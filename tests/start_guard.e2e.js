// 対戦開始まわりの安全確認。ローカルサーバー起動後に:
//   DATABASE_URL=postgres://localhost/salvado_dev SIO_CLIENT=<socket.io-clientのパス> PORT=<ポート> node tests/start_guard.e2e.js
// S1) 名前に文字列以外を入れた開始要求でサーバーが落ちない
// S2) 解除情報の読み込みを待っている古い開始要求が、後から始めた対戦を壊さない
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/salvado_dev';
const path = require('path');
const { io } = require(process.env.SIO_CLIENT || 'socket.io-client');
const db = require(path.join(__dirname, '..', 'server/db.js'));
const B = 'http://localhost:' + (process.env.PORT || 3200);
const deck = JSON.parse(require('fs').readFileSync(__dirname + '/deck60.json', 'utf8'));
let fails = 0; const ok = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DK = 'dk_guard_e2e_device';
const Unlocks = require(path.join(__dirname, '..', 'server/unlocks.js'));
const conn = (dk) => new Promise(res => { const s = io(B, { transports: ['websocket'], forceNew: true, auth: { deviceKey: dk === undefined ? DK : dk } }); s.joined = []; s.errors = []; s.on('joined', d => s.joined.push(d)); s.on('error', e => s.errors.push(e)); s.on('deckRejected', e => s.errors.push(e)); s.on('connect', () => res(s)); });
const zdeck = (() => { const d = JSON.parse(JSON.stringify(deck)); let need = 2; for (const x of d) { while (need > 0 && x.count > 1) { x.count--; need--; } } d.push({ id: 'zeratine', count: 2 }); return d; })();
(async () => {
  // S1
  { const s = await conn();
    s.emit('aiMatch', { name: {}, deck, playerId: 'p_guard_e2e_1' });
    s.emit('quickMatch', { name: ['x'], deck, playerId: 'p_guard_e2e_1' });
    s.emit('puzzleMatch', { name: { a: 1 }, puzzleId: 'puzzle_01' });
    s.emit('createRoom', { name: 12345, deck, playerId: 'p_guard_e2e_1' });
    await sleep(800);
    const alive = await fetch(B + '/api/app/min-version').then(r => r.ok).catch(() => false);
    ok(alive, 'S1) 名前に文字列以外を入れた開始要求を4種類送っても、サーバーは動いている');
    s.emit('leaveRoom'); await sleep(200); s.disconnect();
    const t = await conn(); t.emit('aiMatch', { name: 'ふつう', deck, playerId: 'p_guard_e2e_1' }); await sleep(800);
    ok(t.joined.length === 1, 'S1) その後のふつうの開始要求は通る'); t.emit('action', { type: 'surrender' }); await sleep(200); t.disconnect(); }

  // S2
  { const pid = 'p_guard_e2e_2_' + Date.now(); await db.upsertUser(pid, 'guard'); await db.unlockCards(pid, ['zeratine', 'lead', 'daisuke_dare'], Unlocks.deviceHash(DK));
    const s = await conn();
    // 解除情報の読み込み(DB)を待つ開始要求の直後に、同じ接続でチュートリアルを開始する
    s.emit('aiMatch', { name: 'guard', deck: zdeck, playerId: pid });
    s.emit('tutorialMatch');
    await sleep(1500);
    ok(s.joined.length === 1 && s.joined[0].isTutorial === true, 'S2) 後から始めたチュートリアルだけが始まる(古い開始要求は捨てられる) joined=' + JSON.stringify(s.joined.map(j => j.isTutorial ? 'tutorial' : (j.roomId || '').slice(0, 5))));
    const dbg = await fetch(B + '/debug').then(r => r.json()).catch(() => null);
    s.emit('leaveRoom'); await sleep(300);
    // その後、同じデッキでふつうに始められる(解除済みなので通る)
    s.joined.length = 0; s.emit('aiMatch', { name: 'guard', deck: zdeck, playerId: pid }); await sleep(1200);
    ok(s.joined.length === 1 && !s.joined[0].isTutorial && s.errors.length === 0, 'S2) その後、解除済みカード入りのデッキでCPU戦を始められる (errors=' + JSON.stringify(s.errors) + ')');
    s.emit('action', { type: 'surrender' }); await sleep(300); s.disconnect();

    // S3) 関係のない部屋の後始末(roomId つきの leaveRoom)は、読み込み待ちの開始要求を取り消さない
    { const t = await conn(); t.emit('aiMatch', { name: 'guard', deck: zdeck, playerId: pid }); t.emit('leaveRoom', { roomId: 'NOSUCH' }); await sleep(1200);
      ok(t.joined.length === 1 && t.errors.length === 0, 'S3) 対象外の leaveRoom({roomId}) が来ても、開始要求は通る (joined=' + t.joined.length + ')');
      t.emit('action', { type: 'surrender' }); await sleep(300); t.disconnect(); }

    // S4) 起動時の自動復帰確認(復帰先なし)は、読み込み待ちの開始要求を取り消さない
    { const t = await conn(); t.failed = 0; t.on('rejoinFailed', () => t.failed++);
      t.emit('aiMatch', { name: 'guard', deck: zdeck, playerId: pid }); t.emit('rejoin', { playerId: pid, startup: true }); await sleep(1200);
      // rejoin が「開始の後」に届いた場合は、自分が今いる部屋への復帰として joined(rejoin:true) がもう1回届く(害は無い)。開始そのものが1回通っていることを見る
      ok(t.joined.filter(j => !j.rejoin).length === 1, 'S4) 復帰先の無い rejoin が来ても、開始要求は通る (開始=' + t.joined.filter(j => !j.rejoin).length + ' 復帰=' + t.joined.filter(j => j.rejoin).length + ')');
      t.emit('action', { type: 'surrender' }); await sleep(300); t.disconnect(); }

    // S5) クイックマッチ: 続けて2回押すと「解除」で終わる。
    //     2回目が「読み込み待ちの間」に届くか「待機に入った後」に届くかは通信のタイミングで変わるが、どちらでも最後は待機していないこと
    { const t = await conn(); t.waiting = 0; t.cancelled = 0; t.on('waiting', () => t.waiting++); t.on('matchCancelled', () => t.cancelled++);
      t.emit('quickMatch', { name: 'guard', deck: zdeck, playerId: pid }); t.emit('quickMatch', { name: 'guard', deck: zdeck, playerId: pid }); await sleep(1200);
      const u = await conn(); u.emit('quickMatch', { name: 'other', deck, playerId: 'p_guard_e2e_other5' }); await sleep(900);
      ok(t.cancelled === 1 && t.waiting <= 1 && u.joined.length === 0, 'S5) 続けて2回押す: 解除が1回届き、待機枠は残らない(次の人とマッチしない) (waiting=' + t.waiting + ' cancelled=' + t.cancelled + ')');
      u.emit('quickMatch', { name: 'other', deck, playerId: 'p_guard_e2e_other5' }); await sleep(600); // 次の人の待機を解除して片付ける
      // もう一度押すと待機に入れる → さらに押すと解除(従来の動き)
      const w0 = t.waiting, c0 = t.cancelled;
      t.emit('quickMatch', { name: 'guard', deck: zdeck, playerId: pid }); await sleep(900);
      ok(t.waiting === w0 + 1, 'S5) もう一度押すと待機に入れる');
      t.emit('quickMatch', { name: 'guard', deck: zdeck, playerId: pid }); await sleep(900);
      ok(t.cancelled === c0 + 1, 'S5) 待機中にもう一度押すと解除になる');
      t.disconnect(); u.disconnect(); }

    // S6) 待機中 → 解除を押す → すぐもう一度押す、でも待機枠が残らない(解除の通知だけ届いて他人とマッチする、が起きない)
    { const t = await conn(); t.waiting = 0; t.cancelled = 0; t.on('waiting', () => t.waiting++); t.on('matchCancelled', () => t.cancelled++);
      t.emit('quickMatch', { name: 'guard', deck: zdeck, playerId: pid }); await sleep(900);
      ok(t.waiting === 1, 'S6) まず待機に入る');
      t.emit('quickMatch', { name: 'guard', deck: zdeck, playerId: pid }); t.emit('quickMatch', { name: 'guard', deck: zdeck, playerId: pid }); await sleep(900);
      // 2回押した結果は「解除→もう一度待機」。どちらにしても、通知と実際の状態が食い違わないこと
      const u = await conn(); u.emit('quickMatch', { name: 'other', deck, playerId: 'p_guard_e2e_other' }); await sleep(900);
      const tWaitingNow = (t.waiting - t.cancelled) === 1; // 最後の通知が「待機」なら1
      // 自分の最後の通知が「待機」なら次の人とマッチし、「解除」ならマッチしない(待つ側には joined は来ないので、相手側の joined で見る)
      ok(tWaitingNow === (u.joined.length === 1), 'S6) 通知と実際の待機状態が一致する (自分の通知: 待機' + t.waiting + '回/解除' + t.cancelled + '回, 相手とマッチ=' + (u.joined.length === 1) + ')');
      for (const x of [t, u]) { x.emit('action', { type: 'surrender' }); } await sleep(300); u.emit('leaveRoom'); t.emit('leaveRoom'); await sleep(200); t.disconnect(); u.disconnect(); }
    // S7) 解除済みのゲストIDを、別の端末から名乗っても使えない。クリアした端末からは使える。APIも端末の鍵が合う時だけ返す
    { const bad = await conn('dk_someone_else'); bad.emit('aiMatch', { name: 'x', deck: zdeck, playerId: pid }); await sleep(1200);
      ok(bad.joined.length === 0 && bad.errors.some(e => (e.reason || e.msg || '').indexOf('まだ使えません') >= 0), 'S7) 別の端末から同じゲストIDを名乗る: 報酬カード入りのデッキは拒否される');
      bad.disconnect();
      const good = await conn(); good.emit('aiMatch', { name: 'x', deck: zdeck, playerId: pid }); await sleep(1200);
      ok(good.joined.length === 1, 'S7) クリアした端末からは始められる'); good.emit('action', { type: 'surrender' }); await sleep(300); good.disconnect();
      const api = (h) => fetch(B + '/api/user/' + pid + '/unlocks', { headers: h }).then(r => r.json());
      const a1 = await api({ 'x-device-key': DK }), a2 = await api({ 'x-device-key': 'dk_someone_else' }), a3 = await api({});
      ok(a1.cards.length === 3 && a2.cards.length === 0 && a3.cards.length === 0, 'S7) 解除状況のAPIも、端末の鍵が合う時だけ3枚を返す (' + a1.cards.length + '/' + a2.cards.length + '/' + a3.cards.length + ')');
      const pre = await fetch(B + '/api/user/' + pid + '/unlocks', { method: 'OPTIONS' });
      ok((pre.headers.get('access-control-allow-headers') || '').indexOf('x-device-key') >= 0, 'S7) アプリ(別オリジン)から端末の鍵を送れる(プリフライトで許可)'); }
    await db.getPool().query("DELETE FROM user_inventory WHERE user_id = $1", [pid]); await db.getPool().query("DELETE FROM match_history WHERE user_id = $1", [pid]); await db.getPool().query("DELETE FROM users WHERE id = $1", [pid]); }
  console.log(fails === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL (' + fails + ')'); process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
