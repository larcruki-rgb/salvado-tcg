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
        '<button class="ham-surrender" type="button">降参する</button>' +
      '</div>' +
      '<div class="ham-section">' +
        '<h4>エンチャント早見表</h4>' +
        '<div class="ham-legend">' +
          '<div class="ham-en-item"><div class="ham-en-head"><span class="enchant-badge ench-parasite">寄</span><span class="ham-en-name">魔の寄生体</span></div><span class="ham-en-desc">攻撃・HPを+200。【応援1】で蘇生を得る。ターン開始時に魔物トークンを1体生成。魔物の数だけ毎ターン終了時にライフを失う。</span></div>' +
          '<div class="ham-en-item"><div class="ham-en-head"><span class="enchant-badge ench-ki_no_sei">木</span><span class="ham-en-name">木の精</span></div><span class="ham-en-desc">ブロック時、戦闘ダメージを受けない。</span></div>' +
          '<div class="ham-en-item"><div class="ham-en-head"><span class="enchant-badge ench-alminium">銀</span><span class="ham-en-name">頭にアルミホイル</span></div><span class="ham-en-desc">効果の対象にならない。</span></div>' +
          '<div class="ham-en-item"><div class="ham-en-head"><span class="enchant-badge ench-healthy_sleep">健</span><span class="ham-en-name">健康的な生活</span></div><span class="ham-en-desc">HPを+300する。</span></div>' +
          '<div class="ham-en-item"><div class="ham-en-head"><span class="enchant-badge ench-smasher">剣</span><span class="ham-en-name">戦術兵器スマッシャー</span></div><span class="ham-en-desc">俊足を得て攻撃・HPを+100。ユリに装備時は+200・飛行も付与。</span></div>' +
          '<div class="ham-en-item"><div class="ham-en-head"><span class="enchant-badge ench-rena">霊</span><span class="ham-en-name">地縛霊 レナ</span></div><span class="ham-en-desc">飛行を得る。【応援3】で蘇生を得る。</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="ham-section">' +
        '<h4>キーワード早見表</h4>' +
        '<div class="ham-kw-legend">' +
          '<div><b>俊足</b><span>投稿したターンからすぐ攻撃できる</span></div>' +
          '<div><b>油断しない</b><span>攻撃してもタップしない（ブロックにも使える）</span></div>' +
          '<div><b>飛行</b><span>飛行を持つキャラでしかブロックできない</span></div>' +
          '<div><b>蘇生</b><span>破壊される代わりに視聴者の応援コストを支払って場に残れる</span></div>' +
          '<div><b>割り込み</b><span>相手のターンやチェーン中にも使える</span></div>' +
          '<div><b>攻撃不可</b><span>攻撃に参加できない（ブロックは可能）</span></div>' +
          '<div><b>ブロック時ダメージ無効</b><span>ブロック時、このキャラはダメージを受けない</span></div>' +
          '<div><b>登場時</b><span>場に投稿された時に自動で発動する効果</span></div>' +
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
        var vh = window.innerHeight;
        var ph = panel.offsetHeight || 300; // 高さの上限(画面の75%)と中のスクロールは style.css 側で決めている
        var spaceBelow = vh - r.bottom;
        panel.style.right = (window.innerWidth - r.right) + 'px';
        if(spaceBelow >= ph + 20){
          panel.style.top = (r.bottom + 6) + 'px';
          panel.style.bottom = 'auto';
        } else if(r.top - 6 - ph >= 8){
          panel.style.bottom = (vh - r.top + 6) + 'px';
          panel.style.top = 'auto';
        } else {
          // 下にも上にも入りきらない(スマホを縦に持ってブラウザで開いた時など)。画面の上端に合わせる。
          // 以前はボタンの上に重ねて置いていたため、上の方(「降参する」)が画面の外に出て押せなかった
          panel.style.top = '8px';
          panel.style.bottom = 'auto';
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
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  setTimeout(init, 300);
  setTimeout(init, 1000);
})();
