// 相手のターン中に playCard / activateAbility を送っても通らないこと(9/26 問い合わせ: 相手ターン中にイズナが出た)
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GameState = require(path.join(ROOT, 'server/GameState.js'));
const { CARD_DB, makeCard } = require(path.join(ROOT, 'shared/cards.js'));
const mc = id => makeCard(CARD_DB.find(c => c.id === id));
let fails = 0; const ok = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };

function setup() {
  const gs = new GameState('t'); const prompts = []; gs.on('prompt', d => prompts.push(d)); gs.log = () => {};
  const P0 = gs.G.players[0], P1 = gs.G.players[1];
  for (const P of [P0, P1]) { for (let i = 0; i < 5; i++) { const m = mc('kaera'); m.manaTapped = false; P.mana.push(m); } P.deck = []; for (let i = 0; i < 5; i++) P.deck.push(mc('mamachari')); }
  P1.hand.push(mc('izuna')); P0.hand.push(mc('sagi'));
  gs.G.cp = 0; gs.G.phase = 'main'; gs.G.turn = 2;
  return { gs, P0, P1, prompts };
}
// A) 相手(P1)は P0 のターン中にクリーチャーを出せない
{ const { gs, P1 } = setup(); const before = P1.field.length, handBefore = P1.hand.length;
  gs.playCard(1, 0);
  ok(P1.field.length === before && P1.hand.length === handBefore, 'A) 相手ターン中の playCard は無視される(場も手札も変わらない)'); }
// B) 手番の人(P0)は普通に出せる(回帰)
{ const { gs, P0 } = setup(); const before = P0.field.length;
  gs.playCard(0, 0);
  ok(P0.field.length === before + 1 || P0.hand.length === 0, 'B) 手番の人の playCard は通る'); }
// C) 相手(P1)は通常時に能力を起動できない(チェーン中の応答は別経路)
{ const { gs, P1, prompts } = setup(); const iz = mc('izuna'); iz.tapped = false; P1.field.push(iz);
  gs.activateAbility(0, 'activated_izuna', 1);
  ok(prompts.length === 0, 'C) 相手ターン中の activateAbility は無視される(プロンプトが出ない)'); }
// D) 手番の人(P0)は能力を起動できる(回帰)
{ const { gs, P0, prompts } = setup(); const iz = mc('izuna'); iz.tapped = false; P0.field.push(iz); gs.G.players[1].field.push(mc('mamachari'));
  gs.activateAbility(0, 'activated_izuna', 0);
  ok(prompts.some(p => p.type === 'target_damage'), 'D) 手番の人の activateAbility は通る'); }
// E) 解決確認待ち(ack)の間はターン終了も追加投稿も通らない
{ const { gs, P0 } = setup(); gs._awaitingAck = true; const cp = gs.G.cp, hand = P0.hand.length;
  gs.endTurn(0); gs.playCard(0, 0);
  ok(gs.G.cp === cp && P0.hand.length === hand, 'E) 確認待ち中の endTurn/playCard はその場では実行されない');
  gs._awaitingAck = false; gs._flushDeferredEndTurn();
  ok(gs.G.cp !== cp, 'E) 保留したターン終了は解決後に自動で実行される'); }
// F) 存在しない能力IDでは起動できない(カエラに activated_asaki を指定 等)
{ const { gs, P0, prompts } = setup(); const k = mc('kaera'); k.tapped = false; P0.field.push(k); gs.G.players[1].hand.push(mc('mamachari'));
  gs.activateAbility(0, 'activated_asaki', 0);
  ok(prompts.length === 0, 'F) そのクリーチャーが持たない能力は起動できない'); }
// G) 代替コストの選択は質問の持ち主だけ、かつクリエイター2枚だけ
{ const { gs, P0, P1 } = setup(); const mk = mc('makkinii'); P0.hand.push(mk); const c1 = mc('seishun_kiben'), c2 = mc('kikaku_botsu'); P0.hand.push(c1, c2); P0.mana.forEach(m => m.manaTapped = true);
  gs.startCreatorDiscard(mk, P0.hand.indexOf(mk), 0); const before = P0.hand.length;
  gs.handleCreatorDiscard(1, [0, 1]); ok(P0.hand.length === before, 'G) 相手は代替コストの選択を横取りできない');
  const sagiIdx = P0.hand.findIndex(c => c.id === 'sagi'); gs.handleCreatorDiscard(0, [sagiIdx, P0.hand.indexOf(c1)]); ok(P0.hand.length === before, 'G) クリエイター以外を含む選択は無視される'); }
// H) ブロック選択待ち中に confirmAttack を再送しても攻撃時強化が重複しない
{ const { gs, P0, P1 } = setup(); const ky = mc('kyamakiri'); ky.tapped = false; ky.summonSick = false; P0.field.push(ky); P1.field.push(mc('mamachari'));
  gs.startCombat(0); gs.toggleAttacker(0, 0); gs.confirmAttack(0); const buff = ky.tempBuff.power;
  gs.confirmAttack(0); gs.confirmAttack(0);
  ok(ky.tempBuff.power === buff && buff === 200, 'H) confirmAttack 再送で強化が重複しない(+200のまま)'); }
// I) チェーン応答で不正な能力IDを送っても止まらない(パス扱いで解決が進む)
{ const { gs, P0, P1 } = setup(); const iz = mc('izuna'); iz.tapped = false; P1.field.push(iz);
  gs.playCard(0, 0); // P0 がサギを投稿宣言 → P1 にチェーン確認
  const pend = gs.pendingPrompt[1]; ok(!!pend && pend.type === 'chain', 'I) 相手にチェーン確認が出る');
  gs.handlePromptResponse(1, { action: 'activate', fi: 0, aid: 'activated_asaki' }); // 持っていない能力
  ok(gs.G.chainDepth === 0 && !gs.pendingPrompt[1], 'I) 不正な能力IDはパス扱いになり、チェーンが解消される(depth=' + gs.G.chainDepth + ')'); }
// J) 戦闘演出中に保留したターン終了は、演出完了後の状態配信で実行される
{ const { gs } = setup(); const cp = gs.G.cp; gs._combatQueue = [{}];
  gs.endTurn(0); ok(gs.G.cp === cp, 'J) 戦闘キュー中の endTurn は保留される');
  gs._combatQueue = null; gs.broadcastState();
  ok(gs.G.cp !== cp, 'J) 戦闘キュー完了後の状態配信で保留分が実行される'); }
console.log(fails ? 'TURN GUARD: FAIL(' + fails + ')' : 'TURN GUARD: PASS'); process.exit(fails ? 1 : 0);
