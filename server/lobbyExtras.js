// ロビー上部に出す追加情報(2026-10 人気化の作戦 Phase 0):
//  - 対戦会(毎週の決まった時間)のカウントダウン  … 設定 meetups
//  - 今日遊んだ人の数(「いまオンライン」の代わりに出す。正直で大きい数字)  … 設定 lobby_flags.showPlayedToday
//  - 初期デッキの種類  … 設定 lobby_flags.starterDeck
// 日程や表示の切り替えはサーバー側の設定で、アプリの更新なしに変えられる。時刻は日本時間(UTC+9 固定)で扱う。
const Settings = require('./settings');
const db = require('./db');
const { STARTER_DECKS } = require('../shared/cards');
const Release = require('./release');

const JST_MS = 9 * 60 * 60 * 1000;
const DEFAULT_MEETUPS = {
  label: '対戦会',
  from: '2026-10-11',   // この日より前の回は数えない(初回の日付)
  slots: [ { dow: 0, h: 13, m: 0, len: 30 }, { dow: 4, h: 13, m: 0, len: 30 } ], // 日曜13:00-13:30、木曜13:00-13:30
};
const DEFAULT_FLAGS = { showPlayedToday: true, starterDeck: 'fantasy', newcardsTeaser: 'auto', newcardsWhen: '近日', newcardsGroup: 'kawauso' }; // newcardsGroup: 予告パネルに出すグループ(server/lobby_teaser.json のキー) // newcardsTeaser: 'auto'=公開前は予告・公開後は登場、'off'=出さない。newcardsWhen: 予告の時期の文言('近日' / '10/11(日)' など) // 2026-10-04 ケーさん「今日遊んだ人数にしてもういい」→既定で表示

function jst(d) { return new Date(d.getTime() + JST_MS); } // 日本時間の年月日時分を UTC の getter で読むためのずらし
function fromJst(y, mo, d, h, mi) { return new Date(Date.UTC(y, mo, d, h, mi) - JST_MS); }

// 今(now)を基準に、開催中かどうかと次の回を返す
function meetupInfo(cfg, now) {
  now = now || new Date();
  const slots = Array.isArray(cfg.slots) ? cfg.slots.filter(s => s && Number.isInteger(s.dow) && Number.isInteger(s.h)) : [];
  if (!slots.length) return null;
  const fromDate = cfg.from ? new Date(cfg.from + 'T00:00:00+09:00') : null;
  const j = jst(now); const y = j.getUTCFullYear(), mo = j.getUTCMonth(), d = j.getUTCDate(), dow = j.getUTCDay();
  let active = null, next = null;
  for (let off = -1; off <= 14; off++) {
    for (const s of slots) {
      const dd = new Date(Date.UTC(y, mo, d + off)); if (dd.getUTCDay() !== s.dow) continue;
      const start = fromJst(dd.getUTCFullYear(), dd.getUTCMonth(), dd.getUTCDate(), s.h, s.m || 0);
      const end = new Date(start.getTime() + (s.len || 30) * 60000);
      if (fromDate && start < fromDate) continue;
      if (start <= now && now < end) { if (!active || start < active.start) active = { start, end }; }
      else if (start > now) { if (!next || start < next.start) next = { start, end }; }
    }
  }
  const out = { label: cfg.label || '対戦会', active: !!active, slots: slots.map(s => ({ dow: s.dow, h: s.h, m: s.m || 0, len: s.len || 30 })) };
  if (fromDate) { out.from = cfg.from; out.notStarted = fromDate > now; } // 初回より前(まだ1回も開いていない)なら、表示を「初回は〜」に切り替える
  if (active) { out.start = active.start.toISOString(); out.end = active.end.toISOString(); }
  if (next) { out.nextStart = next.start.toISOString(); out.nextEnd = next.end.toISOString(); }
  return out;
}

// 今日(日本時間)に1回でも対戦した人の数(全モード。ゲストも含む)
let playedCache = { at: 0, n: 0 };
async function playedToday() {
  if (Date.now() - playedCache.at < 60000) return playedCache.n;
  const j = jst(new Date());
  const dayStart = fromJst(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate(), 0, 0);
  const r = await db.getPool().query("SELECT COUNT(DISTINCT user_id) AS n FROM match_history WHERE played_at >= $1", [dayStart]);
  playedCache = { at: Date.now(), n: parseInt(r.rows[0].n, 10) || 0 };
  return playedCache.n;
}

async function getMeetups() { const c = await Settings.get('meetups', DEFAULT_MEETUPS); return Object.assign({}, DEFAULT_MEETUPS, c || {}); }
async function getFlags() { const f = await Settings.get('lobby_flags', DEFAULT_FLAGS); return Object.assign({}, DEFAULT_FLAGS, f || {}); }
async function starterDeck() { const f = await getFlags(); return STARTER_DECKS[f.starterDeck] ? f.starterDeck : 'fantasy'; }
// 対戦開始の入口は同期で動くので、初期デッキの種類はメモリに持っておく(起動時と設定変更時に読み、5分ごとに読み直す)
let starterNow = 'fantasy';
async function refreshStarter() { try { starterNow = await starterDeck(); } catch (e) {} return starterNow; }
function starterDeckSync() { return starterNow; }
setInterval(refreshStarter, 5 * 60 * 1000).unref();
refreshStarter();
function starterDeckDef(key) { return (STARTER_DECKS[key] || STARTER_DECKS.fantasy).map(d => ({ id: d.id, count: d.count })); }

// /board/lobby に足す分
const LEGACY_TEASER_GROUP = 'kawauso'; // 1.3.6(client v164)までのアプリは、パネルの中身がかわうそ3枚で固定。その人たちへ返す公開状態は、ずっとかわうそのもの
// 予告パネルの中身(client v165 以降はサーバーが送ったものをそのまま描く)。グループ名 → { teaser:{title,sub}, live:{title,sub}, cards:[{id,name,img,pos}] }
const TEASERS = (() => {
  const out = {};
  try {
    const raw = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'lobby_teaser.json'), 'utf8'));
    const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    Object.keys(raw).forEach(k => {
      const t = raw[k]; if (k.charAt(0) === '_' || !t || typeof t !== 'object' || !Array.isArray(t.cards) || !t.teaser || !t.live) return;
      out[k] = {
        teaser: { title: str(t.teaser.title, 60), sub: str(t.teaser.sub, 200) },
        live: { title: str(t.live.title, 60), sub: str(t.live.sub, 200) },
        cards: t.cards.slice(0, 9).filter(c => c && /^img\/[A-Za-z0-9_\-\/]+\.(jpg|png|webp)$/.test(c.img || '')).map(c => ({ id: str(c.id, 40), name: str(c.name, 30), img: c.img, pos: /^[a-z0-9% ]{1,30}$/.test(c.pos || '') ? c.pos : 'center' })),
      };
    });
  } catch (e) { console.error('[lobby] lobby_teaser.json を読めない:', e.message); }
  return out;
})();
const TEASER_GROUPS = Object.keys(TEASERS);
// いま出すパネル。flags.newcardsGroup が指すグループ(無い・知らない名前なら、かわうそ)
function teaserPanel(flags, when) {
  const group = TEASERS[flags && flags.newcardsGroup] ? flags.newcardsGroup : (TEASERS[LEGACY_TEASER_GROUP] ? LEGACY_TEASER_GROUP : null);
  if (!group) return null;
  const T = TEASERS[group], released = Release.isGroupOpen(group), t = released ? T.live : T.teaser;
  const fill = s => s.split('{when}').join(when);
  return { group, released, title: fill(t.title), sub: fill(t.sub), cards: T.cards };
}

async function extras() {
  const out = {};
  try { out.meet = meetupInfo(await getMeetups()); } catch (e) { console.error('[lobby] meet error:', e.message); }
  try {
    const f = await getFlags();
    out.starterDeck = STARTER_DECKS[f.starterDeck] ? f.starterDeck : 'fantasy';
    out.showPlayed = !!f.showPlayedToday;
    if (f.showPlayedToday) out.playedToday = await playedToday();
    // 新カードの予告パネル(ロビー)。公開スイッチと連動: 公開前=予告、公開後=登場
    // 返すものは3世代ぶん:
    //  released … 1.3.5以前(パネルの3枚がゼラチネ固定)。既定グループの意味のまま
    //  teaser   … 1.3.6(パネルがかわうそ3枚で固定)。ずっとかわうその公開状態。次の予告(十三魔王)に切り替えても、この人たちの画面は「かわうそ登場！」のまま
    //  panel    … client v165 以降。サーバーが送った題・説明・カードをそのまま描く(lobby_teaser.json と newcardsGroup)
    if (f.newcardsTeaser !== 'off') {
      const when = String(f.newcardsWhen || '近日').slice(0, 20);
      out.newcards = { released: Release.isReleased(), when, teaser: { group: LEGACY_TEASER_GROUP, released: Release.isGroupOpen(LEGACY_TEASER_GROUP), when } };
      const panel = teaserPanel(f, when); if (panel) out.newcards.panel = panel;
    }
  } catch (e) { console.error('[lobby] flags error:', e.message); }
  return out;
}

module.exports = { meetupInfo, playedToday, getMeetups, getFlags, starterDeck, starterDeckSync, refreshStarter, starterDeckDef, extras, teaserPanel, TEASER_GROUPS, DEFAULT_MEETUPS, DEFAULT_FLAGS, _resetPlayedCache: () => { playedCache = { at: 0, n: 0 }; } };
