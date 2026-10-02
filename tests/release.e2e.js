// 新カードの公開スイッチと先行テスト枠の通し確認。ローカルサーバー(BOARD_ADMIN_TOKEN=testadmin)起動後に:
//   DATABASE_URL=postgres://localhost/salvado_dev SIO_CLIENT=<socket.io-clientのパス> PORT=<ポート> node tests/release.e2e.js
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/salvado_dev';
const path = require('path');
const { io } = require(process.env.SIO_CLIENT || 'socket.io-client');
const db = require(path.join(__dirname, '..', 'server/db.js'));
const Unlocks = require(path.join(__dirname, '..', 'server/unlocks.js'));
const B = 'http://localhost:' + (process.env.PORT || 3200); const ADMIN = process.env.ADMIN_TOKEN || 'testadmin';
const deck = JSON.parse(require('fs').readFileSync(__dirname + '/deck60.json', 'utf8'));
const zdeck = (() => { const d = JSON.parse(JSON.stringify(deck)); let need = 2; for (const x of d) { while (need > 0 && x.count > 1) { x.count--; need--; } } d.push({ id: 'zeratine', count: 2 }); return d; })();
let fails = 0; const ok = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (body, token) => fetch(B + '/api/app/newcards', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'x-admin-token': token } : {}), body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));
const DK = 'dk_release_e2e';
const conn = (token) => new Promise(res => { const s = io(B, { transports: ['websocket'], forceNew: true, auth: Object.assign({ deviceKey: DK }, token ? { token } : {}) }); s.joined = []; s.errors = []; s.waiting = 0; s.on('joined', d => s.joined.push(d)); s.on('waiting', () => s.waiting++); s.on('error', e => s.errors.push(e.msg || '')); s.on('deckRejected', e => s.errors.push(e.reason || '')); s.on('connect', () => res(s)); });
const unlocksApi = (id, token) => fetch(B + '/api/user/' + id + '/unlocks', { headers: Object.assign({ 'x-device-key': DK }, token ? { Authorization: 'Bearer ' + token } : {}) }).then(r => r.json());
(async () => {
  const before = await fetch(B + '/api/app/newcards').then(r => r.json());
  const stamp = Date.now(); const guest = 'p_release_e2e_' + stamp;
  const name = 'rel' + String(stamp).slice(-7); const email = 'rel' + stamp + '@example.com';
  let acc = null;
  try {
    // 準備: クリア済みのゲストと、クリア済みのアカウント(先行テスト用)
    await db.upsertUser(guest, 'ゲスト'); await db.unlockCards(guest, ['zeratine', 'lead', 'daisuke_dare'], Unlocks.deviceHash(DK));
    acc = await fetch(B + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'testpass1234', name }) }).then(r => r.json());
    ok(acc && acc.token && acc.user && acc.user.id.startsWith('u_'), 'P0) テスト用アカウントを作成');
    await db.unlockCards(acc.user.id, ['zeratine', 'lead', 'daisuke_dare'], null);

    ok((await post({ released: true })).status === 403, 'P1) 管理用トークンなしでは切り替えられない(403)');

    // ---- 公開前(先行テストなし) ----
    const r0 = await post({ released: false, preview: [] }, ADMIN);
    ok(r0.status === 200 && r0.body.released === false && (await fetch(B + '/api/app/newcards').then(r => r.json())).released === false, 'P2) 非公開に設定(再起動なし)');
    { const u = await unlocksApi(guest); ok(u.visible === false && u.cards.length === 0, 'P2) 公開前: 解除状況のAPIは visible=false・カード0枚(クリア済みでも)');
      const s = await conn();
      s.emit('questMatch', { name: 'g', deck, questId: 'quest_08', playerId: guest }); await sleep(900);
      ok(s.joined.length === 0 && s.errors.some(e => e.indexOf('まだ公開されていません') >= 0), 'P2) 公開前: 入手クエストは始められない');
      s.errors.length = 0; s.emit('questMatch', { name: 'g', deck, questId: 'quest_03', playerId: guest }); await sleep(900);
      ok(s.joined.length === 1, 'P2) 公開前でも、既存のクエストは今までどおり始められる'); s.emit('action', { type: 'surrender' }); await sleep(300);
      s.joined.length = 0; s.errors.length = 0; s.emit('aiMatch', { name: 'g', deck: zdeck, playerId: guest }); await sleep(900);
      ok(s.joined.length === 0 && s.errors.some(e => e.indexOf('まだ公開されていません') >= 0), 'P2) 公開前: 新カード入りのデッキはCPU戦でも使えない(クリア済みでも)');
      s.errors.length = 0; s.emit('aiMatch', { name: 'g', deck, playerId: guest }); await sleep(900);
      ok(s.joined.length === 1, 'P2) 公開前でも、既存カードのデッキは今までどおり使える'); s.emit('action', { type: 'surrender' }); await sleep(300); s.disconnect(); }

    // ---- 先行テスト: 表示名でアカウントを指定 ----
    const r1 = await post({ previewNames: [name, '存在しない名前xyz'] }, ADMIN);
    ok(r1.body.ok && r1.body.released === false && r1.body.preview.length === 1 && r1.body.preview[0] === acc.user.id && r1.body.notFound.length === 1, 'P3) 先行テストを表示名で指定(見つからない名前は notFound で返る)');
    { const u = await unlocksApi(acc.user.id, acc.token); ok(u.visible === true && u.cards.length === 3, 'P3) 先行テストのアカウント: visible=true・解除3枚が見える');
      const g = await unlocksApi(guest); ok(g.visible === false, 'P3) 他の人(ゲスト)には見えないまま');
      const noTok = await fetch(B + '/api/user/' + acc.user.id + '/unlocks'); ok(noTok.status === 403, 'P3) アカウントの解除状況は、本人のログインが無いと読めない(403)');
      const s = await conn(acc.token);
      s.emit('aiMatch', { name, deck: zdeck, playerId: acc.user.id }); await sleep(1000);
      ok(s.joined.length === 1, 'P3) 先行テストのアカウント: 新カード入りのデッキでCPU戦を始められる'); s.emit('action', { type: 'surrender' }); await sleep(300);
      s.joined.length = 0; s.emit('questMatch', { name, deck, questId: 'quest_08', playerId: acc.user.id }); await sleep(1000);
      ok(s.joined.length === 1, 'P3) 先行テストのアカウント: 入手クエストを始められる'); s.emit('action', { type: 'surrender' }); await sleep(300);
      s.joined.length = 0; s.errors.length = 0; s.emit('quickMatch', { name, deck: zdeck, playerId: acc.user.id }); await sleep(1000);
      ok(s.waiting === 0 && s.joined.length === 0 && s.errors.some(e => e.indexOf('クイックマッチでは使えません') >= 0), 'P3) 先行テスト中: 新カード入りのデッキはクイックマッチ(知らない人との対戦)では使えない');
      s.errors.length = 0; s.emit('quickMatch', { name, deck, playerId: acc.user.id }); await sleep(900);
      ok(s.waiting === 1, 'P3) 既存カードのデッキなら、クイックマッチに入れる'); s.emit('quickMatch', { name, deck, playerId: acc.user.id }); await sleep(500); s.disconnect();
      // アカウントIDを名乗るだけ(ログインなし)では、先行テストにならない
      const fake = await conn(); fake.emit('aiMatch', { name: 'x', deck: zdeck, playerId: acc.user.id }); await sleep(900);
      ok(fake.joined.length === 0, 'P3) ログインせずに先行テストのアカウントIDを名乗っても、使えない'); fake.disconnect(); }

    // ---- 公開 ----
    const r2 = await post({ released: true }, ADMIN);
    ok(r2.body.released === true && r2.body.preview.length === 1, 'P4) 公開に切り替え(先行テストの指定は変えない)');
    { const u = await unlocksApi(guest); ok(u.visible === true && u.cards.length === 3, 'P4) 公開後: ゲストにも見え、解除3枚が返る');
      const s = await conn(); s.emit('quickMatch', { name: 'g', deck: zdeck, playerId: guest }); await sleep(1000);
      ok(s.waiting === 1 && s.errors.length === 0, 'P4) 公開後: 新カード入りのデッキでクイックマッチに入れる'); s.emit('quickMatch', { name: 'g', deck: zdeck, playerId: guest }); await sleep(500);
      s.emit('questMatch', { name: 'g', deck, questId: 'quest_08', playerId: guest }); await sleep(900);
      ok(s.joined.length === 1, 'P4) 公開後: 入手クエストを誰でも始められる'); s.emit('action', { type: 'surrender' }); await sleep(300); s.disconnect(); }
    const r3 = await post({ released: false }, ADMIN);
    ok(r3.body.released === false, 'P5) 非公開に戻せる(すぐ戻せる)');
  } finally {
    await post({ released: !!before.released, preview: [] }, ADMIN);
    for (const id of [guest, acc && acc.user && acc.user.id].filter(Boolean)) { for (const t of ['user_inventory', 'match_history', 'user_sessions']) { try { await db.getPool().query('DELETE FROM ' + t + ' WHERE user_id = $1', [id]); } catch (e) {} } try { await db.getPool().query('DELETE FROM users WHERE id = $1', [id]); } catch (e) {} }
  }
  console.log(fails === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL (' + fails + ')'); process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
