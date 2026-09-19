// 解決中に出たプロンプトの二重進行/停止の回帰テスト
const path = require('path');
const GameState = require(path.join(__dirname, '..', 'server/GameState.js'));
const { CARD_DB, makeCard } = require(path.join(__dirname, '..', 'shared/cards.js'));
const mc = id => makeCard(CARD_DB.find(c => c.id === id));
let ok = true; const bad = m => { console.log('NG:', m); ok = false; };

// (A) プロンプト未回答中は _continueAfterPick が解決を進めない。応答(returnToChain)で再開する
{
  const gs = new GameState('t'); gs.log = () => {}; let emitted = 0;
  gs.on('resolveResults', () => emitted++);
  gs._resolveQueue = [{ _prebuilt: true, result: { type: 'effect', desc: 'x' } }];
  gs.pendingPrompt[0] = { type: 'shuffle_confirm', data: {} };
  gs._continueAfterPick();
  if (emitted !== 0 || gs._resolveQueue.length !== 1) bad('プロンプト未回答なのに解決が進んだ');
  gs.handlePromptResponse(0, { shuffle: false });
  if (emitted !== 1) bad('プロンプト応答後に解決が再開しない');
  console.log('[A] 未回答中は停止・応答で再開:', emitted === 1 ? 'OK' : 'NG');
}
// (B) 動画復元: 同名制限で弾かれた時に解決が止まらず、選び直しプロンプトが再提示される
{
  const gs = new GameState('t'); gs.log = () => {}; gs.toast = () => {};
  const P = gs.G.players[0];
  P.field.push(mc('jun')); P.grave.push(mc('jun')); // copies:1 → 同名制限
  gs._resolveQueue = [];
  gs.pendingPrompt[0] = { type: 'douga_fukugen_pick', data: { cards: [] } };
  gs.handlePromptResponse(0, { idx: 0 });
  const rep = gs.pendingPrompt[0] && gs.pendingPrompt[0].type === 'douga_fukugen_pick';
  if (!rep) bad('同名制限で弾いた後に選び直しプロンプトが出ない(停止)');
  gs.handlePromptResponse(0, { idx: -1 });
  if (gs._resolveQueue !== null) bad('選ばない→解決が完了しない');
  console.log('[B] 動画復元の弾き→再提示→完了:', rep && gs._resolveQueue === null ? 'OK' : 'NG');
}
console.log('RESULT:', ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
