// 実行: ローカルサーバーを TURN_TIMER_MS=3000 で起動してから node tests/ghost_match.e2e.js (socket.io-client が必要。無ければ SIO_CLIENT=/path/to/node_modules/socket.io-client)
const { io } = require(process.env.SIO_CLIENT || 'socket.io-client'); const B='http://localhost:3200';
const deck = JSON.parse(require('fs').readFileSync(__dirname + '/deck60.json', 'utf8'));
const c=()=>io(B,{transports:['websocket']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const once=(s,ev,ms)=>new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error('timeout '+ev)),ms);s.once(ev,d=>{clearTimeout(t);res(d);});});
let fails=0; const ok=(cond,label)=>{ console.log((cond?'OK ':'NG ')+label); if(!cond) fails++; };
(async()=>{
  // A) 同一プレイヤーIDの古い接続が待機枠にいる → 新しい接続が待ち直し、第三者が来ればマッチ
  { const a=c(), a2=c(), b=c(); await Promise.all([once(a,'connect',3000),once(a2,'connect',3000),once(b,'connect',3000)]);
    a.emit('quickMatch',{name:'A',deck,playerId:'p_gh1'}); const w1=await once(a,'waiting',2000);
    a2.emit('quickMatch',{name:'A',deck,playerId:'p_gh1'}); const w2=await once(a2,'waiting',2000);
    ok(w1.roomId!==w2.roomId,'A) 同一IDの新接続は別ルームで待ち直す ('+w1.roomId+'→'+w2.roomId+')');
    let aJoined=0; a.on('opponentJoined',()=>aJoined++);
    const pj=once(b,'joined',2000), po=once(a2,'opponentJoined',2000); b.emit('quickMatch',{name:'B',deck,playerId:'p_gh2'}); const j=await pj; await po;
    ok(j.roomId===w2.roomId && aJoined===0,'A) 第三者は新しい接続の方とマッチ、古い接続には何も来ない');
    a.disconnect(); a2.disconnect(); b.disconnect(); await sleep(300); }
  // B) 待機中に別モード(CPU戦)を押した人の待機枠は消える → 次の人は幽霊とマッチしない
  { const x=c(), d=c(), e=c(); await Promise.all([once(x,'connect',3000),once(d,'connect',3000),once(e,'connect',3000)]);
    x.emit('quickMatch',{name:'X',deck,playerId:'p_gh3'}); await once(x,'waiting',2000);
    x.emit('aiMatch',{name:'X',deck,playerId:'p_gh3'}); await once(x,'joined',2000);
    d.emit('quickMatch',{name:'D',deck,playerId:'p_gh4'}); const wd=await once(d,'waiting',2000);
    let dj=0; d.on('joined',()=>dj++); await sleep(500);
    ok(dj===0,'B) CPU戦に移った人の待機枠には合流しない(Dは待機)');
    e.emit('quickMatch',{name:'E',deck,playerId:'p_gh5'}); const je=await once(e,'joined',2000);
    ok(je.roomId===wd.roomId,'B) 次の本物同士(D,E)はマッチする');
    x.disconnect(); d.disconnect(); e.disconnect(); await sleep(300); }
  // C) 一度も操作しない先手は1回の時間切れで敗北 → 相手は永久待ちにならない(TURN_TIMER_MS=3000)
  { const f=c(), g=c(); await Promise.all([once(f,'connect',3000),once(g,'connect',3000)]);
    f.emit('quickMatch',{name:'F',deck,playerId:'p_gh6'}); await once(f,'waiting',2000);
    g.emit('quickMatch',{name:'G',deck,playerId:'p_gh7'}); await once(g,'joined',2000);
    const t0=Date.now(); const [gf,gg]=await Promise.all([once(f,'gameOver',9000),once(g,'gameOver',9000)]);
    const dt=Date.now()-t0;
    ok(gf.loser===gg.loser && gf.youWin!==gg.youWin && dt<6000,'C) 無操作の先手が時間切れ1回で敗北、両者にgameOver ('+dt+'ms, loser='+gf.loser+')');
    f.disconnect(); g.disconnect(); await sleep(300); }
  // D) 操作した人は1回の時間切れでは負けない(ターンが回るだけ)、2連続で負け
  { const h=c(), i=c(); await Promise.all([once(h,'connect',3000),once(i,'connect',3000)]);
    // リスナーは対戦開始前に登録(joinedと同時にturnScreenが届くため)
    let ended={}; let timeouts=0; let screens=0;
    for (const s of [h,i]) { s.on('turnScreen',({isYourTurn,currentPlayer})=>{ screens++; if(!isYourTurn) return; setTimeout(()=>s.emit('action',{type:'startTurn'}),200); if(!ended[currentPlayer]){ ended[currentPlayer]=true; setTimeout(()=>s.emit('action',{type:'endTurn'}),600);} }); s.on('turnTimer',({remaining})=>{ if(remaining===0) timeouts++; }); }
    const pgo=Promise.race([once(h,'gameOver',30000),once(i,'gameOver',30000)]);
    h.emit('quickMatch',{name:'H',deck,playerId:'p_gh8'}); await once(h,'waiting',2000);
    i.emit('quickMatch',{name:'I',deck,playerId:'p_gh9'}); await once(i,'joined',2000);
    const go=await pgo;
    // 期待: T1 H操作(endTurn) → T2 I操作 → T3 H時間切れ1回目(ターンが回る) → T4 I時間切れ1回目 → T5 H時間切れ2回目=敗北
    ok(screens>=8 && timeouts>=6 && go.loser===0,'D) 両者1回操作→無操作: 時間切れ1回目はターンが回り、2連続目で敗北 (turnScreen '+screens+'件, loser='+go.loser+')');
    h.disconnect(); i.disconnect(); await sleep(300); }
  // E) 毎ターン操作(マナ配置)はするが自分でターンを終えない両者 → 先手が時間切れ2回目で敗北(操作でリセットされない)
  { const h=c(), i=c(); await Promise.all([once(h,'connect',3000),once(i,'connect',3000)]);
    let timeouts=0;
    for (const s of [h,i]) { s.on('turnScreen',({isYourTurn})=>{ if(!isYourTurn) return; setTimeout(()=>s.emit('action',{type:'startTurn'}),200); setTimeout(()=>s.emit('action',{type:'placeMana',data:{idx:0}}),600); }); s.on('turnTimer',({remaining})=>{ if(remaining===0) timeouts++; }); }
    const pgo=Promise.race([once(h,'gameOver',30000),once(i,'gameOver',30000)]);
    h.emit('quickMatch',{name:'H2',deck,playerId:'p_gh10'}); await once(h,'waiting',2000);
    i.emit('quickMatch',{name:'I2',deck,playerId:'p_gh11'}); await once(i,'joined',2000);
    const go=await pgo;
    ok(go.loser===0 && timeouts>=6,'E) 毎ターン操作しても自分で終えなければ2連続時間切れで敗北 (loser='+go.loser+', 時間切れ通知'+timeouts+')');
    h.disconnect(); i.disconnect(); await sleep(300); }
  // F) 自分が作った部屋に自分で joinRoom → 待機のまま(部屋は消えない)、その後に別人が入れる
  { const m=c(), n=c(); await Promise.all([once(m,'connect',3000),once(n,'connect',3000)]);
    m.emit('createRoom',{name:'M',deck,playerId:'p_gh12'}); const w=await once(m,'waiting',2000);
    let err=0; m.on('error',()=>err++);
    m.emit('joinRoom',{roomId:w.roomId,name:'M',deck,playerId:'p_gh12'}); const w2=await once(m,'waiting',2000);
    n.emit('joinRoom',{roomId:w.roomId,name:'N',deck,playerId:'p_gh13'}); const jn=await once(n,'joined',2000);
    ok(w2.roomId===w.roomId && err===0 && jn.roomId===w.roomId,'F) 自分の部屋へのjoinRoomは待機継続、部屋は残り別人が入れる');
    m.disconnect(); n.disconnect(); await sleep(300); }
  console.log(fails?'GHOST RESULT: FAIL('+fails+')':'GHOST RESULT: PASS'); process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
