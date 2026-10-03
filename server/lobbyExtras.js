// ロビー上部に出す追加情報(2026-10 人気化の作戦 Phase 0):
//  - 対戦会(毎週の決まった時間)のカウントダウン  … 設定 meetups
//  - 今日遊んだ人の数(「いまオンライン」の代わりに出す。正直で大きい数字)  … 設定 lobby_flags.showPlayedToday
//  - 初期デッキの種類  … 設定 lobby_flags.starterDeck
// 日程や表示の切り替えはサーバー側の設定で、アプリの更新なしに変えられる。時刻は日本時間(UTC+9 固定)で扱う。
const Settings = require('./settings');
const db = require('./db');
const { STARTER_DECKS } = require('../shared/cards');

const JST_MS = 9 * 60 * 60 * 1000;
const DEFAULT_MEETUPS = {
  label: '対戦会',
  from: '2026-10-11',   // この日より前の回は数えない(初回の日付)
  slots: [ { dow: 0, h: 13, m: 0, len: 30 }, { dow: 4, h: 13, m: 0, len: 30 } ], // 日曜13:00-13:30、木曜13:00-13:30
};
const DEFAULT_FLAGS = { showPlayedToday: false, starterDeck: 'fantasy' };

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
async function extras() {
  const out = {};
  try { out.meet = meetupInfo(await getMeetups()); } catch (e) { console.error('[lobby] meet error:', e.message); }
  try {
    const f = await getFlags();
    out.starterDeck = STARTER_DECKS[f.starterDeck] ? f.starterDeck : 'fantasy';
    out.showPlayed = !!f.showPlayedToday;
    if (f.showPlayedToday) out.playedToday = await playedToday();
  } catch (e) { console.error('[lobby] flags error:', e.message); }
  return out;
}

module.exports = { meetupInfo, playedToday, getMeetups, getFlags, starterDeck, starterDeckSync, refreshStarter, starterDeckDef, extras, DEFAULT_MEETUPS, DEFAULT_FLAGS, _resetPlayedCache: () => { playedCache = { at: 0, n: 0 }; } };
