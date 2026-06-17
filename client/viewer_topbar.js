// スマホ横モード(is-landscape)で視聴者ゾーンをトップバーに移すレイヤー
// client.js は触らず、DOM観察で動的に表示
(function(){
  function buildManaTb(zoneEl){
    var cards = zoneEl.querySelectorAll('.mini-card.mana-card');
    var total = cards.length;
    var tapped = 0;
    cards.forEach(function(c){ if(c.classList.contains('mana-tapped')) tapped++; });
    var active = total - tapped;
    var html = '<span class="mana-count">' + active + '/' + total + '</span>';
    html += '<div class="viewer-icons">';
    for(var i=0;i<active;i++) html += '<span class="viewer-icon"></span>';
    for(var i=0;i<tapped;i++) html += '<span class="viewer-icon tapped"></span>';
    html += '</div>';
    return html;
  }
  function ensureSlot(topBar, className, refNode){
    var el = topBar.querySelector('.mana-tb.' + className);
    if(!el){
      el = document.createElement('div');
      el.className = 'mana-tb ' + className;
      if(refNode && refNode.parentNode === topBar){
        topBar.insertBefore(el, refNode);
      } else {
        topBar.appendChild(el);
      }
    }
    return el;
  }
  function updateTopbar(){
    var topBar = document.querySelector('.top-bar');
    var oppMana = document.getElementById('oppMana');
    var myMana = document.getElementById('myMana');
    if(!topBar || !oppMana || !myMana) return;
    var inLandscape = document.body.classList.contains('is-landscape');
    if(!inLandscape){
      // 解除: 既存スロットを削除
      var slots = topBar.querySelectorAll('.mana-tb');
      slots.forEach(function(s){ s.remove(); });
      return;
    }
    // トップバーの構造を取得して挿入位置を決める
    // ターン表示と思しき中央要素を探す
    var children = Array.prototype.slice.call(topBar.children);
    var centerEl = null;
    children.forEach(function(c){
      if(!centerEl && /Turn|フェーズ|メイン|ターン/i.test(c.textContent || '')) centerEl = c;
    });
    // 相手視聴者: 中央要素の前(=左寄り)に挿入。なければ先頭の次
    var oppRef = centerEl || (children.length > 1 ? children[1] : null);
    var oppTb = ensureSlot(topBar, 'opp', oppRef);
    oppTb.innerHTML = buildManaTb(oppMana);
    // 自分視聴者: 中央要素の後ろ(=右寄り)に挿入。なければ最後の前
    var myRef = (centerEl && centerEl.nextElementSibling) ? centerEl.nextElementSibling : (children.length > 1 ? children[children.length-1] : null);
    var myTb = ensureSlot(topBar, 'my', myRef);
    myTb.innerHTML = buildManaTb(myMana);
  }
  function init(){
    updateTopbar();
    var oppMana = document.getElementById('oppMana');
    var myMana = document.getElementById('myMana');
    if(oppMana){
      new MutationObserver(function(){ updateTopbar(); }).observe(oppMana, {childList:true, subtree:true, attributes:true});
    }
    if(myMana){
      new MutationObserver(function(){ updateTopbar(); }).observe(myMana, {childList:true, subtree:true, attributes:true});
    }
    // body class 変化(ビュー切替)時にも更新
    new MutationObserver(function(){ updateTopbar(); }).observe(document.body, {attributes:true, attributeFilter:['class']});
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  setTimeout(init, 500);
  setTimeout(init, 1500);
})();
