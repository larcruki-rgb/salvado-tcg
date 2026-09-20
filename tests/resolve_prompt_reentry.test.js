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
// (B) 動画復元: 同名制限で弾かれても解決が止まらない(他に候補があれば再提示→選ばない→完了)
{
  const gs = new GameState('t'); gs.log = () => {}; gs.toast = () => {};
  const P = gs.G.players[0];
  P.field.push(mc('jun')); P.grave.push(mc('jun'), mc('mamachari')); // jun=同名制限, mamachari=出せる
  gs._resolveQueue = [];
  gs.pendingPrompt[0] = { type: 'douga_fukugen_pick', data: { cards: [{ name: 'ジュン', cost: 2, idx: 0 }, { name: 'ママチャリ暴走族', cost: 2, idx: 1 }] } };
  gs.handlePromptResponse(0, { idx: 0 });
  const rep = gs.pendingPrompt[0] && gs.pendingPrompt[0].type === 'douga_fukugen_pick';
  if (!rep) bad('同名制限で弾いた後に選び直しプロンプトが出ない(停止)');
  gs.handlePromptResponse(0, { idx: -1 });
  if (gs._resolveQueue !== null) bad('選ばない→解決が完了しない');
  console.log('[B] 動画復元の弾き→再提示→完了:', rep && gs._resolveQueue === null ? 'OK' : 'NG');
}
// (C) 出せる候補が無い時は再提示せず解決を再開する(CPUが違反カードを選び続ける無限ループ防止)
{
  const gs = new GameState('t'); gs.log = () => {}; gs.toast = () => {};
  const P = gs.G.players[0];
  P.field.push(mc('jun')); P.grave.push(mc('jun')); // 唯一の候補が同名制限
  gs._resolveQueue = [];
  gs.pendingPrompt[0] = { type: 'douga_fukugen_pick', data: { cards: [{ name: 'ジュン', cost: 2, idx: 0 }] } };
  gs.handlePromptResponse(0, { idx: 0 });
  const stalled = !!gs.pendingPrompt[0], done = gs._resolveQueue === null;
  if (stalled || !done) bad('候補なしなのに再提示された/解決が完了しない(無限ループの芽)');
  console.log('[C] 候補なし→再提示せず完了:', (!stalled && done) ? 'OK' : 'NG');
}
// (D) 候補が他にある時は、その候補だけで再提示される
{
  const gs = new GameState('t'); gs.log = () => {}; gs.toast = () => {};
  const P = gs.G.players[0];
  P.field.push(mc('jun')); P.grave.push(mc('jun'), mc('mamachari'));
  gs._resolveQueue = [];
  gs.pendingPrompt[0] = { type: 'douga_fukugen_pick', data: { cards: [{ name: 'ジュン', cost: 2, idx: 0 }, { name: 'ママチャリ暴走族', cost: 2, idx: 1 }] } };
  gs.handlePromptResponse(0, { idx: 0 });
  const pp = gs.pendingPrompt[0];
  const okD = pp && pp.type === 'douga_fukugen_pick' && pp.data.cards.length === 1 && pp.data.cards[0].idx === 1;
  if (!okD) bad('再提示の候補が絞られていない');
  console.log('[D] 違反カード除外で再提示:', okD ? 'OK' : 'NG');
}
// (E) 青春詭弁の無料投稿でも登場時能力が通常投稿と同じに発動する(ジュン→死神少女サーチ)
{
  const gs = new GameState('t'); gs.log = () => {}; gs.toast = () => {};
  const P = gs.G.players[0];
  const jun = mc('jun'); P.hand.push(jun); P.deck.push(mc('shinigami'), mc('kaera'));
  gs._resolveQueue = [];
  gs.pendingPrompt[0] = { type: 'seishun_kiben_target', data: { targets: [{ name: 'ジュン', idx: 0 }] } };
  gs.handlePromptResponse(0, { idx: 0 });
  const onField = P.field.some(c => c.id === 'jun'), searched = P.hand.some(c => c.id === 'shinigami');
  if (!onField || !searched) bad('青春詭弁経由の投稿で登場時能力(死神少女サーチ)が発動しない');
  console.log('[E] 青春詭弁でも登場時能力が同一:', onField && searched ? 'OK' : 'NG');
}
// (F) 青春詭弁: 同名制限のカードを選んだら、合法な候補だけで選び直し。候補なしなら再開
{
  const gs = new GameState('t'); gs.log = () => {}; gs.toast = () => {};
  const P = gs.G.players[0];
  P.field.push(mc('jun')); P.hand.push(mc('jun'), mc('tomo')); // jun=同名制限, tomo=出せる
  gs._resolveQueue = [];
  gs.pendingPrompt[0] = { type: 'seishun_kiben_target', data: { targets: [] } };
  gs.handlePromptResponse(0, { idx: 0 });
  const pp = gs.pendingPrompt[0];
  const rep = pp && pp.type === 'seishun_kiben_target' && pp.data.targets.length === 1 && pp.data.targets[0].name === '勇者 トモ';
  if (!rep) bad('青春詭弁: 違反カード除外の選び直しが出ない');
  gs.handlePromptResponse(0, { idx: pp.data.targets[0].idx });
  const done = gs._resolveQueue === null && P.field.some(c => c.id === 'tomo');
  if (!done) bad('青春詭弁: 選び直し後に投稿/完了しない');
  console.log('[F] 青春詭弁の違反→合法候補で選び直し→完了:', rep && done ? 'OK' : 'NG');
}
// (G) 候補生成が解決時の同名制限を反映する
{
  const gs = new GameState('t'); gs.log = () => {};
  const P = gs.G.players[0]; P.field.push(mc('jun')); P.hand.push(mc('jun'), mc('tomo'), mc('kaera'));
  const c = gs._legalHandHeroCandidates(0).map(x => x.name);
  const okG = c.length === 1 && c[0] === '勇者 トモ';
  if (!okG) bad('候補生成が同名制限を反映していない: ' + c.join(','));
  console.log('[G] 候補生成(同名制限込み):', okG ? 'OK' : 'NG');
}
// (H) 宣言時は同名制限で即終了しない(場と手札に同じ主人公: 相手の割り込み後に出せる余地を残す)
{
  const gs = new GameState('t'); gs.log = () => {}; gs.toast = () => {};
  const P = gs.G.players[0]; P.field.push(mc('jun')); P.hand.push(mc('jun'));
  gs.offerChain = () => {}; // チェーン提示を止めてスタック積みだけ観測
  gs._pushSupportEffect(mc('seishun_kiben'), '青春詭弁', 0); // カード効果テーブル経由の正規の入口
  const pushed = gs.G.effectStack.length === 1;
  if (!pushed) bad('宣言時に同名制限で即終了している(効果が積まれない)');
  // 解決時に場のジュンが消えていれば手札のジュンが候補になる
  P.field.length = 0;
  const eff = gs.G.effectStack[0]; gs.G.effectStack = []; eff.resolve();
  const prompted = gs.pendingPrompt[0] && gs.pendingPrompt[0].type === 'seishun_kiben_target' && gs.pendingPrompt[0].data.targets.length === 1;
  if (!prompted) bad('解決時に候補が再計算されていない');
  console.log('[H] 宣言時は絞らず・解決時に再計算:', pushed && prompted ? 'OK' : 'NG');
}
console.log('RESULT:', ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
