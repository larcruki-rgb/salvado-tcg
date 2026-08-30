// アカウント機能(メール+パスワード) — 2026-08
// 方針: 既存の匿名ID(p_xxx)はそのまま。ログインすると u_xxx のアカウントIDで遊ぶようになり、
//       勝敗・デッキはそのIDに紐付いて貯まる(過去データの移行はしない)。
// トークンはDB(user_sessions)に保存するので、サーバー側に秘密鍵の環境変数は不要。
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const Mailer = require('./InquiryMailer');

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://game.sarubedo.jp';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;
const NAME_CHANGE_LIMIT = 2;      // 30日あたりの名前変更回数
const NAME_CHANGE_WINDOW_DAYS = 30;
const NAME_TAKEN_MSG = 'このプレイヤー名は既に使われています';

function normalizeName(n) { return (n || '').replace(/\s+/g, ' ').trim().slice(0, 30); }

async function nameChangeInfo(userId) {
  const list = await db.getRecentNameChanges(userId, NAME_CHANGE_WINDOW_DAYS);
  const remaining = Math.max(0, NAME_CHANGE_LIMIT - list.length);
  const nextAt = remaining > 0 ? null : new Date(new Date(list[0]).getTime() + NAME_CHANGE_WINDOW_DAYS * 86400000);
  return { remaining, limit: NAME_CHANGE_LIMIT, windowDays: NAME_CHANGE_WINDOW_DAYS, nextAt };
}
// アカウントの表示名を小文字でメモリに保持(ゲスト名との衝突判定を同期的に行うため)。
// 起動時にDBから読み込み、登録/改名/削除で更新する(サーバーは単一プロセス前提)。
const accountNames = new Set();
let namesLoaded = false;
async function loadAccountNames() {
  try {
    const list = await db.getAllAccountNames();
    accountNames.clear(); list.forEach(n => accountNames.add(n.toLowerCase()));
    namesLoaded = true;
    console.log('[auth] account names loaded:', accountNames.size);
  } catch (e) { console.error('[auth] loadAccountNames error:', e.message); setTimeout(loadAccountNames, 30000); }
}
function isReservedByAccount(name) { return !!name && accountNames.has(normalizeName(name).toLowerCase()); }
// ゲスト(アカウントで裏取りされていない接続)がアカウント名を名乗っていたら「(ゲスト)」を付ける
function guestSafeName(name, trustedPid) {
  if (!name || isAccountId(trustedPid)) return name;
  return isReservedByAccount(name) ? name + '(ゲスト)' : name;
}
function fmtDate(d) { const x = new Date(d); return `${x.getFullYear()}/${x.getMonth()+1}/${x.getDate()}`; }

function newId(prefix) { return prefix + crypto.randomBytes(9).toString('base64url'); }
function newToken() { return crypto.randomBytes(32).toString('base64url'); }
function isAccountId(id) { return typeof id === 'string' && id.startsWith('u_'); }

function publicUser(u) {
  return { id: u.id, email: u.email, display_name: u.display_name, created_at: u.created_at };
}

// --- 総当たり対策: 失敗した試行だけ数える(IPごと 10分で10回失敗したら一時停止) ---
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  let a = (attempts.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  attempts.set(ip, a);
  return a.length >= 10;
}
function recordFail(ip) {
  const a = attempts.get(ip) || [];
  a.push(Date.now()); attempts.set(ip, a);
  if (attempts.size > 10000) attempts.clear();
}

function clientIp(req) { return req.headers['x-forwarded-for'] || req.socket.remoteAddress; }
function bearer(req) {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

// Authorization: Bearer <token> を解決して req.user に載せる(無ければ null)
async function attachUser(req, res, next) {
  try { req.user = await db.getUserByToken(bearer(req)); }
  catch (e) { req.user = null; }
  next();
}
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'ログインが必要です' });
  next();
}

async function sendResetMail(email, token) {
  const url = `${PUBLIC_BASE_URL}/?reset=${token}`;
  if (!process.env.GMAIL_APP_PASSWORD) {
    console.log('[auth] (mail未設定) パスワード再設定URL:', url);
    return;
  }
  const text = [
    'サルベドカードゲームをご利用いただきありがとうございます。',
    '',
    `このメールは、サルベドカードゲーム(${PUBLIC_BASE_URL})で「パスワードを忘れた」の操作が行われたためお送りしています。`,
    '',
    '下のリンクを開いて、新しいパスワードを設定してください。',
    url,
    '',
    '・リンクの有効期限は1時間です',
    '・期限が切れた場合は、もう一度「パスワードを忘れた」からやり直してください',
    '・この操作に心当たりがない場合は、このメールを無視してください(パスワードは変更されません)',
    '',
    '------------------------------',
    'サルベドカードゲーム 運営',
    'YouTube「サルベド漫画」公式カードゲーム',
    PUBLIC_BASE_URL,
    'お問い合わせ: ゲーム内ロビー最下部の「お問い合わせ」フォームから',
  ].join('\n');
  const html = `
    <div style="font-family:sans-serif;font-size:15px;line-height:1.8;color:#333;max-width:560px;">
      <p>サルベドカードゲームをご利用いただきありがとうございます。</p>
      <p>このメールは、<a href="${PUBLIC_BASE_URL}">サルベドカードゲーム</a>で「パスワードを忘れた」の操作が行われたためお送りしています。</p>
      <p>下のボタンから、新しいパスワードを設定してください。</p>
      <p style="margin:24px 0;"><a href="${url}" style="background:#2fb6cb;color:#fff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:999px;display:inline-block;">新しいパスワードを設定する</a></p>
      <p style="font-size:13px;color:#666;">ボタンが開けない場合はこちらのURLをブラウザに貼り付けてください:<br><a href="${url}">${url}</a></p>
      <ul style="font-size:13px;color:#666;">
        <li>リンクの有効期限は1時間です</li>
        <li>期限が切れた場合は、もう一度「パスワードを忘れた」からやり直してください</li>
        <li>この操作に心当たりがない場合は、このメールを無視してください(パスワードは変更されません)</li>
      </ul>
      <hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
      <p style="font-size:12px;color:#888;">サルベドカードゲーム 運営<br>YouTube「サルベド漫画」公式カードゲーム<br><a href="${PUBLIC_BASE_URL}">${PUBLIC_BASE_URL}</a><br>お問い合わせ: ゲーム内ロビー最下部の「お問い合わせ」フォームから</p>
    </div>`;
  await Mailer.getTransporter().sendMail({
    from: `サルベドカードゲーム <${Mailer.MAIL_USER}>`,
    replyTo: Mailer.MAIL_USER,
    to: email,
    subject: 'パスワード再設定のご案内 - サルベドカードゲーム',
    text, html,
  });
}

function mount(app) {
  // CORSプリフライト(アプリのWebViewはオリジンが異なる)
  app.options(['/auth/*', '/api/user/*'], (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.sendStatus(204);
  });
  app.use(['/auth', '/api/user'], attachUser);
  loadAccountNames();

  // ゲストの名前登録前チェック(アカウントで使われている名前は使えない)
  app.get('/auth/name-check', (req, res) => {
    const name = normalizeName(req.query.name);
    if (!name) return res.json({ available: false, error: '名前を入力してください' });
    if (isReservedByAccount(name)) return res.json({ available: false, error: 'この名前はアカウント登録している人が使っています' });
    res.json({ available: true });
  });

  // 登録
  app.post('/auth/register', async (req, res) => {
    try {
      if (tooManyAttempts(clientIp(req))) return res.status(429).json({ error: '試行回数が多すぎます。しばらく待ってください' });
      let { email, password, name } = req.body || {};
      email = (email || '').trim().toLowerCase();
      name = normalizeName(name);
      if (!EMAIL_RE.test(email) || email.length > 200) return res.status(400).json({ error: 'メールアドレスの形式が正しくありません' });
      if (typeof password !== 'string' || password.length < PASSWORD_MIN) return res.status(400).json({ error: `パスワードは${PASSWORD_MIN}文字以上にしてください` });
      if (password.length > 200) return res.status(400).json({ error: 'パスワードが長すぎます' });
      if (!name) return res.status(400).json({ error: 'プレイヤー名を入力してください' });
      if (await db.getUserByEmail(email)) return res.status(409).json({ error: 'このメールアドレスは既に登録されています' });
      if (await db.isDisplayNameTaken(name)) return res.status(409).json({ error: NAME_TAKEN_MSG });
      const id = newId('u_');
      const hash = await bcrypt.hash(password, 10);
      await db.createAccount(id, email, hash, name);
      accountNames.add(name.toLowerCase());
      const token = newToken();
      await db.createSession(id, token);
      const user = await db.getUserByToken(token);
      res.json({ token, user: publicUser(user) });
    } catch (e) {
      console.error('[auth] register error:', e.message);
      if (/users_email_lower_uq/.test(e.message)) return res.status(409).json({ error: 'このメールアドレスは既に登録されています' });
      if (/users_account_name_uq/.test(e.message)) return res.status(409).json({ error: NAME_TAKEN_MSG });
      res.status(500).json({ error: '登録に失敗しました' });
    }
  });

  // ログイン
  app.post('/auth/login', async (req, res) => {
    try {
      if (tooManyAttempts(clientIp(req))) return res.status(429).json({ error: '試行回数が多すぎます。しばらく待ってください' });
      let { email, password } = req.body || {};
      email = (email || '').trim().toLowerCase();
      const u = email && typeof password === 'string' ? await db.getUserByEmail(email) : null;
      const ok = u && u.password_hash && await bcrypt.compare(password, u.password_hash);
      if (!ok) { recordFail(clientIp(req)); return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' }); }
      const token = newToken();
      await db.createSession(u.id, token);
      res.json({ token, user: publicUser(u) });
    } catch (e) {
      console.error('[auth] login error:', e.message);
      res.status(500).json({ error: 'ログインに失敗しました' });
    }
  });

  app.post('/auth/logout', requireAuth, async (req, res) => {
    try { await db.deleteSession(bearer(req)); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 自分の情報 + 戦績
  app.get('/auth/me', requireAuth, async (req, res) => {
    try {
      const stats = await db.getUserStats(req.user.id);
      const nameChange = await nameChangeInfo(req.user.id);
      res.json({ user: publicUser(req.user), stats, nameChange });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 表示名変更
  app.post('/auth/name', requireAuth, async (req, res) => {
    try {
      const name = normalizeName(req.body && req.body.name);
      if (!name) return res.status(400).json({ error: 'プレイヤー名を入力してください' });
      if (name === (req.user.display_name || '')) return res.json({ ok: true, display_name: name });
      const info = await nameChangeInfo(req.user.id);
      if (info.remaining <= 0) return res.status(429).json({ error: `名前の変更は${NAME_CHANGE_WINDOW_DAYS}日間に${NAME_CHANGE_LIMIT}回までです。次に変更できるのは ${fmtDate(info.nextAt)} 以降です` });
      if (await db.isDisplayNameTaken(name, req.user.id)) return res.status(409).json({ error: NAME_TAKEN_MSG });
      await db.updateDisplayName(req.user.id, name);
      if (req.user.display_name) accountNames.delete(req.user.display_name.toLowerCase());
      accountNames.add(name.toLowerCase());
      const after = await nameChangeInfo(req.user.id);
      res.json({ ok: true, display_name: name, nameChange: after });
    } catch (e) {
      if (/users_account_name_uq/.test(e.message)) return res.status(409).json({ error: NAME_TAKEN_MSG });
      res.status(500).json({ error: e.message });
    }
  });

  // パスワード変更(ログイン中)
  app.post('/auth/password', requireAuth, async (req, res) => {
    try {
      const { current, password } = req.body || {};
      if (typeof password !== 'string' || password.length < PASSWORD_MIN) return res.status(400).json({ error: `パスワードは${PASSWORD_MIN}文字以上にしてください` });
      const ok = await bcrypt.compare(current || '', req.user.password_hash || '');
      if (!ok) return res.status(401).json({ error: '現在のパスワードが違います' });
      await db.updatePassword(req.user.id, await bcrypt.hash(password, 10));
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // パスワード忘れ → メールで再設定リンク(存在しないメールでも同じ応答にする)
  app.post('/auth/forgot', async (req, res) => {
    try {
      if (tooManyAttempts(clientIp(req))) return res.status(429).json({ error: '試行回数が多すぎます。しばらく待ってください' });
      const email = ((req.body && req.body.email) || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'メールアドレスの形式が正しくありません' });
      recordFail(clientIp(req));
      const u = await db.getUserByEmail(email);
      if (u) {
        const token = newToken();
        await db.createPasswordReset(u.id, token, new Date(Date.now() + 60 * 60 * 1000));
        await sendResetMail(u.email, token);
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('[auth] forgot error:', e.message);
      res.status(500).json({ error: 'メール送信に失敗しました' });
    }
  });

  app.post('/auth/reset', async (req, res) => {
    try {
      const { token, password } = req.body || {};
      if (typeof password !== 'string' || password.length < PASSWORD_MIN) return res.status(400).json({ error: `パスワードは${PASSWORD_MIN}文字以上にしてください` });
      const userId = token ? await db.consumePasswordReset(String(token)) : null;
      if (!userId) return res.status(400).json({ error: 'リンクが無効か、期限切れです。もう一度やり直してください' });
      await db.updatePassword(userId, await bcrypt.hash(password, 10));
      await db.deleteAllSessions(userId);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // アカウント削除(パスワード確認あり)
  app.delete('/auth/account', requireAuth, async (req, res) => {
    try {
      const ok = await bcrypt.compare((req.body && req.body.password) || '', req.user.password_hash || '');
      if (!ok) return res.status(401).json({ error: 'パスワードが違います' });
      await db.deleteAccount(req.user.id);
      if (req.user.display_name) accountNames.delete(req.user.display_name.toLowerCase());
      res.json({ ok: true });
    } catch (e) {
      console.error('[auth] delete error:', e.message);
      res.status(500).json({ error: '削除に失敗しました' });
    }
  });
}

// /api/user/:id への書き込みは、アカウントID(u_)なら本人のトークン必須
function requireOwner(req, res, next) {
  const id = req.params.id;
  if (isAccountId(id)) {
    if (!req.user || req.user.id !== id) return res.status(403).json({ error: 'ログインが必要です' });
  }
  next();
}

// socket.io: 接続時の auth.token を解決して socket.accountId に載せる
function socketMiddleware(socket, next) {
  const token = socket.handshake && socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next();
  db.getUserByToken(token).then(u => { if (u) socket.accountId = u.id; next(); }).catch(() => next());
}
// アカウントIDを名乗る場合はトークンで裏取り済みのものだけ信用する(他人の戦績への混入防止)
function trustedPid(socket, pid) {
  if (isAccountId(pid) && socket.accountId !== pid) return null;
  return pid;
}

module.exports = { mount, requireOwner, socketMiddleware, trustedPid, isAccountId, guestSafeName, isReservedByAccount };
