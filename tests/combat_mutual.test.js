// 戦闘の死亡判定は「同時」: 相手の場を先に片付けた結果で耐久が戻り、片方だけ生き残ることが無い
// 例: アーク(500/500「相手全体-100/-100」)同士 → 互いに400/400で400ダメージ → 両方死ぬ(相打ち)。席の順番で勝者が変わらない
// 実行: node tests/combat_mutual.test.js
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GameState = require(path.join(ROOT, 'server/GameState.js'));
const { CARD_DB, makeCard } = require(path.join(ROOT, 'shared/cards.js'));
const mc = id => makeCard(CARD_DB.find(c => c.id === id));
let fails = 0; const ok = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };

function setup(attacker) {
  const gs = new GameState('t'); const prompts = []; gs.on('prompt', d => prompts.push(d)); gs.log = () => {}; gs.toast = () => {};
  gs.on('resolveResults', () => { setImmediate(() => { gs.handleAckResolve(0); gs.handleAckResolve(1); }); });
  const P0 = gs.G.players[0], P1 = gs.G.players[1];
  for (const P of [P0, P1]) { for (let i = 0; i < 5; i++) { const m = mc('kaera'); m.manaTapped = false; P.mana.push(m); } P.deck = []; for (let i = 0; i < 5; i++) P.deck.push(mc('mamachari')); P.hand = []; }
  gs.G.cp = attacker; gs.G.phase = 'main'; gs.G.turn = 3;
  return { gs, P0, P1, prompts };
}
// 質問に答えながら盤面が落ち着くまで回す(割り込み=パス、ブロック=0番でブロック、蘇生=opts.regen)。空振りが5回続いたら終了
async function settle(gs, prompts, opts) {
  let idle = 0; const seen = { regen: false };
  for (let i = 0; i < 200 && idle < 5; i++) {
    await new Promise(r => setImmediate(r));
    const idx = prompts.findIndex(p => p && !p._done);
    if (idx < 0) { idle++; continue; }
    idle = 0; const p = prompts[idx]; p._done = true;
    const seat = p.player;
    if (!gs.pendingPrompt[seat] || gs.pendingPrompt[seat].type !== p.type) continue; // 同じ質問の二重通知
    if (p.type === 'chain' || p.type === 'chain_attack') gs.handlePromptResponse(seat, { action: 'pass' });
    else if (p.type === 'block') gs.handlePromptResponse(seat, { assignments: { 0: 0 } });
    else if (p.type === 'regen_confirm') { seen.regen = true; gs.handlePromptResponse(seat, { accept: !!opts.regen }); }
    else gs.handlePromptResponse(seat, { cancel: true, skip: true, action: 'pass' });
  }
  return seen;
}
// 攻撃側の席を変えて、アーク同士の戦闘を最後まで進める
async function arkVsArk(attacker) {
  const { gs, prompts } = setup(attacker);
  const A = gs.G.players[attacker], D = gs.G.players[1 - attacker];
  const a = mc('ark'); a.tapped = false; a.summonSick = false; A.field.push(a);
  const d = mc('ark'); d.tapped = false; d.summonSick = false; D.field.push(d);
  gs.startCombat(attacker); gs.toggleAttacker(attacker, 0); gs.confirmAttack(attacker);
  // 質問に答えながら盤面が落ち着くまで回す(割り込み=パス、ブロック=アークでブロック、蘇生=断る)
  await settle(gs, prompts, { regen: false });
  return { attackerAlive: A.field.some(c => c.id === 'ark'), defenderAlive: D.field.some(c => c.id === 'ark'), gs };
}
(async () => {
  // A) 席0が攻撃 → 相打ち
  { const r = await arkVsArk(0); ok(!r.attackerAlive && !r.defenderAlive, 'A) 席0のアークが攻撃、席1のアークがブロック → 両方死ぬ(生存: 攻撃側=' + r.attackerAlive + ' ブロック側=' + r.defenderAlive + ')'); }
  // B) 席1が攻撃 → 相打ち(席の順番で結果が変わらない)
  { const r = await arkVsArk(1); ok(!r.attackerAlive && !r.defenderAlive, 'B) 席1のアークが攻撃、席0のアークがブロック → 両方死ぬ(生存: 攻撃側=' + r.attackerAlive + ' ブロック側=' + r.defenderAlive + ')'); }
  // C) 回帰: 片方だけが致死なら片方だけ死ぬ(ママチャリ100/100 が アーク にブロックされる → ママチャリだけ死ぬ)
  { const { gs, prompts } = setup(0);
    const m = mc('mamachari'); m.tapped = false; m.summonSick = false; gs.G.players[0].field.push(m);
    const d = mc('ark'); d.tapped = false; d.summonSick = false; gs.G.players[1].field.push(d);
    gs.startCombat(0); gs.toggleAttacker(0, 0); gs.confirmAttack(0);
    await settle(gs, prompts, { regen: false });
    ok(!gs.G.players[0].field.some(c => c.id === 'mamachari') && gs.G.players[1].field.some(c => c.id === 'ark'), 'C) 一方だけ致死なら一方だけ死ぬ(回帰)'); }
  // D) 回帰: 蘇生(ミーコ)が同時判定でも効く。ミーコ自身が生きていれば、戦闘で死んだ味方に蘇生確認が出る
  //    (ママチャリ100/100はアークの-100で耐久0=状況死で蘇生不可なので、サギ200/200を使う)
  { const { gs, prompts } = setup(0);
    const m = mc('sagi'); m.tapped = false; m.summonSick = false; gs.G.players[0].field.push(m);
    const mi = mc('miiko'); mi.tapped = false; gs.G.players[0].field.push(mi);
    const d = mc('ark'); d.tapped = false; d.summonSick = false; gs.G.players[1].field.push(d);
    gs.startCombat(0); gs.toggleAttacker(0, 0); gs.confirmAttack(0);
    const seen = await settle(gs, prompts, { regen: true }); const regenSeen = seen.regen;
    ok(regenSeen && gs.G.players[0].field.some(c => c.id === 'sagi'), 'D) ミーコの蘇生確認が出て、受けると生き残る(回帰)'); }
  console.log(fails ? 'COMBAT-MUTUAL RESULT: FAIL(' + fails + ')' : 'COMBAT-MUTUAL RESULT: PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
