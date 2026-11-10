// かわうそ3枚(2026-10-29): かわうそ(トークンだけ+100・重複しない) / かわうそかわうそ(トークン2体) / かわうそかわいそ(割り込み・全破壊→数×100ダメージ+回復)
// 実行: node tests/kawauso.test.js
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
  // K1) かわうそかわうそ: 100/100 のかわうそトークンが2体出る(召喚酔い)。応援3消費
  { const { gs, prompts } = setup(); gs.G.players[0].hand.push(mc('kawauso_kawauso'));
    quiet(() => gs.playCard(0, 0)); await settle(gs, prompts);
    const tk = F(gs, 0).filter(c => c.id === 'token_kawauso');
    ok(tk.length === 2 && tk.every(t => t.isToken && t.summonSick && gs.getP(t, 0) === 100 && gs.getT(t, 0) === 100), 'K1) かわうそトークン(100/100)が2体、召喚酔いで出る');
    ok(untapped(gs, 0) === 6 && inGrave(gs, 0, 'kawauso_kawauso') === 1 && idle(gs), 'K1) 応援3消費、カードはゴミ箱、止まっていない'); }

  // K2) かわうそ: トークンだけ攻撃+100。本体は100のまま。HPは上がらない。かわうそ2体でも+100のまま(重複しない)
  { const { gs } = setup(); const k1 = ready('kawauso'); F(gs, 0).push(k1);
    const { TOKEN_KAWAUSO } = require(path.join(ROOT, 'shared/cards.js')); const tk = makeCard(TOKEN_KAWAUSO); F(gs, 0).push(tk);
    ok(gs.getP(tk, 0) === 200 && gs.getT(tk, 0) === 100, 'K2) かわうそがいるとトークンは200/100 (実際 ' + gs.getP(tk, 0) + '/' + gs.getT(tk, 0) + ')');
    ok(gs.getP(k1, 0) === 100, 'K2) 本体は100のまま');
    F(gs, 0).push(ready('kawauso'));
    ok(gs.getP(tk, 0) === 200, 'K2) かわうそ2体でもトークンは200(重複しない)');
    const jk = makeCard(require(path.join(ROOT, 'shared/cards.js')).TOKEN_JK); F(gs, 0).push(jk);
    ok(gs.getP(jk, 0) === 100, 'K2) 他のトークン(女子高生)は上がらない');
    F(gs, 0).splice(0, F(gs, 0).length); F(gs, 0).push(tk);
    ok(gs.getP(tk, 0) === 100, 'K2) かわうそが場を離れたらトークンは100に戻る');
    const tk2 = makeCard(TOKEN_KAWAUSO); F(gs, 1).push(tk2); F(gs, 0).push(ready('kawauso'));
    ok(gs.getP(tk2, 1) === 100, 'K2) 相手のかわうそトークンには効かない'); }

  // K3) かわうそかわいそ(自分の手番): 本体1+トークン2 → 全部消える(本体はゴミ箱・トークンは消滅)、相手LP-300、自分LP+300、蘇生確認は出ない
  { const { gs, prompts } = setup(); const { TOKEN_KAWAUSO } = require(path.join(ROOT, 'shared/cards.js'));
    const k = ready('kawauso'); k.enchantments.push({ id: 'parasite' }); // 寄生体付き(蘇生持ち)でも蘇生確認が出ないこと
    F(gs, 0).push(k, makeCard(TOKEN_KAWAUSO), makeCard(TOKEN_KAWAUSO), ready('jk_a'));
    gs.G.players[0].hand.push(mc('kawauso_kawaiso'));
    quiet(() => gs.playCard(0, 0)); const seen = await settle(gs, prompts);
    ok(count(gs, 0, 'kawauso') === 0 && count(gs, 0, 'token_kawauso') === 0 && count(gs, 0, 'jk_a') === 1, 'K3) かわうそ本体+トークン2体だけ消える(女子高生Aは残る)');
    ok(inGrave(gs, 0, 'kawauso') === 1 && inGrave(gs, 0, 'parasite') === 1 && inGrave(gs, 0, 'kawauso_kawaiso') === 1, 'K3) 本体と寄生体とかわいそはゴミ箱へ');
    ok(gs.G.players[1].life === 1700 && gs.G.players[0].life === 2300, 'K3) 相手LP1700・自分LP2300 (実際 ' + gs.G.players[1].life + '/' + gs.G.players[0].life + ')');
    ok(!seen.some(s => s.indexOf('regen_confirm') >= 0) && untapped(gs, 0) === 8 && idle(gs), 'K3) 蘇生確認なし、応援1消費、止まっていない'); }

  // K4) かわうそがいない時: 発動せずカードも応援も減らない
  { const { gs, prompts } = setup(); F(gs, 0).push(ready('jk_a')); gs.G.players[0].hand.push(mc('kawauso_kawaiso'));
    quiet(() => gs.playCard(0, 0)); await settle(gs, prompts);
    ok(gs.G.players[0].hand.length === 1 && untapped(gs, 0) === 9 && gs.G.players[1].life === 2000 && idle(gs), 'K4) かわうそ不在: 手札に残り、応援も減らず、何も起きない'); }

  // K5) 割り込み: 相手の攻撃に対して、ブロック後の割り込みでかわいそを撃てる。トークンがいない時は候補に出ない
  { const { gs, prompts } = setup(1); const { TOKEN_KAWAUSO } = require(path.join(ROOT, 'shared/cards.js'));
    F(gs, 0).push(makeCard(TOKEN_KAWAUSO), makeCard(TOKEN_KAWAUSO), makeCard(TOKEN_KAWAUSO)); gs.G.players[0].hand.push(mc('kawauso_kawaiso'));
    F(gs, 1).push(ready('mamachari'));
    quiet(() => { gs.startCombat(1); gs.toggleAttacker(1, 0); gs.confirmAttack(1); });
    let played = false;
    await settle(gs, prompts, (p, s) => {
      if (p.type === 'block' && s === 0) return { assignments: {} };
      if (p.type === 'chain_attack' && s === 0 && !played) { const o = p.data.supports.find(x => x.id === 'kawauso_kawaiso'); if (o) { played = true; return { action: 'playSupport', idx: o.idx }; } }
    });
    ok(played, 'K5) 相手の攻撃中、割り込みの候補にかわいそが出て撃てる');
    ok(count(gs, 0, 'token_kawauso') === 0 && gs.G.players[1].life === 1700, 'K5) トークン3体消滅、相手LP1700 (実際 ' + gs.G.players[1].life + ')');
    const MP = CARD_DB.find(c => c.id === 'mamachari').power;
    ok(gs.G.players[0].life === 2300 - MP, 'K5) 自分LP: +300 してから ままちゃり(' + MP + ')の攻撃が通って ' + (2300 - MP) + ' (実際 ' + gs.G.players[0].life + ')');
    ok(idle(gs) && gs.G.phase === 'main2', 'K5) 戦闘は最後まで進んで止まっていない'); }

  // K6) 割り込みの候補: かわうそがいない時は chain に出ない(応答権そのものが無ければ素通り)
  { const { gs, prompts } = setup(1); gs.G.players[0].hand.push(mc('kawauso_kawaiso')); F(gs, 1).push(ready('mamachari'));
    quiet(() => { gs.startCombat(1); gs.toggleAttacker(1, 0); gs.confirmAttack(1); });
    let offered = false;
    const seen = await settle(gs, prompts, (p, s) => { if (p.type === 'chain_attack' && s === 0) { offered = p.data.supports.some(x => x.id === 'kawauso_kawaiso'); } });
    const MP = CARD_DB.find(c => c.id === 'mamachari').power;
    ok(!offered && gs.G.players[0].life === 2000 - MP && idle(gs), 'K6) かわうそ不在: 候補に出ない。攻撃はそのまま通る (LP ' + gs.G.players[0].life + ', prompts: ' + seen.join(' ') + ')'); }

  // K7) 相手LPが300以下なら勝つ
  { const { gs, prompts } = setup(); const { TOKEN_KAWAUSO } = require(path.join(ROOT, 'shared/cards.js'));
    F(gs, 0).push(makeCard(TOKEN_KAWAUSO), makeCard(TOKEN_KAWAUSO), makeCard(TOKEN_KAWAUSO)); gs.G.players[1].life = 300;
    gs.G.players[0].hand.push(mc('kawauso_kawaiso'));
    let over = null; gs.on('gameOver', d => over = d);
    quiet(() => gs.playCard(0, 0)); await settle(gs, prompts);
    ok(gs.G.players[1].life <= 0 && (gs._gameOver || over), 'K7) 相手LP300 → 0 で決着 (winner=' + (over && over.winner) + ')'); }

  // K8) 打ち消される: 動画削除で打ち消されたら、かわうそは残り、LPは動かない
  { const { gs, prompts } = setup(); const { TOKEN_KAWAUSO } = require(path.join(ROOT, 'shared/cards.js'));
    F(gs, 0).push(makeCard(TOKEN_KAWAUSO)); gs.G.players[0].hand.push(mc('kawauso_kawaiso')); gs.G.players[1].hand.push(mc('douga_sakujo'));
    quiet(() => gs.playCard(0, 0)); let c = false;
    await settle(gs, prompts, (p, s) => {
      if (p.type === 'chain' && s === 1 && !c) { const o = p.data.supports.find(x => x.id === 'douga_sakujo'); if (o) { c = true; return { action: 'playSupport', idx: o.idx }; } }
      if (p.type === 'counterspell_target') return { idx: p.data.targets[0].idx };
    });
    ok(c && count(gs, 0, 'token_kawauso') === 1 && gs.G.players[1].life === 2000 && gs.G.players[0].life === 2000 && idle(gs), 'K8) 打ち消し: トークンは残り、LPは動かない'); }

  // K9) デッキ上限: かわうそ4・かわうそかわうそ4・かわいそ2。既定デッキ/CPU山札には混ざらない(copies 無し)
  { const ids = ['kawauso', 'kawauso_kawauso', 'kawauso_kawaiso']; const d = ids.map(i => CARD_DB.find(c => c.id === i));
    ok(d[0].deckMax === 4 && d[1].deckMax === 4 && d[2].deckMax === 2, 'K9) deckMax 4/4/2');
    ok(d.every(c => c.copies === undefined && c.acquire === 'quest'), 'K9) copies 無し(既定デッキに混ざらない)・クエスト解除のカード(2026-11 quest_09)'); }

  console.log('RESULT ' + (fails ? 'FAIL ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
