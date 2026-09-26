// CPU戦の停止検知プローブ: 4ターン目まで進まなければ STALL と部屋の内部状態を出す。ACK_TIMEOUT_MS=9999999 TURN_TIMER_MS=3000 で起動したローカルサーバーに対して、for i in 1..6 で回す
const { io } = require(process.env.SIO_CLIENT || 'socket.io-client'); const B='http://localhost:3200';
const deck = JSON.parse(require('fs').readFileSync(__dirname + '/deck60.json','utf8'));
(async()=>{const s=io(B,{transports:['websocket']}); let seq=[], myTurns=0, prompts=[], t0=Date.now(), roomId=null, lastEvent='';
 const T=()=>Math.round((Date.now()-t0)/1000)+'s';
 s.on('joined',d=>{roomId=d.roomId;});
 s.onAny((ev,d)=>{ lastEvent=ev+'@'+T(); });
 s.on('turnScreen',({turn,isYourTurn})=>{seq.push('T'+turn+(isYourTurn?'自分':'CPU')); if(isYourTurn){ myTurns++; setTimeout(()=>s.emit('action',{type:'startTurn'}),300); setTimeout(()=>s.emit('action',{type:'placeMana',data:{idx:0}}),800); setTimeout(()=>s.emit('action',{type:'endTurn'}),1500);} });
 s.on('resolveResults',()=>setTimeout(()=>s.emit('action',{type:'ackResolve'}),200));
 s.on('prompt',p=>{ prompts.push(p.type+'@'+T()); const d=(p.type==='chain'||p.type==='chainAttack'||p.type==='chain_attack')?{action:'pass'}:(p.type==='block'?{assignments:{}}:{cancel:true,skip:true,action:'pass'}); setTimeout(()=>s.emit('action',{type:'promptResponse',data:d}),200); });
 await new Promise(r=>s.on('connect',r)); s.emit('aiMatch',{name:'probe',deck,playerId:'p_probe_'+Date.now()});
 const deadline=Date.now()+50000; while(Date.now()<deadline && myTurns<4) await new Promise(r=>setTimeout(r,500));
 const d=await (await fetch(B+'/debug')).json(); const room=d.list.find(r=>r.roomId===roomId);
 const stalled = myTurns<4;
 console.log((stalled?'STALL ':'ok    ')+'room='+roomId+' turns='+seq.join('>')+' | prompts='+prompts.join(',')+' | last='+lastEvent);
 if(stalled) console.log('  内部:', JSON.stringify({phase:room.phase,cp:room.cp,turn:room.turn,chainDepth:room.chainDepth,effectStack:room.effectStack,pendingPrompt:room.pendingPrompt,waitingAction:room.waitingAction,deferred:room.deferredEndTurn,awaitingAck:room.awaitingAck,acks:room.acks,combatQueue:room.combatQueue,resolveQueue:room.resolveQueue}));
 s.emit('leaveRoom'); s.disconnect(); process.exit(stalled?1:0);})();
