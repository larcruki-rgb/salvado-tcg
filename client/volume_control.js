// BGM/SE音量スライダー（テスト導入）
// 消す時: このファイルと index.html の volume_control.js の script 1行を削除するだけ。
// client.js 本体には一切手を入れず、グローバル関数のラップだけで実現している。
(function(){
  var LS_KEY = 'salvado_volume';
  var vols = { bgm: 1, se: 1 };
  try {
    var saved = JSON.parse(localStorage.getItem(LS_KEY));
    if (saved) {
      if (typeof saved.bgm === 'number') vols.bgm = saved.bgm;
      if (typeof saved.se === 'number') vols.se = saved.se;
    }
  } catch(e) {}
  function save(){ try { localStorage.setItem(LS_KEY, JSON.stringify(vols)); } catch(e) {} }

  // client.js の _playBGMTrack が設定する基準音量(0.015)に倍率をかける
  var BGM_BASE = 0.015;
  function applyBgm(){
    if (window._bgmGain) { try { window._bgmGain.gain.value = BGM_BASE * vols.bgm; } catch(e) {} }
  }

  // BGM: トラック切替(ピンチBGM等)のたびにgainが作り直されるのでラップして倍率をかけ直す
  var origPlayBGM = window._playBGMTrack;
  if (typeof origPlayBGM === 'function') {
    window._playBGMTrack = function(track){ origPlayBGM(track); applyBgm(); };
  }

  // SE/ボイス: 全再生が通る _playWithGain に倍率をかける
  var origPlayWithGain = window._playWithGain;
  if (typeof origPlayWithGain === 'function') {
    window._playWithGain = function(url, volume, onEnded){
      return origPlayWithGain(url, volume * vols.se, onEnded);
    };
  }

  var css = document.createElement('style');
  css.textContent =
    '.vol-row{display:flex;align-items:center;gap:8px;margin:8px 0;max-width:100%;}' +
    '.vol-label{font-size:13px;white-space:nowrap;flex:0 0 58px;}' +
    // min-width:0 でSafariのスライダー固有幅を無視して縮められるようにする(%切れ対策)
    '.vol-row input[type=range]{flex:1 1 0;min-width:0;}' +
    '.vol-pct{font-size:12px;flex:0 0 38px;text-align:right;color:#999;}';
  document.head.appendChild(css);

  function makeRow(label, key){
    var wrap = document.createElement('div');
    wrap.className = 'vol-row';
    var lab = document.createElement('span');
    lab.className = 'vol-label';
    lab.textContent = label;
    var input = document.createElement('input');
    input.type = 'range';
    input.min = 0; input.max = 100; input.step = 5;
    input.value = Math.round(vols[key] * 100);
    var pct = document.createElement('span');
    pct.className = 'vol-pct';
    pct.textContent = input.value + '%';
    input.addEventListener('input', function(){
      vols[key] = input.value / 100;
      pct.textContent = input.value + '%';
      save();
      if (key === 'bgm') applyBgm();
    });
    wrap.appendChild(lab); wrap.appendChild(input); wrap.appendChild(pct);
    return wrap;
  }

  function inject(){
    var panel = document.querySelector('.hamburger-panel');
    if (!panel || panel.querySelector('.vol-section')) return;
    var sec = document.createElement('div');
    sec.className = 'ham-section vol-section';
    var h = document.createElement('h4');
    h.textContent = '音量';
    sec.appendChild(h);
    sec.appendChild(makeRow('♪ BGM', 'bgm'));
    sec.appendChild(makeRow('🔊 SE', 'se'));
    // 「メニュー」セクションの次・エンチャント早見表の前に挿す
    panel.insertBefore(sec, panel.children[1] || null);
  }
  // ハンバーガーメニュー(hamburger_menu.js)が遅延生成なので、少し待ちながら挿す
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
  setTimeout(inject, 500);
  setTimeout(inject, 1500);
  setTimeout(inject, 3000);
})();
