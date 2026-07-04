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
    // PC: レターボックス余白に「端の木目帯」をキャンバス整列で敷く(割れ目の高さが揃う)
    function strip(id,img){
      var el=document.getElementById(id);
      if(!el){
        el=document.createElement('div');
        el.id=id;
        el.style.cssText='position:fixed;display:none;pointer-events:none;z-index:-1;background-repeat:repeat-x;';
        el.style.backgroundImage="url('img/board_f/"+img+"')";
        document.body.appendChild(el);
      }
      return el;
    }
    var bl=strip('bleedL','edge_l.png'), br=strip('bleedR','edge_r.png');
    var oldBleed=document.getElementById('boardBleed'); if(oldBleed) oldBleed.style.display='none';
    gs.style.removeProperty('background-image'); gs.style.removeProperty('background-color');
    if(mode==='desktop' && gs.classList.contains('active')){
      var cs2=getComputedStyle(document.documentElement);
      function nv(n,d){var v=parseFloat(cs2.getPropertyValue(n));return isNaN(v)?d:v;}
      var zoom=nv('--bleed-ws',1), yoff=nv('--bleed-oy',0);
      var cw=rw*s, ch=rh*s;
      var cl=(window.innerWidth-cw)/2, ct=(window.innerHeight-ch)/2;
      var sw=Math.round(252*s*zoom);   // 帯の表示幅(元400px→キャンバス係数0.63)
      [[bl,0,cl,'right'],[br,cl+cw,window.innerWidth-(cl+cw),'left']].forEach(function(cfg){
        var el=cfg[0], x=cfg[1], w=cfg[2], anchor=cfg[3];
        if(w>0.5){
          el.style.display='block';
          el.style.left=x+'px'; el.style.width=w+'px';
          el.style.top=ct+'px'; el.style.height=ch+'px';
          el.style.backgroundSize=sw+'px '+Math.round(ch*zoom)+'px';
          el.style.backgroundPosition=anchor+' '+yoff+'px';
        } else { el.style.display='none'; }
      });
    } else { bl.style.display='none'; br.style.display='none'; }
    var md=document.getElementById('modal');
    if(md){
      if(gs.classList.contains('active') && mode!=='desktop'){
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
