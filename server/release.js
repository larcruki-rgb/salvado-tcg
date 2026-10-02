// 新カード(acquire:'quest' のカードと、その入手クエスト)の公開スイッチ(2026-10)。
// 公開するまでは誰にも見せない・使わせない。こうしておくと、サーバーを先に本番へ出しても見た目は何も変わらず、
// 「新しいアプリが全員に行き渡ってから、全員同時に公開」ができる(古いアプリの人が新カードと当たる状況を作らない)。
// 先行テスト: 公開前でも、指定したアカウント(u_。ログインで本人確認済みのIDだけ)には見せる。
// 値は DB(app_settings の newcards_release)に置き、管理用トークンつきの POST で再起動なしに切り替える。
const db = require('./db');

let released = false;
let preview = new Set(); // 先行テストのアカウントID
let retryTimer = null;
let loadedOk = false; // DBから一度でも読めたか。読めていないうちは set で上書きしない(省略した項目を初期値で潰さないため)

async function readFromDb() {
  const raw = await db.getSetting('newcards_release');
  const j = raw ? JSON.parse(raw) : {};
  released = j.released === true;
  preview = new Set(Array.isArray(j.preview) ? j.preview.filter(x => typeof x === 'string' && x.startsWith('u_')) : []);
  loadedOk = true;
}

async function load() {
  try {
    await readFromDb();
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  } catch (e) {
    // 読めない間は「非公開」のまま動く(安全側)。読めるまで30秒おきにやり直す
    console.error('[release] load error(30秒後に再試行):', e.message);
    if (!retryTimer) { retryTimer = setTimeout(() => { retryTimer = null; load(); }, 30000); if (retryTimer.unref) retryTimer.unref(); }
  }
  console.log('[release] 新カード: ' + (released ? '公開中' : '非公開') + ' / 先行テスト ' + preview.size + '人');
  return state();
}
async function set(next) {
  if (!loadedOk) await readFromDb(); // まだ読めていなければ先に読む(読めなければ例外=変更しない)
  const r = (next && typeof next.released === 'boolean') ? next.released : released;
  const p = (next && Array.isArray(next.preview)) ? next.preview.filter(x => typeof x === 'string' && x.startsWith('u_')).slice(0, 100) : Array.from(preview);
  await db.setSetting('newcards_release', JSON.stringify({ released: r, preview: p }));
  released = r; preview = new Set(p);
  console.log('[release] 変更: ' + (released ? '公開中' : '非公開') + ' / 先行テスト ' + preview.size + '人');
  return state();
}
function state() { return { released, preview: Array.from(preview) }; }
function isReleased() { return released; }
// そのプレイヤーに新カードとクエストを見せてよいか。userId は「裏取り済みのID」を渡すこと(index.js の trustedPid / API の requireOwner の後)
function visibleTo(userId) {
  if (process.env.UNLOCK_ALL_CARDS === '1') return true; // デバッグ用の全解除は公開扱い
  return released || (typeof userId === 'string' && preview.has(userId));
}
// テスト用
function _setForTest(next) { released = !!next.released; preview = new Set(next.preview || []); loadedOk = true; }

module.exports = { load, set, state, isReleased, visibleTo, _setForTest };
