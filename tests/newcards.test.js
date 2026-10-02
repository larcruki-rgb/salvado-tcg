// 新カード3枚(2026-10): 店主 リード / 大食冠 ゼラチネ(分裂・捕食) / ダイスケ誰その男
// 実行: node tests/newcards.test.js
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GameState = require(path.join(ROOT, 'server/GameState.js'));
const { CARD_DB, TOKEN_JK, makeCard } = require(path.join(ROOT, 'shared/cards.js'));
const mc = id => makeCard(CARD_DB.find(c => c.id === id));
let fails = 0; const ok = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
const ready = id => { const c = mc(id); c.tapped = false; c.summonSick = false; return c; };
const _log = console.log; const quiet = fn => { console.log = () => {}; try { return fn(); } finally { console.log = _log; } };

function setup(cp) {
  const gs = new GameState('t'); const prompts = []; gs.on('prompt', d => prompts.push(d)); gs.toast = () => {};
  gs.logLines = []; gs.log = m => gs.logLines.push(m);
  gs.on('resolveResults', () => { setImmediate(() => { gs.handleAckResolve(0); gs.handleAckResolve(1); }); });
  for (const P of gs.G.players) { for (let i = 0; i < 9; i++) { const m = mc('kaera'); m.manaTapped = false; P.mana.push(m); } P.deck = []; P.hand = []; P.life = 2000; }
  gs.G.cp = cp || 0; gs.G.phase = 'main'; gs.G.turn = 3;
  return { gs, prompts };
}
async function settle(gs, prompts, answer) {
  let idle = 0; const seen = [];
  console.log = () => {};
  try {
    for (let i = 0; i < 400 && idle < 6; i++) {
      await new Promise(r => setImmediate(r));
      const idx = prompts.findIndex(p => p && !p._done);
      if (idx < 0) { idle++; continue; }
      idle = 0; const p = prompts[idx]; p._done = true; const s = p.player;
      if (!gs.pendingPrompt[s] || gs.pendingPrompt[s].type !== p.type) continue;
      seen.push(s + ':' + p.type);
      let r = answer ? answer(p, s) : undefined;
      if (r === undefined) r = (p.type === 'regen_confirm') ? { accept: true } : (p.type === 'block' ? { assignments: {} } : { action: 'pass' });
      gs.handlePromptResponse(s, r);
    }
  } finally { console.log = _log; }
  return seen;
}
const F = (gs, pi) => gs.G.players[pi].field;
const count = (gs, pi, id) => F(gs, pi).filter(c => c.id === id).length;
const inGrave = (gs, pi, id) => gs.G.players[pi].grave.filter(c => c.id === id).length;
const idle = gs => !gs.pendingPrompt[0] && !gs.pendingPrompt[1] && gs.G.chainDepth === 0 && gs.G.effectStack.length === 0 && !gs._busy();
const act = (gs, p, fi, aid) => quiet(() => gs.activateAbility(fi, aid, p));

(async () => {
  // ================= 店主 リード =================
  { const { gs, prompts } = setup();
    const lead = ready('lead'); F(gs, 0).push(lead);
    gs.G.players[0].deck = [mc('douga_sakujo'), mc('tomo'), mc('komi')];
    act(gs, 0, 0, 'activated_lead_search');
    await settle(gs, prompts);
    const hand = gs.G.players[0].hand;
    ok(hand.length === 1 && hand[0].id === 'tomo', 'L1) 山札のキャラ(トモ)が手札に来る');
    ok(gs.G.players[0].deck.length === 2 && lead.tapped && gs.avMana(0) === 6, 'L1) 山札-1、リードはタップ、応援3を支払い');
    ok(!gs.logLines.some(l => l.indexOf('トモ') >= 0), 'L1) ログに取ったカードの名前が出ない(相手に手札が漏れない)');
    ok(idle(gs), 'L1) 解決後に止まっていない'); }
  { const { gs, prompts } = setup();
    F(gs, 0).push(ready('lead')); gs.G.players[0].deck = [mc('douga_sakujo'), mc('komi')];
    act(gs, 0, 0, 'activated_lead_search');
    await settle(gs, prompts);
    ok(gs.G.players[0].hand.length === 0 && gs.G.players[0].deck.length === 2 && idle(gs), 'L2) 山札にキャラなし: 不発で止まらない'); }
  { const { gs } = setup();
    const lead = ready('lead'); F(gs, 0).push(lead);
    ok(gs.getActivatable(lead, 0).some(a => a.id === 'activated_lead_search') && lead.hero === true && gs.checkLeg(mc('lead'), 0) === false, 'L3) 能力が候補に出る/主人公で同名制限あり'); }

  // ================= ゼラチネ: 分裂 =================
  const splitCase = async (label, prep, expect) => {
    const { gs, prompts } = setup(); const z = ready('zeratine'); F(gs, 0).push(z); prep(z, gs);
    act(gs, 0, 0, 'activated_zeratine_split');
    await settle(gs, prompts);
    const n = count(gs, 0, 'token_zeratine_child');
    ok(n === expect && count(gs, 0, 'zeratine') === 0 && inGrave(gs, 0, 'zeratine') === 1 && idle(gs), label + ' → ' + expect + '体 (実際 ' + n + ')');
    return gs;
  };
  { const gs = await splitCase('Z1) 残りHP300', () => {}, 3);
    ok(F(gs, 0).every(c => c.isToken && c.summonSick && gs.getP(c, 0) === 100 && gs.getT(c, 0) === 100 && !c.hero && !c.heroine), 'Z1) 子供は100/100・召喚酔い・主人公/ヒロインではない'); }
  await splitCase('Z2) ダメージ100を受けた後', z => { z.damage = 100; }, 2);
  await splitCase('Z3) カウンター+800で残りHP1100', z => { z.counters.push({ power: 0, toughness: 800 }); }, 10);
  await splitCase('Z4) 一時強化+300(投げ銭)は体数に乗る', z => { z.tempBuff.toughness = 300; }, 6);
  await splitCase('Z5) 残りHPがマイナス', z => { z.damage = 500; }, 0);
  await splitCase('Z6) 召喚酔いでも使える(出したターン)', z => { z.summonSick = true; }, 3);
  await splitCase('Z7) タップ中でも使える', z => { z.tapped = true; }, 3);

  // Z8) 同じゼラチネで2回宣言できない: 相手が割り込んで応答権が戻っても、候補に分裂が出ない
  { const { gs, prompts } = setup(); F(gs, 0).push(ready('zeratine'));
    F(gs, 1).push(ready('mamachari')); gs.G.players[1].hand.push(mc('akapo'));
    act(gs, 0, 0, 'activated_zeratine_split');
    let offeredAgain = null, played = false;
    await settle(gs, prompts, (p, s) => {
      if (p.type === 'chain' && s === 1 && !played) { const o = p.data.supports.find(x => x.id === 'akapo'); if (o) { played = true; return { action: 'playSupport', idx: o.idx }; } }
      if (p.type === 'akapo_target') return { targetIdx: 0 };
      if (p.type === 'chain' && s === 0) offeredAgain = p.data.abilities.some(a => a.ability.id === 'activated_zeratine_split');
    });
    ok(played && offeredAgain !== true, 'Z8) 相手の割り込み後、分裂をもう一度は宣言できない');
    ok(count(gs, 0, 'token_zeratine_child') === 3, 'Z8) 子供は3体だけ (実際 ' + count(gs, 0, 'token_zeratine_child') + ')'); }

  // Z9) 打ち消されたら何も出ず、生贄は戻らない
  { const { gs, prompts } = setup(); F(gs, 0).push(ready('zeratine')); gs.G.players[1].hand.push(mc('douga_sakujo'));
    act(gs, 0, 0, 'activated_zeratine_split');
    let c = false;
    await settle(gs, prompts, (p, s) => {
      if (p.type === 'chain' && s === 1 && !c) { const o = p.data.supports.find(x => x.id === 'douga_sakujo'); if (o) { c = true; return { action: 'playSupport', idx: o.idx }; } }
      if (p.type === 'counterspell_target') return { idx: p.data.targets[0].idx };
    });
    ok(c && count(gs, 0, 'token_zeratine_child') === 0 && inGrave(gs, 0, 'zeratine') === 1 && idle(gs), 'Z9) 打ち消し: 子供0体、ゼラチネは墓地のまま'); }

  // Z10) 攻撃中のゼラチネがブロック宣言後に分裂 → その攻撃は発生しない。子供は攻撃に参加しない
  { const { gs, prompts } = setup(); F(gs, 0).push(ready('zeratine')); F(gs, 1).push(ready('mamachari'));
    quiet(() => { gs.startCombat(0); gs.toggleAttacker(0, 0); gs.confirmAttack(0); });
    let did = false;
    await settle(gs, prompts, (p, s) => {
      if (p.type === 'block') return { assignments: { 0: 0 } };
      if (p.type === 'chain_attack' && s === 0 && !did && gs.G.chainContext === 'block') { const ab = p.data.abilities.find(a => a.ability.id === 'activated_zeratine_split'); if (ab) { did = true; return { action: 'activate', fi: ab.fi, aid: ab.ability.id }; } }
    });
    ok(did && count(gs, 0, 'token_zeratine_child') === 3, 'Z10) ブロック宣言後に分裂できる(子供3体)');
    ok(gs.G.players[1].life === 2000 && count(gs, 1, 'mamachari') === 1 && (F(gs, 1)[0].damage || 0) === 0, 'Z10) 攻撃は発生しない(相手LP・ブロッカーとも無傷)');
    ok(gs.G.phase === 'main2' && idle(gs), 'Z10) 戦闘が終わり止まっていない'); }

  // Z11) 相手ターン: 相手の企画ボツ(ゼラチネを破壊)に割り込んで分裂 → 子供3体、企画ボツは対象消滅
  { const { gs, prompts } = setup(1); F(gs, 0).push(ready('zeratine')); gs.G.players[1].hand.push(mc('kikaku_botsu'));
    quiet(() => gs.playCard(1, 0));
    let did = false;
    await settle(gs, prompts, (p, s) => {
      if (p.type === 'destroy_target') { const t = p.data.targets.find(x => x.id === 'zeratine'); return { targetIdx: t.idx, pi: t.pi }; }
      if (p.type === 'chain' && s === 0 && !did) { const ab = p.data.abilities.find(a => a.ability.id === 'activated_zeratine_split'); if (ab) { did = true; return { action: 'activate', fi: ab.fi, aid: ab.ability.id }; } }
    });
    ok(did && count(gs, 0, 'token_zeratine_child') === 3 && idle(gs), 'Z11) 相手ターンの割り込みで分裂: 子供3体が残る (' + F(gs, 0).map(c => c.name).join(',') + ')'); }

  // Z12) 自分の手番でないのに通常起動はできない
  { const { gs } = setup(1); F(gs, 0).push(ready('zeratine'));
    act(gs, 0, 0, 'activated_zeratine_split');
    ok(count(gs, 0, 'zeratine') === 1 && gs.G.effectStack.length === 0, 'Z12) 相手ターンに(割り込み以外で)分裂は起動できない'); }

  // ================= ゼラチネ: 捕食 =================
  // E1) 素の値だけ増える。一時強化・全体強化・エンチャント・アークの弱体化は入らない。蘇生確認も出ない
  { const { gs, prompts } = setup();
    const z = ready('zeratine'), food = ready('mamachari'), milia = ready('milia'), miiko = ready('miiko'); // ママチャリ 素200/100
    F(gs, 0).push(z, food, milia, miiko); F(gs, 1).push(ready('ark'));
    food.tempBuff = { power: 300, toughness: 300 };
    const en = mc('healthy_sleep'); food.enchantments.push({ id: en.id, src: en });
    const before = [gs.getP(z, 0), gs.getT(z, 0)];
    act(gs, 0, 0, 'activated_zeratine_eat');
    const pr = gs.pendingPrompt[0];
    ok(pr && pr.type === 'zeratine_eat_target' && !pr.data.targets.some(t => t.idx === 0) && pr.data.targets.length === 3, 'E1) 対象選択が出る。自分自身は候補にいない');
    ok(!z.tapped && F(gs, 0).includes(food), 'E1) 回答するまでは何も払っていない');
    const seen = await settle(gs, prompts, (p) => { if (p.type === 'zeratine_eat_target') return { targetIdx: 1 }; });
    ok(!seen.some(x => x.indexOf('regen_confirm') >= 0), 'E1) 生贄に蘇生確認が出ない(ミーコと応援があっても)');
    ok(z.tapped && !F(gs, 0).includes(food) && inGrave(gs, 0, 'mamachari') === 1 && inGrave(gs, 0, 'healthy_sleep') === 1, 'E1) ゼラチネはタップ、生贄とそのエンチャントは墓地へ');
    ok(gs.getP(z, 0) === before[0] + 200 && gs.getT(z, 0) === before[1] + 100, 'E1) 増えるのは素の200/100だけ (' + before.join('/') + ' → ' + gs.getP(z, 0) + '/' + gs.getT(z, 0) + ')');
    ok(z.counters.length === 1 && z.counters[0].power === 200 && z.counters[0].toughness === 100 && idle(gs), 'E1) カウンターとして載る。止まっていない'); }

  // E2) キャンセル・不正な回答: 何も払わず、止まらない
  for (const [label, resp] of [['空の回答(CPUの既定)', {}], ['-1', { targetIdx: -1 }], ['自分自身', { targetIdx: 0 }], ['範囲外', { targetIdx: 9 }], ['文字列', { targetIdx: '1' }]]) {
    const { gs, prompts } = setup(); const z = ready('zeratine'), food = ready('mamachari'); F(gs, 0).push(z, food);
    act(gs, 0, 0, 'activated_zeratine_eat');
    await settle(gs, prompts, (p) => { if (p.type === 'zeratine_eat_target') return resp; });
    ok(!z.tapped && F(gs, 0).includes(food) && z.counters.length === 0 && idle(gs), 'E2) ' + label + ': 何も払わず止まらない'); }

  // E3) 食べる相手がいない: 能力が候補に出ない
  { const { gs } = setup(); const z = ready('zeratine'); F(gs, 0).push(z);
    ok(!gs.getActivatable(z, 0).some(a => a.id === 'activated_zeratine_eat'), 'E3) 味方が他にいなければ捕食は候補に出ない'); }

  // E4) トークン(エンチャント付き)を食べる: +100/+100、エンチャントは墓地へ
  { const { gs, prompts } = setup(); const z = ready('zeratine'); const tk = makeCard(TOKEN_JK); const en = mc('rena');
    tk.enchantments.push({ id: en.id, src: en }); F(gs, 0).push(z, tk);
    act(gs, 0, 0, 'activated_zeratine_eat');
    await settle(gs, prompts, (p) => { if (p.type === 'zeratine_eat_target') return { targetIdx: 1 }; });
    ok(gs.getP(z, 0) === 400 && gs.getT(z, 0) === 400 && inGrave(gs, 0, 'rena') === 1 && F(gs, 0).length === 1, 'E4) トークン: +100/+100、付いていたレナは墓地へ'); }

  // E5) 解決前にゼラチネが場を離れたら不発(生贄は戻らない)。止まらない
  { const { gs, prompts } = setup(); const z = ready('zeratine'), food = ready('mamachari'); F(gs, 0).push(z, food);
    F(gs, 1).push(ready('shinigami'));
    act(gs, 0, 0, 'activated_zeratine_eat');
    let sg = false;
    await settle(gs, prompts, (p, s) => {
      if (p.type === 'zeratine_eat_target') return { targetIdx: 1 };
      if (p.type === 'chain' && s === 1 && !sg) { const ab = p.data.abilities.find(a => a.ability.id === 'shinigami_destroy'); if (ab) { sg = true; return { action: 'activate', fi: ab.fi, aid: 'shinigami_destroy' }; } }
      if (p.type === 'shinigami_destroy_target') { const t = p.data.targets.find(x => x.id === 'zeratine'); return { targetIdx: t.idx, pi: t.pi }; }
    });
    ok(sg && F(gs, 0).length === 0 && inGrave(gs, 0, 'zeratine') === 1 && inGrave(gs, 0, 'mamachari') === 1 && z.counters.length === 0 && idle(gs), 'E5) ゼラチネが先に除去された: 強化は不発、止まらない'); }

  // E6) 捕食→分裂: 増えたHPぶん子供が増える。出し直すと 300/300
  { const { gs, prompts } = setup(); const z = ready('zeratine'), food = ready('daria'); F(gs, 0).push(z, food); // ダリア 0/500
    act(gs, 0, 0, 'activated_zeratine_eat');
    await settle(gs, prompts, (p) => { if (p.type === 'zeratine_eat_target') return { targetIdx: 1 }; });
    ok(gs.getP(z, 0) === 300 && gs.getT(z, 0) === 800, 'E6) ダリア(0/500)を捕食 → 300/800');
    act(gs, 0, 0, 'activated_zeratine_split');
    await settle(gs, prompts);
    ok(count(gs, 0, 'token_zeratine_child') === 8, 'E6) 分裂で子供8体 (実際 ' + count(gs, 0, 'token_zeratine_child') + ')');
    const g = gs.G.players[0].grave; const zz = g.find(c => c.id === 'zeratine'); g.splice(g.indexOf(zz), 1);
    quiet(() => gs._enterField(zz, 0, 'test'));
    ok(gs.getP(zz, 0) === 300 && gs.getT(zz, 0) === 300, 'E6) 出し直すと 300/300'); }

  // E7) 割り込み(相手ターン)でも使える。チェーンに戻って止まらない
  { const { gs, prompts } = setup(1); const z = ready('zeratine'), food = ready('mamachari'); F(gs, 0).push(z, food);
    gs.G.players[1].hand.push(mc('kaera'));
    quiet(() => gs.playCard(1, 0));
    let did = false;
    await settle(gs, prompts, (p, s) => {
      if (p.type === 'chain' && s === 0 && !did) { const ab = p.data.abilities.find(a => a.ability.id === 'activated_zeratine_eat'); if (ab) { did = true; return { action: 'activate', fi: ab.fi, aid: ab.ability.id }; } }
      if (p.type === 'zeratine_eat_target') return { targetIdx: 1 };
    });
    ok(did && gs.getP(z, 0) === 500 && count(gs, 1, 'kaera') === 1 && idle(gs), 'E7) 相手の投稿に割り込んで捕食: 500/400、相手の投稿も解決される'); }

  // E8) 戦闘中に、ブロックされた味方の攻撃者を食べる → その攻撃はなくなる
  { const { gs, prompts } = setup(); const z = ready('zeratine'), atk = ready('mamachari'); F(gs, 0).push(z, atk); F(gs, 1).push(ready('daria'));
    quiet(() => { gs.startCombat(0); gs.toggleAttacker(0, 1); gs.confirmAttack(0); });
    let did = false;
    await settle(gs, prompts, (p, s) => {
      if (p.type === 'block') return { assignments: { 1: 0 } };
      if (p.type === 'chain_attack' && s === 0 && !did && gs.G.chainContext === 'block') { const ab = p.data.abilities.find(a => a.ability.id === 'activated_zeratine_eat'); if (ab) { did = true; return { action: 'activate', fi: ab.fi, aid: ab.ability.id }; } }
      if (p.type === 'zeratine_eat_target') return { targetIdx: 1 };
    });
    ok(did && gs.getP(z, 0) === 500 && gs.G.players[1].life === 2000 && gs.G.phase === 'main2' && idle(gs), 'E8) 攻撃中の味方を捕食: 攻撃は消え、戦闘が終わる'); }

  // ================= ダイスケ誰その男 =================
  // D1) 両プレイヤーの主人公だけが変わる。ヒロインは変わらない。タップ状態は引き継ぎ、召喚酔いしない
  { const { gs, prompts } = setup();
    const maoria = ready('maoria'), tomo = ready('tomo'), jun = ready('jun'); maoria.tapped = true;
    const en = mc('rena'); maoria.enchantments.push({ id: en.id, src: en }); maoria.damage = 200;
    F(gs, 0).push(maoria, tomo); F(gs, 1).push(jun, ready('milia'));
    gs.G.players[0].hand.push(mc('daisuke_dare'));
    quiet(() => gs.playCard(0, 0));
    await settle(gs, prompts);
    const t0 = F(gs, 0)[0], t1 = F(gs, 1)[0];
    ok(t0.id === 'token_daisuke' && t1.id === 'token_daisuke' && F(gs, 0)[1].id === 'tomo' && F(gs, 1)[1].id === 'milia', 'D1) 主人公(マオリア・ジュン)だけがダイスケに。ヒロイン(トモ・ミリア)はそのまま');
    ok(t0.tapped === true && t1.tapped === false && !t0.summonSick && !t1.summonSick, 'D1) タップ状態を引き継ぎ、召喚酔いしない');
    ok(t0.isToken && !t0.hero && (t0.damage || 0) === 0 && t0.enchantments.length === 0 && t0.uid !== maoria.uid, 'D1) トークンは新規(主人公ではない・ダメージとエンチャントなし・新しいuid)');
    ok(inGrave(gs, 0, 'maoria') === 1 && inGrave(gs, 0, 'rena') === 1 && inGrave(gs, 1, 'jun') === 1 && maoria.damage === 0 && maoria.enchantments.length === 0, 'D1) 元のカードとエンチャントは墓地へ');
    ok(gs.avMana(0) === 7 && inGrave(gs, 0, 'daisuke_dare') === 1 && idle(gs), 'D1) コスト2、止まっていない'); }

  // D2) 両側にアーク(相手全体-100/-100)がいても、全トークンが生き残る
  { const { gs, prompts } = setup();
    F(gs, 0).push(ready('ark'), ready('jun')); F(gs, 1).push(ready('ark'), ready('asaki'));
    gs.G.players[0].hand.push(mc('daisuke_dare'));
    quiet(() => gs.playCard(0, 0));
    await settle(gs, prompts);
    const all = [...F(gs, 0), ...F(gs, 1)];
    ok(all.length === 4 && all.every(c => c.id === 'token_daisuke'), 'D2) 4体ともダイスケとして場に残る (' + all.map(c => c.name).join(',') + ')');
    ok(all.every((c, i) => gs.getT(c, i < 2 ? 0 : 1) === 100), 'D2) 全員 HP100'); }

  // D3) 攻撃中の主人公が変わっても攻撃は続く(100点)。ブロック中の主人公が変わってもブロックは続く
  { const { gs, prompts } = setup();
    F(gs, 0).push(ready('asaki'), ready('mamachari')); F(gs, 1).push(ready('jun'));   // アサキ400/400(主人公)・ママチャリ200/100 / ジュン100/200(主人公)
    gs.G.players[0].hand.push(mc('daisuke_dare'));
    quiet(() => { gs.startCombat(0); gs.toggleAttacker(0, 0); gs.toggleAttacker(0, 1); gs.confirmAttack(0); });
    let used = false;
    await settle(gs, prompts, (p, s) => {
      if (p.type === 'block') { const a = p.data.attackers.find(x => x.name.indexOf('ママチャリ') >= 0); return { assignments: { [a.idx]: 0 } }; }
      if (p.type === 'chain_attack' && s === 0 && !used && gs.G.chainContext === 'block') { const o = p.data.supports.find(x => x.id === 'daisuke_dare'); if (o) { used = true; return { action: 'playSupport', idx: o.idx }; } }
    });
    // アサキ→ダイスケ(100)が直撃。ママチャリ(200) vs ジュン→ダイスケ(100/100): 互いに致死 → 両方破壊
    ok(used && gs.G.players[1].life === 1900, 'D3) 攻撃中のアサキがダイスケになっても攻撃は続く: 直撃100 (相手LP ' + gs.G.players[1].life + ')');
    ok(F(gs, 1).length === 0 && count(gs, 0, 'mamachari') === 0, 'D3) ブロック中のジュンがダイスケになってもブロックは続く(ママチャリと相打ち)');
    ok(count(gs, 0, 'token_daisuke') === 1 && idle(gs), 'D3) 攻撃側のダイスケは場に残り、止まっていない'); }

  // D4) 先に積まれた効果はトークンに当たらない: 相手の企画ボツ(マオリア対象)に割り込んでダイスケ → 企画ボツは対象消滅
  { const { gs, prompts } = setup(1);
    F(gs, 0).push(ready('maoria')); gs.G.players[0].hand.push(mc('daisuke_dare')); gs.G.players[1].hand.push(mc('kikaku_botsu'));
    quiet(() => gs.playCard(1, 0));
    let used = false;
    await settle(gs, prompts, (p, s) => {
      if (p.type === 'destroy_target') { const t = p.data.targets.find(x => x.id === 'maoria'); return { targetIdx: t.idx, pi: t.pi }; }
      if (p.type === 'chain' && s === 0 && !used) { const o = p.data.supports.find(x => x.id === 'daisuke_dare'); if (o) { used = true; return { action: 'playSupport', idx: o.idx }; } }
    });
    ok(used && count(gs, 0, 'token_daisuke') === 1 && idle(gs), 'D4) 企画ボツはトークンに当たらず、ダイスケは場に残る'); }

  // D5) トークンは2枚目のダイスケ誰その男の対象にならない
  { const { gs, prompts } = setup();
    F(gs, 0).push(ready('jun')); gs.G.players[0].hand.push(mc('daisuke_dare'), mc('daisuke_dare'));
    quiet(() => gs.playCard(0, 0)); await settle(gs, prompts);
    const uid1 = F(gs, 0)[0].uid;
    quiet(() => gs.playCard(0, 0)); await settle(gs, prompts);
    ok(F(gs, 0).length === 1 && F(gs, 0)[0].uid === uid1 && inGrave(gs, 0, 'jun') === 1, 'D5) 2枚目では何も変わらない(同じトークンのまま)'); }

  // D6) 場に主人公がいなくても止まらない / 同名制限: 変身後は同じ主人公をもう一度出せる
  { const { gs, prompts } = setup();
    F(gs, 0).push(ready('tomo')); gs.G.players[0].hand.push(mc('daisuke_dare'));
    quiet(() => gs.playCard(0, 0)); await settle(gs, prompts);
    ok(count(gs, 0, 'tomo') === 1 && idle(gs), 'D6) 主人公がいない: 何も起きず止まらない'); }
  { const { gs, prompts } = setup();
    F(gs, 0).push(ready('jun')); gs.G.players[0].hand.push(mc('daisuke_dare'));
    quiet(() => gs.playCard(0, 0)); await settle(gs, prompts);
    ok(gs.checkLeg(mc('jun'), 0) === true, 'D6) 変身後は同じ主人公(ジュン)をもう一度出せる'); }

  console.log(fails === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL (' + fails + ')');
  process.exit(fails === 0 ? 0 : 1);
})();
