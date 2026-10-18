// 戦闘の対応関係(state.combat): 同名キャラが並んだ時に、どれがブロックされているかを画面に伝える。実行: node tests/combat_view.test.js
const path = require('path'); const ROOT = path.join(__dirname, '..');
const GameState = require(path.join(ROOT, 'server/GameState.js')); const { CARD_DB, makeCard } = require(path.join(ROOT, 'shared/cards.js'));
let fails = 0; const _log = console.log; const ok = (c, l) => { _log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
console.log = () => {};
const mc = id => makeCard(CARD_DB.find(c => c.id === id));
const gs = new GameState(); gs.on('resolveResults', () => { gs.handleAckResolve(0); gs.handleAckResolve(1); });
gs.G.cp = 0; gs.G.phase = 'main'; gs.G.turn = 5;
for (const P of gs.G.players) { for (let i = 0; i < 3; i++) { const m = mc('kaera'); m.manaTapped = false; P.mana.push(m); } P.deck = [mc('kaera'), mc('kaera')]; P.hand = []; }
const a1 = mc('jk_a'), a2 = mc('jk_a'); a1.summonSick = false; a2.summonSick = false; gs.G.players[0].field.push(a1, a2);
const b1 = mc('kyamakiri'); gs.G.players[1].field.push(b1);
ok(gs.getStateForPlayer(0).combat === null, 'C1) 攻撃していない時は combat は null');
gs.startCombat(0); gs.toggleAttacker(0, 0); gs.toggleAttacker(0, 1);
let v = gs.getStateForPlayer(1).combat;
ok(v && v.attackerSeat === 0 && v.declared === false && v.attackers.length === 2 && v.attackers.every(x => x.blockerIdx === null), 'C2) 攻撃者を選んだ直後: 2体とも未ブロック・宣言前');
gs.confirmAttack(0);
gs.resolveBlocks(1, { 1: 0 }); // 2体目(#2)だけをキャマキリでブロック
v = gs.getStateForPlayer(0).combat;
ok(v && v.declared === true && v.attackers.find(x => x.idx === 0).blockerIdx === null && v.attackers.find(x => x.idx === 1).blockerIdx === 0, 'C3) ブロック宣言後: #1 は素通り、#2 はキャマキリ(相手の場0番)にブロックされている');
const v2 = gs.getStateForPlayer(1).combat;
ok(JSON.stringify(v2) === JSON.stringify(v), 'C4) 相手側から見ても同じ対応関係');
_log('RESULT: ' + (fails ? 'FAIL (' + fails + ')' : 'PASS')); process.exit(fails ? 1 : 0);
