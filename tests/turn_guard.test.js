// 相手のターン中に playCard / activateAbility を送っても通らないこと(9/26 問い合わせ: 相手ターン中にイズナが出た)
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GameState = require(path.join(ROOT, 'server/GameState.js'));
const { CARD_DB, makeCard } = require(path.join(ROOT, 'shared/cards.js'));
const mc = id => makeCard(CARD_DB.find(c => c.id === id));
let fails = 0; const ok = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };

function setup() {
  const gs = new GameState('t'); const prompts = []; gs.on('prompt', d => prompts.push(d)); gs.log = () => {};
  const P0 = gs.G.players[0], P1 = gs.G.players[1];
  for (const P of [P0, P1]) { for (let i = 0; i < 5; i++) { const m = mc('kaera'); m.manaTapped = false; P.mana.push(m); } P.deck = []; for (let i = 0; i < 5; i++) P.deck.push(mc('mamachari')); }
  P1.hand.push(mc('izuna')); P0.hand.push(mc('sagi'));
  gs.G.cp = 0; gs.G.phase = 'main'; gs.G.turn = 2;
  return { gs, P0, P1, prompts };
}
// A) 相手(P1)は P0 のターン中にクリーチャーを出せない
{ const { gs, P1 } = setup(); const before = P1.field.length, handBefore = P1.hand.length;
  gs.playCard(1, 0);
  ok(P1.field.length === before && P1.hand.length === handBefore, 'A) 相手ターン中の playCard は無視される(場も手札も変わらない)'); }
// B) 手番の人(P0)は普通に出せる(回帰)
{ const { gs, P0 } = setup(); const before = P0.field.length;
  gs.playCard(0, 0);
  ok(P0.field.length === before + 1 || P0.hand.length === 0, 'B) 手番の人の playCard は通る'); }
// C) 相手(P1)は通常時に能力を起動できない(チェーン中の応答は別経路)
{ const { gs, P1, prompts } = setup(); const iz = mc('izuna'); iz.tapped = false; P1.field.push(iz);
  gs.activateAbility(0, 'activated_izuna', 1);
  ok(prompts.length === 0, 'C) 相手ターン中の activateAbility は無視される(プロンプトが出ない)'); }
// D) 手番の人(P0)は能力を起動できる(回帰)
{ const { gs, P0, prompts } = setup(); const iz = mc('izuna'); iz.tapped = false; P0.field.push(iz); gs.G.players[1].field.push(mc('mamachari'));
  gs.activateAbility(0, 'activated_izuna', 0);
  ok(prompts.some(p => p.type === 'target_damage'), 'D) 手番の人の activateAbility は通る'); }
console.log(fails ? 'TURN GUARD: FAIL(' + fails + ')' : 'TURN GUARD: PASS'); process.exit(fails ? 1 : 0);
