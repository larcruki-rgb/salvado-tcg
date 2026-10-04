// カード名の透過PNGを作る(2026-06 確定の設定: Hiragino Sans 800 / 36px / 字間2px / #2a2a3a / 白フチ0.5px / ネイビー縁取り影 / 高解像度)
const WS = require(process.env.WS); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ITEMS = JSON.parse(process.argv[2]); const OUT = process.argv[3]; const SCALE = 16;
(async () => {
  const port = 9950 + Math.floor(Math.random() * 30);
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port, '--window-size=1200,200', '--user-data-dir=/tmp/cdp_prof_' + Date.now(), 'about:blank'], { stdio: 'ignore' });
  let list = null; for (let i = 0; i < 30 && !list; i++) { await new Promise(r => setTimeout(r, 500)); try { list = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); } catch (e) {} }
  const page = list.find(p => p.type === 'page'); const ws = new WS(page.webSocketDebuggerUrl); await new Promise(r => ws.on('open', r));
  let id = 0; const pend = {}; ws.on('message', m => { const d = JSON.parse(m); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend[i] = res; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await send('Page.navigate', { url: 'file://' + path.resolve(__dirname, 'gen.html') }); await wait(1200);
  for (const it of ITEMS) {
    await ev(`document.getElementById('nm').textContent = ${JSON.stringify(it.name)}; 1`); await wait(200);
    const r = JSON.parse(await ev(`JSON.stringify(document.getElementById('nm').getBoundingClientRect())`));
    const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: SCALE }, fromSurface: true });
    fs.writeFileSync(path.join(OUT, it.id + '.png'), Buffer.from(s.result.data, 'base64'));
    console.log(it.id, it.name, Math.round(r.width) + 'x' + Math.round(r.height), '→ x' + SCALE);
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
