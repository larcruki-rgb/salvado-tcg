// CPUが十三魔王カードの能力を使う(2026-11-13): キャプテン・ジョーの2能力 / 勇者の聖剣の破壊と対象選び
// 実行: node tests/maou13_ai.test.js
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GameState = require(path.join(ROOT, 'server/GameState.js'));
const AIPlayer = require(path.join(ROOT, 'server/AIPlayer.js'));
const { CARD_DB, makeCard, TOKEN_SHARK, TOKEN_MONSTER } = require(path.join(ROOT, 'shared/cards.js'));
const TOK = { token_shark: TOKEN_SHARK, token_monster: TOKEN_MONSTER };
const mc = id => makeCard(TOK[id] || CARD_DB.find(c => c.id === id));
const ready = id => { const c = mc(id); c.tapped = false; c.summonSick = false; return c; };
let fails = 0; const _log = console.log; const ok = (c, l) => { _log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
console.log = () => {};

// CPU = 席1。手番もCPU(main)。sent に CPUの操作が入る
function setup(o) {
  o = o || {};
  const gs = new GameState('ai'); gs.toast = () => {}; gs.log = () => {};
  for (const P of gs.G.players) { P.mana = []; for (let i = 0; i < 8; i++) { const m = mc('kaera'); m.manaTapped = false; P.mana.push(m); } P.deck = []; P.hand = []; P.field = []; P.life = 1000; }
  gs.G.cp = 1; gs.G.phase = o.phase || 'main'; gs.G.turn = 3; gs.G.manaPlaced = true;
  const sent = []; const sock = { seat: 1, on() {}, emit(ev, d) { if (ev === 'action') sent.push(d); } };
  const ai = new AIPlayer(sock, gs);
  const me = gs.G.players[1], opp = gs.G.players[0];
  (o.field || []).forEach(id => me.field.push(ready(id)));
  (o.hand || []).forEach(id => me.hand.push(mc(id)));
  (o.oppField || []).forEach(id => opp.field.push(ready(id)));
  if (o.tapMana) me.mana.slice(0, o.tapMana).forEach(m => m.manaTapped = true);
  return { gs, ai, sent, me, opp };
}
const firstAbility = s => { const a = s.sent.find(x => x.type === 'activateAbility'); return a ? a.aid : null; };
const types = s => s.sent.map(x => x.type + (x.aid ? ':' + x.aid : '')).join(',');
// 聖剣を持ったオリオン(エンチャントの解決後と同じ形)
const swordOrion = () => { const o = ready('orion'); o.enchantments.push(mc('holy_sword')); ['haste', 'vigilance', 'activated_holy_sword'].forEach(a => { if (!o.abilities.includes(a)) o.abilities.push(a); }); return o; };

// ---- キャプテン・ジョー ----
// J1) 攻撃に出られる魔物が2体 → 攻撃前に +100/+100
{ const s = setup({ field: ['captain_joe', 'token_shark', 'token_shark'] }); s.ai.doMainPhase();
  ok(firstAbility(s) === 'activated_joe_buff' && s.sent[0].fi === 0, 'J1) 攻撃できる魔物2体 → 強化 (' + types(s) + ')'); }
// J2) ジョーだけ → サメ魔物を出す
{ const s = setup({ field: ['captain_joe'] }); s.ai.doMainPhase();
  ok(firstAbility(s) === 'activated_joe_shark', 'J2) ジョーだけ → サメ魔物 (' + types(s) + ')'); }
// J3) 出したばかりの魔物(攻撃できない)は数えない → 強化でなくサメ
{ const s = setup({ field: ['captain_joe', 'token_shark', 'token_shark'] }); s.me.field[1].summonSick = true; s.me.field[2].summonSick = true; s.ai.doMainPhase();
  ok(firstAbility(s) === 'activated_joe_shark', 'J3) 魔物が出たばかり → サメ魔物 (' + types(s) + ')'); }
// J4) 応援が2に足りない → 使わない
{ const s = setup({ field: ['captain_joe'], tapMana: 7 }); s.ai.doMainPhase();
  ok(firstAbility(s) === null, 'J4) 応援1 → 使わない (' + types(s) + ')'); }
// J5) 場のキャラが6体いて強化の条件も無い → サメを増やさない
{ const s = setup({ field: ['captain_joe', 'kawauso', 'kawauso', 'kawauso', 'kawauso', 'kawauso'] }); s.ai.doMainPhase();
  ok(firstAbility(s) === null, 'J5) 場6体 → サメを増やさない (' + types(s) + ')'); }
// J6) 手札に出せるキャラがあれば、そっちが先
{ const s = setup({ field: ['captain_joe'], hand: ['menhera'] }); s.ai.doMainPhase();
  ok(s.sent[0] && s.sent[0].type === 'playCard', 'J6) 手札のキャラが先 (' + types(s) + ')'); }
// J7) 戦闘の後(main2)は強化しない。余り応援はサメへ
{ const s = setup({ field: ['captain_joe', 'token_shark', 'token_shark'], phase: 'main2' }); s.ai.doMainPhase();
  ok(firstAbility(s) === 'activated_joe_shark', 'J7) 戦闘後は強化せずサメ魔物 (' + types(s) + ')'); }
// J8) ブラックヴォルテックス号(攻撃できない)は強化の数に入れない。魔物でもない
{ const s = setup({ field: ['captain_joe', 'black_vortex', 'token_shark'] }); s.ai.doMainPhase();
  ok(firstAbility(s) === 'activated_joe_shark', 'J8) 船は数えない → サメ魔物 (' + types(s) + ')'); }

// ---- 勇者の聖剣 ----
// S1) 相手に魔王(トークン以外) → 破壊を使う
{ const s = setup({ oppField: ['captain_joe'] }); s.me.field.push(swordOrion()); s.ai.doMainPhase();
  ok(firstAbility(s) === 'activated_holy_sword', 'S1) 相手にジョー → 聖剣を使う (' + types(s) + ')'); }
// S2) 相手が100/100のトークンだけ → 使わない(タップすると攻撃できなくなるため)
{ const s = setup({ oppField: ['token_monster'] }); s.me.field.push(swordOrion()); s.ai.doMainPhase();
  ok(firstAbility(s) === null, 'S2) トークンだけ → 使わない (' + types(s) + ')'); }
// S3) 対象なし(魔王・魔物がいない) → 使わない
{ const s = setup({ oppField: ['kawauso'] }); s.me.field.push(swordOrion()); s.ai.doMainPhase();
  ok(firstAbility(s) === null, 'S3) 魔王・魔物がいない → 使わない (' + types(s) + ')'); }
// S4) 応援が3に足りない / タップ済み → 使わない
{ const s = setup({ oppField: ['captain_joe'], tapMana: 6 }); s.me.field.push(swordOrion()); s.ai.doMainPhase();
  ok(firstAbility(s) === null, 'S4) 応援2 → 使わない (' + types(s) + ')'); }
{ const s = setup({ oppField: ['captain_joe'] }); const o = swordOrion(); o.tapped = true; s.me.field.push(o); s.ai.doMainPhase();
  ok(firstAbility(s) === null, 'S4) タップ済み → 使わない (' + types(s) + ')'); }
// S5) 対象選び: トークンより本体。必ず idx と pi を返す
{ const s = setup({ oppField: ['token_monster', 'captain_joe'] }); s.me.field.push(swordOrion());
  s.ai.handlePrompt('holy_sword_target', { targets: s.gs._holySwordTargets(1) });
  const r = s.sent[0];
  ok(r && r.type === 'promptResponse' && r.targetIdx === 1 && r.pi === 0, 'S5) トークンよりジョーを選ぶ (' + JSON.stringify(r) + ')'); }
// S6) 候補がトークンだけでも、聞かれたら空で返さない
{ const s = setup({ oppField: ['token_monster'] }); s.me.field.push(swordOrion());
  s.ai.handlePrompt('holy_sword_target', { targets: s.gs._holySwordTargets(1) });
  const r = s.sent[0];
  ok(r && r.targetIdx === 0 && r.pi === 0, 'S6) トークンだけでも対象を返す (' + JSON.stringify(r) + ')'); }
// S7) 候補が空 → -1
{ const s = setup({}); s.ai.handlePrompt('holy_sword_target', { targets: [] });
  ok(s.sent[0] && s.sent[0].targetIdx === -1, 'S7) 候補なし → -1'); }
// S8) 実際に通す: CPUの回答で、応援3とタップを払ってジョーが壊れる
{ const s = setup({ oppField: ['captain_joe'] }); const o = swordOrion(); s.me.field.push(o);
  s.gs.returnToChain = () => {}; s.gs.emit = () => {}; s.gs.broadcastState = () => {};
  const targets = s.gs._holySwordTargets(1);
  s.gs.pendingPrompt[1] = { type: 'holy_sword_target', data: { fi: 0, srcUid: o.uid, targets } };
  s.ai.handlePrompt('holy_sword_target', { targets });
  const r = s.sent[0]; s.gs.handlePromptResponse(1, { targetIdx: r.targetIdx, pi: r.pi });
  ok(!s.opp.field.some(c => c.id === 'captain_joe') && o.tapped && s.gs.avMana(1) === 5, 'S8) ジョーが壊れ、オリオンはタップ、応援は5残る (' + s.gs.avMana(1) + ')'); }

_log('\nRESULT: ' + (fails === 0 ? 'PASS' : 'FAIL (' + fails + ')'));
process.exit(fails === 0 ? 0 : 1);
