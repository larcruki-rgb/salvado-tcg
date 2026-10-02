// 強制更新(最低版)の判定と、版番号の照合。DBを使う(DATABASE_URL。既定 postgres://localhost/salvado_dev)
// 実行: node tests/app_gate.test.js
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/salvado_dev';
const path = require('path'); const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const AppGate = require(path.join(ROOT, 'server/appGate.js'));
const db = require(path.join(ROOT, 'server/db.js'));
let fails = 0; const _log = console.log; const ok = (c, l) => { _log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
console.log = () => {};
const mk = (origin, auth) => { const s = { handshake: { headers: { origin }, auth: auth || {} } }; AppGate.socketMiddleware(s, () => {}); return s; };

(async () => {
  // G1) 版番号: client.js の CLIENT_V と index.html の client.js?v= が一致している
  { const js = fs.readFileSync(path.join(ROOT, 'client/client.js'), 'utf8'); const html = fs.readFileSync(path.join(ROOT, 'client/index.html'), 'utf8');
    const a = /var CLIENT_V = (\d+);/.exec(js), b = /<script src="client\.js\?v=(\d+)"><\/script>/.exec(html);
    ok(a && b && a[1] === b[1], 'G1) CLIENT_V(' + (a && a[1]) + ') と index.html の client.js?v=(' + (b && b[1]) + ') が一致'); }

  // G2) アプリからの接続の見分け
  ok(AppGate.isNativeOrigin('capacitor://localhost') && AppGate.isNativeOrigin('https://localhost') && AppGate.isNativeOrigin('http://localhost'), 'G2) iOS/Android のアプリの接続元をアプリと判定');
  ok(!AppGate.isNativeOrigin('https://game.sarubedo.jp') && !AppGate.isNativeOrigin('http://localhost:3200') && !AppGate.isNativeOrigin(undefined), 'G2) ブラウザ版(本番・開発)と接続元なしはアプリと判定しない');

  const before = await AppGate.load();
  try {
    // G3) 無効(0)の時は誰も止めない
    await AppGate.set(0);
    ok(!AppGate.blocked(mk('https://localhost')) && !AppGate.blocked(mk('capacitor://localhost')), 'G3) 最低版0(無効): 古いアプリも止めない');

    // G4) 最低版123: 古いアプリは止める、新しいアプリとブラウザは通す
    await AppGate.set(123);
    ok(AppGate.blocked(mk('https://localhost')) && AppGate.blocked(mk('capacitor://localhost')), 'G4) 版を送らない配布済みアプリ(Android/iOS)は止める');
    ok(AppGate.blocked(mk('https://localhost', { clientV: 122, native: true })), 'G4) 版122のアプリは止める');
    ok(!AppGate.blocked(mk('https://localhost', { clientV: 123, native: true })) && !AppGate.blocked(mk('capacitor://localhost', { clientV: 130, native: true })), 'G4) 版123以上のアプリは通す');
    ok(!AppGate.blocked(mk('https://game.sarubedo.jp')) && !AppGate.blocked(mk('https://game.sarubedo.jp', { clientV: 100 })) && !AppGate.blocked(mk('http://localhost:3200')), 'G4) ブラウザ版は版に関係なく通す');
    ok(AppGate.blocked(mk('https://example.com', { native: true })), 'G4) 接続元が違っても、アプリを名乗り版が古ければ止める');

    // G5) 設定はDBに保存され、読み直しても同じ値。変な値は0扱い
    ok((await db.getSetting('min_client_v')) === '123' && (await AppGate.load()) === 123, 'G5) 設定はDBに保存され、読み直しても123');
    ok((await AppGate.set('abc')) === 0 && (await AppGate.set(-5)) === 0, 'G5) 数字でない値・マイナスは0(無効)になる');
  } finally { await AppGate.set(before); }

  // G6) shared/cards.js はサーバー側で読み込んでも更新確認が動かない(window が無い)
  { const src = fs.readFileSync(path.join(ROOT, 'shared/cards.js'), 'utf8');
    ok(src.indexOf("typeof window!=='undefined'&&typeof document!=='undefined'&&window.Capacitor") >= 0 && typeof require(path.join(ROOT, 'shared/cards.js')).makeCard === 'function', 'G6) cards.js の更新確認はブラウザ(アプリ)限定で、サーバーでの読み込みは壊れない'); }

  _log(fails === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL (' + fails + ')');
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { _log('ERROR ' + (e && e.stack || e)); process.exit(1); });
