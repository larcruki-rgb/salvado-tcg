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
const conn = (token) => new Promise(res => { const s = io(B, { transports: ['websocket'], forceNew: true, auth: Object.assign({ deviceKey: DK }, token ? { token } : {}) }); s.joined = []; s.errors = []; s.waiting = 0; s.cancelled = 0; s.roomId = null; s.on('joined', d => s.joined.push(d)); s.on('waiting', d => { s.waiting++; s.roomId = d && d.roomId; }); s.on('matchCancelled', () => s.cancelled++); s.on('error', e => s.errors.push(e.msg || '')); s.on('deckRejected', e => s.errors.push(e.reason || '')); s.on('connect', () => res(s)); });
const unlocksApi = (id, token) => fetch(B + '/api/user/' + id + '/unlocks', { headers: Object.assign({ 'x-device-key': DK }, token ? { Authorization: 'Bearer ' + token } : {}) }).then(r => r.json());
(async () => {
  const before = await fetch(B + '/api/app/newcards').then(r => r.json());
  const stamp = Date.now(); const guest = 'p_release_e2e_' + stamp;
  const name = 'rel' + String(stamp).slice(-7); const email = 'rel' + stamp + '@example.com';
  let acc = null, acc2 = null;
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

    // ---- 先行テスト中: 新カードは「先行テストの人どうしの部屋」でだけ使える ----
    { acc2 = await fetch(B + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'b' + email, password: 'testpass1234', name: name + 'b' }) }).then(r => r.json());
      await db.unlockCards(acc2.user.id, ['zeratine', 'lead', 'daisuke_dare'], null);
      const A = await conn(acc.token), G = await conn(), B2 = await conn(acc2.token);
      // 先行テストの人が新カード入りで部屋を作る → 一般の人は入れない
      A.emit('createRoom', { name, deck: zdeck, playerId: acc.user.id }); await sleep(900);
      ok(A.waiting === 1 && A.roomId, 'P3b) 先行テストの人は、新カード入りのデッキで部屋を作れる');
      G.emit('joinRoom', { roomId: A.roomId, name: 'g', deck, playerId: guest }); await sleep(900);
      ok(G.joined.length === 0 && G.errors.some(e => e.indexOf('参加できません') >= 0), 'P3b) その部屋に、一般の人は入れない(募集に出しても同じ)');
      // まだ先行テストに入っていない2人目のアカウントも入れない → 追加すると入れる
      B2.emit('joinRoom', { roomId: A.roomId, name: 'b', deck: zdeck, playerId: acc2.user.id }); await sleep(900);
      ok(B2.joined.length === 0, 'P3b) 先行テストに入っていないアカウントは、新カード入りのデッキで入れない');
      const rr = await post({ previewNames: [name, name + 'b'] }, ADMIN);
      ok(rr.body.preview.length === 2, 'P3b) 先行テストを2人に');
      B2.errors.length = 0; B2.emit('joinRoom', { roomId: A.roomId, name: 'b', deck: zdeck, playerId: acc2.user.id }); await sleep(1000);
      ok(B2.joined.length === 1, 'P3b) 先行テストの人どうしなら、新カード入りのデッキで対戦できる (' + JSON.stringify(B2.errors) + ')');
      B2.emit('action', { type: 'surrender' }); await sleep(400);
      // 一般の人が作った部屋(募集)に、先行テストの人が新カード入りで入ることはできない。既存カードのデッキなら入れる
      G.errors.length = 0; G.joined.length = 0; G.emit('createRoom', { name: 'g', deck, playerId: guest }); await sleep(800);
      const gRoom = G.roomId;
      A.joined.length = 0; A.errors.length = 0; A.emit('joinRoom', { roomId: gRoom, name, deck: zdeck, playerId: acc.user.id }); await sleep(900);
      ok(A.joined.length === 0 && A.errors.some(e => e.indexOf('先行テストの人どうし') >= 0), 'P3c) 一般の人の部屋に、新カード入りのデッキでは入れない');
      A.errors.length = 0; A.emit('joinRoom', { roomId: gRoom, name, deck, playerId: acc.user.id }); await sleep(900);
      ok(A.joined.length === 1, 'P3c) 既存カードのデッキなら入れる'); A.emit('action', { type: 'surrender' }); await sleep(400);
      // クイックマッチの待機室に、部屋番号で新カード入りのデッキを持ち込むこともできない
      G.waiting = 0; G.emit('quickMatch', { name: 'g', deck, playerId: guest }); await sleep(800);
      const qRoom = G.roomId;
      A.joined.length = 0; A.errors.length = 0; A.emit('joinRoom', { roomId: qRoom, name, deck: zdeck, playerId: acc.user.id }); await sleep(900);
      ok(G.waiting === 1 && A.joined.length === 0 && A.errors.length > 0, 'P3d) クイックマッチの待機室へ、部屋番号で新カード入りのデッキを持ち込めない');
      G.emit('quickMatch', { name: 'g', deck, playerId: guest }); await sleep(500);
      A.disconnect(); G.disconnect(); B2.disconnect(); }

    // ---- 公開 ----
    const r2 = await post({ released: true }, ADMIN);
    ok(r2.body.released === true && r2.body.preview.length === 2, 'P4) 公開に切り替え(先行テストの指定は変えない)');
    { const u = await unlocksApi(guest); ok(u.visible === true && u.cards.length === 3, 'P4) 公開後: ゲストにも見え、解除3枚が返る');
      const s = await conn(); s.emit('quickMatch', { name: 'g', deck: zdeck, playerId: guest }); await sleep(1000);
      ok(s.waiting === 1 && s.errors.length === 0, 'P4) 公開後: 新カード入りのデッキでクイックマッチに入れる'); s.emit('quickMatch', { name: 'g', deck: zdeck, playerId: guest }); await sleep(500);
      s.emit('questMatch', { name: 'g', deck, questId: 'quest_08', playerId: guest }); await sleep(900);
      ok(s.joined.length === 1, 'P4) 公開後: 入手クエストを誰でも始められる'); s.emit('action', { type: 'surrender' }); await sleep(300); s.disconnect(); }
    // 非公開に戻す: 新カード入りで待機中の部屋は取り消される(戻した後に、他の人とマッチしない)
    { const w = await conn(); w.emit('quickMatch', { name: 'g', deck: zdeck, playerId: guest }); await sleep(900);
      ok(w.waiting === 1, 'P5) (公開中) 新カード入りのデッキで待機に入る');
      const r3 = await post({ released: false }, ADMIN); await sleep(500);
      ok(r3.body.released === false && r3.body.closedRooms === 1 && w.cancelled === 1, 'P5) 非公開に戻すと、その待機は取り消される (closedRooms=' + r3.body.closedRooms + ')');
      const o = await conn(); o.emit('quickMatch', { name: 'o', deck, playerId: 'p_release_other_' + stamp }); await sleep(900);
      ok(o.waiting === 1 && o.joined.length === 0, 'P5) 次に来た人は、取り消された部屋とはマッチしない(新しく待機する)');
      o.emit('quickMatch', { name: 'o', deck, playerId: 'p_release_other_' + stamp }); await sleep(400); o.disconnect(); w.disconnect();
      const u = await unlocksApi(guest); ok(u.visible === false, 'P5) 非公開に戻した後は、解除状況のAPIも visible=false'); }
    // 先行テストの人がクイックマッチで待機中(公開中に入った)→ 非公開に戻す: その待機も取り消される(残すと一般の人と当たる)
    { await post({ released: true }, ADMIN);
      const A = await conn(acc.token); A.emit('quickMatch', { name, deck: zdeck, playerId: acc.user.id }); await sleep(900);
      ok(A.waiting === 1, 'P5b) (公開中) 先行テストの人が、新カード入りのデッキでクイックマッチ待機');
      const r = await post({ released: false }, ADMIN); await sleep(500);
      ok(r.body.closedRooms === 1 && A.cancelled === 1, 'P5b) 非公開に戻すと、その待機は取り消される');
      const o = await conn(); o.emit('quickMatch', { name: 'o', deck, playerId: 'p_release_other_' + stamp }); await sleep(900);
      ok(o.waiting === 1 && o.joined.length === 0, 'P5b) 次にクイックマッチを押した一般の人は、新カードの相手と当たらない');
      // 取り消された人は、その後ふつうに(既存カードのデッキで)クイックマッチに入れる。誤って「解除」扱いにならない
      A.waiting = 0; A.cancelled = 0; A.emit('quickMatch', { name, deck, playerId: acc.user.id }); await sleep(900);
      ok(A.joined.length === 1 || o.joined.length === 1, 'P5b) 取り消された人が既存カードのデッキで押し直すと、待っていた人とマッチする');
      A.emit('action', { type: 'surrender' }); await sleep(400); A.disconnect(); o.disconnect(); }
    // 対戦が始まった部屋の空席に、部屋番号で別の人が入ることはできない
    { await post({ released: true }, ADMIN);
      const h = await conn(), j = await conn(), third = await conn();
      h.emit('createRoom', { name: 'h', deck, playerId: 'p_release_h_' + stamp }); await sleep(700);
      j.emit('joinRoom', { roomId: h.roomId, name: 'j', deck, playerId: 'p_release_j_' + stamp }); await sleep(900);
      ok(j.joined.length === 1, 'P7) 待機中の部屋には入れる(従来どおり)');
      h.disconnect(); await sleep(600);
      third.emit('joinRoom', { roomId: h.roomId, name: 't', deck, playerId: 'p_release_t_' + stamp }); await sleep(900);
      ok(third.joined.length === 0 && third.errors.length > 0, 'P7) 対戦が始まった部屋の空席(切断した人の席)には、別の人は入れない (' + third.errors.join('/') + ')');
      j.disconnect(); third.disconnect(); await post({ released: false }, ADMIN); }
    // 型の違う指定は、何も変えずに 400
    { const bad = await post({ released: 'false' }, ADMIN); const st = await fetch(B + '/api/app/newcards').then(r => r.json());
      ok(bad.status === 400 && st.released === false, 'P6) released に文字列を指定: 400 で、状態は変わらない');
      ok((await post({ previewNames: 'x' }, ADMIN)).status === 400, 'P6) previewNames に配列以外: 400');
      await post({ preview: [acc.user.id] }, ADMIN);
      const bad2 = await post({ preview: [123] }, ADMIN); const cur = await post({}, ADMIN);
      ok(bad2.status === 400 && cur.body.preview.length === 1, 'P6) preview の中身が文字列でない: 400 で、先行テストの指定は消えない'); }
  } finally {
    await post({ released: !!before.released, preview: [] }, ADMIN);
    for (const id of [guest, 'p_release_other_' + stamp, 'p_release_h_' + stamp, 'p_release_j_' + stamp, 'p_release_t_' + stamp, acc && acc.user && acc.user.id, acc2 && acc2.user && acc2.user.id].filter(Boolean)) { for (const t of ['user_inventory', 'match_history', 'user_sessions']) { try { await db.getPool().query('DELETE FROM ' + t + ' WHERE user_id = $1', [id]); } catch (e) {} } try { await db.getPool().query('DELETE FROM users WHERE id = $1', [id]); } catch (e) {} }
  }
  console.log(fails === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL (' + fails + ')'); process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
