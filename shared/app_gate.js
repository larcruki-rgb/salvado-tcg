// 強制更新の画面(アプリ専用)。shared/cards.js から読み込まれる。cards.js はアプリでも起動のたびにサーバーから読むので、
// 配布済みの古いアプリにもこの確認が届く。ブラウザ版では何もしない。
// 同梱の版は index.html の <script src="client.js?v=NNN"> から読む。最低版はサーバー(/api/app/min-version)に聞く。
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var cap = window.Capacitor;
  var isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  if (!isNative) return;
  var BASE = (typeof window.__SALVADO_GATE_BASE__ === 'string') ? window.__SALVADO_GATE_BASE__ : 'https://game.sarubedo.jp';

  function bundledVersion() {
    var ss = document.querySelectorAll('script[src]');
    for (var i = 0; i < ss.length; i++) {
      var m = /(?:^|\/)client\.js\?v=(\d+)/.exec(ss[i].getAttribute('src') || '');
      if (m) return parseInt(m[1], 10);
    }
    return 0;
  }
  function platform() { try { return (cap.getPlatform && cap.getPlatform()) || ''; } catch (e) { return ''; } }

  function showUpdateScreen(store) {
    if (document.getElementById('salvadoUpdateGate')) return;
    // 対戦サーバーへの接続を止める(古いアプリが裏で繋ぎ直したり、対戦に戻ったりしないように)
    try { if (typeof socket !== 'undefined' && socket) { if (socket.io && socket.io.opts) socket.io.opts.reconnection = false; socket.disconnect(); } } catch (e) {}
    var url = (platform() === 'ios') ? (store && store.ios) : (store && store.android);
    var d = document.createElement('div');
    d.id = 'salvadoUpdateGate';
    d.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;background:rgba(20,22,34,0.97);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;';
    d.innerHTML = '<div style="max-width:420px;width:100%;background:#fffdf8;border-radius:18px;border:4px solid #1f9aa6;padding:26px 20px;text-align:center;font-family:sans-serif;color:#3a2e1a;">'
      + '<div style="font-size:20px;font-weight:800;margin-bottom:12px;">アプリを更新してください</div>'
      + '<div style="font-size:14px;line-height:1.8;margin-bottom:20px;">新しいバージョンがあります。<br>更新すると、また遊べるようになります。</div>'
      + (url ? '<a id="salvadoUpdateBtn" href="' + url + '" target="_blank" rel="noopener" style="display:inline-block;background:#ff9a3c;color:#fff;font-size:17px;font-weight:800;text-decoration:none;padding:14px 34px;border-radius:999px;box-shadow:0 4px 0 #c96a10;">ストアを開く</a>' : '<div style="font-size:14px;">ストアで「サルベド漫画カードゲーム」を更新してください</div>')
      + '</div>';
    (document.body || document.documentElement).appendChild(d);
    var b = document.getElementById('salvadoUpdateBtn');
    if (b) b.addEventListener('click', function (ev) { try { ev.preventDefault(); window.open(url, '_blank'); } catch (e) { location.href = url; } });
  }

  function check() {
    fetch(BASE + '/api/app/min-version?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var min = (j && parseInt(j.minClientV, 10)) || 0;
        if (min > 0 && bundledVersion() < min) showUpdateScreen(j.store || {});
      })
      .catch(function () { /* 読めない時は何もしない(サーバー側でも対戦開始を止めている) */ });
  }
  // 起動時に確認。あわせて、対戦サーバーへ繋ぎ直すたびにも確認する(起動した後で最低版が上がった時に、古いアプリが動かない対戦画面に取り残されないように)
  function start() {
    check();
    try { if (typeof socket !== 'undefined' && socket && socket.on) { socket.on('connect', check); socket.on('updateRequired', function (d) { var min = (d && parseInt(d.minClientV, 10)) || 0; if (min > 0 && bundledVersion() < min) showUpdateScreen((d && d.store) || {}); }); } } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
