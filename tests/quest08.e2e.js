// 実行: ローカルサーバー起動後に SIO_CLIENT=<socket.io-clientのパス> PORT=<ポート> node tests/quest08.e2e.js
// クエスト quest_08 を受け身のプレイヤー(視聴者を置いてターン終了するだけ。質問にはパス/最初の選択肢)で回し、CPUの動きを記録する
const { io } = require(process.env.SIO_CLIENT);
const deck = JSON.parse(require('fs').readFileSync(__dirname + '/deck60.json','utf8'));
const B = 'http://localhost:' + process.env.PORT;
// 公開スイッチ: このテストは「公開済み」で動かす。終わったら元に戻す(ローカルサーバーは BOARD_ADMIN_TOKEN=testadmin で起動しておく)
const _relUrl = 'http://localhost:' + (process.env.PORT || 3200) + '/api/app/newcards';
const _setRel = (released) => fetch(_relUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': process.env.ADMIN_TOKEN || 'testadmin' }, body: JSON.stringify({ released }) }).then(r => r.json()).catch(() => null);
let _relBefore = null;
const _exit = process.exit.bind(process);
process.exit = (code) => { (_relBefore === null ? Promise.resolve() : _setRel(_relBefore)).then(() => _exit(code)); };
(async () => {
  _relBefore = await fetch(_relUrl).then(r => r.json()).then(j => !!j.released).catch(() => false); await _setRel(true);
  const s = io(B, { transports: ['websocket'] }); const logs = []; let over = null, reward = null, err = null, turns = 0, maxOpp = 0, first = null;
  s.on('log', m => logs.push(m)); s.on('error', e => err = e); s.on('deckRejected', e => err = e);
  s.on('turnScreen', ({ turn, isYourTurn }) => { turns = turn; if (isYourTurn) { setTimeout(() => s.emit('action', { type: 'startTurn' }), 200); setTimeout(() => s.emit('action', { type: 'placeMana', data: { idx: 0 } }), 600); setTimeout(() => s.emit('action', { type: 'endTurn' }), 1100); } });
  s.on('stateUpdate', st => { if (!first) first = st; if (st.opp && st.opp.field) maxOpp = Math.max(maxOpp, st.opp.field.length); });
  s.on('resolveResults', () => setTimeout(() => s.emit('action', { type: 'ackResolve' }), 150));
  s.on('prompt', p => { const d = (p.type === 'chain' || p.type === 'chain_attack') ? { action: 'pass' } : (p.type === 'block' ? { assignments: {} } : (p.type === 'regen_confirm' ? { accept: false } : { idx: -1, targetIdx: -1 })); setTimeout(() => s.emit('action', { type: 'promptResponse', data: d }), 150); });
  s.on('gameOver', d => over = d); s.on('questReward', d => reward = d);
  await new Promise(r => s.on('connect', r));
  s.emit('questMatch', { name: 'クエスト検証', deck, questId: 'quest_08', playerId: 'p_quest08_e2e' });
  const t0 = Date.now(); while (!over && Date.now() - t0 < 150000) await new Promise(r => setTimeout(r, 500));
  await new Promise(r => setTimeout(r, 2500));
  console.log('初期: 自分LP', first && first.me.life, '視聴者', first && first.me.mana.length, '/ CPU LP', first && first.opp.life, '視聴者', first && first.opp.mana.length, '場', first && first.opp.field.map(c => c.name).join(','), '手札', first && first.opp.handCount);
  const pick = k => logs.filter(l => l.indexOf(k) >= 0);
  console.log('捕食:', pick('捕食').length, '回 例:', pick('捕食').slice(0, 3).join(' | '));
  console.log('分裂:', pick('分裂').length, '回 例:', pick('分裂').slice(0, 3).join(' | '));
  console.log('ダイスケ:', pick('ダイスケ').length, '件 例:', pick('ダイスケ').slice(0, 2).join(' | '));
  console.log('リード:', pick('リード').slice(0, 3).join(' | '));
  console.log('CPUの場の最大', maxOpp, '/ 到達ターン', turns, '/ 所要', Math.round((Date.now() - t0) / 1000) + '秒');
  console.log('結果:', JSON.stringify(over), '報酬通知:', JSON.stringify(reward), 'エラー:', JSON.stringify(err));
  process.exit(0);
})();
