// 確認(ack)を一切送らないクライアントでも対戦が進むか(安全網)。ローカルサーバーを ACK_TIMEOUT_MS=2000 で起動して実行
const { io } = require(process.env.SIO_CLIENT || 'socket.io-client'); const B = 'http://localhost:' + (process.env.PORT || 3200);
const deck = JSON.parse(require('fs').readFileSync(__dirname + '/deck60.json', 'utf8'));
(async () => { const s = io(B, { transports: ['websocket'] }); let seq = [], myTurns = 0, results = 0, t0 = Date.now();
  s.on('turnScreen', ({ turn, isYourTurn }) => { seq.push('T' + turn + (isYourTurn ? '自分' : 'CPU')); if (isYourTurn) { myTurns++; setTimeout(() => s.emit('action', { type: 'startTurn' }), 300); setTimeout(() => s.emit('action', { type: 'placeMana', data: { idx: 0 } }), 800); setTimeout(() => s.emit('action', { type: 'endTurn' }), 1500); } });
  const LATE = +process.env.LATE_ACK_MS || 0; // 0=ackを送らない / N=Nms 遅れて送る(安全網の後に届く遅延ack)
  s.on('resolveResults', () => { results++; if (LATE) setTimeout(() => s.emit('action', { type: 'ackResolve' }), LATE); });
  s.on('prompt', p => { const d = (p.type === 'chain' || p.type === 'chainAttack') ? { action: 'pass' } : (p.type === 'block' ? { assignments: {} } : { cancel: true, skip: true, action: 'pass' }); setTimeout(() => s.emit('action', { type: 'promptResponse', data: d }), 200); });
  await new Promise(r => s.on('connect', r)); s.emit('aiMatch', { name: 'noack', deck, playerId: 'p_noack' });
  await new Promise(r => setTimeout(r, 45000));
  console.log('ターン推移:', seq.join(' → '), '| 演出', results, '回(ack未送信)');
  const ok = myTurns >= 3 && results >= 1; console.log(ok ? 'ACK TIMEOUT: PASS (ackを送らなくても安全網で進む)' : 'ACK TIMEOUT: FAIL'); s.disconnect(); process.exit(ok ? 0 : 1); })();
