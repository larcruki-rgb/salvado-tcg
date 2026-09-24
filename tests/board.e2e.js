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
  { const G = await account('G'); const H = await account('H'); const ids = []; for (let i = 0; i < 6; i++) { const acc = await account('P' + i); const r = await j('/board/posts', { method: 'POST', headers: auth(acc.token), body: { topic: 'win', body: '勝った' + i } }); ids.push(r.data.post.id); }
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
  console.log(fails ? 'BOARD RESULT: FAIL(' + fails + ')' : 'BOARD RESULT: PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
