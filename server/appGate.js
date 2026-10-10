// 強制更新(2026-10): 古いアプリは、更新するまで対戦を始められない。
// 最低版(minClientV)は DB(app_settings)に置き、管理用トークンつきの POST で再起動なしに切り替える(0 = 無効)。
// 版 = 同梱の client.js の番号(index.html の client.js?v=NNN と、client.js の CLIENT_V)。ブラウザ版は対象外。
const db = require('./db');

const STORE = {
  android: 'https://play.google.com/store/apps/details?id=jp.sarubedo.tcg',
  ios: 'https://apps.apple.com/jp/app/id6790535117',
};
let minClientV = 0;
// おすすめ更新(2026-10-11): 強制はしないが、同梱の ads.js の版がこれより古いアプリには「新しい版があります」の帯を出す。
// client.js の版が同じで区別できない 1.3.1(ads.js v6) と 1.3.2(ads.js v7) を見分けるために ads.js の版を使う。0 = 無効
let recommendAdsV = 0;

// 起動時に読む。DB障害で読めなかった時は、読めるまで30秒おきにやり直す(読めないまま「無効」で動き続けない)
let retryTimer = null;
async function load() {
  try { const v = await db.getSetting('min_client_v'); minClientV = Math.max(0, parseInt(v, 10) || 0); const r = await db.getSetting('recommend_ads_v'); recommendAdsV = Math.max(0, parseInt(r, 10) || 0); if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } }
  catch (e) {
    console.error('[app-gate] load error(30秒後に再試行):', e.message);
    if (!retryTimer) { retryTimer = setTimeout(() => { retryTimer = null; load(); }, 30000); if (retryTimer.unref) retryTimer.unref(); }
  }
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
async function setRecommendAdsV(v) {
  const n = Math.max(0, parseInt(v, 10) || 0);
  await db.setSetting('recommend_ads_v', String(n));
  recommendAdsV = n;
  console.log('[app-gate] recommendAdsV を ' + n + ' に変更');
  return n;
}
function getRecommendAdsV() { return recommendAdsV; }

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

module.exports = { load, set, get, setRecommendAdsV, getRecommendAdsV, blocked, socketMiddleware, isNativeOrigin, STORE, MESSAGE };
