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
    fit();
  }
  // 枚数が多い時は重なりを詰めて、表示幅(スマホは約200px)に全枚数を収める(12枚以上で欠ける問題の対策)
  function fit(){
    if(!container) return;
    var cards = container.children, n = cards.length;
    if(!n) return;
    var mobile = document.body.classList.contains('is-mobile');
    var natural = mobile ? -6 : 0; // 既定の重なり(スマホは -6px。PCは CSS の gap 任せ)
    // まず既定の間隔で並べ、はみ出す時だけ(コンテナは max-width で止まるので scrollWidth > clientWidth になる)詰め直す
    for(var i=0;i<n;i++) cards[i].style.marginLeft = (i===0 ? '' : (mobile ? natural + 'px' : ''));
    if(container.scrollWidth <= container.clientWidth + 1) return;
    var cardW = cards[0].getBoundingClientRect().width || 22;
    var avail = container.clientWidth - cardW;
    var step = n > 1 ? Math.floor(avail / (n - 1)) : cardW;
    var overlap = Math.min(natural, step - cardW);
    if(overlap < -(cardW - 3)) overlap = -(cardW - 3); // 最低3pxは見せる
    for(var i=1;i<n;i++) cards[i].style.marginLeft = overlap + 'px';
  }
  window.addEventListener('resize', fit);
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
