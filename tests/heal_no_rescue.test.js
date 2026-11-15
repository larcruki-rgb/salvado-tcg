// HPが尽きた投稿キャラは回復で助からない(2026-11-15 ケーさん決定)
// 例: 自分が komi → 相手が割り込みでレイチェンの500ダメージをミリア(HP300)へ → 後から撃った方が先に解決してミリアは致死
//     → komi が解決しても戻らず、割り込みが終わった時に破壊される。以前は komi でダメージが0に戻って生き残っていた
// 実行: node tests/heal_no_rescue.test.js
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GameState = require(path.join(ROOT, 'server/GameState.js'));
const { CARD_DB, makeCard } = require(path.join(ROOT, 'shared/cards.js'));
const mc = id => makeCard(CARD_DB.find(c => c.id === id));
let fails = 0; const ok = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
const ready = id => { const c = mc(id); c.tapped = false; c.summonSick = false; return c; };
const _log = console.log; const quiet = fn => { console.log = () => {}; try { return fn(); } finally { console.log = _log; } };

function setup() {
  const gs = new GameState('t'); const prompts = []; gs.on('prompt', d => prompts.push(d)); gs.toast = () => {};
  gs.logLines = []; gs.log = m => gs.logLines.push(m);
  gs.on('resolveResults', () => { setImmediate(() => { gs.handleAckResolve(0); gs.handleAckResolve(1); }); });
  for (const P of gs.G.players) { for (let i = 0; i < 9; i++) { const m = mc('kaera'); m.manaTapped = false; P.mana.push(m); } P.deck = []; P.hand = []; P.life = 2000; }
  gs.G.cp = 0; gs.G.phase = 'main'; gs.G.turn = 3;
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
      if (r === undefined) r = (p.type === 'regen_confirm') ? { accept: false } : (p.type === 'block' ? { assignments: {} } : { action: 'pass' });
      gs.handlePromptResponse(s, r);
    }
  } finally { console.log = _log; }
  return seen;
}
const F = (gs, pi) => gs.G.players[pi].field;
const has = (gs, pi, id) => F(gs, pi).some(c => c.id === id);
const idle = gs => !gs.pendingPrompt[0] && !gs.pendingPrompt[1] && gs.G.chainDepth === 0 && gs.G.effectStack.length === 0;

(async () => {
  // A) 報告のあった場面: komi に割り込んでレイチェンの500ダメージ → ミリアは助からない。LPの300回復はそのまま入る
  { const { gs, prompts } = setup();
    F(gs, 0).push(ready('milia')); gs.G.players[0].hand.push(mc('komi')); F(gs, 1).push(ready('reichen'));
    quiet(() => gs.playCard(0, 0)); let used = false;
    const seen = await settle(gs, prompts, (p, s) => {
      if (p.type === 'chain' && s === 1 && !used) { const a = p.data.abilities.find(x => x.ability.id === 'activated_reichen_dmg'); if (a) { used = true; return { action: 'activate', fi: a.fi, aid: a.ability.id }; } }
      if (p.type === 'target_damage') return { targetIdx: 0 };
    });
    ok(used && !has(gs, 0, 'milia') && gs.G.players[0].life === 2300 && idle(gs), 'A) komi に割り込みで500ダメージ → ミリアは破壊される。LPは+300 (割り込み=' + used + ' ミリア生存=' + has(gs, 0, 'milia') + ' LP=' + gs.G.players[0].life + ' ' + seen.join(' ') + ')'); }

  // B) 回帰: 致死でないダメージは、今まで通り komi で全部戻る
  { const { gs, prompts } = setup();
    const m = ready('ark'); m.damage = 200; F(gs, 0).push(m); gs.G.players[0].hand.push(mc('komi'));
    quiet(() => gs.playCard(0, 0)); await settle(gs, prompts);
    const a = F(gs, 0).find(c => c.id === 'ark');
    ok(!!a && (a.damage || 0) === 0 && gs.G.players[0].life === 2300, 'B) 致死でないダメージは komi で0に戻る(回帰)'); }

  // C) komi は、同じ場のHPが尽きたキャラだけ飛ばして、他は回復する
  { const { gs, prompts } = setup();
    const dead = ready('mamachari'); dead.damage = 99999; const hurt = ready('ark'); hurt.damage = 100;
    F(gs, 0).push(dead, hurt); gs.G.players[0].hand.push(mc('komi'));
    quiet(() => gs.playCard(0, 0)); await settle(gs, prompts);
    const a = F(gs, 0).find(c => c.id === 'ark');
    ok(!has(gs, 0, 'mamachari') && !!a && (a.damage || 0) === 0, 'C) HPが尽きた方は破壊、傷ついただけの方は回復'); }

  // D) レイチェンの全回復も同じ: HPが尽きたキャラは戻らない
  { const { gs, prompts } = setup();
    const dead = ready('mamachari'); dead.damage = 99999; F(gs, 0).push(ready('reichen'), dead);
    quiet(() => gs.activateAbility(0, 'activated_reichen_heal', 0));
    await settle(gs, prompts, (p) => { if (p.type === 'reichen_heal_target') return { targetIdx: 1 }; });
    ok(!has(gs, 0, 'mamachari') && idle(gs), 'D) レイチェンの全回復でも、HPが尽きたキャラは助からない'); }

  console.log('RESULT ' + (fails ? 'FAIL ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
