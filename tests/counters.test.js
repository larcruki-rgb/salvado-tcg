// カウンター(カードに載る永続強化)。場にいる間だけ残り、場を離れたら消える。
// あわせて、トークンに付いたエンチャントが破壊時に墓地へ行くこと(以前は消えていた)。
// 実行: node tests/counters.test.js
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GameState = require(path.join(ROOT, 'server/GameState.js'));
const { CARD_DB, TOKEN_JK, makeCard } = require(path.join(ROOT, 'shared/cards.js'));
const mc = id => makeCard(CARD_DB.find(c => c.id === id));
let fails = 0; const ok = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
const _log = console.log; const quiet = fn => { console.log = () => {}; try { return fn(); } finally { console.log = _log; } };
function setup() {
  const gs = new GameState('t'); gs.log = () => {}; gs.toast = () => {};
  for (const P of gs.G.players) { for (let i = 0; i < 9; i++) { const m = mc('kaera'); m.manaTapped = false; P.mana.push(m); } P.deck = []; P.hand = []; P.life = 2000; }
  gs.G.cp = 0; gs.G.phase = 'main'; gs.G.turn = 3;
  return gs;
}
const addCounter = c => c.counters.push({ power: 300, toughness: 200, source: 'test' });

// K1) 初期値と実効値
{ const gs = setup(); const a = mc('mamachari'), b = mc('mamachari'); // 200/100
  ok(Array.isArray(a.counters) && a.counters.length === 0 && a.counters !== b.counters, 'K1) makeCard の counters は空で、カードごとに独立した配列');
  gs.G.players[0].field.push(a); addCounter(a);
  ok(gs.getP(a, 0) === 500 && gs.getT(a, 0) === 300, 'K1) getP/getT にカウンターが加算される (' + gs.getP(a, 0) + '/' + gs.getT(a, 0) + ')');
  const st = gs.getStateForPlayer(0).me.field[0];
  ok(st.effP === 500 && st.effT === 300 && st.counters.length === 1, 'K1) 状態送信に実効値とカウンターが含まれる'); }

// K2) ターン開始では残る / 一時強化は消える
{ const gs = setup(); const a = mc('mamachari'); gs.G.players[0].field.push(a); addCounter(a); a.tempBuff.power = 300;
  gs.untapAll();
  ok(a.counters.length === 1 && a.tempBuff.power === 0 && gs.getP(a, 0) === 500, 'K2) ターン開始: 一時強化は消え、カウンターは残る (' + gs.getP(a, 0) + ')'); }

// K3) 通常破壊で消える。出し直すと素の値
{ const gs = setup(); const a = mc('mamachari'); gs.G.players[0].field.push(a); addCounter(a);
  quiet(() => gs._executeDestroy(a, 0));
  ok(gs.G.players[0].grave.includes(a) && a.counters.length === 0, 'K3) 破壊: 墓地へ行き、カウンターは消える');
  gs.G.players[0].grave.splice(gs.G.players[0].grave.indexOf(a), 1);
  quiet(() => gs._enterField(a, 0, 'test'));
  ok(gs.getP(a, 0) === 200 && gs.getT(a, 0) === 100, 'K3) 出し直すと素の 200/100'); }

// K4) 手札戻し(水素水)で消える
{ const gs = setup(); const h = mc('milia'); gs.G.players[0].field.push(h); addCounter(h);
  const s = mc('suisosui');
  quiet(() => gs._enterField(s, 1, 'test'));
  ok(gs.G.players[0].hand.includes(h) && h.counters.length === 0, 'K4) 手札戻し: カウンターは消える'); }

// K5) その場の蘇生(ミーコ)では残る
{ const gs = setup(); const prompts = []; gs.on('prompt', d => prompts.push(d));
  const a = mc('mamachari'), mi = mc('miiko'); gs.G.players[0].field.push(a, mi); addCounter(a); // 500/300
  a.damage = 300;
  quiet(() => gs.broadcastState());
  ok(gs.pendingPrompt[0] && gs.pendingPrompt[0].type === 'regen_confirm', 'K5) 致死ダメージで蘇生確認が出る');
  quiet(() => gs.handlePromptResponse(0, { accept: true }));
  ok(gs.G.players[0].field.includes(a) && a.damage === 0 && a.counters.length === 1 && gs.getT(a, 0) === 300, 'K5) 蘇生後も場に残り、カウンターも残る'); }

// K6) トークンに付いたエンチャントは破壊時に墓地へ行く
{ const gs = setup(); const tk = makeCard(TOKEN_JK); const en = mc('healthy_sleep');
  tk.enchantments.push({ id: en.id, src: en }); gs.G.players[0].field.push(tk);
  quiet(() => gs._executeDestroy(tk, 0));
  ok(!gs.G.players[0].field.includes(tk) && !gs.G.players[0].grave.includes(tk), 'K6) トークン本体は墓地へ行かず消える');
  ok(gs.G.players[0].grave.some(g => g.id === 'healthy_sleep'), 'K6) 付いていたエンチャントは墓地へ行く'); }

// K7) 通常カードのエンチャントは従来どおり墓地へ(退行なし)
{ const gs = setup(); const a = mc('mamachari'); const en = mc('rena');
  a.enchantments.push({ id: en.id, src: en }); gs.G.players[0].field.push(a);
  quiet(() => gs._executeDestroy(a, 0));
  const g = gs.G.players[0].grave;
  ok(g.includes(a) && g.filter(x => x.id === 'rena').length === 1 && a.enchantments.length === 0, 'K7) 通常カード: 本体とエンチャントが1枚ずつ墓地へ'); }

// K8) ボスラッシュの持ち越し(JSONコピー)でカウンターが残る
{ const gs = setup(); const a = mc('mamachari'); addCounter(a);
  const copy = JSON.parse(JSON.stringify(a));
  gs.G.players[0].field.push(copy);
  ok(copy.counters.length === 1 && gs.getP(copy, 0) === 500, 'K8) JSONコピーした場のカードにカウンターが残る'); }

console.log(fails === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL (' + fails + ')');
process.exit(fails === 0 ? 0 : 1);
