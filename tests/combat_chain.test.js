// 攻撃 → 割り込み(インプレッション制限 -500/-500 全体) → 返しの割り込み(投げ銭 +300/+300) → 解決 → ブロック → ダメージ、が感覚どおりになるか
// 同時死亡判定(_lethal)の導入後の確認。実行: node tests/combat_chain.test.js
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GameState = require(path.join(ROOT, 'server/GameState.js'));
const { CARD_DB, makeCard } = require(path.join(ROOT, 'shared/cards.js'));
const mc = id => makeCard(CARD_DB.find(c => c.id === id));
let fails = 0; const ok = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
const ready = id => { const c = mc(id); c.tapped = false; c.summonSick = false; return c; };

function setup() {
  const gs = new GameState('t'); const prompts = []; gs.on('prompt', d => prompts.push(d)); gs.log = () => {}; gs.toast = () => {};
  gs.on('resolveResults', () => { setImmediate(() => { gs.handleAckResolve(0); gs.handleAckResolve(1); }); });
  for (const P of gs.G.players) { for (let i = 0; i < 9; i++) { const m = mc('kaera'); m.manaTapped = false; P.mana.push(m); } P.deck = []; for (let i = 0; i < 5; i++) P.deck.push(mc('mamachari')); P.hand = []; P.life = 2000; }
  gs.G.cp = 0; gs.G.phase = 'main'; gs.G.turn = 3;
  return { gs, prompts };
}
// 質問に答えながら落ち着くまで回す。script[seat] = 出す割り込みカードIDの順番(手札にあって出せる時だけ)。block = ブロックする側の割り当て
async function settle(gs, prompts, script, blockAssign) {
  let idle = 0; const seen = [];
  for (let i = 0; i < 300 && idle < 6; i++) {
    await new Promise(r => setImmediate(r));
    const idx = prompts.findIndex(p => p && !p._done);
    if (idx < 0) { idle++; continue; }
    idle = 0; const p = prompts[idx]; p._done = true; const s = p.player;
    if (!gs.pendingPrompt[s] || gs.pendingPrompt[s].type !== p.type) continue;
    seen.push(s + ':' + p.type);
    if (p.type === 'chain' || p.type === 'chain_attack') {
      const want = script[s] && script[s][0];
      const opt = want && (p.data.supports || []).find(x => x.id === want);
      if (opt) { script[s].shift(); gs.handlePromptResponse(s, { action: 'playSupport', idx: opt.idx }); }
      else gs.handlePromptResponse(s, { action: 'pass' });
    }
    else if (p.type === 'buff_target') gs.handlePromptResponse(s, { targetIdx: 0 });
    else if (p.type === 'block') gs.handlePromptResponse(s, { assignments: (p.data.blockers && p.data.blockers.length) ? blockAssign : {} });
    else if (p.type === 'regen_confirm') gs.handlePromptResponse(s, { accept: false });
    else gs.handlePromptResponse(s, { cancel: true, skip: true, action: 'pass' });
  }
  return seen;
}
const alive = (gs, pi, id) => gs.G.players[pi].field.some(c => c.id === id);
const dmg = (gs, pi, id) => { const c = gs.G.players[pi].field.find(c => c.id === id); return c ? (c.damage || 0) : null; };

(async () => {
  // S1) アーク(500/500)が攻撃 → 相手がインプレッション制限(-500全体) → 自分が投げ銭(+300)で返す
  //     期待: 投げ銭が先に解決→アーク800/800→-500で300/300。相手のサギ(200/200-100)は-500で耐久0以下=死亡(状況死・蘇生なし)
  //     ブロッカーが消えたので攻撃は素通り→相手LP -300。アークは生存・ダメージ0
  { const { gs, prompts } = setup();
    gs.G.players[0].field.push(ready('ark')); gs.G.players[0].hand.push(mc('super_chat'));
    gs.G.players[1].field.push(ready('sagi')); gs.G.players[1].hand.push(mc('impression_seigen'));
    gs.startCombat(0); gs.toggleAttacker(0, 0); gs.confirmAttack(0);
    const seen = await settle(gs, prompts, { 0: ['super_chat'], 1: ['impression_seigen'] }, { 0: 0 });
    ok(seen.includes('1:chain_attack') && seen.includes('0:chain_attack') && seen.includes('0:buff_target'), 'S1) 相手の割り込み→自分の割り込み(投げ銭の対象選択)の順で質問が出る [' + seen.join(' ') + ']');
    ok(alive(gs, 0, 'ark') && dmg(gs, 0, 'ark') === 0, 'S1) 投げ銭で守ったアークは生存・ダメージ0 (生存=' + alive(gs, 0, 'ark') + ' dmg=' + dmg(gs, 0, 'ark') + ')');
    ok(!alive(gs, 1, 'sagi'), 'S1) 相手のサギは-500で死亡');
    ok(gs.G.players[1].life === 1700, 'S1) ブロッカーが消えたので攻撃が通り、相手LP 2000→1700 (実際 ' + gs.G.players[1].life + ')'); }

  // S2) サギ(200/200)が攻撃 → 相手アークがブロック予定 → 相手がインプレッション制限 → 自分が投げ銭でサギを守ろうとする
  //     期待: サギ 200+300-500=0 → 耐久0で死亡。相手アークも 500-500=0 で死亡。攻撃側が消えるので相手LPは減らない
  { const { gs, prompts } = setup();
    gs.G.players[0].field.push(ready('sagi')); gs.G.players[0].hand.push(mc('super_chat'));
    gs.G.players[1].field.push(ready('ark')); gs.G.players[1].hand.push(mc('impression_seigen'));
    gs.startCombat(0); gs.toggleAttacker(0, 0); gs.confirmAttack(0);
    await settle(gs, prompts, { 0: ['super_chat'], 1: ['impression_seigen'] }, { 0: 0 });
    ok(!alive(gs, 0, 'sagi') && !alive(gs, 1, 'ark'), 'S2) +300しても-500に届かず両方死亡 (サギ=' + alive(gs, 0, 'sagi') + ' アーク=' + alive(gs, 1, 'ark') + ')');
    ok(gs.G.players[1].life === 2000, 'S2) 攻撃側が消えたのでLPは減らない (実際 ' + gs.G.players[1].life + ')'); }

  // S3) アーク対アーク、両方が自分のアークに投げ銭 → 700/700 同士の戦闘 → 相打ち(席の順番に関係なく)
  { const { gs, prompts } = setup();
    gs.G.players[0].field.push(ready('ark')); gs.G.players[0].hand.push(mc('super_chat'));
    gs.G.players[1].field.push(ready('ark')); gs.G.players[1].hand.push(mc('super_chat'));
    gs.startCombat(0); gs.toggleAttacker(0, 0); gs.confirmAttack(0);
    await settle(gs, prompts, { 0: ['super_chat'], 1: ['super_chat'] }, { 0: 0 });
    ok(!alive(gs, 0, 'ark') && !alive(gs, 1, 'ark'), 'S3) 投げ銭同士(700/700 vs 700/700)は相打ち (P0=' + alive(gs, 0, 'ark') + ' P1=' + alive(gs, 1, 'ark') + ')');
    ok(gs.G.players[1].life === 2000, 'S3) ブロックされたのでLPは減らない'); }

  // S4) 席を入れ替え: P1(席1)が攻撃側で S1 と同じ流れ(相手=P0がインプレッション制限、P1が投げ銭) → 結果が席に依存しない
  { const { gs, prompts } = setup(); gs.G.cp = 1;
    gs.G.players[1].field.push(ready('ark')); gs.G.players[1].hand.push(mc('super_chat'));
    gs.G.players[0].field.push(ready('sagi')); gs.G.players[0].hand.push(mc('impression_seigen'));
    gs.startCombat(1); gs.toggleAttacker(1, 0); gs.confirmAttack(1);
    await settle(gs, prompts, { 1: ['super_chat'], 0: ['impression_seigen'] }, { 0: 0 });
    ok(alive(gs, 1, 'ark') && dmg(gs, 1, 'ark') === 0 && !alive(gs, 0, 'sagi') && gs.G.players[0].life === 1700, 'S4) 席1が攻撃側でも S1 と同じ結果 (アーク生存=' + alive(gs, 1, 'ark') + ' サギ=' + alive(gs, 0, 'sagi') + ' LP=' + gs.G.players[0].life + ')'); }

  // S5) ブロック後の割り込み: アーク攻撃 → 相手がサギでブロック → (ブロック後の質問で)自分が投げ銭 → 800-100=700 でサギを倒し、サギの100でアークは生存
  { const { gs, prompts } = setup();
    gs.G.players[0].field.push(ready('ark')); gs.G.players[0].hand.push(mc('super_chat'));
    gs.G.players[1].field.push(ready('sagi'));
    gs.startCombat(0); gs.toggleAttacker(0, 0); gs.confirmAttack(0);
    // 攻撃宣言時の質問ではパスし、ブロック後の質問で投げ銭を出す: script は「blockInfo が付いた chain_attack」でだけ使う
    let idle = 0, used = false; const seen = [];
    for (let i = 0; i < 300 && idle < 6; i++) {
      await new Promise(r => setImmediate(r));
      const idx = prompts.findIndex(p => p && !p._done); if (idx < 0) { idle++; continue; } idle = 0;
      const p = prompts[idx]; p._done = true; const s = p.player; if (!gs.pendingPrompt[s] || gs.pendingPrompt[s].type !== p.type) continue; seen.push(s + ':' + p.type + (p.data && p.data.blockInfo ? '(block)' : ''));
      if (p.type === 'chain_attack') { const opt = (!used && s === 0 && p.data.blockInfo && p.data.blockInfo.some(b => b.blocked)) ? (p.data.supports || []).find(x => x.id === 'super_chat') : null; if (opt) { used = true; gs.handlePromptResponse(s, { action: 'playSupport', idx: opt.idx }); } else gs.handlePromptResponse(s, { action: 'pass' }); }
      else if (p.type === 'buff_target') gs.handlePromptResponse(s, { targetIdx: 0 });
      else if (p.type === 'block') gs.handlePromptResponse(s, { assignments: { 0: 0 } });
      else if (p.type === 'regen_confirm') gs.handlePromptResponse(s, { accept: false });
      else gs.handlePromptResponse(s, { cancel: true, skip: true, action: 'pass' });
    }
    ok(used, 'S5) ブロック後に攻撃側へ割り込みの質問が出て投げ銭を出せた [' + seen.join(' ') + ']');
    ok(alive(gs, 0, 'ark') && dmg(gs, 0, 'ark') === 100 && !alive(gs, 1, 'sagi') && gs.G.players[1].life === 2000, 'S5) アーク生存(ダメージ100)・サギ死亡・LPはそのまま (生存=' + alive(gs, 0, 'ark') + ' dmg=' + dmg(gs, 0, 'ark') + ' サギ=' + alive(gs, 1, 'sagi') + ' LP=' + gs.G.players[1].life + ')'); }

  console.log(fails ? 'COMBAT-CHAIN RESULT: FAIL(' + fails + ')' : 'COMBAT-CHAIN RESULT: PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
