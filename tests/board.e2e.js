// 掲示板API/ソケットのシナリオテスト。ローカルサーバーを BOARD_ADMIN_TOKEN=testadmin で起動して node tests/board.e2e.js
const { io } = require(process.env.SIO_CLIENT || 'socket.io-client'); const B = 'http://localhost:3200';
const deck = JSON.parse(require('fs').readFileSync(__dirname + '/deck60.json', 'utf8'));
let fails = 0; const ok = (c, l) => { console.log((c ? 'OK ' : 'NG ') + l); if (!c) fails++; };
const j = async (path, opts) => { opts = opts || {}; const r = await fetch(B + path, Object.assign({}, opts, { headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}), body: opts.body ? JSON.stringify(opts.body) : undefined })); return { status: r.status, data: await r.json().catch(() => ({})) }; };
const auth = t => ({ Authorization: 'Bearer ' + t });
async function account(tag) { const email = 'board_' + tag + '_' + Date.now() + '@example.com'; const r = await j('/auth/register', { method: 'POST', body: { email, password: 'Passw0rd!' + tag, name: 'テスト' + tag + Date.now().toString(36).slice(-4) } }); if (!r.data.token) throw new Error('register failed ' + JSON.stringify(r.data)); return r.data; }
(async () => {
  const A = await account('A'), Bb = await account('B'), C = await account('C'), D = await account('D');
  // 1) ゲストは読めるが投稿できない
  let r = await j('/board/posts', { method: 'POST', body: { topic: 'chat', body: 'guest' } }); ok(r.status === 401, '1) ゲスト投稿は401');
  r = await j('/board/posts?topic=chat'); ok(r.status === 200 && Array.isArray(r.data.posts), '1) ゲストは一覧を読める');
  // 2) 投稿・NG・連絡先・連投
  r = await j('/board/posts', { method: 'POST', headers: auth(A.token), body: { topic: 'chat', body: 'こんにちは！対戦楽しい', avatar: 2 } }); ok(r.status === 200 && r.data.post && r.data.post.avatar === 2, '2) 登録者の投稿OK ' + (r.status !== 200 ? JSON.stringify(r) : '')); if (!r.data.post) process.exit(1);
  const postId = r.data.post.id;
  r = await j('/board/posts', { method: 'POST', headers: auth(A.token), body: { topic: 'chat', body: '連投' } }); ok(r.status === 429, '2) 30秒以内の連投は429');
  r = await j('/board/posts', { method: 'POST', headers: auth(Bb.token), body: { topic: 'chat', body: 'おまえ死ね' } }); ok(r.status === 400 && /不適切/.test(r.data.error), '2) NGワードは400: ' + r.data.error);
  r = await j('/board/posts', { method: 'POST', headers: auth(Bb.token), body: { topic: 'chat', body: 'LINE ID: abc123 追加して' } }); ok(r.status === 400 && /連絡先/.test(r.data.error), '2) 連絡先は400: ' + r.data.error);
  r = await j('/board/posts', { method: 'POST', headers: auth(Bb.token), body: { topic: 'chat', body: 'https://example.com' } }); ok(r.status === 400, '2) URLは400');
  r = await j('/board/posts', { method: 'POST', headers: auth(Bb.token), body: { topic: 'chat', body: 'あ'.repeat(201) } }); ok(r.status === 400 && /200/.test(r.data.error), '2) 201文字は400');
  r = await j('/board/posts', { method: 'POST', headers: auth(Bb.token), body: { topic: 'xxx', body: 'x' } }); ok(r.status === 400, '2) 不正トピックは400');
  // 3) いいね
  r = await j('/board/posts/' + postId + '/like', { method: 'POST', headers: auth(Bb.token) }); ok(r.data.liked === true && r.data.likes === 1, '3) いいね +1');
  r = await j('/board/posts/' + postId + '/like', { method: 'POST', headers: auth(Bb.token) }); ok(r.data.liked === false && r.data.likes === 0, '3) もう一回で取り消し');
  // 4) 通報3件で非表示
  r = await j('/board/posts/' + postId + '/report', { method: 'POST', headers: auth(A.token), body: { reason: '1' } }); ok(r.status === 400, '4) 自分の投稿は通報できない');
  await j('/board/posts/' + postId + '/report', { method: 'POST', headers: auth(Bb.token), body: { reason: '1' } });
  await j('/board/posts/' + postId + '/report', { method: 'POST', headers: auth(Bb.token), body: { reason: '1' } }); // 同じ人の2回目は数えない
  r = await j('/board/posts?topic=chat'); ok(r.data.posts.some(p => p.id === postId), '4) 通報1件ではまだ表示');
  await j('/board/posts/' + postId + '/report', { method: 'POST', headers: auth(C.token), body: { reason: '2' } });
  r = await j('/board/posts/' + postId + '/report', { method: 'POST', headers: auth(D.token), body: { reason: '3' } }); ok(r.data.hidden === true, '4) 3人目の通報で非表示');
  r = await j('/board/posts?topic=chat'); ok(!r.data.posts.some(p => p.id === postId), '4) 一覧から消えた');
  // 5) ブロック
  r = await j('/board/posts', { method: 'POST', headers: auth(C.token), body: { topic: 'chat', body: 'Cの投稿' } }); const cPost = r.data.post.id;
  await j('/board/block', { method: 'POST', headers: auth(D.token), body: { userId: C.user.id } });
  r = await j('/board/posts?topic=chat', { headers: auth(D.token) }); ok(!r.data.posts.some(p => p.id === cPost), '5) ブロックした相手の投稿は自分には見えない');
  r = await j('/board/posts?topic=chat', { headers: auth(A.token) }); ok(r.data.posts.some(p => p.id === cPost), '5) 他の人には見える');
  await j('/board/block/' + C.user.id, { method: 'DELETE', headers: auth(D.token) });
  r = await j('/board/posts?topic=chat', { headers: auth(D.token) }); ok(r.data.posts.some(p => p.id === cPost), '5) ブロック解除で見える');
  // 6) 削除(本人/他人/運営)
  r = await j('/board/posts/' + cPost, { method: 'DELETE', headers: auth(D.token) }); ok(r.status === 403, '6) 他人は削除できない');
  r = await j('/board/posts/' + cPost, { method: 'DELETE', headers: auth(C.token) }); ok(r.status === 200, '6) 本人は削除できる');
  r = await j('/board/posts', { method: 'POST', headers: auth(D.token), body: { topic: 'deck', body: 'ヒロイン多めのデッキどう？' } }); const dPost = r.data.post.id;
  r = await j('/board/posts/' + dPost, { method: 'DELETE', headers: { 'x-admin-token': 'testadmin' } }); ok(r.status === 200, '6) 運営トークンで削除できる');
  r = await j('/board/posts/' + dPost, { method: 'DELETE', headers: { 'x-admin-token': 'wrong' } }); ok(r.status === 403, '6) 間違ったトークンは403');
  // 7) お知らせ
  r = await j('/board/notice', { method: 'POST', headers: { 'x-admin-token': 'testadmin' }, body: { body: '9/27 に生放送やるにゃ' } }); ok(r.status === 200, '7) 運営お知らせ投稿');
  r = await j('/board/posts?topic=chat'); ok(r.data.notice && /生放送/.test(r.data.notice.body), '7) 一覧にお知らせが付く');
  // 8) 対戦募集: ルームを作ってから募集 → 他の人の一覧に「参加できる」として出る → 参加すると対戦開始 → 募集終了
  const E = await account('E'); // 投稿間隔(30秒)に引っかからない新しい人で募集する
  const sa = io(B, { transports: ['websocket'], auth: { token: E.token } }); await new Promise(r => sa.on('connect', r));
  const wait = new Promise(res => sa.once('waiting', res)); sa.emit('createRoom', { name: 'E', deck, playerId: E.user.id }); const w = await wait;
  r = await j('/board/posts', { method: 'POST', headers: auth(Bb.token), body: { topic: 'recruit', body: '偽の募集', roomId: w.roomId } }); ok(r.status === 400, '8) 他人の部屋では募集できない');
  await new Promise(r => setTimeout(r, 100));
  r = await j('/board/posts', { method: 'POST', headers: auth(E.token), body: { topic: 'recruit', body: '初心者歓迎！', roomId: w.roomId } });
  ok(r.status === 200 && r.data.post.roomOpen === true, '8) 自分の待機中ルームで募集OK (' + (r.data.error || 'roomOpen=' + (r.data.post && r.data.post.roomOpen)) + ')');
  r = await j('/board/posts?topic=recruit'); const rec = r.data.posts.find(p => p.roomId === w.roomId); ok(rec && rec.roomOpen, '8) 募集一覧に参加可能として出る');
  const sb = io(B, { transports: ['websocket'], auth: { token: Bb.token } }); await new Promise(r => sb.on('connect', r));
  const joined = new Promise(res => sb.once('joined', res)); sb.emit('joinRoom', { roomId: w.roomId, name: 'B', deck, playerId: Bb.user.id }); await joined;
  r = await j('/board/posts?topic=recruit'); const rec2 = r.data.posts.find(p => p.roomId === w.roomId); ok(rec2 && rec2.roomOpen === false, '8) 参加後は募集終了になる');
  sa.disconnect(); sb.disconnect();
  // 9) 同じ人の並行投稿は1件だけ通る(制限のすり抜け防止)
  { const F = await account('F'); const rs = await Promise.all([1,2,3].map(i => j('/board/posts', { method: 'POST', headers: auth(F.token), body: { topic: 'chat', body: '並行' + i } }))); ok(rs.filter(x => x.status === 200).length === 1, '9) 並行3投稿のうち成功は1件 (' + rs.map(x => x.status).join(',') + ')'); }
  // 10) CORSプリフライト
  { const r = await fetch(B + '/board/posts', { method: 'OPTIONS', headers: { Origin: 'capacitor://localhost', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } }); ok(r.status === 204 && /authorization/i.test(r.headers.get('access-control-allow-headers') || ''), '10) OPTIONS が 204 で Authorization を許可'); }
  // 11) 通報のレート制限(1分5件)
  { const G = await account('G'); const H = await account('H'); const ids = []; for (let i = 0; i < 6; i++) { const acc = await account('P' + i); const r = await j('/board/posts', { method: 'POST', headers: auth(acc.token), body: { topic: 'chat', body: '通報テスト' + i } }); ids.push(r.data.post.id); }
    let last; for (const id of ids) last = await j('/board/posts/' + id + '/report', { method: 'POST', headers: auth(G.token), body: { reason: '1' } }); ok(last.status === 429, '11) 6件目の通報は429'); }
  // 12〜15) モデレーター: 名前で付与 → 他人の投稿を削除/復活・お知らせ投稿/削除 → 外すと権限消失
  { const M = await account('Mod'); const V = await account('Victim'); const N = await account('Normal'); const adm = { 'x-admin-token': 'testadmin' };
    let r = await j('/board/posts', { method: 'POST', headers: auth(V.token), body: { topic: 'chat', body: 'モデレーターテスト用' } }); const vid = r.data.post.id;
    r = await j('/board/posts/' + vid, { method: 'DELETE', headers: auth(M.token) }); ok(r.status === 403, '12) 権限なしは他人の投稿を消せない');
    r = await j('/board/mods', { method: 'POST', headers: adm, body: { name: 'no_such_name_xyz' } }); ok(r.status === 404, '12) 存在しない名前は404');
    r = await j('/board/mods', { method: 'POST', headers: adm, body: { name: M.user.display_name } }); ok(r.status === 200 && r.data.mod.userId === M.user.id, '12) 表示名でモデレーター付与');
    r = await j('/board/mods', { headers: adm }); ok(r.data.mods.some(m => m.user_id === M.user.id), '12) 一覧に載る');
    r = await j('/board/posts?topic=chat', { headers: auth(M.token) }); ok(r.data.canMod === true, '13) 一覧に canMod=true');
    r = await j('/board/posts/' + vid, { method: 'DELETE', headers: auth(M.token) }); ok(r.status === 200, '13) モデレーターは他人の投稿を消せる');
    r = await j('/board/posts?topic=chat', { headers: auth(N.token) }); ok(!r.data.posts.some(p => p.id === vid), '13) 一般には見えない');
    r = await j('/board/posts?topic=chat', { headers: auth(M.token) }); const hp = r.data.posts.find(p => p.id === vid); ok(hp && hp.hidden === true, '13) モデレーターには非表示中として見える');
    r = await j('/board/posts/' + vid + '/restore', { method: 'POST', headers: auth(N.token) }); ok(r.status === 403, '13) 一般は復活できない');
    r = await j('/board/posts/' + vid + '/restore', { method: 'POST', headers: auth(M.token) }); ok(r.status === 200, '13) モデレーターは復活できる');
    r = await j('/board/posts?topic=chat', { headers: auth(N.token) }); ok(r.data.posts.some(p => p.id === vid), '13) 復活後は一般にも見える');
    r = await j('/board/notice', { method: 'POST', headers: auth(N.token), body: { body: 'にせ' } }); ok(r.status === 403, '14) 一般はお知らせを出せない');
    r = await j('/board/notice', { method: 'POST', headers: auth(M.token), body: { body: 'モデレーターからのお知らせ' } }); ok(r.status === 200, '14) モデレーターはお知らせを出せる');
    r = await j('/board/posts?topic=chat'); const nid = r.data.notice && r.data.notice.id; ok(nid && /モデレーター/.test(r.data.notice.body), '14) 最上段に反映');
    r = await j('/board/notice/' + nid, { method: 'DELETE', headers: auth(M.token) }); ok(r.status === 200, '14) モデレーターはお知らせを消せる');
    r = await j('/board/mods/' + encodeURIComponent(M.user.display_name), { method: 'DELETE', headers: adm }); ok(r.status === 200 && r.data.removed === 1, '15) 名前でモデレーター解除');
    r = await j('/board/posts/' + vid, { method: 'DELETE', headers: auth(M.token) }); ok(r.status === 403, '15) 解除後は消せない');
  }
  // 16) 削除者の記録は最初の削除だけ(運営削除後に本人が削除しても上書きしない) / 解除は1人だけ
  { const M2 = await account('Mod2'); const P = await account('Poster'); const adm = { 'x-admin-token': 'testadmin' };
    await j('/board/mods', { method: 'POST', headers: adm, body: { name: M2.user.display_name } });
    let r = await j('/board/posts', { method: 'POST', headers: auth(P.token), body: { topic: 'chat', body: '記録テスト' } }); const pid = r.data.post.id;
    await j('/board/posts/' + pid, { method: 'DELETE', headers: auth(M2.token) });
    await j('/board/posts/' + pid, { method: 'DELETE', headers: auth(P.token) });
    r = await j('/board/posts?topic=chat', { headers: auth(M2.token) }); const hp = r.data.posts.find(p => p.id === pid); ok(hp && hp.hidden, '16) 運営削除→本人削除でも非表示のまま');
    r = await j('/board/mods', { headers: adm }); const before = r.data.mods.length;
    r = await j('/board/mods/' + encodeURIComponent(M2.user.display_name), { method: 'DELETE', headers: adm }); ok(r.data.removed === 1, '16) 解除は1人だけ消える');
    r = await j('/board/mods', { headers: adm }); ok(r.data.mods.length === before - 1, '16) 他のモデレーターは残る');
  }
  // 17) トピックはサーバーが正(3つ・勝利報告なし) / カード添付
  { let r = await j('/board/topics'); ok(r.data.list && r.data.list.length === 3 && !r.data.topics.win, '17) トピックは3つで勝利報告なし');
    const K = await account('Card');
    r = await j('/board/posts', { method: 'POST', headers: auth(K.token), body: { topic: 'win', body: 'x' } }); ok(r.status === 400, '17) 勝利報告への投稿は400');
    r = await j('/board/posts', { method: 'POST', headers: auth(K.token), body: { topic: 'deck', body: 'このカードどう使う？', cardId: 'miiko' } }); ok(r.status === 200 && r.data.post.card && r.data.post.card.id === 'miiko' && r.data.post.card.name, '17) カード添付 → 名前と画像が付く (' + (r.data.post && r.data.post.card && r.data.post.card.name) + ')');
    r = await j('/board/posts?topic=deck'); ok(r.data.posts.some(p => p.card && p.card.id === 'miiko'), '17) 一覧にもカードが付く');
    const K2 = await account('Card2');
    r = await j('/board/posts', { method: 'POST', headers: auth(K2.token), body: { topic: 'deck', body: 'x', cardId: 'no_such_card' } }); ok(r.status === 400, '17) 存在しないカードは400');
  }
  // 18) お知らせは常に1件: 新しいお知らせで前のが消え、最新を消しても前のが復活しない
  { const M3 = await account('Mod3'); const adm = { 'x-admin-token': 'testadmin' };
    await j('/board/mods', { method: 'POST', headers: adm, body: { name: M3.user.display_name } });
    let r = await j('/board/notice', { method: 'POST', headers: auth(M3.token), body: { body: 'お知らせ その1' } }); ok(r.status === 200, '18) お知らせ1');
    r = await j('/board/notice', { method: 'POST', headers: auth(M3.token), body: { body: 'お知らせ その2' } }); ok(r.status === 200, '18) お知らせ2');
    r = await j('/board/lobby'); ok(r.data.notice && /その2/.test(r.data.notice.body), '18) ロビーAPIは最新1件');
    r = await j('/board/notice/' + r.data.notice.id, { method: 'DELETE', headers: auth(M3.token) }); ok(r.status === 200, '18) 最新を消す');
    r = await j('/board/lobby'); ok(r.data.notice === null, '18) 消したら前のが復活しない(null)');
    r = await j('/board/posts?topic=chat'); ok(r.data.notice === null, '18) 掲示板側も同じ');
    await j('/board/mods/' + encodeURIComponent(M3.user.display_name), { method: 'DELETE', headers: adm });
  }
  // 19) ロビーAPI: 生きている募集だけ / 自分の募集は mine / 削除で部屋も閉じる(recruitCancelled) / help
  { const R = await account('Recruit'), V = await account('Viewer');
    const s = io(B, { transports: ['websocket'], auth: { token: R.token } });
    await new Promise(res => s.on('connect', res));
    const waiting = new Promise(res => s.on('waiting', res));
    s.emit('createRoom', { name: R.user.display_name, deck, playerId: R.user.id });
    const w = await waiting; ok(!!w.roomId, '19) 募集用の部屋を作成');
    let r = await j('/board/posts', { method: 'POST', headers: auth(R.token), body: { topic: 'recruit', body: '初心者歓迎', roomId: w.roomId } }); ok(r.status === 200, '19) 募集を投稿');
    const rid = r.data.post.id;
    r = await j('/board/lobby', { headers: auth(V.token) }); ok(r.data.recruits.some(x => x.roomId === w.roomId && x.body === '初心者歓迎'), '19) 他人には募集が見える');
    ok(typeof r.data.online === 'number' && r.data.online >= 1, '19) オンライン人数がある');
    r = await j('/board/lobby', { headers: auth(R.token) }); ok(!r.data.recruits.some(x => x.roomId === w.roomId) && r.data.mine && r.data.mine.roomId === w.roomId, '19) 本人には mine として出て一覧には出ない');
    const cancelled = new Promise(res => s.on('recruitCancelled', res));
    r = await j('/debug'); const roomsBefore = r.data.roomsTotal;
    r = await j('/board/posts/' + rid, { method: 'DELETE', headers: auth(R.token) }); ok(r.status === 200 && r.data.roomClosed === true, '19) 本人削除で部屋を閉じた');
    const c = await Promise.race([cancelled, new Promise(res => setTimeout(() => res(null), 2000))]); ok(c && c.roomId === w.roomId, '19) recruitCancelled が届く');
    r = await j('/debug'); ok(r.data.roomsTotal === roomsBefore - 1, '19) 部屋が消えている(rooms ' + roomsBefore + '→' + r.data.roomsTotal + ')');
    r = await j('/board/lobby', { headers: auth(V.token) }); ok(!r.data.recruits.some(x => x.roomId === w.roomId), '19) 一覧からも消える');
    r = await j('/board/help'); ok(r.status === 200 && r.data.battle && r.data.battle.lines.length > 0 && !r.data._comment, '19) help が返る');
    s.disconnect();
  }
  // 20) 運営が募集を消しても部屋は閉じない(募集主の対戦を巻き込まない)
  { const R2 = await account('Recruit2'); const M4 = await account('Mod4'); const adm = { 'x-admin-token': 'testadmin' };
    await j('/board/mods', { method: 'POST', headers: adm, body: { name: M4.user.display_name } });
    const s = io(B, { transports: ['websocket'], auth: { token: R2.token } });
    await new Promise(res => s.on('connect', res));
    const waiting = new Promise(res => s.on('waiting', res));
    s.emit('createRoom', { name: R2.user.display_name, deck, playerId: R2.user.id });
    const w = await waiting;
    let r = await j('/board/posts', { method: 'POST', headers: auth(R2.token), body: { topic: 'recruit', body: '募集', roomId: w.roomId } }); const rid = r.data.post.id;
    r = await j('/debug'); const before = r.data.roomsTotal;
    r = await j('/board/posts/' + rid, { method: 'DELETE', headers: auth(M4.token) }); ok(r.status === 200 && r.data.roomClosed === false, '20) 運営削除では部屋を閉じない');
    r = await j('/debug'); ok(r.data.roomsTotal === before, '20) 部屋は残る');
    s.emit('leaveRoom'); await new Promise(res => setTimeout(res, 300));
    r = await j('/debug'); ok(r.data.roomsTotal === before - 1, '20) leaveRoom で消える');
    s.disconnect();
    await j('/board/mods/' + encodeURIComponent(M4.user.display_name), { method: 'DELETE', headers: adm });
  }
  // 21) leaveRoom {roomId}: その待機部屋に居る時だけ抜ける(別の部屋に移った後の遅れた後始末で対戦を壊さない)
  { const s = io(B, { transports: ['websocket'] }); await new Promise(res => s.on('connect', res));
    let w = new Promise(res => s.on('waiting', res)); s.emit('createRoom', { name: 'L1', deck, playerId: 'p_leave_' + Date.now() }); const first = await w;
    w = new Promise(res => s.on('waiting', res)); s.emit('createRoom', { name: 'L1', deck, playerId: 'p_leave_' + Date.now() }); const second = await w;
    let r = await j('/debug'); const before = r.data.roomsTotal;
    s.emit('leaveRoom', { roomId: first.roomId }); await new Promise(res => setTimeout(res, 300));
    r = await j('/debug'); ok(r.data.roomsTotal === before, '21) 古い部屋IDの leaveRoom は無視される(今の部屋は残る)');
    s.emit('leaveRoom', { roomId: second.roomId }); await new Promise(res => setTimeout(res, 300));
    r = await j('/debug'); ok(r.data.roomsTotal === before - 1, '21) 今の待機部屋の leaveRoom は効く');
    s.disconnect();
  }
  // 22) お知らせの同時投稿でも有効なのは1件
  { const M5 = await account('Mod5'); const adm = { 'x-admin-token': 'testadmin' };
    await Promise.all([1,2,3,4].map(i => j('/board/notice', { method: 'POST', headers: adm, body: { body: '同時 ' + i } })));
    const r = await j('/board/lobby'); ok(r.data.notice && /同時/.test(r.data.notice.body), '22) お知らせが出る');
    await j('/board/notice/' + r.data.notice.id, { method: 'DELETE', headers: adm });
    const r2 = await j('/board/lobby'); ok(r2.data.notice === null, '22) 同時投稿でも消したら何も残らない(1件だけ有効だった)');
  }
  console.log(fails ? 'BOARD RESULT: FAIL(' + fails + ')' : 'BOARD RESULT: PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
