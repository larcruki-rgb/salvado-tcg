// ロビー掲示板(第1段階): 固定トピック / 投稿 / いいね / 通報 / ブロック / NGワード / 運営お知らせ / 対戦募集の「参加する」
// 投稿はアカウント登録者のみ(req.user)。ゲストは読み取り専用。
// ストア(Apple/Google)のUGC要件: フィルタ・通報・ブロック・運営削除・利用規約同意(クライアント側)を満たす。
const fs = require('fs');
const path = require('path');
const db = require('./db');
const Mailer = require('./InquiryMailer');

const TOPICS = { recruit: '対戦募集', deck: 'デッキ・質問', chat: '雑談', win: '勝利報告' };
const NOTICE_TOPIC = 'notice';
const BODY_MAX = 200;
const POST_INTERVAL_MS = 30 * 1000;   // 1人30秒に1回
const POST_DAILY_MAX = 50;            // 1人1日50件
const REPORT_HIDE_AT = 3;             // 通報3件で自動非表示
const RECRUIT_TTL_MS = 10 * 60 * 1000; // 募集は10分で消える
const REPORT_TO = process.env.BOARD_REPORT_TO || process.env.INQUIRY_TO || 'sarubedopr@gmail.com';
const ADMIN_TOKEN = process.env.BOARD_ADMIN_TOKEN || '';

// ---- スキーマ ----
let schemaReady = null;
function ensure() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const p = db.getPool();
    await p.query(`CREATE TABLE IF NOT EXISTS board_posts (
      id SERIAL PRIMARY KEY,
      topic TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar SMALLINT NOT NULL DEFAULT 1,
      body TEXT NOT NULL,
      room_id TEXT,
      like_count INT NOT NULL DEFAULT 0,
      report_count INT NOT NULL DEFAULT 0,
      hidden BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await p.query(`CREATE INDEX IF NOT EXISTS board_posts_topic_idx ON board_posts (topic, id DESC)`);
    await p.query(`CREATE TABLE IF NOT EXISTS board_likes (post_id INT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (post_id, user_id))`);
    await p.query(`CREATE TABLE IF NOT EXISTS board_reports (post_id INT NOT NULL, user_id TEXT NOT NULL, reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (post_id, user_id))`);
    await p.query(`CREATE TABLE IF NOT EXISTS board_blocks (user_id TEXT NOT NULL, blocked_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, blocked_id))`);
    // モデレーター(運営権限を持つアカウント)。合言葉を配らず、アカウント単位で付け外しする
    await p.query(`CREATE TABLE IF NOT EXISTS board_mods (user_id TEXT PRIMARY KEY, name TEXT, added_at TIMESTAMPTZ NOT NULL DEFAULT now(), added_by TEXT)`);
    await p.query(`ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS hidden_by TEXT`);
  })();
  return schemaReady;
}
async function q(text, params) { await ensure(); return db.getPool().query(text, params); }

// ---- NGワード / 連絡先らしき文字列 ----
let ngWords = [];
function loadNgWords() {
  try {
    ngWords = fs.readFileSync(path.join(__dirname, 'board_ngwords.txt'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')).map(normalize);
  } catch (e) { ngWords = []; }
}
function normalize(s) { return String(s || '').normalize('NFKC').toLowerCase().replace(/[\s　]/g, ''); }
const CONTACT_PATTERNS = [
  /https?:\/\//i, /www\./i, /\.(com|net|jp|org|io|me|tv|xyz)\b/i,
  /[\w.+-]+@[\w-]+\.[\w.]+/,                 // メール
  /\d{2,4}[-‐ー]?\d{2,4}[-‐ー]?\d{3,4}/,        // 電話番号
  /(line|ライン|らいん)\s*(id|ｉｄ|アイディー)?\s*[:：]/i, // LINE ID
  /(discord|ディスコ|インスタ|instagram|twitter|ｘ垢|x垢|@[a-z0-9_]{4,})/i,
];
function checkBody(body) {
  if (typeof body !== 'string') return '本文がありません';
  const t = body.replace(/\r/g, '').trim();
  if (!t) return '本文がありません';
  if ([...t].length > BODY_MAX) return '本文は' + BODY_MAX + '文字までです';
  if ((t.match(/\n/g) || []).length > 6) return '改行が多すぎます';
  for (const re of CONTACT_PATTERNS) if (re.test(t)) return 'URL・連絡先・SNSのIDは投稿できません';
  const n = normalize(t);
  for (const w of ngWords) if (w && n.includes(w)) return '不適切な言葉が含まれています';
  return null;
}

// ---- 投稿制限(メモリ) ----
const lastPostAt = new Map();

function fmtPost(row, me, roomsAccessor, forMod) {
  let roomOpen = false;
  if (row.topic === 'recruit' && row.room_id) {
    const rooms = roomsAccessor && roomsAccessor();
    const room = rooms && rooms.get(row.room_id);
    roomOpen = !!(room && room.state === 'waiting' && (Date.now() - new Date(row.created_at).getTime()) < RECRUIT_TTL_MS);
  }
  return {
    id: row.id, topic: row.topic, userId: row.user_id, name: row.name, avatar: row.avatar, body: row.body,
    roomId: row.topic === 'recruit' ? row.room_id : null, roomOpen,
    likes: row.like_count, liked: !!row.liked, mine: !!(me && me.id === row.user_id),
    createdAt: row.created_at,
    ...(forMod ? { reports: row.report_count, hidden: !!row.hidden } : {}),
  };
}

async function notifyReport({ post, reporter, reason, count }) {
  try {
    if (!process.env.GMAIL_APP_PASSWORD) { console.log('[board] 通報(メール未設定):', post.id, reason); return; }
    const text = `掲示板の投稿が通報されました(${count}件目${count >= REPORT_HIDE_AT ? '・自動非表示' : ''})\n\n` +
      `投稿ID: ${post.id}\nトピック: ${TOPICS[post.topic] || post.topic}\n投稿者: ${post.name} (${post.user_id})\n投稿日時: ${post.created_at}\n本文:\n${post.body}\n\n` +
      `通報者: ${reporter.display_name || reporter.id} (${reporter.id})\n理由: ${reason || '(なし)'}\n\n` +
      `削除する場合: DELETE ${process.env.PUBLIC_BASE_URL || 'https://game.sarubedo.jp'}/board/posts/${post.id} に x-admin-token ヘッダーを付けて送るか、ホタルに「投稿${post.id}を消して」と伝える`;
    await Mailer.getTransporter().sendMail({ from: `"サルベドTCG 掲示板" <${Mailer.MAIL_USER}>`, to: REPORT_TO, subject: `[サルベドTCG] 掲示板の通報 #${post.id}（${count}件目）`, text });
  } catch (e) { console.error('[board] 通報メール失敗:', e.message); }
}

function isAdmin(req) { return !!ADMIN_TOKEN && req.get('x-admin-token') === ADMIN_TOKEN; }

// ---- モデレーター ----
let modSet = null;
async function loadMods() { const r = await q(`SELECT user_id FROM board_mods`); modSet = new Set(r.rows.map(x => x.user_id)); return modSet; }
async function isMod(user) { if (!user) return false; if (!modSet) await loadMods(); return modSet.has(user.id); }
async function findAccountByName(name) {
  const r = await q(`SELECT id, display_name FROM users WHERE email IS NOT NULL AND lower(display_name) = lower($1) LIMIT 1`, [String(name || '').trim()]);
  return r.rows[0] || null;
}

// 通報のレート制限(1人1分に5件)
const reportLog = new Map();
function reportAllowed(userId) {
  const now = Date.now(); const arr = (reportLog.get(userId) || []).filter(t => now - t < 60000);
  if (arr.length >= 5) return false;
  arr.push(now); reportLog.set(userId, arr); if (reportLog.size > 5000) reportLog.clear(); return true;
}

function mount(app, io, roomsAccessor, Auth) {
  loadNgWords();
  const attach = Auth.attachUser, requireAuth = Auth.requireAuth;

  // アプリ(Capacitor WebView)は別オリジンから叩くので、/board/* はプリフライト込みでCORSを許可する
  app.use('/board', (req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token');
    res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/board/topics', (req, res) => res.json({ topics: TOPICS, bodyMax: BODY_MAX }));

  // 一覧: 直近50件(古い方へは before=<id>)。非表示・ブロック相手の投稿は除外。募集は10分で消える
  app.get('/board/posts', attach, async (req, res) => {
    try {
      const topic = String(req.query.topic || 'chat');
      if (!TOPICS[topic]) return res.status(400).json({ error: 'トピックが不正です' });
      const before = parseInt(req.query.before) || null;
      const me = req.user;
      const mod = await isMod(me);
      const params = [topic]; let where = mod ? `p.topic = $1` : `p.topic = $1 AND p.hidden = false`;
      if (topic === 'recruit') { params.push(new Date(Date.now() - RECRUIT_TTL_MS)); where += ` AND p.created_at > $${params.length}`; }
      if (before) { params.push(before); where += ` AND p.id < $${params.length}`; }
      let likedSel = 'false AS liked', blockJoin = '';
      if (me) {
        params.push(me.id);
        likedSel = `EXISTS (SELECT 1 FROM board_likes l WHERE l.post_id = p.id AND l.user_id = $${params.length}) AS liked`;
        blockJoin = ` AND NOT EXISTS (SELECT 1 FROM board_blocks b WHERE b.user_id = $${params.length} AND b.blocked_id = p.user_id)`;
      }
      const r = await q(`SELECT p.*, ${likedSel} FROM board_posts p WHERE ${where}${blockJoin} ORDER BY p.id DESC LIMIT 50`, params);
      const notice = await q(`SELECT * FROM board_posts WHERE topic = $1 AND hidden = false ORDER BY id DESC LIMIT 1`, [NOTICE_TOPIC]);
      res.json({ topic, canMod: mod, posts: r.rows.map(row => fmtPost(row, me, roomsAccessor, mod)), notice: notice.rows[0] ? { id: notice.rows[0].id, body: notice.rows[0].body, createdAt: notice.rows[0].created_at } : null });
    } catch (e) { console.error('[board] list error:', e.message); res.status(500).json({ error: '読み込みに失敗しました' }); }
  });

  // 投稿(登録者のみ)
  app.post('/board/posts', attach, requireAuth, async (req, res) => {
    try {
      const me = req.user;
      const topic = String((req.body && req.body.topic) || '');
      if (!TOPICS[topic]) return res.status(400).json({ error: 'トピックが不正です' });
      const body = String((req.body && req.body.body) || '').replace(/\r/g, '').trim();
      const bad = checkBody(body);
      if (bad) return res.status(400).json({ error: bad });
      const name = me.display_name || 'プレイヤー';
      if (checkBody(name)) return res.status(400).json({ error: '表示名に使えない言葉が含まれています。アカウント設定で名前を変えてください' });
      const now = Date.now();
      // 同じ人の並行リクエストが制限をすり抜けないよう、判定と同時に枠を予約する(失敗したら戻す)
      if (now - (lastPostAt.get(me.id) || 0) < POST_INTERVAL_MS) return res.status(429).json({ error: '投稿は30秒に1回までです' });
      const prevAt = lastPostAt.get(me.id) || 0;
      lastPostAt.set(me.id, now);
      const release = () => { if (lastPostAt.get(me.id) === now) { if (prevAt) lastPostAt.set(me.id, prevAt); else lastPostAt.delete(me.id); } };
      const cnt = await q(`SELECT COUNT(*)::int AS c FROM board_posts WHERE user_id = $1 AND created_at > now() - interval '1 day'`, [me.id]);
      if (cnt.rows[0].c >= POST_DAILY_MAX) { release(); return res.status(429).json({ error: '1日の投稿上限に達しました' }); }
      let roomId = null;
      if (topic === 'recruit' && req.body.roomId) {
        roomId = String(req.body.roomId).toUpperCase().slice(0, 12);
        const rooms = roomsAccessor(); const room = rooms.get(roomId);
        // 自分が作って待機中の部屋だけ募集に載せられる
        if (!room || room.state !== 'waiting' || !(room.playerIds && room.playerIds[0] === me.id)) { release(); return res.status(400).json({ error: '募集できる部屋がありません(ルームを作ってから募集してください)' }); }
      }
      let avatar = parseInt(req.body.avatar) || 1; if (avatar < 1 || avatar > 4) avatar = 1;
      let r;
      try { r = await q(`INSERT INTO board_posts (topic, user_id, name, avatar, body, room_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [topic, me.id, name, avatar, body, roomId]); }
      catch (e) { release(); throw e; }
      if (lastPostAt.size > 5000) lastPostAt.clear();
      const post = fmtPost(r.rows[0], me, roomsAccessor);
      try { io.emit('boardPost', { topic, id: post.id }); } catch (e) {}
      res.json({ ok: true, post });
    } catch (e) { console.error('[board] post error:', e.message); res.status(500).json({ error: '投稿に失敗しました' }); }
  });

  // いいね(トグル)
  app.post('/board/posts/:id/like', attach, requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id); if (!id) return res.status(400).json({ error: 'id' });
      const ex = await q(`SELECT 1 FROM board_likes WHERE post_id = $1 AND user_id = $2`, [id, req.user.id]);
      let liked;
      if (ex.rows.length) { await q(`DELETE FROM board_likes WHERE post_id = $1 AND user_id = $2`, [id, req.user.id]); liked = false; }
      else { await q(`INSERT INTO board_likes (post_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, req.user.id]); liked = true; }
      const r = await q(`UPDATE board_posts SET like_count = (SELECT COUNT(*) FROM board_likes WHERE post_id = $1) WHERE id = $1 RETURNING like_count`, [id]);
      res.json({ ok: true, liked, likes: r.rows[0] ? r.rows[0].like_count : 0 });
    } catch (e) { res.status(500).json({ error: '失敗しました' }); }
  });

  // 通報: 3件で自動非表示 + 運営にメール
  app.post('/board/posts/:id/report', attach, requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id); if (!id) return res.status(400).json({ error: 'id' });
      const reason = String((req.body && req.body.reason) || '').slice(0, 200);
      const p = await q(`SELECT * FROM board_posts WHERE id = $1`, [id]);
      if (!p.rows[0]) return res.status(404).json({ error: '投稿がありません' });
      if (p.rows[0].user_id === req.user.id) return res.status(400).json({ error: '自分の投稿は通報できません' });
      if (!reportAllowed(req.user.id)) return res.status(429).json({ error: '通報が多すぎます。少し待ってください' });
      const ins = await q(`INSERT INTO board_reports (post_id, user_id, reason) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [id, req.user.id, reason]);
      const r = await q(`UPDATE board_posts SET report_count = (SELECT COUNT(*) FROM board_reports WHERE post_id = $1), hidden = hidden OR (SELECT COUNT(*) FROM board_reports WHERE post_id = $1) >= $2 WHERE id = $1 RETURNING report_count, hidden`, [id, REPORT_HIDE_AT]);
      if (ins.rowCount === 1) notifyReport({ post: p.rows[0], reporter: req.user, reason, count: r.rows[0].report_count }); // 同じ人の重複通報ではメールを送らない
      res.json({ ok: true, hidden: r.rows[0].hidden });
    } catch (e) { console.error('[board] report error:', e.message); res.status(500).json({ error: '失敗しました' }); }
  });

  // ブロック / 解除
  app.post('/board/block', attach, requireAuth, async (req, res) => {
    try {
      const target = String((req.body && req.body.userId) || '');
      if (!target || target === req.user.id) return res.status(400).json({ error: '対象が不正です' });
      await q(`INSERT INTO board_blocks (user_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.user.id, target]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: '失敗しました' }); }
  });
  app.delete('/board/block/:userId', attach, requireAuth, async (req, res) => {
    try { await q(`DELETE FROM board_blocks WHERE user_id = $1 AND blocked_id = $2`, [req.user.id, String(req.params.userId)]); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: '失敗しました' }); }
  });
  app.get('/board/blocks', attach, requireAuth, async (req, res) => {
    try { const r = await q(`SELECT b.blocked_id, u.display_name FROM board_blocks b LEFT JOIN users u ON u.id = b.blocked_id WHERE b.user_id = $1 ORDER BY b.created_at DESC`, [req.user.id]); res.json({ blocked: r.rows.map(x => ({ userId: x.blocked_id, name: x.display_name || x.blocked_id })) }); }
    catch (e) { res.status(500).json({ error: '失敗しました' }); }
  });

  // 削除(本人 or 運営) = 非表示
  app.delete('/board/posts/:id', attach, async (req, res) => {
    try {
      const id = parseInt(req.params.id); if (!id) return res.status(400).json({ error: 'id' });
      const p = await q(`SELECT user_id FROM board_posts WHERE id = $1`, [id]);
      if (!p.rows[0]) return res.status(404).json({ error: '投稿がありません' });
      const owner = req.user && req.user.id === p.rows[0].user_id;
      const admin = isAdmin(req), mod = await isMod(req.user);
      if (!owner && !admin && !mod) return res.status(403).json({ error: '削除できません' });
      await q(`UPDATE board_posts SET hidden = true, hidden_by = $2 WHERE id = $1`, [id, admin && !req.user ? 'admin' : req.user.id]);
      try { io.emit('boardPost', { id, removed: true }); } catch (e) {}
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: '失敗しました' }); }
  });
  // 非表示の投稿を戻す(運営)。通報は消して再度の自動非表示を防ぐ
  app.post('/board/posts/:id/restore', attach, async (req, res) => {
    try {
      const id = parseInt(req.params.id); if (!id) return res.status(400).json({ error: 'id' });
      if (!isAdmin(req) && !(await isMod(req.user))) return res.status(403).json({ error: '権限がありません' });
      await q(`DELETE FROM board_reports WHERE post_id = $1`, [id]);
      await q(`UPDATE board_posts SET hidden = false, hidden_by = NULL, report_count = 0 WHERE id = $1`, [id]);
      try { io.emit('boardPost', { id }); } catch (e) {}
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: '失敗しました' }); }
  });

  // 運営お知らせ(最上段に固定)。x-admin-token が必要
  app.post('/board/notice', attach, async (req, res) => {
    try {
      if (!isAdmin(req) && !(await isMod(req.user))) return res.status(403).json({ error: '権限がありません' });
      const body = String((req.body && req.body.body) || '').trim().slice(0, 500);
      if (!body) return res.status(400).json({ error: '本文がありません' });
      await q(`INSERT INTO board_posts (topic, user_id, name, avatar, body) VALUES ($1,'admin','運営',1,$2)`, [NOTICE_TOPIC, body]);
      try { io.emit('boardPost', { topic: NOTICE_TOPIC }); } catch (e) {}
      res.json({ ok: true });
    } catch (e) { console.error('[board] notice error:', e.message); res.status(500).json({ error: '失敗しました' }); }
  });
  app.delete('/board/notice/:id', attach, async (req, res) => {
    try {
      if (!isAdmin(req) && !(await isMod(req.user))) return res.status(403).json({ error: '権限がありません' });
      const id = parseInt(req.params.id); if (!id) return res.status(400).json({ error: 'id' });
      await q(`UPDATE board_posts SET hidden = true, hidden_by = $2 WHERE id = $1 AND topic = $3`, [id, req.user ? req.user.id : 'admin', NOTICE_TOPIC]);
      try { io.emit('boardPost', { topic: NOTICE_TOPIC }); } catch (e) {}
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: '失敗しました' }); }
  });
  // モデレーターの付け外し(合言葉が必要)。名前はアカウントの表示名(重複なし)
  app.get('/board/mods', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
    try { const r = await q(`SELECT user_id, name, added_at FROM board_mods ORDER BY added_at`); res.json({ mods: r.rows }); } catch (e) { res.status(500).json({ error: '失敗しました' }); }
  });
  app.post('/board/mods', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
    try {
      const u = await findAccountByName(req.body && req.body.name);
      if (!u) return res.status(404).json({ error: 'その表示名のアカウントが見つかりません' });
      await q(`INSERT INTO board_mods (user_id, name, added_by) VALUES ($1,$2,'admin') ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name`, [u.id, u.display_name]);
      await loadMods();
      res.json({ ok: true, mod: { userId: u.id, name: u.display_name } });
    } catch (e) { res.status(500).json({ error: '失敗しました' }); }
  });
  app.delete('/board/mods/:name', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
    try {
      const u = await findAccountByName(req.params.name);
      const r = await q(`DELETE FROM board_mods WHERE user_id = $1 OR lower(name) = lower($2)`, [u ? u.id : '', String(req.params.name || '')]);
      await loadMods();
      res.json({ ok: true, removed: r.rowCount });
    } catch (e) { res.status(500).json({ error: '失敗しました' }); }
  });
  // NGワード辞書の再読込(運営)
  app.post('/board/reload-ngwords', (req, res) => { if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' }); loadNgWords(); res.json({ ok: true, count: ngWords.length }); });
}

module.exports = { mount, checkBody, TOPICS, BODY_MAX, loadNgWords };
