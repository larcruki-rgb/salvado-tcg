// 強制更新(2026-10): 古いアプリは、更新するまで対戦を始められない。
// 最低版(minClientV)は DB(app_settings)に置き、管理用トークンつきの POST で再起動なしに切り替える(0 = 無効)。
// 版 = 同梱の client.js の番号(index.html の client.js?v=NNN と、client.js の CLIENT_V)。ブラウザ版は対象外。
const db = require('./db');

const STORE = {
  android: 'https://play.google.com/store/apps/details?id=jp.sarubedo.tcg',
  ios: 'https://apps.apple.com/jp/app/id6790535117',
};
let minClientV = 0;

async function load() {
  try { const v = await db.getSetting('min_client_v'); minClientV = Math.max(0, parseInt(v, 10) || 0); }
  catch (e) { console.error('[app-gate] load error:', e.message); }
  console.log('[app-gate] minClientV=' + minClientV + (minClientV > 0 ? ' (これより古いアプリは対戦不可)' : ' (無効)'));
  return minClientV;
}
async function set(v) {
  const n = Math.max(0, parseInt(v, 10) || 0);
  await db.setSetting('min_client_v', String(n));
  minClientV = n;
  console.log('[app-gate] minClientV を ' + n + ' に変更');
  return n;
}
function get() { return minClientV; }

// アプリ(Capacitor)の WebView からの接続か。配布済みの古いアプリは自分では何も名乗らないので、接続元(Origin)で見分ける。
// iOS: capacitor://localhost / Android: https://localhost(古い設定は http://localhost)。ブラウザ版は game.sarubedo.jp(開発は localhost:ポート)
function isNativeOrigin(origin) {
  return origin === 'capacitor://localhost' || origin === 'https://localhost' || origin === 'http://localhost' || origin === 'ionic://localhost';
}
// 接続時に1回だけ、アプリかどうかと版を socket に載せる
function socketMiddleware(socket, next) {
  const hs = socket.handshake || {}; const auth = hs.auth || {};
  socket.isNativeApp = auth.native === true || isNativeOrigin(hs.headers && hs.headers.origin);
  socket.clientV = Math.max(0, parseInt(auth.clientV, 10) || 0); // 古いクライアントは送らない(=0)
  next();
}
// この接続は対戦を始めてよいか。false の時は理由を伝える(古いクライアントは error を画面に出す)
function blocked(socket) {
  return minClientV > 0 && !!socket.isNativeApp && (socket.clientV || 0) < minClientV;
}
const MESSAGE = '新しいバージョンがあります。ストアでアプリを更新してから遊んでください';

module.exports = { load, set, get, blocked, socketMiddleware, isNativeOrigin, STORE, MESSAGE };
