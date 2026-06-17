// ローカル開発用: URLパラメータでビューモードを強制切替
// 使い方:
//   ?view=pc   → デスクトップ表示(is-desktop, 画面サイズそのまま)
//   ?view=mp   → スマホ縦表示(is-mobile, 393×844のスマホ枠でクリップ)
//   ?view=ml   → スマホ横表示(is-desktop+is-landscape, 844×393のスマホ枠でクリップ)
// パラメータがなければ通常の自動判定のまま
(function(){
  var params = new URLSearchParams(window.location.search);
  var view = params.get('view');
  if(!view) return;
  // client.js の自動判定の後に走らせるため少し遅延
  function apply(){
    var b = document.body;
    b.classList.remove('is-mobile','is-desktop','is-landscape','is-app');
    if(view === 'pc'){
      b.classList.add('is-desktop');
    } else if(view === 'mp'){
      b.classList.add('is-mobile');
    } else if(view === 'ml'){
      b.classList.add('is-desktop','is-landscape');
    }
  }
  // mp/ml モードでは #gameScreen をスマホ枠サイズに固定 + 周囲を暗色背景にする
  function applyFrame(){
    if(document.getElementById('viewFrameStyle')) document.getElementById('viewFrameStyle').remove();
    if(view === 'pc') return;
    var s = document.createElement('style');
    s.id = 'viewFrameStyle';
    var size = view === 'mp' ? {w:393,h:844} : {w:844,h:393};
    s.textContent = ''
      + 'body{background:#15151f !important;}\n'
      + '#gameScreen.active{position:relative !important;margin:20px auto !important;width:'+size.w+'px !important;height:'+size.h+'px !important;'
      + 'border:12px solid #1c1c22 !important;border-radius:40px !important;overflow:hidden !important;flex-shrink:0 !important;'
      + 'box-shadow:0 12px 40px rgba(0,0,0,0.5) !important;left:auto !important;top:auto !important;}\n';
    document.head.appendChild(s);
  }
  // クライアントJS実行後に上書き(複数回保険)
  function applyAll(){ apply(); applyFrame(); }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', applyAll);
  } else {
    applyAll();
  }
  setTimeout(applyAll, 100);
  setTimeout(applyAll, 500);

  // 画面右下に小さなビュー切替UIも出す
  function injectUI(){
    if(document.getElementById('viewSwitchUI')) return;
    var box = document.createElement('div');
    box.id = 'viewSwitchUI';
    box.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:9999;background:rgba(20,20,30,0.85);border:1px solid #5a4a2a;border-radius:6px;padding:6px;display:flex;gap:4px;font-family:sans-serif;font-size:11px;box-shadow:0 4px 12px rgba(0,0,0,0.5);';
    [['PC','pc'],['スマホ縦','mp'],['スマホ横','ml']].forEach(function(item){
      var btn = document.createElement('a');
      btn.href = '?view=' + item[1];
      btn.textContent = item[0];
      var active = view === item[1];
      btn.style.cssText = 'padding:4px 10px;border-radius:4px;text-decoration:none;color:' + (active ? '#f0e6d0' : '#aaa') + ';background:' + (active ? '#5a4a2a' : 'transparent') + ';border:1px solid ' + (active ? '#8a7d5a' : '#444') + ';font-weight:' + (active ? 'bold' : 'normal') + ';';
      box.appendChild(btn);
    });
    document.body.appendChild(box);
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', injectUI);
  } else {
    injectUI();
  }
})();
