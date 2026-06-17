// 自陣LPの左にハンバーガーメニュー追加(降参ボタン + エンチャント早見表)
(function(){
  var btn = null, panel = null;
  function init(){
    if(btn) return;
    var topBar = document.querySelector('.top-bar');
    if(!topBar) return;

    btn = document.createElement('button');
    btn.className = 'hamburger-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label','メニュー');
    btn.innerHTML = '<span></span><span></span><span></span>';

    panel = document.createElement('div');
    panel.className = 'hamburger-panel';
    panel.innerHTML =
      '<div class="ham-section">' +
        '<h4>メニュー</h4>' +
        '<button class="ham-log" type="button">ログを開く / 閉じる</button>' +
        '<button class="ham-surrender" type="button">降参する</button>' +
      '</div>' +
      '<div class="ham-section">' +
        '<h4>エンチャント早見表</h4>' +
        '<div class="ham-legend">' +
          '<div><span class="enchant-badge ench-parasite">寄</span><span class="ham-en-name">魔の寄生体</span></div>' +
          '<div><span class="enchant-badge ench-ki_no_sei">木</span><span class="ham-en-name">木の精</span></div>' +
          '<div><span class="enchant-badge ench-alminium">銀</span><span class="ham-en-name">頭にアルミホイル</span></div>' +
          '<div><span class="enchant-badge ench-healthy_sleep">健</span><span class="ham-en-name">健康的な生活</span></div>' +
          '<div><span class="enchant-badge ench-smasher">剣</span><span class="ham-en-name">戦術兵器スマッシャー</span></div>' +
          '<div><span class="enchant-badge ench-rena">霊</span><span class="ham-en-name">地縛霊 レナ</span></div>' +
        '</div>' +
      '</div>';

    var boxes = topBar.querySelectorAll('.life-box');
    var myLifeBox = null;
    boxes.forEach(function(b){ if(!b.classList.contains('life-opp')) myLifeBox = b; });
    if(myLifeBox) topBar.insertBefore(btn, myLifeBox);
    else topBar.appendChild(btn);

    document.body.appendChild(panel);

    btn.addEventListener('click', function(e){
      e.stopPropagation();
      var open = panel.classList.toggle('open');
      if(open){
        var r = btn.getBoundingClientRect();
        var ph = panel.offsetHeight || 300;
        var spaceBelow = window.innerHeight - r.bottom;
        panel.style.right = (window.innerWidth - r.right) + 'px';
        if(spaceBelow >= ph + 20){
          panel.style.top = (r.bottom + 6) + 'px';
          panel.style.bottom = 'auto';
        } else {
          panel.style.bottom = (window.innerHeight - r.top + 6) + 'px';
          panel.style.top = 'auto';
        }
      }
    });
    document.addEventListener('click', function(e){
      if(panel && !panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)){
        panel.classList.remove('open');
      }
    });
    panel.querySelector('.ham-surrender').addEventListener('click', function(){
      if(typeof window.doSurrender === 'function'){
        if(confirm('降参しますか？')) window.doSurrender();
      } else {
        var sBtn = document.getElementById('surrenderBtn');
        if(sBtn) sBtn.click();
      }
      panel.classList.remove('open');
    });
    panel.querySelector('.ham-log').addEventListener('click', function(){
      var lt = document.getElementById('logToggle');
      if(lt) lt.click();
      panel.classList.remove('open');
    });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  setTimeout(init, 300);
  setTimeout(init, 1000);
})();
