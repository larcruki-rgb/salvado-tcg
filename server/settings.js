// アプリ全体の設定(app_settings)を、短いキャッシュつきで読む。再起動なしに切り替えたい値はここを通す。
// 値は JSON 文字列で保存する。読めない間は既定値を返す(安全側)。
const db = require('./db');
const cache = new Map(); // key -> { value, at }
const TTL_MS = 30 * 1000;

async function get(key, def) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    const raw = await db.getSetting(key);
    const value = (raw === null || raw === undefined) ? def : JSON.parse(raw);
    cache.set(key, { value, at: Date.now() });
    return value;
  } catch (e) {
    console.error('[settings] ' + key + ' 読み込み失敗:', e.message);
    return hit ? hit.value : def;
  }
}
async function set(key, value) {
  await db.setSetting(key, JSON.stringify(value));
  cache.set(key, { value, at: Date.now() });
  return value;
}
function invalidate(key) { cache.delete(key); }
module.exports = { get, set, invalidate };
