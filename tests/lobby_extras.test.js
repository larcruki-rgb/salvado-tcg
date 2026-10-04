// 対戦会の日程計算(JST)・初期デッキ・計測の受け口(DBを使う)。実行: node tests/lobby_extras.test.js
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/salvado_dev';
const path = require('path');
const ROOT = path.join(__dirname, '..');
let fails = 0; const _log = console.log; const ok = (c, l) => { _log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
console.log = () => {}; console.error = () => {};
const Lobby = require(path.join(ROOT, 'server/lobbyExtras.js'));
const db = require(path.join(ROOT, 'server/db.js'));
const { STARTER_DECKS, CARD_DB } = require(path.join(ROOT, 'shared/cards.js'));
const DeckValidation = require(path.join(ROOT, 'server/deckValidation.js'));
const cfg = { label: '対戦会', from: '2026-10-11', slots: [{ dow: 0, h: 13, m: 0, len: 30 }, { dow: 4, h: 13, m: 0, len: 30 }] };
const J = (s) => new Date(s + '+09:00'); // 日本時間の文字列から
(async () => {
  try {
    // M1) 初回(10/11 日曜13:00)より前の木曜(10/8)は数えない。10/3(土)から見た次回は 10/11 13:00
    { const m = Lobby.meetupInfo(cfg, J('2026-10-03T10:00:00'));
      ok(m && !m.active && m.nextStart === J('2026-10-11T13:00:00').toISOString(), 'M1) from より前の回は飛ばし、次回は 10/11(日) 13:00 JST: ' + (m && m.nextStart)); }
    // M1b) 初回より前は notStarted=true、初回を過ぎたら false
    { ok(Lobby.meetupInfo(cfg, J('2026-10-03T10:00:00')).notStarted === true && Lobby.meetupInfo(cfg, J('2026-10-12T10:00:00')).notStarted === false, 'M1b) 初回より前だけ notStarted'); }
    // M2) 10/11 13:10 は開催中、終了 13:30、次回は 10/15(木)
    { const m = Lobby.meetupInfo(cfg, J('2026-10-11T13:10:00'));
      ok(m.active && m.end === J('2026-10-11T13:30:00').toISOString() && m.nextStart === J('2026-10-15T13:00:00').toISOString(), 'M2) 開催中の判定と次回(木曜)'); }
    // M3) 13:30 ちょうどは終了(開催中でない)、次回は木曜
    { const m = Lobby.meetupInfo(cfg, J('2026-10-11T13:30:00')); ok(!m.active && m.nextStart === J('2026-10-15T13:00:00').toISOString(), 'M3) 終了時刻ちょうどは開催中でない'); }
    // M4) 深夜(JST 0:30 = UTC 前日15:30)でも日付がずれない: 10/15(木) 0:30 の次回は同日 13:00
    { const m = Lobby.meetupInfo(cfg, J('2026-10-15T00:30:00')); ok(m.nextStart === J('2026-10-15T13:00:00').toISOString(), 'M4) JST 深夜でも同日の回を次回にする'); }
    // M5) 枠が無い設定は null、from 無しなら直近の回
    { ok(Lobby.meetupInfo({ slots: [] }, new Date()) === null, 'M5a) 枠なしは null');
      const m = Lobby.meetupInfo({ slots: [{ dow: 4, h: 13 }] }, J('2026-10-03T10:00:00')); ok(m.nextStart === J('2026-10-08T13:00:00').toISOString(), 'M5b) from 無しなら直近(10/8 木)'); }
    // M6) 壊れた枠(文字列など)は無視する
    { const m = Lobby.meetupInfo({ slots: [null, { dow: 'x' }, { dow: 0, h: 13 }] }, J('2026-10-03T10:00:00')); ok(m && m.slots.length === 1, 'M6) 不正な枠は捨てる'); }
    // S1) 初期デッキは3種とも60枚で、デッキ検証を通る(クエスト報酬カードを含まない)
    for (const k of Object.keys(STARTER_DECKS)) {
      const def = Lobby.starterDeckDef(k); const n = def.reduce((a, d) => a + d.count, 0);
      const v = DeckValidation.validateDeck('p_tester000000', def, null);
      ok(n === 60 && v.ok !== false && !v.error, 'S1) 初期デッキ ' + k + ' は60枚で検証OK: ' + JSON.stringify(v).slice(0, 80));
      ok(def.every(d => CARD_DB.find(c => c.id === d.id) && (CARD_DB.find(c => c.id === d.id).acquire !== 'quest')), 'S1b) ' + k + ' に存在しないカード・クエスト報酬カードが無い');
    }
    ok(Lobby.starterDeckDef('nope').length === STARTER_DECKS.fantasy.length, 'S2) 不明な種類はファンタジーに倒す');
    // T1) 計測の保存と集計が動く
    const dev = 'd_test' + Date.now().toString(36);
    await db.addEvent(dev, null, 'open', { first: true });
    await db.addEvent(dev, 'p_abc123456', 'tutorial_end', { result: 'done' });
    const f = await db.funnel(1);
    ok(f && typeof f.opened === 'number' && f.opened >= 1 && f.tutorialDone >= 1, 'T1) funnel の集計が返る: ' + JSON.stringify(f));
    await db.getPool().query('DELETE FROM app_events WHERE device = $1', [dev]);
    // P1) 今日遊んだ人は数値
    const n = await Lobby.playedToday(); ok(typeof n === 'number' && n >= 0, 'P1) playedToday は数値: ' + n);
    // X1) extras は meet と starterDeck を返す
    const ex = await Lobby.extras(); ok(ex && ex.meet && typeof ex.starterDeck === 'string' && typeof ex.showPlayed === 'boolean', 'X1) extras の形: ' + JSON.stringify(ex).slice(0, 120));
  } catch (e) { ok(false, '例外: ' + (e.stack || e.message)); }
  _log('RESULT: ' + (fails ? 'FAIL ' + fails : 'PASS'));
  process.exit(fails ? 1 : 0);
})();
