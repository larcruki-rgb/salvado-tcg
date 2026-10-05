// 募集の保持(recruit hold)の通し確認。サーバーを RECRUIT_CALL_MS=2500 HOLD_LOST_GRACE_MS=2000 QUICK_LOST_MS=1500 で起動してから:
//   SIO_CLIENT=<socket.io-clientのパス> PORT=<ポート> node tests/recruit_hold.e2e.js
const { io } = require(process.env.SIO_CLIENT || 'socket.io-client');
const B = 'http://localhost:' + (process.env.PORT || 3200);
const deck = JSON.parse(require('fs').readFileSync(__dirname + '/deck60.json', 'utf8'));
let fails = 0; const ok = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let uid = 0;
function client(pid, dk) {
  const s = io(B, { transports: ['websocket'], auth: { deviceKey: dk || ('d_test' + (++uid) + Date.now().toString(36)) } });
  s.ev = []; const orig = s.onevent; s.onAny((e, d) => s.ev.push([e, d]));
  s.pid = pid; s.dk = dk;
  s.got = (e) => s.ev.filter(x => x[0] === e).map(x => x[1]);
  s.wait = (e, ms) => new Promise((res) => { const t0 = Date.now(); const iv = setInterval(() => { const g = s.got(e); if (g.length) { clearInterval(iv); res(g[g.length - 1]); } else if (Date.now() - t0 > (ms || 3000)) { clearInterval(iv); res(null); } }, 30); });
  s.clear = () => { s.ev.length = 0; };
  return s;
}
const conn = s => new Promise(r => s.on('connect', r));
const P = (n) => 'p_hold' + n + '_' + Date.now().toString(36);
(async () => {
  try {
    // H1) 募集を出して hold → CPU戦を始めても部屋が残る → 参加者が来ると呼び出し → 募集主が入り直して開始
    { const pidO = P('o1'), dkO = 'd_holdowner1' + Date.now().toString(36);
      const o = client(pidO, dkO), j = client(P('j1')); await Promise.all([conn(o), conn(j)]);
      o.emit('createRoom', { name: '募集主', deck, playerId: pidO }); const w = await o.wait('waiting'); const rid = w && w.roomId;
      o.emit('recruitHold', { roomId: rid }); const h = await o.wait('recruitHolding');
      ok(!!rid && h && h.roomId === rid, 'H1) 募集の保持が始まる(recruitHolding)');
      o.clear(); o.emit('aiMatch', { name: '募集主', deck, playerId: pidO }); const ja = await o.wait('joined');
      ok(ja && ja.roomId !== rid && !o.got('recruitHoldEnded').length, 'H1) 募集主がCPU戦を始めても、募集は閉じない');
      j.emit('joinRoom', { roomId: rid, name: '参加者', deck, playerId: j.pid });
      const jj = await j.wait('joined'), jc = await j.wait('recruitCalling'), oc = await o.wait('recruitCall');
      ok(jj && jj.seat === 1 && jc && oc && oc.roomId === rid && oc.name === '参加者', 'H1) 参加者は席1で待ち、募集主に呼び出しが届く');
      ok(!j.got('turnScreen').length, 'H1) 募集主が来るまで対戦は始まらない');
      // 3人目は入れない
      const k = client(P('k1')); await conn(k); k.emit('joinRoom', { roomId: rid, name: '3人目', deck, playerId: k.pid }); const ke = await k.wait('error');
      ok(ke && /満席/.test(ke.msg) && !k.got('joined').length, 'H1) 呼び出し中は3人目が入れない(満席)'); k.disconnect();
      // 募集主: サーバーに確かめる(recruitAccept) → recruitGo → 再読込(=切断して新しい接続)、joinRoom し直す
      o.emit('recruitAccept', { roomId: rid, playerId: pidO }); const go = await o.wait('recruitGo');
      ok(go && go.roomId === rid, 'H1) 募集主の移動をサーバーが認める(recruitGo)');
      o.disconnect(); await sleep(150);
      const o2 = client(pidO, dkO); await conn(o2); o2.emit('joinRoom', { roomId: rid, name: '募集主', deck, playerId: pidO });
      const oj = await o2.wait('joined'), ot = await o2.wait('turnScreen', 4000), jt = await j.wait('turnScreen', 4000), jo = await j.wait('opponentJoined');
      ok(oj && oj.seat === 0 && ot && jt && jo, 'H1) 募集主が席0で入り直すと、2人の対戦が始まる');
      ok(!j.got('recruitCallFailed').length, 'H1) 参加者に「来なかった」は届かない');
      await sleep(3000); ok(!j.got('recruitCallFailed').length && !j.got('opponentLeft').length, 'H1) 呼び出しの制限時間を過ぎても、始まった対戦は壊れない');
      o2.disconnect(); j.disconnect(); await sleep(200); }
    // H2) 募集主が戻ってこない → 参加者を解放して募集を閉じる
    { const pidO = P('o2'); const o = client(pidO), j = client(P('j2')); await Promise.all([conn(o), conn(j)]);
      o.emit('createRoom', { name: '募集主2', deck, playerId: pidO }); const rid = (await o.wait('waiting')).roomId;
      o.emit('recruitHold', { roomId: rid }); await o.wait('recruitHolding');
      o.emit('aiMatch', { name: '募集主2', deck, playerId: pidO }); await o.wait('joined');
      o.removeAllListeners('recruitCall'); // 呼び出しを無視する募集主
      j.emit('joinRoom', { roomId: rid, name: '参加者2', deck, playerId: j.pid }); await j.wait('recruitCalling');
      const f = await j.wait('recruitCallFailed', 5000), he = await o.wait('recruitHoldEnded', 1000);
      ok(f && he && he.reason === 'no-show', 'H2) 募集主が来ないと、参加者に失敗が届き、募集は閉じる');
      j.clear(); j.emit('joinRoom', { roomId: rid, name: '参加者2', deck, playerId: j.pid }); const e2 = await j.wait('error');
      ok(e2 && /見つかりません/.test(e2.msg), 'H2) 閉じた募集の部屋にはもう入れない');
      j.clear(); j.emit('aiMatch', { name: '参加者2', deck, playerId: j.pid }); ok(!!(await j.wait('joined')), 'H2) 解放された参加者は、別の対戦を始められる');
      o.disconnect(); j.disconnect(); await sleep(200); }
    // H3) 募集主がクイックマッチを始めたら、募集は閉じる
    { const pidO = P('o3'); const o = client(pidO), j = client(P('j3')); await Promise.all([conn(o), conn(j)]);
      o.emit('createRoom', { name: '募集主3', deck, playerId: pidO }); const rid = (await o.wait('waiting')).roomId;
      o.emit('recruitHold', { roomId: rid }); await o.wait('recruitHolding');
      o.emit('aiMatch', { name: '募集主3', deck, playerId: pidO }); await o.wait('joined');
      o.clear(); o.emit('quickMatch', { name: '募集主3', deck, playerId: pidO }); const he = await o.wait('recruitHoldEnded');
      j.emit('joinRoom', { roomId: rid, name: '参加者3', deck, playerId: j.pid }); const e = await j.wait('error');
      ok(he && e && /見つかりません/.test(e.msg), 'H3) クイックマッチを始めると募集は閉じる(部屋も消える)');
      o.emit('quickMatch', { name: '募集主3', deck, playerId: pidO }); await sleep(200); o.disconnect(); j.disconnect(); await sleep(200); }
    // H4) 古いクライアント(recruitHold を送らない): 従来どおり、CPU戦を始めると部屋が消える
    { const pidO = P('o4'); const o = client(pidO), j = client(P('j4')); await Promise.all([conn(o), conn(j)]);
      o.emit('createRoom', { name: '旧', deck, playerId: pidO }); const rid = (await o.wait('waiting')).roomId;
      o.emit('aiMatch', { name: '旧', deck, playerId: pidO }); await o.wait('joined');
      j.emit('joinRoom', { roomId: rid, name: '参加者4', deck, playerId: j.pid }); const e = await j.wait('error');
      ok(e && /見つかりません/.test(e.msg), 'H4) 保持を頼んでいない部屋は、従来どおり席を外すと消える');
      o.disconnect(); j.disconnect(); await sleep(200); }
    // H5) 募集主が座って待っている所に参加者が来た: 従来どおり即開始(呼び出しなし)
    { const pidO = P('o5'); const o = client(pidO), j = client(P('j5')); await Promise.all([conn(o), conn(j)]);
      o.emit('createRoom', { name: '募集主5', deck, playerId: pidO }); const rid = (await o.wait('waiting')).roomId;
      o.emit('recruitHold', { roomId: rid }); await o.wait('recruitHolding');
      j.emit('joinRoom', { roomId: rid, name: '参加者5', deck, playerId: j.pid });
      const ot = await o.wait('turnScreen', 4000), jt = await j.wait('turnScreen', 4000);
      ok(ot && jt && !o.got('recruitCall').length && !j.got('recruitCalling').length && o.got('recruitHoldEnded').some(x => x.reason === 'matched'), 'H5) 座って待っていれば即開始。募集中の印は消える');
      o.disconnect(); j.disconnect(); await sleep(200); }
    // H6) 募集主が再読込(切断→同じ端末・同じIDで再接続): 募集は続き、再接続した接続に結び直される。その後に参加者が来ても呼ばれる
    { const pidO = P('o6'), dkO = 'd_holdowner6' + Date.now().toString(36); const o = client(pidO, dkO), j = client(P('j6')); await Promise.all([conn(o), conn(j)]);
      o.emit('createRoom', { name: '募集主6', deck, playerId: pidO }); const rid = (await o.wait('waiting')).roomId;
      o.emit('recruitHold', { roomId: rid }); await o.wait('recruitHolding');
      o.disconnect(); await sleep(300);
      const o2 = client(pidO, dkO); await conn(o2); o2.emit('rejoin', { playerId: pidO, startup: true });
      const h2 = await o2.wait('recruitHolding');
      ok(h2 && h2.roomId === rid, 'H6) 再読込しても募集は続く(新しい接続に結び直される)');
      j.emit('joinRoom', { roomId: rid, name: '参加者6', deck, playerId: j.pid }); const oc = await o2.wait('recruitCall');
      ok(oc && oc.roomId === rid, 'H6) 再読込の後でも、参加者が来たら呼び出しが届く');
      o2.emit('recruitAccept', { roomId: rid, playerId: pidO }); await o2.wait('recruitGo');
      o2.emit('joinRoom', { roomId: rid, name: '募集主6', deck, playerId: pidO }); ok(!!(await o2.wait('turnScreen', 4000)) && !!(await j.wait('turnScreen', 4000)), 'H6) そのまま対戦が始まる');
      o2.disconnect(); j.disconnect(); await sleep(200); }
    // H7) 募集主が切断したまま戻らない: 猶予(HOLD_LOST_GRACE_MS)を過ぎたら、来た参加者は入れず、募集は閉じる
    { const pidO = P('o7'); const o = client(pidO), j = client(P('j7')); await Promise.all([conn(o), conn(j)]);
      o.emit('createRoom', { name: '募集主7', deck, playerId: pidO }); const rid = (await o.wait('waiting')).roomId;
      o.emit('recruitHold', { roomId: rid }); await o.wait('recruitHolding');
      o.disconnect(); await sleep(2600);
      j.emit('joinRoom', { roomId: rid, name: '参加者7', deck, playerId: j.pid }); const e = await j.wait('error');
      ok(e && /見つかりません/.test(e.msg) && !j.got('joined').length, 'H7) 募集主が切れたまま猶予を過ぎた募集には入れない');
      j.disconnect(); await sleep(200); }
    // H8) 呼び出し待ちの参加者が抜けたら、募集は「募集中」に戻り、別の人が参加できる
    { const pidO = P('o8'), dkO = 'd_holdowner8' + Date.now().toString(36); const o = client(pidO, dkO), j = client(P('j8')), k = client(P('k8')); await Promise.all([conn(o), conn(j), conn(k)]);
      o.emit('createRoom', { name: '募集主8', deck, playerId: pidO }); const rid = (await o.wait('waiting')).roomId;
      o.emit('recruitHold', { roomId: rid }); await o.wait('recruitHolding');
      o.emit('aiMatch', { name: '募集主8', deck, playerId: pidO }); await o.wait('joined'); o.removeAllListeners('recruitCall');
      j.emit('joinRoom', { roomId: rid, name: '参加者8', deck, playerId: j.pid }); await j.wait('recruitCalling');
      j.disconnect(); await sleep(300);
      k.emit('joinRoom', { roomId: rid, name: '別の人', deck, playerId: k.pid }); const kc = await k.wait('recruitCalling');
      ok(!!kc && !o.got('recruitHoldEnded').length, 'H8) 待っていた参加者が抜けても募集は続き、別の人が参加できる');
      o.disconnect(); k.disconnect(); await sleep(200); }
    // H9) 別の人が募集主のIDを名乗っても(端末が違う)、募集主としては扱われない
    { const pidO = P('o9'), dkO = 'd_holdowner9' + Date.now().toString(36); const o = client(pidO, dkO), x = client(pidO, 'd_otherdevice9' + Date.now().toString(36)); await Promise.all([conn(o), conn(x)]);
      o.emit('createRoom', { name: '募集主9', deck, playerId: pidO }); const rid = (await o.wait('waiting')).roomId;
      o.emit('recruitHold', { roomId: rid }); await o.wait('recruitHolding');
      o.emit('aiMatch', { name: '募集主9', deck, playerId: pidO }); await o.wait('joined');
      x.emit('rejoin', { playerId: pidO, startup: true }); await sleep(400);
      ok(!x.got('recruitHolding').length, 'H9) 別の端末からの確認では、募集は結び直されない');
      o.disconnect(); x.disconnect(); await sleep(200); }
    // H10) 呼び出しの後に参加者が抜けた: 募集主が recruitAccept しても移動は認められず、今のCPU戦はそのまま続く
    { const pidO = P('o10'); const o = client(pidO), j = client(P('j10')); await Promise.all([conn(o), conn(j)]);
      o.emit('createRoom', { name: '募集主10', deck, playerId: pidO }); const rid = (await o.wait('waiting')).roomId;
      o.emit('recruitHold', { roomId: rid }); await o.wait('recruitHolding');
      o.emit('aiMatch', { name: '募集主10', deck, playerId: pidO }); await o.wait('joined'); await o.wait('turnScreen');
      j.emit('joinRoom', { roomId: rid, name: '参加者10', deck, playerId: j.pid }); await o.wait('recruitCall');
      j.disconnect(); await sleep(300);
      o.clear(); o.emit('recruitAccept', { roomId: rid, playerId: pidO }); const cc = await o.wait('recruitCallCancelled');
      o.emit('action', { type: 'startTurn' }); const su = await o.wait('stateUpdate', 2500);
      ok(cc && !o.got('recruitGo').length && !!su, 'H10) 取り消された呼び出しでは移動しない。CPU戦は続いている');
      o.disconnect(); await sleep(200); }
    // H11) 同じアカウントの別の接続で対人戦(クイックマッチ)を始めたら、前の接続で出した募集も閉じる(対人戦の最中に呼び戻されない)
    { const pidO = P('o11'), dkO = 'd_holdowner11' + Date.now().toString(36); const o = client(pidO, dkO), o2 = client(pidO, dkO), j = client(P('j11')); await Promise.all([conn(o), conn(o2), conn(j)]);
      o.emit('createRoom', { name: '募集主11', deck, playerId: pidO }); const rid = (await o.wait('waiting')).roomId;
      o.emit('recruitHold', { roomId: rid }); await o.wait('recruitHolding');
      o.emit('aiMatch', { name: '募集主11', deck, playerId: pidO }); await o.wait('joined');
      o2.emit('quickMatch', { name: '募集主11', deck, playerId: pidO }); await o2.wait('waiting');
      j.emit('joinRoom', { roomId: rid, name: '参加者11', deck, playerId: j.pid }); const e = await j.wait('error');
      ok(e && /見つかりません/.test(e.msg) && o.got('recruitHoldEnded').length > 0, 'H11) 別の接続でクイックマッチを始めると、募集は閉じる');
      o2.emit('quickMatch', { name: '募集主11', deck, playerId: pidO }); await sleep(200); o.disconnect(); o2.disconnect(); j.disconnect(); await sleep(200); }
    // H12) 募集は1アカウント1つ: 別の接続で新しく募集を出すと、前の募集は閉じる
    { const pidO = P('o12'), dkO = 'd_holdowner12' + Date.now().toString(36); const o = client(pidO, dkO), o2 = client(pidO, dkO), j = client(P('j12')); await Promise.all([conn(o), conn(o2), conn(j)]);
      o.emit('createRoom', { name: '募集主12', deck, playerId: pidO }); const rid1 = (await o.wait('waiting')).roomId;
      o.emit('recruitHold', { roomId: rid1 }); await o.wait('recruitHolding');
      o.emit('aiMatch', { name: '募集主12', deck, playerId: pidO }); await o.wait('joined');
      o2.emit('createRoom', { name: '募集主12', deck, playerId: pidO }); const rid2 = (await o2.wait('waiting')).roomId;
      o2.emit('recruitHold', { roomId: rid2 }); await o2.wait('recruitHolding');
      j.emit('joinRoom', { roomId: rid1, name: '参加者12', deck, playerId: j.pid }); const e = await j.wait('error');
      ok(rid1 !== rid2 && e && /見つかりません/.test(e.msg), 'H12) 新しく募集を出すと、同じアカウントの前の募集は閉じる');
      o.disconnect(); o2.disconnect(); j.disconnect(); await sleep(200); }
    // H13) 対人戦の最中の募集主は呼び戻されない(recruitAccept を送っても認められず、募集は閉じる)
    { const pidO = P('o13'), dkO = 'd_holdowner13' + Date.now().toString(36); const o = client(pidO, dkO), q = client(P('q13')), j = client(P('j13')); await Promise.all([conn(o), conn(q), conn(j)]);
      // 募集を出して席を外す(CPU戦) → その接続でクイックマッチ…は募集が閉じるので、サーバーの最後の守りを直接確かめる:
      // 募集を持ったまま、相手の作った部屋に入った状態を作るのは joinRoom(別の部屋)で募集が閉じるためできない。よって「閉じている」ことを確かめる
      o.emit('createRoom', { name: '募集主13', deck, playerId: pidO }); const rid = (await o.wait('waiting')).roomId;
      o.emit('recruitHold', { roomId: rid }); await o.wait('recruitHolding');
      o.emit('aiMatch', { name: '募集主13', deck, playerId: pidO }); await o.wait('joined');
      q.emit('createRoom', { name: '相手13', deck, playerId: q.pid }); const rq = (await q.wait('waiting')).roomId;
      o.clear(); o.emit('joinRoom', { roomId: rq, name: '募集主13', deck, playerId: pidO }); await o.wait('turnScreen', 4000);
      j.emit('joinRoom', { roomId: rid, name: '参加者13', deck, playerId: j.pid }); const e = await j.wait('error');
      o.emit('recruitAccept', { roomId: rid, playerId: pidO }); await sleep(400);
      ok(e && /見つかりません/.test(e.msg) && !o.got('recruitGo').length && !q.got('opponentLeft').length, 'H13) 別の人の部屋で対人戦を始めた募集主は呼び戻されず、その対戦も壊れない');
      o.disconnect(); q.disconnect(); j.disconnect(); await sleep(200); }
    // H14) 同じアカウントの別の端末から、自分の募集の部屋には入れない(部屋も消えない)
    { const pidO = P('o14'), dkO = 'd_holdowner14' + Date.now().toString(36); const o = client(pidO, dkO), x = client(pidO, 'd_other14' + Date.now().toString(36)), j = client(P('j14')); await Promise.all([conn(o), conn(x), conn(j)]);
      o.emit('createRoom', { name: '募集主14', deck, playerId: pidO }); const rid = (await o.wait('waiting')).roomId;
      o.emit('recruitHold', { roomId: rid }); await o.wait('recruitHolding');
      o.emit('aiMatch', { name: '募集主14', deck, playerId: pidO }); await o.wait('joined');
      x.emit('joinRoom', { roomId: rid, name: '募集主14', deck, playerId: pidO }); const e = await x.wait('error');
      j.emit('joinRoom', { roomId: rid, name: '参加者14', deck, playerId: j.pid }); const jc = await j.wait('recruitCalling');
      ok(e && /自分の募集/.test(e.msg) && !x.got('joined').length && !!jc, 'H14) 別の端末から自分の募集には入れない。募集は残り、他の人は参加できる');
      o.disconnect(); x.disconnect(); j.disconnect(); await sleep(200); }
    // H15) 募集主が座って待っている時に再読込: 古い接続の切断より先に新しい接続の確認が届いても、席と募集が新しい接続に引き継がれる
    { const pidO = P('o15'), dkO = 'd_holdowner15' + Date.now().toString(36); const o = client(pidO, dkO), j = client(P('j15')); await Promise.all([conn(o), conn(j)]);
      o.emit('createRoom', { name: '募集主15', deck, playerId: pidO }); const rid = (await o.wait('waiting')).roomId;
      o.emit('recruitHold', { roomId: rid }); await o.wait('recruitHolding');
      const o2 = client(pidO, dkO); await conn(o2); o2.emit('rejoin', { playerId: pidO, startup: true }); // 古い接続 o はまだ生きている
      const h2 = await o2.wait('recruitHolding'), w2 = await o2.wait('waiting');
      j.emit('joinRoom', { roomId: rid, name: '参加者15', deck, playerId: j.pid });
      const t2 = await o2.wait('turnScreen', 4000), tj = await j.wait('turnScreen', 4000);
      ok(h2 && w2 && w2.roomId === rid && t2 && tj, 'H15) 新しい接続が席ごと引き継ぎ、参加者が来たらその接続で対戦が始まる');
      o.disconnect(); o2.disconnect(); j.disconnect(); await sleep(200); }
    // H16) 移動を認めた後(recruitGo)に通信が切れた: つなぎ直すと recruitGo が送り直される
    { const pidO = P('o16'), dkO = 'd_holdowner16' + Date.now().toString(36); const o = client(pidO, dkO), j = client(P('j16')); await Promise.all([conn(o), conn(j)]);
      o.emit('createRoom', { name: '募集主16', deck, playerId: pidO }); const rid = (await o.wait('waiting')).roomId;
      o.emit('recruitHold', { roomId: rid }); await o.wait('recruitHolding');
      o.emit('aiMatch', { name: '募集主16', deck, playerId: pidO }); await o.wait('joined');
      j.emit('joinRoom', { roomId: rid, name: '参加者16', deck, playerId: j.pid }); await o.wait('recruitCall');
      o.emit('recruitAccept', { roomId: rid, playerId: pidO }); await o.wait('recruitGo'); o.disconnect(); await sleep(200);
      const o2 = client(pidO, dkO); await conn(o2); o2.emit('rejoin', { playerId: pidO }); const go2 = await o2.wait('recruitGo');
      ok(go2 && go2.roomId === rid, 'H16) つなぎ直した接続に recruitGo が送り直される');
      o2.emit('joinRoom', { roomId: rid, name: '募集主16', deck, playerId: pidO }); ok(!!(await o2.wait('turnScreen', 4000)) && !!(await j.wait('turnScreen', 4000)), 'H16) そのまま入り直して対戦が始まる');
      o2.disconnect(); j.disconnect(); await sleep(200); }
    // ===== クイックマッチの待機も「席を外しても残る」(hold: true を送る新しいクライアント) =====
    // Q1) 待機 → CPU戦 → 別の人が押す → 呼び出し → 入り直して開始
    { const pidA = P('qa1'), dkA = 'd_quicka1' + Date.now().toString(36); const a = client(pidA, dkA), b = client(P('qb1')); await Promise.all([conn(a), conn(b)]);
      a.emit('quickMatch', { name: '待つ人', deck, playerId: pidA, hold: true }); const w = await a.wait('waiting'), h = await a.wait('recruitHolding'); const rid = w && w.roomId;
      ok(w && w.kind === 'quick' && h && h.quick === true, 'Q1) クイックマッチの待機が「残る待機」になる');
      a.emit('aiMatch', { name: '待つ人', deck, playerId: pidA }); await a.wait('joined'); await a.wait('turnScreen', 5000);
      ok(!a.got('recruitHoldEnded').length && !a.got('matchCancelled').length, 'Q1) CPU戦を始めても待機は解除されない');
      b.emit('quickMatch', { name: '押す人', deck, playerId: b.pid, hold: true });
      const bj = await b.wait('joined'), bc = await b.wait('recruitCalling'), ac = await a.wait('recruitCall');
      ok(bj && bj.seat === 1 && bc && bc.quick && ac && ac.quick && ac.roomId === rid && !b.got('turnScreen').length, 'Q1) 押した人は席1で待ち、待っていた人に呼び出しが届く');
      a.emit('recruitAccept', { roomId: rid, playerId: pidA }); const go = await a.wait('recruitGo'); a.disconnect(); await sleep(150);
      const a2 = client(pidA, dkA); await conn(a2); a2.emit('joinRoom', { roomId: rid, name: '待つ人', deck, playerId: pidA });
      ok(go && !!(await a2.wait('turnScreen', 4000)) && !!(await b.wait('turnScreen', 4000)), 'Q1) 待っていた人が入り直すと対戦が始まる');
      a2.disconnect(); b.disconnect(); await sleep(250); }
    // Q2) 席を外して待っている本人がもう一度押す = 解除。次に押した人は新しく待つ
    { const pidA = P('qa2'); const a = client(pidA), b = client(P('qb2')); await Promise.all([conn(a), conn(b)]);
      a.emit('quickMatch', { name: '待つ人2', deck, playerId: pidA, hold: true }); await a.wait('recruitHolding');
      a.emit('aiMatch', { name: '待つ人2', deck, playerId: pidA }); await a.wait('joined');
      a.clear(); a.emit('quickMatch', { name: '待つ人2', deck, playerId: pidA, hold: true }); const mc = await a.wait('matchCancelled');
      b.emit('quickMatch', { name: '押す人2', deck, playerId: b.pid, hold: true }); const bw = await b.wait('waiting');
      ok(mc && bw && !b.got('recruitCalling').length, 'Q2) もう一度押すと解除。次の人は呼び出しにならず、新しく待つ');
      b.emit('quickMatch', { name: '押す人2', deck, playerId: b.pid, hold: true }); await b.wait('matchCancelled'); a.disconnect(); b.disconnect(); await sleep(250); }
    // Q3) 待っていた人が戻らない → 押した人に知らせが届く(クライアントは自動で探し直す)。待機は消える
    { const pidA = P('qa3'); const a = client(pidA), b = client(P('qb3')); await Promise.all([conn(a), conn(b)]);
      a.emit('quickMatch', { name: '待つ人3', deck, playerId: pidA, hold: true }); await a.wait('recruitHolding');
      a.emit('aiMatch', { name: '待つ人3', deck, playerId: pidA }); await a.wait('joined');
      b.emit('quickMatch', { name: '押す人3', deck, playerId: b.pid, hold: true }); await b.wait('recruitCalling');
      const f = await b.wait('recruitCallFailed', 5000);
      b.clear(); b.emit('quickMatch', { name: '押す人3', deck, playerId: b.pid, hold: true }); const bw = await b.wait('waiting');
      ok(f && f.quick === true && !!bw, 'Q3) 戻らなければ押した人は解放され、探し直すと新しく待てる');
      b.emit('quickMatch', { name: '押す人3', deck, playerId: b.pid, hold: true }); await b.wait('matchCancelled'); a.disconnect(); b.disconnect(); await sleep(250); }
    // Q4) 古いクライアント(hold を送らない): 従来どおり、CPU戦を始めると待機が消える
    { const pidA = P('qa4'); const a = client(pidA), b = client(P('qb4')); await Promise.all([conn(a), conn(b)]);
      a.emit('quickMatch', { name: '旧A', deck, playerId: pidA }); await a.wait('waiting');
      a.emit('aiMatch', { name: '旧A', deck, playerId: pidA }); await a.wait('joined');
      b.emit('quickMatch', { name: '旧B', deck, playerId: b.pid }); const bw = await b.wait('waiting');
      ok(!a.got('recruitHolding').length && bw && !b.got('recruitCalling').length && !b.got('joined').length, 'Q4) 古いクライアントの待機は、席を外すと消える(従来どおり)');
      b.emit('quickMatch', { name: '旧B', deck, playerId: b.pid }); await b.wait('matchCancelled'); a.disconnect(); b.disconnect(); await sleep(250); }
    // Q5) 座って待っている所に次の人が押した: 従来どおり即開始
    { const pidA = P('qa5'); const a = client(pidA), b = client(P('qb5')); await Promise.all([conn(a), conn(b)]);
      a.emit('quickMatch', { name: '待つ人5', deck, playerId: pidA, hold: true }); await a.wait('recruitHolding');
      b.emit('quickMatch', { name: '押す人5', deck, playerId: b.pid, hold: true });
      ok(!!(await a.wait('turnScreen', 4000)) && !!(await b.wait('turnScreen', 4000)) && !a.got('recruitCall').length && a.got('recruitHoldEnded').some(x => x.reason === 'matched'), 'Q5) 座って待っていれば即開始');
      a.disconnect(); b.disconnect(); await sleep(250); }
    // Q6) 呼び出し中に押した人が抜けた: 待機枠に戻り、次に押した人がまた呼び出せる
    { const pidA = P('qa6'); const a = client(pidA), b = client(P('qb6')), c = client(P('qc6')); await Promise.all([conn(a), conn(b), conn(c)]);
      a.emit('quickMatch', { name: '待つ人6', deck, playerId: pidA, hold: true }); await a.wait('recruitHolding');
      a.emit('aiMatch', { name: '待つ人6', deck, playerId: pidA }); await a.wait('joined'); a.removeAllListeners('recruitCall');
      b.emit('quickMatch', { name: '押す人6', deck, playerId: b.pid, hold: true }); await b.wait('recruitCalling'); b.disconnect(); await sleep(300);
      c.emit('quickMatch', { name: '次の人6', deck, playerId: c.pid, hold: true }); const cc = await c.wait('recruitCalling');
      ok(!!cc && !a.got('recruitHoldEnded').length, 'Q6) 押した人が抜けても待機は続き、次の人が呼び出せる');
      a.disconnect(); c.disconnect(); await sleep(250); }
    // Q7) 待っていた人がアプリを閉じた(切断して戻らない): 少し経てば、次に押した人は呼び出しにならず新しく待つ
    { const pidA = P('qa7'); const a = client(pidA), b = client(P('qb7')); await Promise.all([conn(a), conn(b)]);
      a.emit('quickMatch', { name: '待つ人7', deck, playerId: pidA, hold: true }); await a.wait('recruitHolding');
      a.disconnect(); await sleep(1900);
      b.emit('quickMatch', { name: '押す人7', deck, playerId: b.pid, hold: true }); const bw = await b.wait('waiting');
      ok(bw && !b.got('recruitCalling').length, 'Q7) 切断したままの人の待機は消え、次の人は新しく待つ');
      b.emit('quickMatch', { name: '押す人7', deck, playerId: b.pid, hold: true }); await b.wait('matchCancelled'); b.disconnect(); await sleep(250); }
    // Q8) 呼び出し待ちの人がもう一度押す: 2つの部屋に入らない。待っていた人の待機も置き去りにならない(次の人がまた呼び出せる)
    { const pidA = P('qa8'); const a = client(pidA), b = client(P('qb8')), c = client(P('qc8')); await Promise.all([conn(a), conn(b), conn(c)]);
      a.emit('quickMatch', { name: '待つ人8', deck, playerId: pidA, hold: true }); await a.wait('recruitHolding');
      a.emit('aiMatch', { name: '待つ人8', deck, playerId: pidA }); await a.wait('joined'); a.removeAllListeners('recruitCall');
      b.emit('quickMatch', { name: '押す人8', deck, playerId: b.pid, hold: true }); await b.wait('recruitCalling');
      b.clear(); b.emit('quickMatch', { name: '押す人8', deck, playerId: b.pid, hold: true }); const bc2 = await b.wait('recruitCalling'); // もう一度押す → 同じ相手を呼び直す
      ok(!!bc2 && !b.got('waiting').length, 'Q8) 呼び出し待ちからもう一度押すと、同じ相手を呼び直す(新しい部屋を別に作らない)');
      b.disconnect(); await sleep(300);
      c.emit('quickMatch', { name: '次の人8', deck, playerId: c.pid, hold: true }); const cc = await c.wait('recruitCalling');
      ok(!!cc && !a.got('recruitHoldEnded').length, 'Q8) その後も待っていた人の待機は生きていて、次の人が呼び出せる');
      a.disconnect(); c.disconnect(); await sleep(2300); } // 切れた人の待機が消えるまで待つ(QUICK_LOST_MS)
    // Q9) クイックマッチの待機に部屋番号で入った人が、呼び出し中にクイックマッチを押す → 別の人(C)とは当たらず、2つの対戦に入らない
    { const pidA = P('qa9'), dkA = 'd_quicka9' + Date.now().toString(36); const a = client(pidA, dkA), b = client(P('qb9')), c = client(P('qc9')); await Promise.all([conn(a), conn(b), conn(c)]);
      a.emit('quickMatch', { name: '待つ人9', deck, playerId: pidA, hold: true }); const rid = (await a.wait('waiting')).roomId; await a.wait('recruitHolding');
      a.emit('aiMatch', { name: '待つ人9', deck, playerId: pidA }); await a.wait('joined');
      b.emit('joinRoom', { roomId: rid, name: '番号で来た人9', deck, playerId: b.pid }); await b.wait('recruitCalling');
      b.clear(); b.emit('quickMatch', { name: '番号で来た人9', deck, playerId: b.pid, hold: true }); await sleep(400);
      c.emit('quickMatch', { name: '次の人9', deck, playerId: c.pid, hold: true }); await sleep(500);
      const bRooms = new Set(b.got('joined').map(x => x.roomId).concat(b.got('waiting').map(x => x.roomId)));
      ok(bRooms.size === 1, 'Q9) 押し直した人は1つの部屋にしかいない (' + Array.from(bRooms).join(',') + ')');
      a.disconnect(); b.disconnect(); c.disconnect(); await sleep(2300); }
    // Q10) 同じ接続で、別のIDとして押しても、自分の待機を自分で呼び出さない(前の待機は閉じて、新しく待つ)
    { const pidA = P('qa10'); const a = client(pidA); await conn(a);
      a.emit('quickMatch', { name: '待つ人10', deck, playerId: pidA, hold: true }); await a.wait('recruitHolding');
      a.emit('aiMatch', { name: '待つ人10', deck, playerId: pidA }); await a.wait('joined');
      a.clear(); a.emit('quickMatch', { name: '別名10', deck, playerId: P('qx10'), hold: true }); const w = await a.wait('waiting');
      ok(w && w.kind === 'quick' && !a.got('recruitCalling').length && !a.got('recruitCall').length, 'Q10) 自分の待機を自分で呼び出さない');
      a.emit('quickMatch', { name: '別名10', deck, playerId: P('qx10'), hold: true }); await sleep(300); a.disconnect(); await sleep(250); }
  } catch (e) { ok(false, '例外: ' + (e.stack || e.message)); }
  console.log('RESULT: ' + (fails ? 'FAIL (' + fails + ')' : 'PASS')); process.exit(fails ? 1 : 0);
})();
