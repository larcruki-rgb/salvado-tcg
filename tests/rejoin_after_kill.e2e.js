// アプリ完全終了→開き直し(新しい接続が起動時に rejoin を送る)で対戦に戻れるか / 猶予を過ぎたら相手の勝ちになるか
// 実行: RECONNECT_GRACE_MS=5000 でローカルサーバーを起動して node tests/rejoin_after_kill.e2e.js
// 注意: TURN_TIMER_MS は猶予より長くしておくこと(短いと無操作の時間切れ敗北が先に来て opponentLeft ではなく gameOver になる)
const { io } = require(process.env.SIO_CLIENT || 'socket.io-client'); const B = 'http://localhost:3200';
const deck = JSON.parse(require('fs').readFileSync(__dirname + '/deck60.json', 'utf8'));
const GRACE = +process.env.RECONNECT_GRACE_MS || 5000;
const c = (deviceKey) => io(B, { transports: ['websocket'], auth: deviceKey ? { deviceKey } : {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const once = (s, ev, ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); s.once(ev, d => { clearTimeout(t); res(d); }); });
let fails = 0; const ok = (cond, label) => { console.log((cond ? 'OK ' : 'NG ') + label); if (!cond) fails++; };
(async () => {
  // A) 猶予内に「新しい接続」で戻る → joined(rejoin) + stateUpdate、相手には opponentLeft が来ない、その後降参で決着
  { const a = c(), b = c(); await Promise.all([once(a, 'connect', 3000), once(b, 'connect', 3000)]);
    let bLeft = 0; b.on('opponentLeft', () => bLeft++);
    a.emit('quickMatch', { name: 'A', deck, playerId: 'p_kill1' }); await once(a, 'waiting', 2000);
    b.emit('quickMatch', { name: 'B', deck, playerId: 'p_kill2' }); await once(b, 'joined', 2000);
    await sleep(500); a.disconnect(); await sleep(1000);
    const a2 = c(); const pj = once(a2, 'joined', 3000), ps = once(a2, 'stateUpdate', 3000);
    await once(a2, 'connect', 3000); a2.emit('rejoin', { playerId: 'p_kill1' }); // クライアントが起動時に送るのと同じ
    const j = await pj; await ps;
    ok(j.rejoin === true && j.seat === 0 && bLeft === 0, 'A) 完全終了→猶予内の開き直しで対戦に復帰(joined rejoin=true, 相手は切断扱いにならない)');
    const pg = once(b, 'gameOver', 3000); a2.emit('action', { type: 'surrender' }); const g = await pg;
    ok(g.youWin === true, 'A) 復帰後の操作(降参)が通り、相手にgameOver');
    a2.disconnect(); b.disconnect(); await sleep(300); }
  // B) 猶予を過ぎてから戻る → rejoinFailed、相手には猶予経過時点で opponentLeft(勝ち)
  { const a = c(), b = c(); await Promise.all([once(a, 'connect', 3000), once(b, 'connect', 3000)]);
    a.emit('quickMatch', { name: 'A', deck, playerId: 'p_kill3' }); await once(a, 'waiting', 2000);
    b.emit('quickMatch', { name: 'B', deck, playerId: 'p_kill4' }); await once(b, 'joined', 2000);
    await sleep(500); const t0 = Date.now(); const pl = once(b, 'opponentLeft', GRACE + 5000); a.disconnect();
    await pl; const dt = Date.now() - t0;
    ok(dt >= GRACE - 500 && dt < GRACE + 3000, 'B) 猶予(' + GRACE + 'ms)経過で相手に opponentLeft (' + dt + 'ms)');
    const a2 = c(); await once(a2, 'connect', 3000); const pf = once(a2, 'rejoinFailed', 3000); a2.emit('rejoin', { playerId: 'p_kill3' }); await pf;
    ok(true, 'B) 猶予後の開き直しは rejoinFailed(ロビーのまま)');
    a2.disconnect(); b.disconnect(); await sleep(300); }
  // C) 対戦中の席に生きた接続がいる時、同じプレイヤーIDの別接続(2台目)が起動時rejoinしても横取りしない
  { const a = c(), b = c(); await Promise.all([once(a, 'connect', 3000), once(b, 'connect', 3000)]);
    a.emit('quickMatch', { name: 'A', deck, playerId: 'p_kill5' }); await once(a, 'waiting', 2000);
    b.emit('quickMatch', { name: 'B', deck, playerId: 'p_kill6' }); await once(b, 'joined', 2000);
    let aUpd = 0; a.on('stateUpdate', () => aUpd++);
    const a2 = c(); await once(a2, 'connect', 3000); const pf = once(a2, 'rejoinFailed', 3000); let a2j = 0; a2.on('joined', () => a2j++); a2.emit('rejoin', { playerId: 'p_kill5' }); await pf;
    const before = aUpd; a.emit('action', { type: 'startTurn' }); await sleep(600);
    ok(a2j === 0 && aUpd > before, 'C) 2台目の起動時rejoinは rejoinFailed、1台目は席を失わず操作が通る');
    a.disconnect(); a2.disconnect(); b.disconnect(); await sleep(300); }
  // D) 強制終了直後(古い接続がまだ切断検知されていない)に同じ端末で開き直す → 古い接続を置き換えて復帰、残り時間も届く
  { const a = c('dev_A'), b = c('dev_B'); await Promise.all([once(a, 'connect', 3000), once(b, 'connect', 3000)]);
    a.emit('quickMatch', { name: 'A', deck, playerId: 'p_kill7' }); await once(a, 'waiting', 2000);
    b.emit('quickMatch', { name: 'B', deck, playerId: 'p_kill8' }); await once(b, 'joined', 2000);
    await sleep(500); let bLeft = 0, bOver = 0; b.on('opponentLeft', () => bLeft++); b.on('gameOver', () => bOver++);
    const a2 = c('dev_A'); const pj = once(a2, 'joined', 3000), pt = once(a2, 'turnTimer', 3000); await once(a2, 'connect', 3000); a2.emit('rejoin', { playerId: 'p_kill7' });
    const j = await pj; const t = await pt;
    ok(j.rejoin === true && t.remaining > 0 && t.total > 0, 'D) 同じ端末の再起動は古い接続が生きていても復帰できる(joined) + 残り時間(' + t.remaining + '/' + t.total + '秒)が届く');
    await sleep(300); ok(a.connected === false, 'D) 置き換えられた古い接続はサーバー側から切られる');
    ok(bLeft === 0 && bOver === 0, 'D) 古い接続を切っても相手に opponentLeft/gameOver は出ない(対戦は続いている)');
    a2.disconnect(); b.disconnect(); await sleep(300); }
  // E) 端末Aが猶予中(切断中)に、同じアカウントの端末Bが起動 → Bは引き込まれない。その後に端末Aが戻れば復帰
  { const a = c('dev_A'), b = c('dev_B'); await Promise.all([once(a, 'connect', 3000), once(b, 'connect', 3000)]);
    a.emit('quickMatch', { name: 'A', deck, playerId: 'p_kill9' }); await once(a, 'waiting', 2000);
    b.emit('quickMatch', { name: 'B', deck, playerId: 'p_kill10' }); await once(b, 'joined', 2000);
    await sleep(500); a.disconnect(); await sleep(500);
    const other = c('dev_OTHER'); await once(other, 'connect', 3000); const pf = once(other, 'rejoinFailed', 3000); other.emit('rejoin', { playerId: 'p_kill9' }); await pf;
    const a2 = c('dev_A'); await once(a2, 'connect', 3000); const pj = once(a2, 'joined', 3000); a2.emit('rejoin', { playerId: 'p_kill9' }); const j = await pj;
    ok(j.rejoin === true, 'E) 猶予中に別端末が起動しても引き込まれず(rejoinFailed)、元の端末は復帰できる');
    other.disconnect(); a2.disconnect(); b.disconnect(); await sleep(300); }
  // F) 鍵付きの席には、鍵を省略した要求(別端末が鍵を送らない)でも戻れない
  { const a = c('dev_A'), b = c('dev_B'); await Promise.all([once(a, 'connect', 3000), once(b, 'connect', 3000)]);
    a.emit('quickMatch', { name: 'A', deck, playerId: 'p_kill11' }); await once(a, 'waiting', 2000);
    b.emit('quickMatch', { name: 'B', deck, playerId: 'p_kill12' }); await once(b, 'joined', 2000);
    await sleep(500); a.disconnect(); await sleep(500);
    const nokey = c(); await once(nokey, 'connect', 3000); const pf = once(nokey, 'rejoinFailed', 3000); nokey.emit('rejoin', { playerId: 'p_kill11' }); await pf;
    ok(true, 'F) 鍵付きの席に鍵なしの要求は rejoinFailed');
    nokey.disconnect(); b.disconnect(); await sleep(300); }
  // G) チュートリアルは起動時の自動復帰の対象外 + leaveRoom 後は部屋が消える
  { const a = c('dev_T'); await once(a, 'connect', 3000);
    a.emit('tutorialMatch'); await once(a, 'joined', 3000); await sleep(300);
    const a2 = c('dev_T'); await once(a2, 'connect', 3000); const pf = once(a2, 'rejoinFailed', 3000); a2.emit('rejoin', { playerId: 'p_none', startup: true }); await pf;
    ok(true, 'G) チュートリアル中に同じ端末が起動時rejoinしても戻されない(rejoinFailed)');
    const before = (await (await fetch(B + '/debug')).json()).rooms; a.emit('leaveRoom'); await sleep(400);
    const after = (await (await fetch(B + '/debug')).json()).rooms;
    ok(after < before, 'G) leaveRoom でチュートリアルの部屋が消える (' + before + '→' + after + ')');
    a.disconnect(); a2.disconnect(); await sleep(300); }
  // H) 対人戦で leaveRoom → 相手に opponentLeft、その後の同じ端末の rejoin は失敗
  { const a = c('dev_A'), b = c('dev_B'); await Promise.all([once(a, 'connect', 3000), once(b, 'connect', 3000)]);
    a.emit('quickMatch', { name: 'A', deck, playerId: 'p_kill13' }); await once(a, 'waiting', 2000);
    b.emit('quickMatch', { name: 'B', deck, playerId: 'p_kill14' }); await once(b, 'joined', 2000);
    await sleep(300); const pl = once(b, 'opponentLeft', 3000); a.emit('leaveRoom'); await pl;
    const pf = once(a, 'rejoinFailed', 3000); a.emit('rejoin', { playerId: 'p_kill13', startup: true }); await pf;
    ok(true, 'H) 対人戦の leaveRoom は相手の勝ち(opponentLeft)、その後は戻れない');
    a.disconnect(); b.disconnect(); await sleep(300); }
  console.log(fails ? 'REJOIN-KILL RESULT: FAIL(' + fails + ')' : 'REJOIN-KILL RESULT: PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
