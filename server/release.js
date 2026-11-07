// 新カード(acquire:'quest' のカードと、その入手クエスト)の公開スイッチ(2026-10)。
// 公開するまでは誰にも見せない・使わせない。こうしておくと、サーバーを先に本番へ出しても見た目は何も変わらず、
// 「新しいアプリが全員に行き渡ってから、全員同時に公開」ができる(古いアプリの人が新カードと当たる状況を作らない)。
// 先行テスト: 公開前でも、指定したアカウント(u_。ログインで本人確認済みのIDだけ)には見せる。
// 値は DB(app_settings の newcards_release)に置き、管理用トークンつきの POST で再起動なしに切り替える。
const db = require('./db');
const { CARD_DB } = require('../shared/cards');

// 公開グループ。カード定義の release:'<名前>' が同じ名前のスイッチで公開される(2026-11 かわうそ3枚から)。
// acquire:'quest' で release の無いカード(ゼラチネ・リード・ダイスケ)は既定グループ(released そのもの)。
const KNOWN_GROUPS = Array.from(new Set(CARD_DB.map(c => c.release).filter(g => typeof g === 'string')));
const GROUP_RE = /^[a-z0-9_]{1,20}$/;

let released = false;
let groups = {}; // グループ名 → 公開中か(無ければ非公開)
let preview = new Set(); // 先行テストのアカウントID
let retryTimer = null;
let loadedOk = false; // DBから一度でも読めたか。読めていないうちは set で上書きしない(省略した項目を初期値で潰さないため)

// 読み込みと更新は1つずつ順番に実行する。同時に走らせると、遅れて終わった古い読み込みが、直前の更新を上書きする
// (DBは非公開なのに、メモリは公開のまま、という食い違いになる)
let chain = Promise.resolve();
function serial(fn) { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; }

async function readFromDb() {
  const raw = await db.getSetting('newcards_release');
  const j = raw ? JSON.parse(raw) : {};
  released = j.released === true;
  groups = cleanGroups(j.groups);
  preview = new Set(Array.isArray(j.preview) ? j.preview.filter(x => typeof x === 'string' && x.startsWith('u_')) : []);
  loadedOk = true;
}

function cleanGroups(g) {
  const out = {};
  if (g && typeof g === 'object') for (const k of Object.keys(g)) { if (GROUP_RE.test(k) && typeof g[k] === 'boolean') out[k] = g[k]; }
  return out;
}

function load() {
  return serial(async () => {
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
  });
}
function set(next) {
  return serial(async () => {
    if (!loadedOk) await readFromDb(); // まだ読めていなければ先に読む(読めなければ例外=変更しない)
    const r = (next && typeof next.released === 'boolean') ? next.released : released;
    const p = (next && Array.isArray(next.preview)) ? next.preview.filter(x => typeof x === 'string' && x.startsWith('u_')).slice(0, 100) : Array.from(preview);
    const g = Object.assign({}, groups, cleanGroups(next && next.groups)); // 指定したグループだけ変える
    await db.setSetting('newcards_release', JSON.stringify({ released: r, preview: p, groups: g }));
    released = r; preview = new Set(p); groups = g;
    console.log('[release] 変更: ' + (released ? '公開中' : '非公開') + ' / グループ ' + JSON.stringify(groups) + ' / 先行テスト ' + preview.size + '人');
    return state();
  });
}
function state() { return { released, preview: Array.from(preview), groups: Object.assign({}, groups) }; }
function isReleased() { return released; }
// 先行テストの人(または デバッグ用の全解除)か。公開前のカードを見てよい人
function previewTester(userId) { return process.env.UNLOCK_ALL_CARDS === '1' || (typeof userId === 'string' && preview.has(userId)); }
// カードが属する公開グループ。null = 公開スイッチの対象外(最初からあるカード・トークン)
function cardGroup(c) { if (!c) return null; if (typeof c.release === 'string') return c.release; return c.acquire === 'quest' ? 'default' : null; }
// そのグループが全員に公開されているか(先行テストは見ない)
function isGroupOpen(g) { if (!g) return true; if (g === 'default') return released; return groups[g] === true; }
// 既定グループと、カード定義にある全グループが公開済みか
function allOpen() { return released && KNOWN_GROUPS.every(isGroupOpen); }
function groupVisibleTo(g, userId) { return process.env.UNLOCK_ALL_CARDS === '1' || isGroupOpen(g) || previewTester(userId); }
function cardVisibleTo(c, userId) { return groupVisibleTo(cardGroup(c), userId); }
// {グループ名: この人に見せてよいか}(クライアントの表示用)
function groupsVisibleTo(userId) { const out = {}; for (const g of KNOWN_GROUPS) out[g] = groupVisibleTo(g, userId); return out; }
function isKnownGroup(g) { return KNOWN_GROUPS.includes(g); }
// そのプレイヤーに新カードとクエストを見せてよいか。userId は「裏取り済みのID」を渡すこと(index.js の trustedPid / API の requireOwner の後)
function visibleTo(userId) {
  if (process.env.UNLOCK_ALL_CARDS === '1') return true; // デバッグ用の全解除は公開扱い
  return released || (typeof userId === 'string' && preview.has(userId));
}
// テスト用
function _setForTest(next) { released = !!next.released; preview = new Set(next.preview || []); groups = cleanGroups(next.groups); loadedOk = true; }

module.exports = { load, set, state, isReleased, visibleTo, previewTester, cardGroup, isGroupOpen, allOpen, groupVisibleTo, cardVisibleTo, groupsVisibleTo, isKnownGroup, KNOWN_GROUPS, _setForTest };
