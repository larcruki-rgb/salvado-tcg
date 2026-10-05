// 募集の保持(recruit hold)の通し確認。サーバーを RECRUIT_CALL_MS=2500 HOLD_LOST_GRACE_MS=2000 で起動してから:
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
      // 募集主: 今の対戦を抜けて再読込(=切断して新しい接続)、joinRoom し直す
      o.emit('leaveRoom'); await sleep(100); o.disconnect(); await sleep(150);
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
  } catch (e) { ok(false, '例外: ' + (e.stack || e.message)); }
  console.log('RESULT: ' + (fails ? 'FAIL (' + fails + ')' : 'PASS')); process.exit(fails ? 1 : 0);
})();
