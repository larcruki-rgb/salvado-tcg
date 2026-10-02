// 強制更新の通し確認。ローカルサーバー(BOARD_ADMIN_TOKEN=testadmin)起動後に:
//   SIO_CLIENT=<socket.io-clientのパス> PORT=<ポート> node tests/app_gate.e2e.js
const { io } = require(process.env.SIO_CLIENT || 'socket.io-client');
const B = 'http://localhost:' + (process.env.PORT || 3200); const ADMIN = process.env.ADMIN_TOKEN || 'testadmin';
const deck = JSON.parse(require('fs').readFileSync(__dirname + '/deck60.json', 'utf8'));
let fails = 0; const ok = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
const setMin = v => fetch(B + '/api/app/min-version', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN }, body: JSON.stringify({ minClientV: v }) }).then(r => r.json());
const getMin = () => fetch(B + '/api/app/min-version').then(r => r.json());
// origin と auth を指定して繋ぎ、CPU戦を始めようとした結果を返す
function tryMatch(origin, auth) {
  return new Promise(res => {
    const s = io(B, { transports: ['websocket'], extraHeaders: origin ? { Origin: origin } : {}, auth: auth || {}, forceNew: true });
    let out = { joined: false, error: null, update: null };
    s.on('joined', () => { out.joined = true; }); s.on('error', e => { out.error = e && e.msg; }); s.on('updateRequired', d => { out.update = d; });
    s.on('connect', () => { s.emit('aiMatch', { name: 'gate', deck, playerId: 'p_gate_e2e' }); setTimeout(() => { s.emit('action', { type: 'surrender' }); setTimeout(() => { s.disconnect(); res(out); }, 300); }, 900); });
  });
}
(async () => {
  const before = (await getMin()).minClientV;
  try {
    ok((await fetch(B + '/api/app/min-version', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minClientV: 999 }) })).status === 403, 'E1) 管理用トークンなしでは切り替えられない(403)');
    const r0 = await setMin(0); ok(r0.ok && r0.minClientV === 0, 'E2) 最低版を0(無効)に設定');
    ok((await tryMatch('https://localhost', {})).joined === true, 'E2) 無効の間は、古いアプリも対戦を始められる');
    const r1 = await setMin(123); const g = await getMin();
    ok(r1.ok && g.minClientV === 123 && /play\.google\.com/.test(g.store.android) && /apps\.apple\.com/.test(g.store.ios), 'E3) 最低版を123に設定(再起動なし)。ストアURLも返る');
    const oldA = await tryMatch('https://localhost', {});
    ok(oldA.joined === false && oldA.error && oldA.error.indexOf('更新') >= 0 && oldA.update && oldA.update.minClientV === 123, 'E3) 古いAndroidアプリ: 対戦を始められず、更新の案内が出る (' + oldA.error + ')');
    const oldI = await tryMatch('capacitor://localhost', {});
    ok(oldI.joined === false && !!oldI.error, 'E3) 古いiOSアプリ: 対戦を始められない');
    ok((await tryMatch('https://localhost', { clientV: 123, native: true })).joined === true, 'E3) 新しいアプリ(版123)は始められる');
    ok((await tryMatch('https://game.sarubedo.jp', {})).joined === true && (await tryMatch(null, {})).joined === true, 'E3) ブラウザ版は始められる');
    const r2 = await setMin(0);
    ok(r2.minClientV === 0 && (await tryMatch('https://localhost', {})).joined === true, 'E4) 0に戻すと、すぐに古いアプリも始められる(すぐ戻せる)');
  } finally { await setMin(before); }
  console.log(fails === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL (' + fails + ')'); process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
