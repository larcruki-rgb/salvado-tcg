// 強制更新の画面の確認(手動・Chromeが必要)。ローカルサーバー(BOARD_ADMIN_TOKEN=testadmin)起動後に:
//   WS=<wsモジュールのパス> PORT=<ポート> [PLAT=ios] node tests/app_gate_screen.e2e.js <保存する画像のパス>
// ブラウザをアプリに見立てて(window.Capacitor を用意して) shared/app_gate.js を読み込み、更新画面が出る条件と、接続が切れることを確認する
const WS = require(process.env.WS); const { spawn } = require('child_process'); const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; const PORT = process.env.PORT;
const B = 'http://localhost:' + PORT;
const setMin = v => fetch(B + '/api/app/min-version', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': 'testadmin' }, body: JSON.stringify({ minClientV: v }) }).then(r => r.json());
(async () => {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9336', '--window-size=420,900', '--user-data-dir=/tmp/cdp_prof_' + Date.now(), 'about:blank'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const list = await (await fetch('http://127.0.0.1:9336/json')).json(); const page = list.find(p => p.type === 'page');
  const ws = new WS(page.webSocketDebuggerUrl); await new Promise(r => ws.on('open', r));
  let id = 0; const pend = {}; ws.on('message', m => { const d = JSON.parse(m); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend[i] = res; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.enable'); await send('Runtime.enable');
  const inject = `(function(){ window.__SALVADO_GATE_BASE__=''; window.Capacitor={isNativePlatform:function(){return true;},getPlatform:function(){return '${process.env.PLAT || 'android'}';}}; var s=document.createElement('script'); s.src='/shared/app_gate.js?t='+Date.now(); document.head.appendChild(s); return 1; })()`;
  try {
    // A) 最低版が同梱の版より大きい → 更新画面が出て、接続が切れる
    await setMin(999);
    await send('Page.navigate', { url: B + '/' }); await wait(3000);
    console.log('読み込み直後: 接続中=', await ev(`socket.connected`), '同梱の版=', await ev(`CLIENT_V`));
    await ev(inject); await wait(1500);
    console.log('A) 更新画面:', await ev(`!!document.getElementById('salvadoUpdateGate')`), '/ 文面:', await ev(`(document.getElementById('salvadoUpdateGate')||{}).innerText && document.getElementById('salvadoUpdateGate').innerText.replace(/\\n+/g,' | ')`));
    console.log('A) ボタンの行き先:', await ev(`(document.getElementById('salvadoUpdateBtn')||{}).href`), '/ 接続中=', await ev(`socket.connected`), '/ 再接続しない設定=', await ev(`socket.io.opts.reconnection === false`));
    console.log('A) 画面全体を覆っているか(下のボタンを押せない):', await ev(`(function(){ var el=document.elementFromPoint(195, 600); return !!(el && el.closest('#salvadoUpdateGate')); })()`));
    const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(process.argv[2], Buffer.from(s.result.data, 'base64'));
    // B) 最低版が同梱の版以下 → 何も出ない
    await setMin(123);
    await send('Page.navigate', { url: B + '/?b=1' }); await wait(3000); await ev(inject); await wait(1500);
    console.log('B) 最低版123・同梱123: 更新画面=', await ev(`!!document.getElementById('salvadoUpdateGate')`), '/ 接続中=', await ev(`socket.connected`));
    // C) 無効(0) → 何も出ない
    await setMin(0);
    await send('Page.navigate', { url: B + '/?c=1' }); await wait(3000); await ev(inject); await wait(1500);
    console.log('C) 無効(0): 更新画面=', await ev(`!!document.getElementById('salvadoUpdateGate')`));
    // D) アプリでない(ブラウザ版) → スクリプトを読んでも何もしない
    await setMin(999);
    await send('Page.navigate', { url: B + '/?d=1' }); await wait(3000);
    await ev(`(function(){ var s=document.createElement('script'); s.src='/shared/app_gate.js?t='+Date.now(); document.head.appendChild(s); return 1; })()`); await wait(1500);
    console.log('D) ブラウザ版(最低版999でも): 更新画面=', await ev(`!!document.getElementById('salvadoUpdateGate')`), '/ 接続中=', await ev(`socket.connected`));
  } finally { await setMin(0); }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
