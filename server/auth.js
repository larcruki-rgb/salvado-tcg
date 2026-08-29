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

function newId(prefix) { return prefix + crypto.randomBytes(9).toString('base64url'); }
function newToken() { return crypto.randomBytes(32).toString('base64url'); }
function isAccountId(id) { return typeof id === 'string' && id.startsWith('u_'); }

function publicUser(u) {
  return { id: u.id, email: u.email, display_name: u.display_name, created_at: u.created_at };
}

// --- ログイン試行の簡易レート制限(IPごと 10分で10回) ---
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  let a = attempts.get(ip) || [];
  a = a.filter(t => now - t < 10 * 60 * 1000);
  if (a.length >= 10) { attempts.set(ip, a); return true; }
  a.push(now); attempts.set(ip, a);
  if (attempts.size > 10000) attempts.clear();
  return false;
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
  await Mailer.getTransporter().sendMail({
    from: `サルベドカードゲーム <${Mailer.MAIL_USER}>`,
    to: email,
    subject: '【サルベドカードゲーム】パスワード再設定のご案内',
    text: `パスワード再設定のリクエストを受け付けました。\n\n以下のリンクから新しいパスワードを設定してください(有効期限: 1時間)。\n${url}\n\n心当たりがない場合は、このメールは無視してください。`,
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

  // 登録
  app.post('/auth/register', async (req, res) => {
    try {
      if (tooManyAttempts(clientIp(req))) return res.status(429).json({ error: '試行回数が多すぎます。しばらく待ってください' });
      let { email, password, name } = req.body || {};
      email = (email || '').trim().toLowerCase();
      name = (name || '').trim().slice(0, 30);
      if (!EMAIL_RE.test(email) || email.length > 200) return res.status(400).json({ error: 'メールアドレスの形式が正しくありません' });
      if (typeof password !== 'string' || password.length < PASSWORD_MIN) return res.status(400).json({ error: `パスワードは${PASSWORD_MIN}文字以上にしてください` });
      if (password.length > 200) return res.status(400).json({ error: 'パスワードが長すぎます' });
      if (!name) return res.status(400).json({ error: 'プレイヤー名を入力してください' });
      if (await db.getUserByEmail(email)) return res.status(409).json({ error: 'このメールアドレスは既に登録されています' });
      const id = newId('u_');
      const hash = await bcrypt.hash(password, 10);
      await db.createAccount(id, email, hash, name);
      const token = newToken();
      await db.createSession(id, token);
      const user = await db.getUserByToken(token);
      res.json({ token, user: publicUser(user) });
    } catch (e) {
      console.error('[auth] register error:', e.message);
      if (/users_email_lower_uq/.test(e.message)) return res.status(409).json({ error: 'このメールアドレスは既に登録されています' });
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
      if (!ok) return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' });
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
      res.json({ user: publicUser(req.user), stats });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 表示名変更
  app.post('/auth/name', requireAuth, async (req, res) => {
    try {
      const name = ((req.body && req.body.name) || '').trim().slice(0, 30);
      if (!name) return res.status(400).json({ error: 'プレイヤー名を入力してください' });
      await db.updateDisplayName(req.user.id, name);
      res.json({ ok: true, display_name: name });
    } catch (e) { res.status(500).json({ error: e.message }); }
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

module.exports = { mount, requireOwner, socketMiddleware, trustedPid, isAccountId };
