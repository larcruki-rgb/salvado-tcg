// 動画復元(ゴミ箱から投稿): 出せる投稿キャラがいない時は、カードも応援も使わずに知らせる。実行: node tests/grave_play.test.js
const path = require('path'); const ROOT = path.join(__dirname, '..');
const GameState = require(path.join(ROOT, 'server/GameState.js')); const { CARD_DB, makeCard } = require(path.join(ROOT, 'shared/cards.js'));
let fails = 0; const _log = console.log; const ok = (c, l) => { _log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
console.log = () => {};
const mc = id => makeCard(CARD_DB.find(c => c.id === id));
function setup(graveIds, fieldIds) {
  const gs = new GameState(); const toasts = [];
  gs.on('toast', d => toasts.push(d.msg)); gs.on('resolveResults', () => { gs.handleAckResolve(0); gs.handleAckResolve(1); });
  gs.G.cp = 0; gs.G.phase = 'main'; gs.G.turn = 5;
  for (const P of gs.G.players) { for (let i = 0; i < 8; i++) { const m = mc('kaera'); m.manaTapped = false; P.mana.push(m); } P.deck = [mc('kaera')]; P.hand = []; }
  gs.G.players[0].hand = [mc('douga_fukugen')]; gs.G.players[0].grave = graveIds.map(mc); (fieldIds || []).forEach(id => gs.G.players[0].field.push(mc(id)));
  return { gs, toasts };
}
{ const { gs, toasts } = setup([]); gs.playCard(0, 0);
  ok(gs.avMana(0) === 8 && gs.G.players[0].hand.length === 1 && toasts.some(t => t.indexOf('出せる投稿キャラがいません') >= 0) && !gs.pendingPrompt[0], 'V1) ゴミ箱にキャラなし: カードも応援も減らず、知らせが出る'); }
{ const { gs, toasts } = setup(['douga_sakujo']); gs.playCard(0, 0);
  ok(gs.avMana(0) === 8 && gs.G.players[0].hand.length === 1 && toasts.length === 1, 'V2) ゴミ箱に規約カードだけ: 同じく使われない'); }
{ const { gs } = setup(['tomo'], ['tomo']); gs.playCard(0, 0);
  ok(gs.avMana(0) === 8 && gs.G.players[0].hand.length === 1, 'V3) ゴミ箱のキャラが同名制限で出せない: 使われない'); }
{ const { gs } = setup(['tomo']); gs.playCard(0, 0);
  ok(gs.avMana(0) === 3 && gs.G.players[0].hand.length === 0 && gs.pendingPrompt[0] && gs.pendingPrompt[0].type === 'douga_fukugen_pick', 'V4) 出せるキャラあり: 応援5を払い、選ぶ画面が出る');
  const idx = gs.pendingPrompt[0].data.cards[0].idx; gs.handlePromptResponse(0, { idx });
  ok(gs.G.players[0].field.some(c => c.id === 'tomo'), 'V5) 選ぶと場に出る'); }
{ const { gs } = setup([]); const o = gs._getChainOptions(0); ok(!o.supports.some(x => (x.id || (x.card && x.card.id)) === 'douga_fukugen'), 'V6) 割り込みの候補にも出ない(出せるキャラがいない時)'); }
{ const { gs } = setup(['tomo']); const o = gs._getChainOptions(0); ok(o.supports.some(x => (x.id || (x.card && x.card.id)) === 'douga_fukugen'), 'V7) 出せるキャラがいれば割り込みの候補に出る'); }
_log('RESULT: ' + (fails ? 'FAIL (' + fails + ')' : 'PASS')); process.exit(fails ? 1 : 0);
