// デッキ切れ: 自分の番の最初に引けない時は LP-200(即敗北ではない)。実行: node tests/deckout.test.js
const path = require('path'); const ROOT = path.join(__dirname, '..');
const GameState = require(path.join(ROOT, 'server/GameState.js')); const { CARD_DB, makeCard } = require(path.join(ROOT, 'shared/cards.js'));
let fails = 0; const _log = console.log; const ok = (c, l) => { _log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
console.log = () => {};
const mc = id => makeCard(CARD_DB.find(c => c.id === id));
function setup(deck0, life0) {
  const gs = new GameState(); const toasts = [], overs = [];
  gs.on('toast', d => toasts.push(d.msg)); gs.on('gameOver', d => overs.push(d)); gs.on('resolveResults', () => { gs.handleAckResolve(0); gs.handleAckResolve(1); });
  gs.G.cp = 0; gs.G.phase = 'start'; gs.G.turn = 9;
  for (const P of gs.G.players) { for (let i = 0; i < 3; i++) { const m = mc('kaera'); m.manaTapped = false; P.mana.push(m); } P.deck = [mc('kaera'), mc('kaera')]; P.hand = []; }
  gs.G.players[0].deck = deck0; if (life0 !== undefined) gs.G.players[0].life = life0;
  return { gs, toasts, overs };
}
{ const { gs, toasts } = setup([]); gs.startTurn(0);
  ok(gs.G.players[0].life === 2000 - GameState.DECKOUT_LP && toasts.some(t => t.indexOf('デッキ切れ') >= 0) && gs.G.phase === 'main', 'D1) デッキ0で番が来ると LP-' + GameState.DECKOUT_LP + ' して、番はそのまま進む'); }
{ const { gs } = setup([mc('kaera')]); gs.startTurn(0);
  ok(gs.G.players[0].life === 2000 && gs.G.players[0].hand.length === 1, 'D2) デッキが1枚でもあれば普通に引いて LP は減らない'); }
{ const { gs, overs } = setup([], GameState.DECKOUT_LP); gs.startTurn(0);
  ok(gs.G.players[0].life <= 0 && (gs._gameOver || overs.length > 0), 'D3) LP がちょうど減る分しか無い時は、デッキ切れで敗北になる'); }
{ const { gs } = setup([]); gs.G.turn = 1; gs.G.cp = 0; gs.startTurn(0);
  ok(gs.G.players[0].life === 2000, 'D4) 先攻の最初の番は引かないので、デッキ0でも減らない'); }
_log('RESULT: ' + (fails ? 'FAIL (' + fails + ')' : 'PASS')); process.exit(fails ? 1 : 0);
