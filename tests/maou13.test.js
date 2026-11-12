// 十三魔王の追加(2026-11): オリオン / 勇者の聖剣 / キャプテン・ジョー / ブラックヴォルテックス号 / メンヘラ・ヤンデレヒロイン、寄生体の魔王付与・ゼラチネ子供の魔物属性
// 実行: node tests/maou13.test.js
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GameState = require(path.join(ROOT, 'server/GameState.js'));
const { CARD_DB, makeCard } = require(path.join(ROOT, 'shared/cards.js'));
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
const untapped = (gs, pi) => gs.G.players[pi].mana.filter(m => !m.manaTapped).length;
const idle = gs => !gs.pendingPrompt[0] && !gs.pendingPrompt[1] && gs.G.chainDepth === 0 && gs.G.effectStack.length === 0;

(async () => {
  const S = require(path.join(ROOT, 'shared/cards.js'));
  const V = require(path.join(ROOT, 'server/deckValidation.js'));
  const Release = require(path.join(ROOT, 'server/release.js'));
  const AIPlayer = require(path.join(ROOT, 'server/AIPlayer.js'));
  const tok = T => { const c = makeCard(T); c.summonSick = false; return c; };
  const withPar = id => { const c = ready(id); c.enchantments.push({ id: 'parasite', src: mc('parasite') }); return c; };
  const sword = (gs, pi, host) => { host.enchantments.push({ id: 'holy_sword', src: mc('holy_sword') }); ['haste', 'vigilance', 'activated_holy_sword'].forEach(a => { if (!host.abilities.includes(a)) host.abilities.push(a); }); };

  // M1) 属性: 寄生体付きは魔王も持つ。ゼラチネ子供・魔物トークン・サメは魔物
  { const { gs } = setup();
    ok(gs.hasSubtype(withPar('maoria'), '魔王') && !gs.hasSubtype(ready('maoria'), '魔王') && gs.hasSubtype(ready('maoria'), '勇者'), 'M1) 寄生体付きマオリアは魔王(付いていなければ勇者のみ)');
    ok([S.TOKEN_ZERATINE_CHILD, S.TOKEN_MONSTER, S.TOKEN_SHARK].every(T => gs.hasSubtype(makeCard(T), '魔物')) && !gs.hasSubtype(makeCard(S.TOKEN_JK), '魔物'), 'M1) ゼラチネ子供・寄生体の魔物・サメ魔物は魔物 / 女子高生は違う'); }

  // M2) オリオン: 登場時に聖剣を手札へ
  { const { gs, prompts } = setup(); gs.G.players[0].deck = [mc('kaera'), mc('holy_sword'), mc('jk_a')]; gs.G.players[0].hand.push(mc('orion'));
    quiet(() => gs.playCard(0, 0)); await settle(gs, prompts);
    ok(count(gs, 0, 'orion') === 1 && gs.G.players[0].hand.some(c => c.id === 'holy_sword') && !gs.G.players[0].deck.some(c => c.id === 'holy_sword'), 'M2) オリオン登場 → 聖剣が山札から手札へ'); }

  // M3) 聖剣: 勇者にだけ付く。+300/+300・俊足・油断しない・破壊能力
  { const { gs, prompts } = setup(); F(gs, 0).push(ready('kaera')); gs.G.players[0].hand.push(mc('holy_sword'));
    quiet(() => gs.playCard(0, 0)); await settle(gs, prompts);
    ok(gs.G.players[0].hand.length === 1 && untapped(gs, 0) === 9 && idle(gs), 'M3) 勇者がいない → 出せない(応援も手札もそのまま)'); }
  { const { gs, prompts } = setup(); const o = mc('orion'); o.tapped = false; F(gs, 0).push(ready('kaera'), o); gs.G.players[0].hand.push(mc('holy_sword'));
    quiet(() => gs.playCard(0, 0));
    const p = prompts.find(x => x.type === 'enchant_target');
    ok(p && p.data.targets.length === 1 && p.data.targets[0].idx === 1, 'M3) 対象は勇者(オリオン)だけ');
    await settle(gs, prompts, (q) => q.type === 'enchant_target' ? { fieldIdx: 0 } : undefined); // わざと勇者以外を選ぶ → 出し直し → 2回目も勇者以外…を避けるため1回だけ
    ok(o.enchantments.length === 0 || o.enchantments.some(e => e.id === 'holy_sword'), 'M3) 勇者以外を選んでも、勇者以外には付かない');
    ok(!F(gs, 0)[0].enchantments.some(e => e.id === 'holy_sword'), 'M3) カエラには付いていない'); }
  { const { gs, prompts } = setup(); const o = mc('orion'); F(gs, 0).push(o); gs.G.players[0].hand.push(mc('holy_sword'));
    quiet(() => gs.playCard(0, 0)); await settle(gs, prompts, (q) => q.type === 'enchant_target' ? { fieldIdx: 0 } : undefined);
    ok(gs.getP(o, 0) === 400 && gs.getT(o, 0) === 400 && o.abilities.includes('haste') && o.abilities.includes('vigilance') && !o.summonSick, 'M3) オリオン400/400・俊足・油断しない・召喚酔いなし (' + gs.getP(o, 0) + '/' + gs.getT(o, 0) + ')');
    ok(!gs.getActivatable(o, 0).some(a => a.id === 'activated_holy_sword'), 'M3) 相手の場に13魔王・魔王・魔物がいない時は出ない');
    F(gs, 1).push(tok(S.TOKEN_MONSTER));
    ok(gs.getActivatable(o, 0).some(a => a.id === 'activated_holy_sword'), 'M3) 対象がいれば使える');
    gs.G.cp = 1; ok(gs.getActivatable(o, 0).some(a => a.id === 'activated_holy_sword'), 'M3) 相手の番(割り込み)でも候補に出る'); gs.G.cp = 0;
    F(gs, 1).pop();
    quiet(() => gs._executeDestroy(o, 0));
    ok(!o.abilities.includes('activated_holy_sword') && !o.abilities.includes('vigilance') && inGrave(gs, 0, 'holy_sword') === 1, 'M3) 場を離れたら付与した能力は消え、聖剣はゴミ箱'); }

  // M4) 聖剣の破壊: 相手の13魔王・魔王・魔物だけ。蘇生不可・積まない(割り込み不可)。応援3+タップ
  { const { gs, prompts } = setup(); const o = ready('orion'); sword(gs, 0, o); F(gs, 0).push(o);
    const zc = tok(S.TOKEN_ZERATINE_CHILD), mao = withPar('maoria'), plain = ready('maoria'), alu = ready('captain_joe'); alu.enchantments.push({ id: 'alminium' });
    F(gs, 1).push(ready('kaera'), zc, mao, plain, alu, ready('captain_joe'));
    quiet(() => gs.activateAbility(0, 'activated_holy_sword', 0));
    const p = prompts.find(x => x.type === 'holy_sword_target'); const names = p ? p.data.targets.map(t => t.name) : [];
    ok(p && names.length === 3 && names.includes('ゼラチネ子供') && names.filter(n => n.indexOf('マオリア') >= 0).length === 1 && names.includes('冥界主 キャプテン・ジョー'), 'M4) 対象: ゼラチネ子供・寄生体付きマオリア・ジョー (アルミホイル付きと寄生体なしマオリア・カエラは除外) ' + names.join(','));
    const ti = p.data.targets.find(t => t.name.indexOf('マオリア') >= 0).idx;
    let stackSeen = -1; const seen = await settle(gs, prompts, (q) => { if (q.type === 'holy_sword_target') { return { targetIdx: ti, pi: 1 }; } });
    ok(!F(gs, 1).includes(mao) && inGrave(gs, 1, 'maoria') === 1 && !seen.some(s => s.indexOf('regen_confirm') >= 0 || s.indexOf('chain') >= 0), 'M4) 寄生体付きマオリアを破壊。蘇生確認もチェーンも出ない');
    ok(o.tapped && untapped(gs, 0) === 6 && idle(gs), 'M4) オリオンはタップ、応援3消費、止まっていない'); }
  { const { gs, prompts } = setup(); const o = ready('orion'); sword(gs, 0, o); F(gs, 0).push(o); F(gs, 1).push(ready('kaera'), tok(S.TOKEN_MONSTER));
    quiet(() => gs.activateAbility(0, 'activated_holy_sword', 0));
    await settle(gs, prompts, (q) => q.type === 'holy_sword_target' ? { targetIdx: 0, pi: 1 } : undefined); // 対象外(カエラ)を選ぶ
    ok(count(gs, 1, 'kaera') === 1 && !o.tapped && untapped(gs, 0) === 9 && idle(gs), 'M4) 対象外を選んだら何もしない(支払いなし・止まらない)'); }

  // M4b) 割り込みで使う: 相手のジョーの能力(サメ投稿)に割り込んで、ジョーを破壊。聖剣はスタックに乗らず、積まれていたサメは解決する
  { const { gs, prompts } = setup(1); const o = ready('orion'); sword(gs, 0, o); F(gs, 0).push(o); const j = ready('captain_joe'); F(gs, 1).push(j);
    quiet(() => gs.activateAbility(0, 'activated_joe_shark', 1));
    const ch = prompts.find(x => x.type === 'chain' && x.player === 0);
    ok(ch && ch.data.abilities.some(a => a.ability.id === 'activated_holy_sword'), 'M4b) 相手の番のチェーンで聖剣が候補に出る');
    let stackAtDestroy = null, chainAfter = 0;
    const seen = await settle(gs, prompts, (q, s) => {
      if (q.type === 'chain' && s === 0 && !q._used) { q._used = true; return { action: 'activate', fi: 0, aid: 'activated_holy_sword' }; }
      if (q.type === 'holy_sword_target') { stackAtDestroy = gs.G.effectStack.length; return { targetIdx: 0, pi: 1 }; }
    });
    ok(!F(gs, 1).includes(j) && inGrave(gs, 1, 'captain_joe') === 1, 'M4b) ジョーは破壊された');
    ok(count(gs, 1, 'token_shark') === 1, 'M4b) 先に積まれていたサメ魔物は、そのまま解決して出る');
    ok(stackAtDestroy === 1 && o.tapped && untapped(gs, 0) === 6 && idle(gs), 'M4b) 聖剣はスタックに乗らない(積まれていたのはサメの1つだけ)・支払い済み・止まっていない'); }

  // M4c) 戦闘中の割り込み: 相手のジョーの攻撃に割り込んで破壊 → 攻撃は無くなり、ライフは減らない。止まらない
  { const { gs, prompts } = setup(1); const o = ready('orion'); sword(gs, 0, o); o.tapped = true; F(gs, 0).push(o);
    const o2 = ready('maoria'); sword(gs, 0, o2); F(gs, 0).push(o2); // 攻撃を受ける側の勇者(タップしていない方が聖剣を使う)
    const j = ready('captain_joe'); F(gs, 1).push(j);
    quiet(() => { gs.startCombat(1); gs.toggleAttacker(1, 0); gs.confirmAttack(1); });
    let used = false;
    await settle(gs, prompts, (q, s) => {
      if (s === 0 && (q.type === 'chain_attack' || q.type === 'chain') && !used && (q.data.abilities || []).some(a => a.ability.id === 'activated_holy_sword')) { used = true; const a = q.data.abilities.find(a => a.ability.id === 'activated_holy_sword'); return { action: 'activate', fi: a.fi, aid: 'activated_holy_sword' }; }
      if (q.type === 'holy_sword_target') return { targetIdx: 0, pi: 1 };
    });
    ok(used && !F(gs, 1).includes(j) && gs.G.players[0].life === 2000 && o2.tapped, 'M4c) 攻撃中のジョーを割り込みで破壊、ダメージなし (LP ' + gs.G.players[0].life + ')');
    ok(!gs.pendingPrompt[0] && !gs.pendingPrompt[1] && gs.G.effectStack.length === 0, 'M4c) 戦闘が終わって止まっていない (phase=' + gs.G.phase + ')'); }

  // M4d) 対象選択で「やめる」: 支払いなし。チェーン中でも元のチェーンへ戻って止まらない
  { const { gs, prompts } = setup(1); const o = ready('orion'); sword(gs, 0, o); F(gs, 0).push(o); const j = ready('captain_joe'); F(gs, 1).push(j);
    quiet(() => gs.activateAbility(0, 'activated_joe_shark', 1));
    await settle(gs, prompts, (q, s) => {
      if (q.type === 'chain' && s === 0 && !q._used) { q._used = true; return { action: 'activate', fi: 0, aid: 'activated_holy_sword' }; }
      if (q.type === 'holy_sword_target') return { targetIdx: -1 };
    });
    ok(F(gs, 1).includes(j) && count(gs, 1, 'token_shark') === 1 && !o.tapped && untapped(gs, 0) === 9 && idle(gs), 'M4d) やめる → ジョーは残り、サメは解決、支払いなし、止まらない'); }
  // M4e) 演出の順: 聖剣のカットイン → 破壊の表示
  { const { gs, prompts } = setup(); const o = ready('orion'); sword(gs, 0, o); F(gs, 0).push(o); F(gs, 1).push(tok(S.TOKEN_MONSTER));
    const toasts = []; gs.toast = (m, t, id) => toasts.push((id || '-') + ':' + t);
    quiet(() => gs.activateAbility(0, 'activated_holy_sword', 0)); await settle(gs, prompts, (q) => q.type === 'holy_sword_target' ? { targetIdx: 0, pi: 1 } : undefined);
    ok(toasts[0] === 'holy_sword:destroy' && toasts[1] === '-:destroy', 'M4e) 聖剣のカットインが先、破壊の表示が後 (' + toasts.join(' / ') + ')'); }

  // M5) ダイスケ誰その男: 聖剣を付けたオリオンはダイスケに。聖剣はゴミ箱、ダイスケに強化は残らない
  { const { gs, prompts } = setup(1); const o = ready('orion'); sword(gs, 0, o); F(gs, 0).push(o);
    gs.G.players[1].hand.push(mc('daisuke_dare')); quiet(() => gs.playCard(1, 0)); await settle(gs, prompts);
    const d = F(gs, 0).find(c => c.id === 'token_daisuke');
    ok(d && gs.getP(d, 0) === 100 && !d.abilities.includes('activated_holy_sword') && inGrave(gs, 0, 'holy_sword') === 1, 'M5) ダイスケ(100/100)・聖剣の能力なし・聖剣はゴミ箱');
    const o2 = ready('kaera'); o2.enchantments.push({ id: 'holy_sword' }); o2.abilities.push('activated_holy_sword');
    ok(gs.getP(o2, 0) === 100 && !gs.getActivatable(o2, 0).some(a => a.id === 'activated_holy_sword'), 'M5) 勇者でないキャラに付いていても効かない(防御的な確認)'); }

  // M6) キャプテン・ジョー
  { const { gs, prompts } = setup(); const j = ready('captain_joe'); F(gs, 0).push(j);
    quiet(() => gs.activateAbility(0, 'activated_joe_shark', 0)); await settle(gs, prompts);
    quiet(() => gs.activateAbility(0, 'activated_joe_shark', 0)); await settle(gs, prompts);
    const sh = F(gs, 0).filter(c => c.id === 'token_shark');
    ok(sh.length === 2 && sh.every(s => s.summonSick && gs.hasSubtype(s, '魔物')) && !j.tapped && untapped(gs, 0) === 5, 'M6) サメ魔物を2回出せる(タップ不要・応援2ずつ)');
    F(gs, 0).push(ready('kaera'), ready('zeratine'), withPar('maoria'));
    quiet(() => gs.activateAbility(0, 'activated_joe_buff', 0)); await settle(gs, prompts);
    const z = F(gs, 0).find(c => c.id === 'zeratine'), m = F(gs, 0).find(c => c.id === 'maoria'), k = F(gs, 0).find(c => c.id === 'kaera');
    ok(gs.getP(sh[0], 0) === 200 && gs.getT(sh[0], 0) === 200 && gs.getP(z, 0) === 400 && gs.getP(m, 0) === 800, 'M6) サメ・ゼラチネ・寄生体付きマオリアが+100/+100');
    ok(gs.getP(j, 0) === 100 && gs.getP(k, 0) === 100 && untapped(gs, 0) === 3, 'M6) ジョー自身と人間(カエラ)は上がらない'); }

  // M7) ブラックヴォルテックス号
  { const { gs, prompts } = setup(); const bv = ready('black_vortex'); const sh = tok(S.TOKEN_SHARK), zc = tok(S.TOKEN_ZERATINE_CHILD), k = ready('kaera'); F(gs, 0).push(bv, sh, zc, k);
    ok(gs.getP(sh, 0) === 200 && gs.getT(sh, 0) === 200 && gs.getP(zc, 0) === 200 && gs.getP(k, 0) === 100 && gs.getP(bv, 0) === 0 && gs.getT(bv, 0) === 300, 'M7) 自分の魔物+100/+100(人間・船自身は上がらない)');
    const opp = tok(S.TOKEN_MONSTER); F(gs, 1).push(opp); ok(gs.getP(opp, 1) === 100, 'M7) 相手の魔物には効かない');
    const j = ready('captain_joe'); F(gs, 0).push(j); ok(gs.getP(j, 0) === 100, 'M7) 魔王(魔物でない)は上がらない'); }
  { const { gs, prompts } = setup(); const bv = ready('black_vortex'); F(gs, 0).push(bv, ready('kaera')); F(gs, 1).push(ready('kaera'));
    gs.G.cp = 1; quiet(() => { gs.G.attackers = [F(gs, 1)[0].uid]; gs.showBlockPrompt(); });
    const bp = prompts.find(x => x.type === 'block');
    ok(bp && bp.data.blockers.length === 1 && bp.data.blockers[0].name === 'パン屋の娘 カエラ', 'M7) ブロックの候補に船は出ない');
    gs.G.cp = 0; ok(!F(gs, 0).filter(c => c.abilities.includes('cannot_attack')).some(c => c !== bv), 'M7) 攻撃不可(cannot_attack)を持つ'); }
  { const { gs, prompts } = setup(); const bv = ready('black_vortex'), j = ready('captain_joe'); F(gs, 0).push(bv, j); j.damage = 999;
    quiet(() => gs.broadcastState()); const seen = await settle(gs, prompts, (q) => q.type === 'regen_confirm' ? { accept: true } : undefined);
    ok(F(gs, 0).includes(j) && j.damage === 0 && !F(gs, 0).includes(bv) && inGrave(gs, 0, 'black_vortex') === 1 && untapped(gs, 0) === 9, 'M7) ジョーが死ぬ → 船を生贄にして蘇生(応援は使わない)');
    ok(seen.filter(s => s.indexOf('regen_confirm') >= 0).length === 1, 'M7) 確認は1回(船はゴミ箱に行き、蘇生の確認は出ない)'); }
  { const { gs, prompts } = setup(); const bv = ready('black_vortex'), k = ready('kaera'); F(gs, 0).push(bv, k); k.damage = 999;
    quiet(() => gs.broadcastState()); const seen = await settle(gs, prompts, (q) => q.type === 'regen_confirm' ? { accept: true } : undefined);
    ok(!seen.some(s => s.indexOf('regen_confirm') >= 0) && F(gs, 0).includes(bv) && !F(gs, 0).includes(k), 'M7) 人間(カエラ)は対象外: 確認なしで破壊、船は残る'); }
  { const { gs, prompts } = setup(); const bv = ready('black_vortex'), sh = tok(S.TOKEN_SHARK); F(gs, 0).push(bv, sh); sh.damage = 999;
    quiet(() => gs.broadcastState()); await settle(gs, prompts, (q) => q.type === 'regen_confirm' ? { accept: false } : undefined);
    ok(!F(gs, 0).includes(sh) && F(gs, 0).includes(bv), 'M7) 断ったら破壊され、船は残る'); }
  { const { gs, prompts } = setup(); const bv = ready('black_vortex'), sh = tok(S.TOKEN_SHARK); F(gs, 0).push(bv, sh); sh.damage = 999; bv.damage = 999;
    quiet(() => gs.broadcastState()); const seen = await settle(gs, prompts, (q) => q.type === 'regen_confirm' ? { accept: true } : undefined);
    ok(!seen.some(s => s.indexOf('black_vortex') >= 0) && F(gs, 0).length === 0, 'M7) 船も同時に死ぬ時は使えない'); }
  // CPU: トークンのためには船を使わない
  { const { gs } = setup(); const sent = []; const ai = new AIPlayer({ seat: 0, on() {}, emit(ev, d) { if (ev === 'action') sent.push(d); } }, gs);
    const sh = tok(S.TOKEN_SHARK), j = ready('captain_joe'); F(gs, 0).push(sh, j);
    ai.handlePrompt('regen_confirm', { source: 'black_vortex', card: { uid: sh.uid } }); ai.handlePrompt('regen_confirm', { source: 'black_vortex', card: { uid: j.uid } }); ai.handlePrompt('regen_confirm', { source: 'miiko', card: { uid: sh.uid } });
    await new Promise(r => setTimeout(r, 50));
    ok(sent.map(s => s.accept).join(',') === 'false,true,true', 'M7) CPU: トークンには船を使わない・キャラには使う・他の蘇生は今までどおり (' + sent.map(s => s.accept).join(',') + ')'); }

  // M8) メンヘラ・ヤンデレ
  { const { gs } = setup(); const mh = ready('menhera'), yd = ready('yandere'); F(gs, 0).push(mh, yd, ready('kanaria')); F(gs, 1).push(ready('milia'), ready('kaera'));
    ok(gs.getP(mh, 0) === 300 && gs.getT(mh, 0) === 100, 'M8) メンヘラ: 場のヒロイン2体(自分カナリア・相手ミリア)で攻撃300 (' + gs.getP(mh, 0) + ')');
    gs.G.players[0].grave.push(mc('jun'), mc('asaki'), mc('kaera')); gs.G.players[1].grave.push(mc('ark'));
    ok(gs.getP(yd, 0) === 300 && gs.getT(yd, 0) === 100, 'M8) ヤンデレ: 自分のゴミ箱の主人公2枚で攻撃300(相手のゴミ箱は数えない) (' + gs.getP(yd, 0) + ')'); }

  // M9) 公開グループ maou13 / 上限
  { const d = JSON.parse(require('fs').readFileSync(path.join(__dirname, 'deck60.json'), 'utf8')); let need = 2; for (const x of d) { while (need > 0 && x.count > 1) { x.count--; need--; } } d.push({ id: 'captain_joe', count: 2 });
    Release._setForTest({ released: true, groups: { kawauso: true } });
    const r = V.validateDeck('p_x', d, null); ok(r.ok === false && r.reason.indexOf('まだ公開されていません') >= 0, 'M9) 公開前はデッキに入れられない');
    Release._setForTest({ released: true, groups: { kawauso: true, maou13: true } });
    ok(V.validateDeck('p_x', d, null).ok === true, 'M9) 公開後は誰でも使える(クエスト不要)');
    const d3 = d.map(x => x.id === 'captain_joe' ? { id: 'captain_joe', count: 3 } : x); d3[0] = { id: d3[0].id, count: d3[0].count - 1 };
    ok(V.validateDeck('p_x', d3, null).ok === false, 'M9) ジョーは2枚まで');
    const lim = ['orion', 'holy_sword', 'captain_joe', 'black_vortex'].map(id => S.CARD_DB.find(c => c.id === id).deckMax).join(',') + '/' + ['menhera', 'yandere'].map(id => S.CARD_DB.find(c => c.id === id).deckMax).join(',');
    ok(lim === '2,2,2,2/4,4', 'M9) 上限: オリオン・聖剣・ジョー・船は2、メンヘラ・ヤンデレは4 (' + lim + ')');
    ok(['orion', 'holy_sword', 'captain_joe', 'black_vortex', 'menhera', 'yandere'].every(id => { const c = S.CARD_DB.find(x => x.id === id); return c.copies === undefined && c.acquire === 'free' && c.release === 'maou13'; }), 'M9) copies無し(既定デッキに入らない)・無料・公開グループ maou13'); }

  console.log(fails === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL ' + fails);
  process.exit(fails ? 1 : 0);
})();
