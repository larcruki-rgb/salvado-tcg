// 相手の手札を裏面カード状でトップバー下に表示(フィールドに少し食い込む)
(function(){
  var container = null;
  function init(){
    if(container) return;
    var gameScreen = document.getElementById('gameScreen');
    if(!gameScreen) return;
    container = document.createElement('div');
    container.id = 'oppHandCards';
    container.className = 'opp-hand-cards';
    gameScreen.appendChild(container);
  }
  function update(){
    if(!container) return;
    var oppInfo = document.getElementById('oppInfo');
    if(!oppInfo) return;
    var m = (oppInfo.textContent || '').match(/手札\s*(\d+)/);
    if(!m) return;
    var n = parseInt(m[1]) || 0;
    var current = container.children.length;
    if(current === n) return;
    var html = '';
    for(var i=0; i<n; i++) html += '<div class="opp-hand-card"></div>';
    container.innerHTML = html;
  }
  function tick(){ init(); update(); }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', tick);
  } else {
    tick();
  }
  setTimeout(tick, 200);
  setTimeout(tick, 800);
  var setupObserver = function(){
    var oppInfo = document.getElementById('oppInfo');
    if(!oppInfo){ setTimeout(setupObserver, 300); return; }
    new MutationObserver(update).observe(oppInfo, {childList:true, characterData:true, subtree:true});
  };
  setupObserver();
})();
