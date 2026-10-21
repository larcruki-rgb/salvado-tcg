// ボスラッシュ: WAVE 10, 15, 20… の開始時に手札をデッキへ戻してシャッフルし、7枚引き直す。実行: node tests/bossrush_hand_reset.test.js
const path = require('path'); const ROOT = path.join(__dirname, '..');
const GameState = require(path.join(ROOT, 'server/GameState.js')); const { CARD_DB, makeCard } = require(path.join(ROOT, 'shared/cards.js'));
let fails = 0; const _log = console.log; const ok = (c, l) => { _log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
console.log = () => {};
const mc = id => makeCard(CARD_DB.find(c => c.id === id));
function run(stage, handN, deckN) {
  const gs = new GameState();
  const hand = Array.from({ length: handN }, () => mc('kaera')), deck = Array.from({ length: deckN }, () => mc('jk_a'));
  gs.initBossRush([{ id: 'kaera', count: 60 }], stage, 2000, null, { field: [], hand, deck, mana: [], manaCards: 0, life: 2000, grave: [] }, { name: 'テストボス', cpu: { life: 1000, field: [], mana: 0 } }); // エンドレスと同じく bossData を渡す(コースの段数に縛られない)
  return gs.G.players[0];
}
ok(!GameState.bossRushHandResetAt(3) && !GameState.bossRushHandResetAt(4) && GameState.bossRushHandResetAt(9) && GameState.bossRushHandResetAt(14) && !GameState.bossRushHandResetAt(10), 'B1) リセットする WAVE は 10, 15, …(WAVE 4, 5, 11 ではしない)');
{ const P = run(9, 0, 20); ok(P.hand.length === 7 && P.deck.length === 13, 'B2) WAVE10 開始: 手札0でも7枚に(デッキ20→13)'); }
{ const P = run(9, 3, 20); ok(P.hand.length === 7 && P.deck.length === 16 && P.hand.length + P.deck.length === 23, 'B3) WAVE10 開始: 手札3枚はデッキに戻してから7枚(合計は変わらない)'); }
{ const P = run(8, 3, 20); ok(P.hand.length === 3 && P.deck.length === 20, 'B4) WAVE9 開始: 何も変わらない'); }
{ const P = run(14, 2, 4); ok(P.hand.length === 6 && P.deck.length === 0, 'B5) WAVE15 開始でデッキが足りない時はある分だけ(手札2+デッキ4=6枚)'); }
_log('RESULT: ' + (fails ? 'FAIL (' + fails + ')' : 'PASS')); process.exit(fails ? 1 : 0);
