// CPU戦の通し確認: 自分はマナ配置→ターン終了だけ、CPUがカードを出してターンが回るか(70秒で3ターン目到達を期待)。ローカルサーバー起動後に SIO_CLIENT=<path> PORT=3200 node tests/cpu_smoke.e2e.js
const { io } = require(process.env.SIO_CLIENT || 'socket.io-client');
const deck = JSON.parse(require('fs').readFileSync(__dirname + '/deck60.json','utf8'));
const B = 'http://localhost:' + (process.env.PORT || 3200);
(async()=>{const s=io(B,{transports:['websocket']}); let seq=[], err=null, oppFieldMax=0, myTurns=0, t0=Date.now();
 const T=()=>Math.round((Date.now()-t0)/1000)+'s';
 s.on('turnScreen',({turn,isYourTurn})=>{seq.push('T'+turn+(isYourTurn?'自分':'CPU')+'@'+T()); if(isYourTurn){ myTurns++; setTimeout(()=>s.emit('action',{type:'startTurn'}),300); setTimeout(()=>s.emit('action',{type:'placeMana',data:{idx:0}}),800); setTimeout(()=>s.emit('action',{type:'endTurn'}),1500);} });
 s.on('stateUpdate',st=>{ if(st.opp&&st.opp.field) oppFieldMax=Math.max(oppFieldMax, st.opp.field.length); });
 s.on('error',e=>err=e); s.on('resolveResults',()=>setTimeout(()=>s.emit('action',{type:'ackResolve'}),200));
 s.on('prompt',p=>{ const d=(p.type==='chain'||p.type==='chainAttack')?{action:'pass'}:(p.type==='block'?{assignments:{}}:{cancel:true,skip:true,action:'pass'}); setTimeout(()=>s.emit('action',{type:'promptResponse',data:d}),200); });
 await new Promise(r=>s.on('connect',r)); s.emit('aiMatch',{name:'ホタル検証',deck,playerId:'p_smoke_'+process.env.PORT});
 await new Promise(r=>setTimeout(r,70000));
 console.log('['+B+'] ターン推移:',seq.join(' → ')); console.log('  CPUの場の最大',oppFieldMax,'| 自分の番',myTurns,'回 | エラー',err?JSON.stringify(err):'なし', (myTurns>=3)?'→ 3ターン目まで到達':'→ 停止'); s.disconnect(); process.exit(0);})();
