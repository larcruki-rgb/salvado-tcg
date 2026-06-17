// 固定アスペクト＋レターボックス: 各モードの黄金比基準でゲーム画面を中央スケール。余白は均等。
// モーダルもゲーム表示中はゲーム箱に追従させる（ロビーのモーダルは全画面のまま）。
(function(){
  var REF={mobile:[402,812],landscape:[750,402],desktop:[1512,897]};
  function apply(){
    var b=document.body, gs=document.getElementById('gameScreen');
    if(!gs)return;
    var mode=b.classList.contains('is-mobile')?'mobile':(b.classList.contains('is-landscape')?'landscape':'desktop');
    var r=REF[mode],rw=r[0],rh=r[1];
    var s=Math.min(window.innerWidth/rw, window.innerHeight/rh);
    gs.style.width=rw+'px'; gs.style.height=rh+'px';
    gs.style.transform='translate(-50%,-50%) scale('+s+')';
    var md=document.getElementById('modal');
    if(md){
      if(gs.classList.contains('active')){
        md.style.width=rw+'px'; md.style.height=rh+'px';
        md.style.left='50%'; md.style.top='50%';
        md.style.transformOrigin='center center';
        md.style.transform='translate(-50%,-50%) scale('+s+')';
      } else {
        md.style.width=md.style.height=md.style.left=md.style.top=md.style.transform='';
      }
    }
  }
  function setup(){
    apply();
    try{ new MutationObserver(apply).observe(document.body,{attributes:true,attributeFilter:['class']}); }catch(e){}
    var gs=document.getElementById('gameScreen');
    if(gs){ try{ new MutationObserver(apply).observe(gs,{attributes:true,attributeFilter:['class']}); }catch(e){} }
  }
  ['resize','orientationchange','load'].forEach(function(e){window.addEventListener(e,function(){setTimeout(apply,60);});});
  if(document.readyState!=='loading')setup(); else document.addEventListener('DOMContentLoaded',setup);
})();
