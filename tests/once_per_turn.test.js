// 「1ターンに1度」の能力(ルシアの竜化: 応援3)。実行: node tests/once_per_turn.test.js
const path = require('path'); const ROOT = path.join(__dirname, '..');
const GameState = require(path.join(ROOT, 'server/GameState.js')); const { CARD_DB, makeCard } = require(path.join(ROOT, 'shared/cards.js'));
let fails = 0; const _log = console.log; const ok = (c, l) => { _log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
console.log = () => {};
const mc = id => makeCard(CARD_DB.find(c => c.id === id));
function setup(manaN) {
  const gs = new GameState(); gs.on('resolveResults', () => { gs.handleAckResolve(0); gs.handleAckResolve(1); });
  gs.G.cp = 0; gs.G.phase = 'main'; gs.G.turn = 3;
  for (const P of gs.G.players) { for (let i = 0; i < manaN; i++) { const m = mc('kaera'); m.manaTapped = false; P.mana.push(m); } P.deck = [mc('kaera'), mc('kaera'), mc('kaera')]; P.hand = []; P.life = 2000; }
  const l = mc('lucia'); l.summonSick = false; gs.G.players[0].field.push(l);
  return { gs, l };
}
const dragon = (gs) => gs.activateAbility(0, 'activated_lucia_dragon', 0);
{ const { gs } = setup(9); ok(gs.abilityManaCost('activated_lucia_dragon') === 3, 'O1) 竜化の応援コストは3'); }
{ const { gs, l } = setup(2); dragon(gs); ok(gs.avMana(0) === 2 && l.tempBuff.power === 0 && !gs._onceUsed(l, 'activated_lucia_dragon'), 'O2) 応援2: 不発(応援も減らず、使用済みにもならない)'); }
{ const { gs, l } = setup(9);
  dragon(gs);
  ok(gs.avMana(0) === 6 && l.tempBuff.power === 300 && l.tempBuff.toughness === 300 && l.abilities.includes('flying'), 'O3) 1回目: +300/+300・飛行、応援9→6');
  ok(!gs.getActivatable(l, 0).some(a => a.id === 'activated_lucia_dragon'), 'O4) 同じターンは候補に出ない');
  ok(gs.getStateForPlayer(0).me.field[0].onceUsed.includes('activated_lucia_dragon'), 'O4b) クライアントに「使用済み」が渡る');
  dragon(gs);
  ok(gs.avMana(0) === 6 && l.tempBuff.power === 300, 'O5) 2回目を送っても何も起きない(応援も減らず、重ならない)');
  // 相手の番 → 自分の次の番で、また使える
  gs.endTurn(0); gs.startTurn(1);
  ok(!gs._onceUsed(l, 'activated_lucia_dragon'), 'O6) ターンが変われば使用済みが切れる(相手の番)');
  gs.endTurn(1); gs.startTurn(0);
  ok(gs.getActivatable(l, 0).some(a => a.id === 'activated_lucia_dragon'), 'O7) 次の自分の番: 候補に戻る');
  dragon(gs);
  ok(l.tempBuff.power === 300 && gs._onceUsed(l, 'activated_lucia_dragon'), 'O8) 次の自分の番: もう一度使える(+300)'); }
{ const { gs, l } = setup(9); dragon(gs); gs._enterField(l, 0); gs.G.players[0].field = gs.G.players[0].field.filter((c, i, a) => a.indexOf(c) === i);
  ok(!gs._onceUsed(l, 'activated_lucia_dragon'), 'O9) 場に入り直したら使用済みは消える'); }
_log('RESULT: ' + (fails ? 'FAIL (' + fails + ')' : 'PASS')); process.exit(fails ? 1 : 0);
