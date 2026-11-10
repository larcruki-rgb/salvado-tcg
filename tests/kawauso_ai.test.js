// CPUのかわうそかわいそ(2026-11 quest_09): とどめ / 道連れ(全体除去・戦闘でまとめて死ぬ) / 二重撃ち防止 / 場に3体以上で積極使用(手札のかわうそ系を先に出す)
// 実行: node tests/kawauso_ai.test.js
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GameState = require(path.join(ROOT, 'server/GameState.js'));
const AIPlayer = require(path.join(ROOT, 'server/AIPlayer.js'));
const { CARD_DB, makeCard, TOKEN_KAWAUSO } = require(path.join(ROOT, 'shared/cards.js'));
const mc = id => id === 'token_kawauso' ? makeCard(TOKEN_KAWAUSO) : makeCard(CARD_DB.find(c => c.id === id));
const ready = id => { const c = mc(id); c.tapped = false; c.summonSick = false; return c; };
let fails = 0; const _log = console.log; const ok = (c, l) => { _log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
console.log = () => {};

// CPU = 席1。手番もCPU(main)。sent に CPUの操作が入る
function setup(o) {
  o = o || {};
  const gs = new GameState('ai'); gs.toast = () => {}; gs.log = () => {};
  for (const P of gs.G.players) { P.mana = []; for (let i = 0; i < 8; i++) { const m = mc('kaera'); m.manaTapped = false; P.mana.push(m); } P.deck = []; P.hand = []; P.field = []; P.life = 1000; }
  gs.G.cp = o.cp === undefined ? 1 : o.cp; gs.G.phase = 'main'; gs.G.turn = 3; gs.G.manaPlaced = true;
  const sent = []; const sock = { seat: 1, on() {}, emit(ev, d) { if (ev === 'action') sent.push(d); } };
  const ai = new AIPlayer(sock, gs);
  const me = gs.G.players[1], opp = gs.G.players[0];
  (o.field || []).forEach(id => me.field.push(ready(id)));
  (o.hand || []).forEach(id => me.hand.push(mc(id)));
  if (o.oppLife !== undefined) opp.life = o.oppLife;
  return { gs, ai, sent, me, opp };
}
const firstPlay = (s) => { const a = s.sent.find(x => x.type === 'playCard'); return a ? s.me.hand[a.idx].id : null; };
const K3 = ['kawauso', 'kawauso', 'kawauso'];

// A1) とどめ: かわうそ3体×100 >= 相手LP300 → 召喚より先にかわいそ
{ const s = setup({ field: K3, hand: ['kawauso_kawaiso', 'kawauso'], oppLife: 300 }); s.ai.doMainPhase();
  ok(firstPlay(s) === 'kawauso_kawaiso', 'A1) とどめ: かわいそを先に撃つ (' + firstPlay(s) + ')'); }
// A2) 積極使用は、手札のかわうそかわうそ・かわうそを先に出す
{ const s = setup({ field: K3, hand: ['kawauso_kawaiso', 'kawauso_kawauso'] }); s.ai.doMainPhase();
  ok(firstPlay(s) === 'kawauso_kawauso', 'A2) 手札にかわうそかわうそ → そっちが先 (' + firstPlay(s) + ')'); }
{ const s = setup({ field: K3, hand: ['kawauso_kawaiso', 'kawauso'] }); s.ai.doMainPhase();
  ok(firstPlay(s) === 'kawauso', 'A2) 手札にかわうそ → そっちが先 (' + firstPlay(s) + ')'); }
// A3) 出し切ったら(または応援が足りなければ)かわいそ
{ const s = setup({ field: K3, hand: ['kawauso_kawaiso'] }); s.ai.doMainPhase();
  ok(firstPlay(s) === 'kawauso_kawaiso', 'A3) 場3体・手札にかわうそ系なし → かわいそ (' + firstPlay(s) + ')'); }
{ const s = setup({ field: K3, hand: ['kawauso_kawaiso', 'kawauso_kawauso'] }); s.me.mana.slice(0, 5).forEach(m => m.manaTapped = true); // 残り応援3(予約2で使えるのは1)
  s.ai.doMainPhase();
  ok(firstPlay(s) === 'kawauso_kawaiso', 'A3) かわうそかわうそを出す応援が無い → かわいそ (' + firstPlay(s) + ')'); }
// A4) 2体では積極使用しない(攻撃へ進む)
{ const s = setup({ field: ['kawauso', 'kawauso'], hand: ['kawauso_kawaiso'] }); s.ai.doMainPhase();
  ok(firstPlay(s) === null && s.sent.some(x => x.type === 'startCombat'), 'A4) 場2体: 撃たずに攻撃 (' + s.sent.map(x => x.type).join(',') + ')'); }
// A4b) トークンも数える
{ const s = setup({ field: ['kawauso', 'token_kawauso', 'token_kawauso'], hand: ['kawauso_kawaiso'] }); s.ai.doMainPhase();
  ok(firstPlay(s) === 'kawauso_kawaiso', 'A4) 本体1+トークン2 でも3体として数える'); }

// チェーン(相手の手番)
const chain = (s, type, stack) => { s.sent.length = 0; s.ai.handleChain(type, { stack, supports: s.me.hand.map((c, i) => ({ idx: i, id: c.id })), abilities: [] }); return s.sent[0]; };
// A5) 道連れ: 相手の全体除去
for (const d of ['チャンネル削除 → 全場破壊+手札入替', '99割間違いない → 相手全破壊+全ハンデス', 'インプレッション制限 → 全キャラ-500/-500', 'ルシア → 全体200ダメージ']) {
  const s = setup({ cp: 0, field: ['kawauso'], hand: ['kawauso_kawaiso'], oppLife: 2000 });
  const r = chain(s, 'chain', [{ description: d, player: 0 }]);
  ok(r && r.action === 'playSupport' && r.idx === 0, 'A5) 道連れ: ' + d.split(' ')[0]); }
{ const s = setup({ cp: 0, field: K3, hand: ['kawauso_kawaiso'], oppLife: 2000 });
  const r = chain(s, 'chain', [{ description: '投げ銭 → +300/+300', player: 0 }]);
  ok(r && r.action === 'pass', 'A5) 関係ない効果には撃たない'); }
// A6) とどめ(チェーン)
{ const s = setup({ cp: 0, field: ['kawauso', 'kawauso'], hand: ['kawauso_kawaiso'], oppLife: 200 });
  const r = chain(s, 'chain', [{ description: '投げ銭 → +300/+300', player: 0 }]);
  ok(r && r.action === 'playSupport', 'A6) チェーン中でもとどめを刺す'); }
// A7) 二重撃ち防止
{ const s = setup({ cp: 0, field: K3, hand: ['kawauso_kawaiso', 'kawauso_kawaiso'], oppLife: 200 });
  const r = chain(s, 'chain', [{ description: 'チャンネル削除 → 全場破壊+手札入替', player: 0 }, { description: 'かわうそかわいそ → かわうそ全破壊→数×100ダメージ+数×100回復', player: 1 }]);
  ok(r && r.action === 'pass', 'A7) 自分のかわいそが積まれていれば重ねない'); }
// A8) 戦闘: まとめて死ぬなら撃つ / 1体だけなら撃たない
function combat(nBlocked) {
  const s = setup({ cp: 0, field: K3, hand: ['kawauso_kawaiso'], oppLife: 2000 });
  const atks = []; for (let i = 0; i < 3; i++) { const a = ready('kaera'); a.power = 300; a.toughness = 300; s.opp.field.push(a); atks.push(a); }
  s.gs.G.attackers = atks.map(a => a.uid); s.gs.G.blockAssignments = {}; s.gs._blocksDeclared = true; s.gs.G.phase = 'block';
  for (let i = 0; i < nBlocked; i++) s.gs.G.blockAssignments[atks[i].uid] = s.me.field[i].uid;
  return chain(s, 'chain_attack', []);
}
{ const r = combat(2); ok(r && r.action === 'playSupport', 'A8) 戦闘でかわうそ2体が死ぬ → 撃つ'); }
{ const r = combat(1); ok(r && r.action === 'pass', 'A8) 1体だけ死ぬ(3体中) → 撃たない'); }

console.log = _log;
console.log(fails === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL (' + fails + ')');
process.exit(fails ? 1 : 0);
