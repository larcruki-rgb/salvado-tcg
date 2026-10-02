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
const conn = () => new Promise(res => { const s = io(B, { transports: ['websocket'], forceNew: true }); s.joined = []; s.errors = []; s.on('joined', d => s.joined.push(d)); s.on('error', e => s.errors.push(e)); s.on('deckRejected', e => s.errors.push(e)); s.on('connect', () => res(s)); });
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
  { const pid = 'p_guard_e2e_2_' + Date.now(); await db.upsertUser(pid, 'guard'); await db.unlockCards(pid, ['zeratine', 'lead', 'daisuke_dare']);
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
      ok(t.joined.length === 1 && !t.joined[0].rejoin, 'S4) 復帰先の無い rejoin が来ても、開始要求は通る (joined=' + t.joined.length + ')');
      t.emit('action', { type: 'surrender' }); await sleep(300); t.disconnect(); }

    // S5) クイックマッチ: 読み込み待ちの間の二度押しは「解除」になる(待機枠に入らない)
    { const t = await conn(); t.waiting = 0; t.cancelled = 0; t.on('waiting', () => t.waiting++); t.on('matchCancelled', () => t.cancelled++);
      t.emit('quickMatch', { name: 'guard', deck: zdeck, playerId: pid }); t.emit('quickMatch', { name: 'guard', deck: zdeck, playerId: pid }); await sleep(1200);
      ok(t.cancelled === 1 && t.waiting === 0 && t.joined.length === 0, 'S5) 二度押しで解除: matchCancelled が1回届き、待機枠には入らない (waiting=' + t.waiting + ' cancelled=' + t.cancelled + ')');
      // 三度目でふつうに待機できる → 四度目で解除(従来の動き)
      t.emit('quickMatch', { name: 'guard', deck: zdeck, playerId: pid }); await sleep(900);
      ok(t.waiting === 1, 'S5) 三度目で待機に入れる');
      t.emit('quickMatch', { name: 'guard', deck: zdeck, playerId: pid }); await sleep(900);
      ok(t.cancelled === 2, 'S5) 待機中の二度押しも従来どおり解除になる');
      t.disconnect(); }
    await db.getPool().query("DELETE FROM user_inventory WHERE user_id = $1", [pid]); await db.getPool().query("DELETE FROM match_history WHERE user_id = $1", [pid]); await db.getPool().query("DELETE FROM users WHERE id = $1", [pid]); }
  console.log(fails === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL (' + fails + ')'); process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
