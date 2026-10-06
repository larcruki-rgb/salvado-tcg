const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const GameRoom = require('./GameRoom');
const { getRanking, getEndlessRanking } = require('./Ranking');
const Comments = require('./Comments');
const InquiryMailer = require('./InquiryMailer');
const db = require('./db');
const Auth = require('./auth');
const DeckValidation = require('./deckValidation');
const Unlocks = require('./unlocks');
const AppGate = require('./appGate');
const Release = require('./release');
const { QUESTS } = require('../shared/quests');
const Lobby = require('./lobbyExtras');
const Settings = require('./settings');

const AI_DECK = [
  {id:'maoria',count:1},{id:'tomo',count:1},{id:'izuna',count:1},{id:'miiko',count:2},
  {id:'jk_a',count:2},
  {id:'asaki',count:1},{id:'azusa',count:1},{id:'shinigami',count:1},{id:'jun',count:1},
  {id:'mamachari',count:2},{id:'kyamakiri',count:2},{id:'milia',count:1},{id:'daria',count:2},
  {id:'seitokaichou',count:2},{id:'osananajimi',count:2},{id:'onna_joushi',count:2},
  {id:'ark',count:1},{id:'imouto',count:2},{id:'mensetsu_kan',count:2},{id:'reichen',count:1},
  {id:'sagi',count:1},{id:'dansou',count:2},{id:'lucia',count:2},
  {id:'oyuchi',count:2},{id:'nanase',count:2},{id:'kikaku_botsu',count:2},
  {id:'douga_henshuu',count:2},{id:'channel_sakujo',count:1},{id:'komi',count:2},
  {id:'katorina',count:2},{id:'seishun_kiben',count:1},{id:'gomo',count:2},{id:'akapo',count:2},
  {id:'impression_seigen',count:2},{id:'douga_sakujo',count:2},
  {id:'salvado_cat_yarakashi',count:1},{id:'douga_fukugen',count:2},
];

const app = express();
const server = http.createServer(app);
// pingInterval/pingTimeout: 既定(25秒+20秒)だとアプリを閉じた端末の接続が最大45秒サーバーに残り、
// その間にクイックマッチの待機枠に「幽霊」として居座って相手が永久に待たされる。10秒+8秒で最大18秒に短縮
const io = new Server(server, { cors: { origin: '*' }, pingInterval: 10000, pingTimeout: 8000 });

// iOSアプリ(同梱WebView)からのAPI呼び出しを許可
app.use((req, res, next) => { res.set('Access-Control-Allow-Origin', '*'); next(); });

// 静的ファイル配信
app.use(express.static(path.join(__dirname, '../client'), { etag: false, maxAge: 0 }));
app.use('/shared', express.static(path.join(__dirname, '../shared'), { etag: false, maxAge: 0 }));
app.use('/cardlist', express.static(path.join(__dirname, '../cardlist'), { etag: false, maxAge: 0 }));
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// ルーム管理
const rooms = new Map();
let quickMatchWaiting = null;
// 対戦中に切断した席を待つ猶予。アプリを完全に終了→開き直しでも戻れるように30秒(旧10秒)。
// クライアントは起動時にも rejoin を送るので、この時間内なら復帰できる
const RECONNECT_GRACE_MS = +process.env.RECONNECT_GRACE_MS || 30000;

function generateRoomId() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

// 端末識別子(クライアントが接続時に auth.deviceKey で送る)。rejoin の「同じ端末か」判定に使う。旧クライアントは無し(null)
io.use((socket, next) => { let k = socket.handshake && socket.handshake.auth && socket.handshake.auth.deviceKey; socket.deviceKey = k ? String(k).slice(0, 64) : null; next(); });
io.use(Auth.socketMiddleware);
io.use(AppGate.socketMiddleware); // アプリからの接続か・同梱の版はいくつか(強制更新の判定用)
AppGate.load();
Release.load(); // 新カードの公開スイッチ(読めるまでは非公開のまま)

// 人間の席が全て空か(AIのダミー接続は人間ではない、切断済みの接続も人間ではない)
// 部屋を消す時に、CPU役(AIPlayer/TutorialPlayer)の予約済みの処理を止める(止めないと、消えた部屋に対して動き続ける)
function stopRoomAi(room) { try { if (room && room.ai && room.ai.stop) room.ai.stop(); } catch (e) {} }
function noHumansLeft(room) {
  for (let i = 0; i < 2; i++) {
    let s = room.sockets[i];
    if (s && s !== room._aiSocket && s.connected !== false) return false;
  }
  return true;
}

// この接続が席に残っている部屋すべてから抜ける(exceptRoomId は除く)。
// クライアントは「ロビーに戻る」をページ再読込で行うので通常は部屋を1つしか持たないが、
// 待機中に別モードのボタンを押すと待機枠の部屋に接続が残ったまま次の部屋に入り、
// 後からクイックマッチした人がその幽霊とマッチして相手が何もしない状態になる。新しい対戦を始める前に必ず呼ぶ
// ==== 募集の保持(recruit hold) — 2026-10-05 ====
// 掲示板に募集を出した人が、CPU戦・クエストなどを遊びながら待てるようにする。
//  - 募集主のクライアントが recruitHold を送ると、その待機部屋に hold が付く(送ってこない古いクライアントは従来どおり=部屋を離れると募集が消える)
//  - hold 付きの待機部屋は、募集主が席を外しても(1人用の対戦を始めても・ロビーへ戻る再読込でも)消さない
//  - 誰かが参加したら: 参加者を席1に座らせ、募集主に recruitCall を送る → 募集主のクライアントが今の対戦を抜けて joinRoom し直す → 2人揃って開始
//  - 募集主が RECRUIT_CALL_MS 以内に来なければ、参加者を解放して募集を閉じる
//  - 募集主がクイックマッチ・別の部屋の作成/参加を始めたら、hold は終わり(募集を閉じる)
const RECRUIT_HOLD_TTL_MS = +process.env.RECRUIT_HOLD_TTL_MS || 30 * 60 * 1000; // 掲示板の募集の寿命と同じ
const RECRUIT_CALL_MS = +process.env.RECRUIT_CALL_MS || 20000;
const HOLD_LOST_GRACE_MS = +process.env.HOLD_LOST_GRACE_MS || 45000;             // 募集主の接続が切れてから(再読込など)待つ時間
const QUICK_LOST_MS = +process.env.QUICK_LOST_MS || 8000;                        // クイックマッチの待機: 待っている人の接続が切れてからこれを過ぎたら、いない扱い(アプリを閉じた人に次の人を待たせない。再読込は数秒で戻る)
function holdOf(room) { return (room && room.hold && room.state === 'waiting') ? room.hold : null; }
function holdAlive(room) {
  const h = holdOf(room); if (!h) return false; const now = Date.now();
  if (now - h.createdAt > RECRUIT_HOLD_TTL_MS) return false;
  if ((!h.socket || h.socket.connected === false) && h.lostAt && now - h.lostAt > HOLD_LOST_GRACE_MS) return false;
  return true;
}
// hold を終わらせて部屋を閉じる。待たされていた参加者がいれば解放する
function dropHold(roomId, reason) {
  const room = rooms.get(roomId); if (!room || !room.hold) return false;
  const h = room.hold; if (h.callTimer) { clearTimeout(h.callTimer); h.callTimer = null; }
  room.hold = null;
  if (quickMatchWaiting === roomId && room.state === 'waiting') quickMatchWaiting = null; // クイックマッチの待機だった場合は待機枠も空ける
  if (room.state !== 'waiting') return false; // もう対戦が始まっている(印だけ外す)
  for (const s of room.sockets) {
    if (!s || s === room._aiSocket) continue;
    try { s.leave(roomId); } catch (e) {}
    if (s.roomId === roomId) { s.roomId = null; s.seat = undefined; }
    if (s === h.socket) continue;
    try { s.emit('recruitCallFailed', { roomId, reason, quick: !!h.quick }); s.emit('error', { msg: h.quick ? '相手が戻らなかったため、もう一度相手を探します' : '相手が戻らなかったため、この募集は取り消されました' }); } catch (e) {}
  }
  if (h.socket && h.socket.connected !== false) { try { h.socket.emit('recruitHoldEnded', { roomId, reason, quick: !!h.quick }); } catch (e) {} }
  rooms.delete(roomId);
  try { io.emit('lobbyRooms', {}); } catch (e) {}
  console.log('[hold] 終了 room=' + roomId + ' reason=' + reason);
  return true;
}
// 呼び出し待ちの参加者が抜けた: 呼び出しをやめて、また待機中に戻す。
// クイックマッチの待機だった場合は待機枠に戻す(呼び出し中は待機枠から外してある)。その間に別の人が待機枠に入っていたら、この待機は閉じる
function releaseCalling(rid, room) {
  const h = room && room.hold; if (!h) return;
  if (h.callTimer) { clearTimeout(h.callTimer); h.callTimer = null; }
  h.calling = false; h.accepted = false;
  if (h.quick) {
    if (!quickMatchWaiting || !rooms.has(quickMatchWaiting)) quickMatchWaiting = rid;
    else if (quickMatchWaiting !== rid) { dropHold(rid, 'superseded'); return; }
  }
  try { io.emit('lobbyRooms', {}); } catch (e) {}
}
// その人(接続 または プレイヤーID)が持っている hold(席を外しているものも含む)を全部終わらせる。
// 接続だけで見ると、同じアカウントの別の接続(再読込の前後・2つ目のタブ)が出した募集が残り、対人戦の最中に呼び戻されてしまう(Codex 指摘)
function dropHoldsOf(socket, exceptRoomId, reason, pid) {
  for (const [rid, room] of Array.from(rooms)) {
    if (rid === exceptRoomId || !room.hold) continue;
    if (room.hold.socket === socket || (pid && room.hold.pid === pid)) dropHold(rid, reason);
  }
}
// その接続が今いる部屋が「対人戦の最中」か(1人用=CPU戦・クエスト・ボスラッシュ・パズル・チュートリアルは false)
function inLivePvp(socket) {
  const r = socket && socket.roomId && rooms.get(socket.roomId);
  return !!(r && r.state === 'playing' && !r._aiSocket && !r.isAI && !r.isTutorial && !r.questId);
}

// opts.dropHold: この接続が出している募集(hold)も閉じる(クイックマッチ・別の部屋の作成/参加の時)。
// 既定は「hold は残す」(1人用の対戦を始める・対戦を抜ける・接続が切れる時)
function detachSocketFromRooms(socket, exceptRoomId, opts) {
  const drop = !!(opts && opts.dropHold);
  if (drop) dropHoldsOf(socket, exceptRoomId, 'owner-moved', opts.pid);
  for (let [rid, room] of rooms) {
    if (rid === exceptRoomId) continue;
    let seat = room.sockets.indexOf(socket);
    if (seat < 0) continue;
    const h = holdOf(room);
    if (h) {
      // hold 付きの待機部屋: 席だけ空けて部屋は残す
      room.sockets[seat] = null;
      try { socket.leave(rid); } catch (e) {}
      if (socket.roomId === rid) { socket.roomId = null; socket.seat = undefined; }
      if (h.socket !== socket) releaseCalling(rid, room); // 呼び出し待ちの参加者が抜けた: 席を空けて、また待機中に戻す
      continue;
    }
    if (room.state === 'playing') {
      room.leave(socket, seat); // 対戦中なら相手の勝ち扱い(opponentLeft)
    } else {
      room.sockets[seat] = null;
      if (room._clearTurnTimer) room._clearTurnTimer();
    }
    if (noHumansLeft(room)) {
      stopRoomAi(room); // 終わった部屋(結果画面など)から最後の人が抜けた時も、CPU役を止める
      rooms.delete(rid);
      if (quickMatchWaiting === rid) quickMatchWaiting = null;
    }
  }
  if (socket.roomId && !rooms.has(socket.roomId)) { socket.roomId = null; socket.seat = undefined; }
}

// そのIDの解除済みカード(Set)を読み込む。読み込めなかった時は「未解除」とは扱わず、やり直しを促して false を返す
// 対戦の開始・退出・復帰のたびに進める番号。解除情報の読み込みを待っている間に、同じ接続が別の操作(別モードの開始・退出・復帰)を
// した場合、待っていた古い開始要求は捨てる(捨てないと、後から始めた対戦の部屋を古い要求が消してしまう)
function beginStart(socket) { socket._startSeq = (socket._startSeq || 0) + 1; socket._quickPending = false; return socket._startSeq; }

async function unlocksFor(socket, playerId, seq) {
  try {
    const set = await Unlocks.load(playerId, socket.deviceKey); // ゲストは「クリアした端末」からの接続でだけ使える
    if (!socket.connected) return false; // 待っている間に切断した
    if (seq !== socket._startSeq) return false; // 待っている間に別の操作をした(この開始要求は古い)
    return set;
  } catch (e) {
    console.error('unlock load error:', e.message);
    const msg = 'カードの解除情報を読み込めませんでした。少し待ってもう一度お試しください';
    socket.emit('deckRejected', { reason: msg });
    socket.emit('error', { msg });
    return false;
  }
}

// 公開前(先行テスト中)に、新カード入りのデッキか
function previewDeck(deck) { return !Release.isReleased() && process.env.UNLOCK_ALL_CARDS !== '1' && DeckValidation.hasQuestCards(deck); }

// 非公開に切り替えた時: 新カード入りのデッキで「待機中」の部屋を取り消す(そのままにすると、非公開にした後でも他の人とマッチしてしまう)。
// 先行テストの人の部屋は残し、先行テストの人だけが入れる部屋にする。進行中の対戦は止めない(その対戦が終わるまで)
function closeWaitingNewCardRooms() {
  let closed = 0;
  for (const [rid, room] of Array.from(rooms)) {
    if (room.state !== 'waiting') continue;
    // 募集(hold)付きの部屋: 募集主が席を外していても、募集主のデッキ(席0に残っている)と、呼び出し待ちの参加者のデッキを見る。
    // 閉じる時は dropHold(呼び出しのタイマー解除・席を外した募集主への通知・待たされている参加者の解放)を通す
    if (room.hold) {
      const hasNew = [0, 1].some(i => DeckValidation.hasQuestCards(room.deckDefs && room.deckDefs[i]));
      if (!hasNew) continue;
      const ownerOk = Release.visibleTo(room.hold.pid), joinerOk = !room.sockets[1] || Release.visibleTo(room.playerIds && room.playerIds[1]);
      if (ownerOk && joinerOk && !room.hold.quick && rid !== quickMatchWaiting) { room.previewOnly = true; continue; } // クイックマッチの待機は、先行テストの人のものでも閉じる(一般の人と当たるため)
      const hs = room.hold.socket;
      if (dropHold(rid, 'unreleased')) { closed++; if (hs && hs.connected !== false) { try { hs.emit('error', { msg: '公開が止まったカードがデッキに入っているため、募集を取り消しました' }); hs.emit('recruitCancelled', { roomId: rid }); } catch (e) {} } }
      continue;
    }
    const occ = room.sockets[0] ? 0 : (room.sockets[1] ? 1 : -1);
    if (occ < 0 || !DeckValidation.hasQuestCards(room.deckDefs && room.deckDefs[occ])) continue;
    // 先行テストの人が自分で作った部屋は残し、先行テストの人だけが入れる部屋にする。
    // クイックマッチの待機室は、先行テストの人のものでも取り消す(残すと、次にクイックマッチを押した一般の人と当たる)
    if (rid !== quickMatchWaiting && Release.visibleTo(room.playerIds && room.playerIds[occ])) { room.previewOnly = true; continue; }
    const sock = room.sockets[occ];
    rooms.delete(rid); if (quickMatchWaiting === rid) quickMatchWaiting = null;
    if (sock) { beginStart(sock); /* 読み込み待ちの開始要求と、クイックマッチの読み込み待ちの印も捨てる */ try { sock.leave(rid); } catch (e) {} sock.roomId = null; sock.seat = undefined;
      sock.emit('error', { msg: '公開が止まったカードがデッキに入っているため、待機を取り消しました' }); sock.emit('matchCancelled', {}); sock.emit('recruitCancelled', { roomId: rid }); }
    closed++;
  }
  if (closed > 0) { try { io.emit('lobbyRooms', {}); } catch (e) {} }
  return closed;
}

// 強制更新: 最低版より古いアプリは対戦を始められない。古いクライアントは error を画面に出すので、それで案内する
function appBlocked(socket) {
  if (!AppGate.blocked(socket)) return false;
  socket.emit('updateRequired', { minClientV: AppGate.get(), store: AppGate.STORE });
  socket.emit('error', { msg: AppGate.MESSAGE });
  return true;
}

io.on('connection', (socket) => {
  console.log('接続:', socket.id);
  // クライアントからの入力1つで例外が出ても、サーバー全体(=進行中の全対戦)を落とさない。
  // 以前は、名前に文字列以外を入れた開始要求1つでプロセスが終了していた(async にする前からの欠陥)
  { const _on = socket.on.bind(socket);
    socket.on = (ev, fn) => _on(ev, (...args) => {
      try { const r = fn(...args); if (r && typeof r.catch === 'function') r.catch(err => console.error('[socket] ' + ev + ' error:', (err && err.stack) || err)); }
      catch (err) { console.error('[socket] ' + ev + ' error:', (err && err.stack) || err); }
    }); }

  socket.on('quickMatch', async (data) => {
    if (appBlocked(socket)) return;
    let name = typeof data === 'string' ? data : (data && data.name);
    let deck = typeof data === 'object' && data ? data.deck : undefined;
    let playerId = Auth.trustedPid(socket, typeof data === 'object' && data ? data.playerId : undefined);
    name = Auth.guestSafeName(name, playerId);
    // 自分がもう待機枠にいるなら、二度押し = 解除。デッキの検証や解除情報の読み込みより先に処理する
    // (読み込みを待っている間にもう一度押されると、解除の通知だけ届いて待機枠が残り、他の人とマッチしてしまう)
    // 期限切れの待機(席を外したまま戻らなかった)は先に片付ける
    if (quickMatchWaiting && rooms.has(quickMatchWaiting) && holdOf(rooms.get(quickMatchWaiting))) {
      const qr = rooms.get(quickMatchWaiting), qh0 = qr.hold;
      const gone = (!qh0.socket || qh0.socket.connected === false) && qh0.lostAt && Date.now() - qh0.lostAt > QUICK_LOST_MS;
      if (!holdAlive(qr) || gone) dropHold(quickMatchWaiting, 'expired');
    }
    if (quickMatchWaiting && rooms.has(quickMatchWaiting)) {
      const wr = rooms.get(quickMatchWaiting);
      if (wr.sockets[0] === socket && wr.state === 'waiting') {
        beginStart(socket);
        try { socket.leave(quickMatchWaiting); } catch (e) {}
        rooms.delete(quickMatchWaiting); quickMatchWaiting = null;
        socket.roomId = null; socket.seat = undefined;
        socket.emit('error', { msg: 'クイックマッチを解除しました' });
        socket.emit('matchCancelled', {});
        return;
      }
    }
    // 席を外して(CPU戦などをしながら)クイックマッチを待っている本人が、もう一度押した = 解除
    for (const [qrid, qroom] of Array.from(rooms)) {
      const qh = holdOf(qroom);
      if (!qh || !qh.quick || !playerId || qh.pid !== playerId) continue;
      if (qh.deviceKey && qh.deviceKey !== socket.deviceKey) continue;
      beginStart(socket);
      dropHold(qrid, 'cancelled');
      socket.emit('error', { msg: 'クイックマッチを解除しました' });
      socket.emit('matchCancelled', {});
      return;
    }
    if (deck === undefined || deck === null) deck = Lobby.starterDeckDef(Lobby.starterDeckSync()); // 初期デッキ(60枚)
    // 解除情報の読み込みを待っている間の二度押し = マッチングの解除(待機枠に入る前でも、入った後と同じ結果にする)
    if (socket._quickPending) {
      socket._quickPending = false;
      beginStart(socket); // 待っている1回目を捨てる
      socket.emit('error', { msg: 'クイックマッチを解除しました' });
      socket.emit('matchCancelled', {});
      return;
    }
    // クエスト報酬カードが入っている時だけ解除情報を読み込む(入っていなければ待ちは発生せず、従来どおり同期で進む)
    const _seq = beginStart(socket);
    let unlocked = null;
    if (DeckValidation.needsUnlockCheck(deck, playerId)) {
      socket._quickPending = true;
      unlocked = await unlocksFor(socket, playerId, _seq);
      if (_seq === socket._startSeq) socket._quickPending = false; // 自分がまだ最新の要求の時だけ下ろす
    }
    if (unlocked === false) return;
    { const v = DeckValidation.validateDeck(playerId, deck, unlocked);
      if (!v.ok) {
        socket.emit('deckRejected', { reason: v.reason || 'invalid deck', cards: v.cards || [] });
        socket.emit('error', { msg: v.reason || 'デッキが不正です' }); // 旧クライアント(1.2以前)向けの表示
        return; } }
    if (!Release.isReleased() && DeckValidation.hasQuestCards(deck) && process.env.UNLOCK_ALL_CARDS !== '1') {
      // 先行テスト中: 公開前のカードは、クイックマッチ(知らない人との対戦)では使えない。CPU戦・クエスト・友だち対戦で試す
      const msg = '公開前のカードは、クイックマッチでは使えません（CPU戦・クエスト・友だちと対戦で試してください）';
      socket.emit('deckRejected', { reason: msg }); socket.emit('error', { msg });
      return;
    }
    db.upsertUser(playerId, name).catch(e => console.error('db upsert error:', e.message));
    if (quickMatchWaiting && rooms.has(quickMatchWaiting)) {
      // 待っている相手のデッキが「公開前の新カード入り」なら、その待機は取り消す(合流する側でも確かめる。公開が止まった直後などの取りこぼし防止)
      const wroom = rooms.get(quickMatchWaiting);
      if (wroom.sockets[0] !== socket && previewDeck(wroom.deckDefs && wroom.deckDefs[0])) closeWaitingNewCardRooms();
    }
    // 同じ接続の二度押し = マッチングの解除(待機枠を消す)。旧クライアント向けには error で文言を出し、新クライアントには matchCancelled
    if (quickMatchWaiting && rooms.has(quickMatchWaiting)) {
      let room = rooms.get(quickMatchWaiting);
      if (room.sockets[0] === socket) {
        if (room.state !== 'waiting') { quickMatchWaiting = null; return; } // すでに対戦が始まっている(joinRoom等で合流済み)なら何もしない
        try { socket.leave(quickMatchWaiting); } catch (e) {}
        rooms.delete(quickMatchWaiting); quickMatchWaiting = null;
        socket.roomId = null; socket.seat = undefined;
        socket.emit('error', { msg: 'クイックマッチを解除しました' });
        socket.emit('matchCancelled', {});
        return;
      }
    }
    // ここで一度だけ、今いる部屋(待機枠・CPU戦・呼び出し待ちの席など)を全部抜け、自分が出していた待機/募集(hold)も閉じる。
    // 抜けた結果で待機枠(quickMatchWaiting)が変わることがある(呼び出し待ちから抜けると、呼ばれていた人の待機が待機枠に戻る)ので、
    // 合流先は「抜けた後」の待機枠で決める。以前は分岐ごとに抜けていたため、抜ける前の状態で合流先を決めてしまい、
    // 同じ接続が2つの部屋に残る・戻した待機を新しい部屋で上書きして誰ともマッチしなくなる、が起きた(Codex 指摘)
    detachSocketFromRooms(socket, undefined, { dropHold: true, pid: playerId });
    if (quickMatchWaiting && !rooms.has(quickMatchWaiting)) quickMatchWaiting = null;
    if (quickMatchWaiting) {
      let room = rooms.get(quickMatchWaiting); const qid = quickMatchWaiting; const qh = holdOf(room);
      if (room.state !== 'waiting' || (qh && qh.calling)) {
        // 待機枠が、もう始まった部屋・呼び出し中の部屋を指していた(本来は指さない): 外して、下で新しく待つ
        quickMatchWaiting = null;
      } else if (playerId && room.playerIds && room.playerIds[0] === playerId && (!qh || room.sockets[0])) {
        // 同じプレイヤーIDの別接続(アプリを閉じた直後の古い接続、別端末の同一アカウント)が待機枠にいる:
        // 古い方を捨てて、この接続で待ち直す。以前は「waitingだけ返して部屋に入れない」だったため、
        // 古い接続が消えた後に本人がどの部屋にもいない永久待機になっていた
        let old = room.sockets[0];
        if (old && old !== socket) { try { old.leave(qid); } catch (e) {} old.roomId = null; old.seat = undefined; }
        if (room.hold) dropHold(qid, 'replaced'); else { stopRoomAi(room); rooms.delete(qid); quickMatchWaiting = null; }
        // ↓ 新しいルーム作成へ
      } else if (qh && room.sockets.indexOf(qh.socket) < 0) {
        // 待っている相手が席を外している(CPU戦などをしながら待っている): この人を席1で待たせて、相手を呼び戻す(掲示板の募集と同じ流れ)
        let seatJ = room.join(socket, name, deck, playerId, 1);
        if (seatJ >= 0) {
          socket.join(qid);
          qh.calling = true; qh.accepted = false;
          if (qh.callTimer) clearTimeout(qh.callTimer);
          const ownerOnline = !!(qh.socket && qh.socket.connected !== false);
          qh.callTimer = setTimeout(() => { qh.callTimer = null; dropHold(qid, 'no-show'); }, ownerOnline ? RECRUIT_CALL_MS : Math.min(RECRUIT_CALL_MS, 10000)); // 待っている人の接続が今切れているなら、長くは待たせない
          quickMatchWaiting = null; // 呼び出している間は、次に押した人をこの部屋へ合流させない(次の人は新しく待つ)
          socket.emit('joined', { roomId: qid, seat: seatJ, names: [qh.name || null, room.names[1]] });
          socket.emit('recruitCalling', { roomId: qid, name: qh.name || '', waitMs: RECRUIT_CALL_MS, quick: true });
          if (ownerOnline) qh.socket.emit('recruitCall', { roomId: qid, name: name || '', quick: true });
          console.log('[hold] クイックマッチ: 相手が見つかった → 待っている人を呼び出し room=' + qid);
          return;
        }
        quickMatchWaiting = null; // 座れなかった(想定外): この待機は閉じて、下で新しく待つ
        dropHold(qid, 'superseded');
      } else {
        let seat = room.join(socket, name, deck, playerId);
        if (seat >= 0) {
          socket.join(qid);
          socket.emit('joined', { roomId: qid, seat, names: room.names });
          // 相手にも通知
          let other = room.sockets[1 - seat];
          if (other) other.emit('opponentJoined', { name: name || 'P' + (seat + 1) });
          if (room.hold) { const mh = room.hold; room.hold = null; if (mh.socket && mh.socket.connected !== false) { try { mh.socket.emit('recruitHoldEnded', { roomId: qid, reason: 'matched', quick: true }); } catch (e) {} } } // 座って待っていた: 待機の印を消す
          quickMatchWaiting = null;
          return;
        }
        // 満席など(想定外): この待機枠は外して、下で新しく待つ
        if (room.hold) dropHold(qid, 'superseded'); else quickMatchWaiting = null;
      }
    }
    // 新しいルーム作成
    let roomId = generateRoomId();
    let room = new GameRoom(roomId);
    rooms.set(roomId, room);
    let seat = room.join(socket, name, deck, playerId);
    socket.join(roomId);
    socket.emit('waiting', { roomId, kind: 'quick', seat, names: room.names }); // 待つ側は joined が来ないので、席と名前をここで渡す(対戦中の名前表示用)
    if (quickMatchWaiting && quickMatchWaiting !== roomId && rooms.has(quickMatchWaiting)) { const prevQ = quickMatchWaiting; if (rooms.get(prevQ).hold) dropHold(prevQ, 'superseded'); } // 前の待機を無通知で置き去りにしない(通常はここに来ない)
    quickMatchWaiting = roomId;
    // 新しいクライアント(hold: true を送ってくる)は、CPU戦などをしながら待てる: この待機を「席を外しても残す」。相手が見つかったら呼び戻す
    if (typeof data === 'object' && data && data.hold === true && playerId) {
      room.hold = { pid: playerId, deviceKey: socket.deviceKey || null, socket, name: room.names[seat], createdAt: Date.now(), lostAt: 0, calling: false, accepted: false, callTimer: null, quick: true };
      socket.emit('recruitHolding', { roomId, quick: true });
    }
  });


  socket.on('aiMatch', async (data) => {
    if (appBlocked(socket)) return;
    let name = typeof data === 'string' ? data : (data && data.name);
    let deck = typeof data === 'object' && data ? data.deck : undefined;
    let playerId = Auth.trustedPid(socket, data && data.playerId);
    name = Auth.guestSafeName(name, playerId);
    // クエスト報酬カードが入っている時だけ解除情報を読み込む(入っていなければ待ちは発生せず、従来どおり同期で進む)
    if (deck === undefined || deck === null) deck = Lobby.starterDeckDef(Lobby.starterDeckSync()); // デッキ未指定＝一度も編集していない人。98枚の全カードではなく初期デッキ(60枚)で戦う
    const _seq = beginStart(socket);
    const unlocked = DeckValidation.needsUnlockCheck(deck, playerId) ? await unlocksFor(socket, playerId, _seq) : null;
    if (unlocked === false) return;
    { const v = DeckValidation.validateDeck(playerId, deck, unlocked);
      if (!v.ok) {
        socket.emit('deckRejected', { reason: v.reason || 'invalid deck', cards: v.cards || [] });
        socket.emit('error', { msg: v.reason || 'デッキが不正です' }); // 旧クライアント(1.2以前)向けの表示
        return; } }
    db.upsertUser(playerId, name).catch(e => console.error('db upsert error:', e.message));
    let roomId = generateRoomId();
    let room = new GameRoom(roomId);
    rooms.set(roomId, room);
    detachSocketFromRooms(socket); // 検証が全部通ってから前の部屋(待機枠・CPU戦など)を抜ける(失敗時に今の対戦を壊さない)
    let seat = room.join(socket, name, deck, playerId);
    socket.join(roomId);
    room.joinAI(AI_DECK);
    socket.emit('joined', { roomId, seat, names: room.names });
  });

  socket.on('tutorialMatch', () => {
    if (appBlocked(socket)) return;
    beginStart(socket);
    let roomId = 'tutorial_' + generateRoomId();
    let room = new GameRoom(roomId);
    rooms.set(roomId, room);
    detachSocketFromRooms(socket); // 検証が全部通ってから前の部屋(待機枠・CPU戦など)を抜ける(失敗時に今の対戦を壊さない)
    let seat = room.join(socket, 'あなた');
    socket.join(roomId);
    room.joinAI(null, true);
    socket.emit('joined', { roomId, seat, names: ['あなた', '相手'], isTutorial: true });
  });


  socket.on('questMatch', async (data) => {
    if (appBlocked(socket)) return;
    let name = data && data.name;
    let deck = data && data.deck;
    let playerId = Auth.trustedPid(socket, data && data.playerId);
    name = Auth.guestSafeName(name, playerId);
    // クエスト報酬カードが入っている時だけ解除情報を読み込む(入っていなければ待ちは発生せず、従来どおり同期で進む)
    if (deck === undefined || deck === null) deck = Lobby.starterDeckDef(Lobby.starterDeckSync()); // デッキ未指定＝一度も編集していない人。98枚の全カードではなく初期デッキ(60枚)で戦う
    const _seq = beginStart(socket);
    const unlocked = DeckValidation.needsUnlockCheck(deck, playerId) ? await unlocksFor(socket, playerId, _seq) : null;
    if (unlocked === false) return;
    { const v = DeckValidation.validateDeck(playerId, deck, unlocked);
      if (!v.ok) {
        socket.emit('deckRejected', { reason: v.reason || 'invalid deck', cards: v.cards || [] });
        socket.emit('error', { msg: v.reason || 'デッキが不正です' }); // 旧クライアント(1.2以前)向けの表示
        return; } }
    db.upsertUser(playerId, name).catch(e => console.error('db upsert error:', e.message));
    let questId = data && data.questId;
    { const qd = QUESTS.find(x => x.id === questId);
      if (qd && qd.reward && !Release.visibleTo(playerId)) { socket.emit('error', { msg: 'このクエストはまだ公開されていません' }); return; } }
    let roomId = 'quest_' + generateRoomId();
    let room = new GameRoom(roomId);
    rooms.set(roomId, room);
    detachSocketFromRooms(socket); // 検証が全部通ってから前の部屋(待機枠・CPU戦など)を抜ける(失敗時に今の対戦を壊さない)
    let seat = room.join(socket, name, deck, playerId);
    socket.join(roomId);
    room.joinAI(AI_DECK, false, questId);
    socket.emit('joined', { roomId, seat, names: [name || 'あなた', 'CPU'], isQuest: true });
  });

  socket.on('bossRush', async (data) => {
    if (appBlocked(socket)) return;
    let name = data && data.name;
    let deck = data && data.deck;
    let playerId = Auth.trustedPid(socket, data && data.playerId);
    name = Auth.guestSafeName(name, playerId);
    // クエスト報酬カードが入っている時だけ解除情報を読み込む(入っていなければ待ちは発生せず、従来どおり同期で進む)
    if (deck === undefined || deck === null) deck = Lobby.starterDeckDef(Lobby.starterDeckSync()); // デッキ未指定＝一度も編集していない人。98枚の全カードではなく初期デッキ(60枚)で戦う
    const _seq = beginStart(socket);
    const unlocked = DeckValidation.needsUnlockCheck(deck, playerId) ? await unlocksFor(socket, playerId, _seq) : null;
    if (unlocked === false) return;
    { const v = DeckValidation.validateDeck(playerId, deck, unlocked);
      if (!v.ok) {
        socket.emit('deckRejected', { reason: v.reason || 'invalid deck', cards: v.cards || [] });
        socket.emit('error', { msg: v.reason || 'デッキが不正です' }); // 旧クライアント(1.2以前)向けの表示
        return; } }
    db.upsertUser(playerId, name).catch(e => console.error('db upsert error:', e.message));
    let roomId = 'boss_' + generateRoomId();
    let room = new GameRoom(roomId);
    room.isBossRush = true;
    room.bossRushStage = 0;
    room.bossRushCourseId = data && data.courseId || 'boss_normal';
    rooms.set(roomId, room);
    detachSocketFromRooms(socket); // 検証が全部通ってから前の部屋(待機枠・CPU戦など)を抜ける(失敗時に今の対戦を壊さない)
    let seat = room.join(socket, name, deck, playerId);
    socket.join(roomId);
    room.joinAI(AI_DECK);
    socket.emit('joined', { roomId, seat, names: [name || 'あなた', 'BOSS'], isBossRush: true });
  });

  socket.on('endlessBoss', async (data) => {
    if (appBlocked(socket)) return;
    let name = data && data.name;
    let deck = data && data.deck;
    let playerId = Auth.trustedPid(socket, data && data.playerId);
    name = Auth.guestSafeName(name, playerId);
    // クエスト報酬カードが入っている時だけ解除情報を読み込む(入っていなければ待ちは発生せず、従来どおり同期で進む)
    if (deck === undefined || deck === null) deck = Lobby.starterDeckDef(Lobby.starterDeckSync()); // デッキ未指定＝一度も編集していない人。98枚の全カードではなく初期デッキ(60枚)で戦う
    const _seq = beginStart(socket);
    const unlocked = DeckValidation.needsUnlockCheck(deck, playerId) ? await unlocksFor(socket, playerId, _seq) : null;
    if (unlocked === false) return;
    { const v = DeckValidation.validateDeck(playerId, deck, unlocked);
      if (!v.ok) {
        socket.emit('deckRejected', { reason: v.reason || 'invalid deck', cards: v.cards || [] });
        socket.emit('error', { msg: v.reason || 'デッキが不正です' }); // 旧クライアント(1.2以前)向けの表示
        return; } }
    db.upsertUser(playerId, name).catch(e => console.error('db upsert error:', e.message));
    let roomId = 'endless_' + generateRoomId();
    let room = new GameRoom(roomId);
    room.isBossRush = true;
    room.isEndless = true;
    room.bossRushStage = 0;
    rooms.set(roomId, room);
    detachSocketFromRooms(socket); // 検証が全部通ってから前の部屋(待機枠・CPU戦など)を抜ける(失敗時に今の対戦を壊さない)
    let seat = room.join(socket, name, deck, playerId);
    socket.join(roomId);
    room.joinAI(AI_DECK);
    socket.emit('joined', { roomId, seat, names: [name || 'あなた', 'BOSS'], isBossRush: true, isEndless: true });
  });

  socket.on('puzzleMatch', (data) => {
    if (appBlocked(socket)) return;
    beginStart(socket);
    let name = data && data.name; if (typeof name !== 'string') name = '';
    let puzzleId = data && data.puzzleId;
    let roomId = 'puzzle_' + generateRoomId();
    let room = new GameRoom(roomId);
    room.puzzleId = puzzleId;
    rooms.set(roomId, room);
    detachSocketFromRooms(socket); // 検証が全部通ってから前の部屋(待機枠・CPU戦など)を抜ける(失敗時に今の対戦を壊さない)
    let seat = room.join(socket, name);
    socket.join(roomId);
    room.joinAI(null);
    socket.emit('joined', { roomId, seat, names: [name || 'あなた', ''], isPuzzle: true });
  });

  socket.on('createRoom', async (data) => {
    if (appBlocked(socket)) return;
    let name = typeof data === 'string' ? data : (data && data.name);
    let deck = typeof data === 'object' && data ? data.deck : undefined;
    let playerId = Auth.trustedPid(socket, typeof data === 'object' && data ? data.playerId : undefined);
    name = Auth.guestSafeName(name, playerId);
    // クエスト報酬カードが入っている時だけ解除情報を読み込む(入っていなければ待ちは発生せず、従来どおり同期で進む)
    if (deck === undefined || deck === null) deck = Lobby.starterDeckDef(Lobby.starterDeckSync()); // デッキ未指定＝一度も編集していない人。98枚の全カードではなく初期デッキ(60枚)で戦う
    const _seq = beginStart(socket);
    const unlocked = DeckValidation.needsUnlockCheck(deck, playerId) ? await unlocksFor(socket, playerId, _seq) : null;
    if (unlocked === false) return;
    { const v = DeckValidation.validateDeck(playerId, deck, unlocked);
      if (!v.ok) {
        socket.emit('deckRejected', { reason: v.reason || 'invalid deck', cards: v.cards || [] });
        socket.emit('error', { msg: v.reason || 'デッキが不正です' }); // 旧クライアント(1.2以前)向けの表示
        return; } }
    db.upsertUser(playerId, name).catch(e => console.error('db upsert error:', e.message));
    let roomId = generateRoomId();
    let room = new GameRoom(roomId);
    room.previewOnly = previewDeck(deck); // 公開前の新カード入りのデッキで作った部屋は、先行テストの人だけが入れる(募集に出しても、一般の人は入れない)
    rooms.set(roomId, room);
    detachSocketFromRooms(socket, undefined, { dropHold: true, pid: playerId }); // 新しく部屋を作る時は、前に出していた募集(hold)も閉じる // 検証が全部通ってから前の部屋(待機枠・CPU戦など)を抜ける(失敗時に今の対戦を壊さない)
    let seat = room.join(socket, name, deck, playerId);
    socket.join(roomId);
    socket.emit('waiting', { roomId, seat, names: room.names });
  });

  socket.on('joinRoom', async (data) => {
    if (appBlocked(socket)) return;
    let roomId = typeof data === 'string' ? data : (data && data.roomId);
    let name = typeof data === 'object' && data ? data.name : undefined;
    let deck = typeof data === 'object' && data ? data.deck : undefined;
    let playerId = Auth.trustedPid(socket, typeof data === 'object' && data ? data.playerId : undefined);
    name = Auth.guestSafeName(name, playerId);
    // クエスト報酬カードが入っている時だけ解除情報を読み込む(入っていなければ待ちは発生せず、従来どおり同期で進む)
    if (deck === undefined || deck === null) deck = Lobby.starterDeckDef(Lobby.starterDeckSync()); // デッキ未指定＝一度も編集していない人。98枚の全カードではなく初期デッキ(60枚)で戦う
    const _seq = beginStart(socket);
    const unlocked = DeckValidation.needsUnlockCheck(deck, playerId) ? await unlocksFor(socket, playerId, _seq) : null;
    if (unlocked === false) return;
    { const v = DeckValidation.validateDeck(playerId, deck, unlocked);
      if (!v.ok) {
        socket.emit('deckRejected', { reason: v.reason || 'invalid deck', cards: v.cards || [] });
        socket.emit('error', { msg: v.reason || 'デッキが不正です' }); // 旧クライアント(1.2以前)向けの表示
        return; } }
    db.upsertUser(playerId, name).catch(e => console.error('db upsert error:', e.message));
    let room = rooms.get(roomId);
    // 募集主が戻らないまま期限が過ぎた hold は、ここで閉じる(掃除は60秒おきなので、その前に来た参加者を待たせない)
    if (room && holdOf(room) && !holdAlive(room)) { dropHold(roomId, 'expired'); room = null; }
    if (!room) { socket.emit('error', { msg: 'ルームが見つかりません' }); return; }
    // 自分が作った待機中の部屋に入ろうとした: そのまま待機を続ける(自分自身と対戦させない)
    if (room.sockets.indexOf(socket) >= 0) { socket.emit('waiting', { roomId }); return; }
    if (room.sockets[0] && room.sockets[1]) { socket.emit('error', { msg: '満席です' }); return; }
    // 自分(同じアカウント)が別の接続で座って待っている部屋には、参加者として入れない(自分自身との対戦になり、勝ちと負けが両方付く)
    { const os = room.sockets[0] ? 0 : (room.sockets[1] ? 1 : -1);
      if (playerId && os >= 0 && room.sockets[os] !== room._aiSocket && room.playerIds && room.playerIds[os] === playerId) { socket.emit('error', { msg: '自分の部屋には参加できません' }); return; } }
    // hold 付きの部屋(募集主が席を外して待っている募集)
    const hold = holdOf(room);
    const isHoldOwner = !!(hold && playerId && hold.pid === playerId && (!hold.deviceKey || hold.deviceKey === socket.deviceKey));
    const ownerAway = !!(hold && room.sockets.indexOf(hold.socket) < 0);
    // 同じアカウントの別の端末から自分の募集に入ろうとした: 断る(下の「出していた募集を閉じる」処理が、入ろうとしている部屋そのものを消してしまう)
    if (hold && playerId && hold.pid === playerId && !isHoldOwner) { socket.emit('error', { msg: '自分の募集には参加できません' }); return; }
    // 募集主を呼び出している間(参加者が席1で待っている間)は、募集主以外は入れない(席0は募集主のもの)
    if (hold && ownerAway && !isHoldOwner && room.sockets[1]) { socket.emit('error', { msg: '満席です' }); return; }
    // 部屋番号で入れるのは、待機中の部屋だけ。対戦が始まった部屋の空席(切断した人の席)に、別の人が入れてしまっていた。
    // 本人が戻る時は rejoin を使う
    if (room.state !== 'waiting') { socket.emit('error', { msg: 'この部屋はもう対戦が始まっています' }); return; }
    // 公開前(先行テスト中): 新カードは「先行テストの人どうしの部屋」でだけ使える。一般の人と当たる経路(募集・クイックマッチの待機室への合流)を塞ぐ
    if (!Release.isReleased() && process.env.UNLOCK_ALL_CARDS !== '1') {
      const occ = room.sockets[0] ? 0 : 1; const occPid = (hold && !isHoldOwner) ? hold.pid : (room.playerIds && room.playerIds[occ]); // 募集主が席を外していても、相手は募集主
      if (room.previewOnly && !Release.visibleTo(playerId)) { socket.emit('error', { msg: 'この部屋には参加できません（公開前のカードのテスト用の部屋です）' }); return; }
      if (previewDeck(deck) && (quickMatchWaiting === roomId || (hold && hold.quick) || !Release.visibleTo(occPid))) { // クイックマッチの待機(呼び出し中は待機枠から外れているので hold.quick でも見る)
        const msg = '公開前のカードは、先行テストの人どうしの部屋でしか使えません';
        socket.emit('deckRejected', { reason: msg }); socket.emit('error', { msg }); return;
      }
    }
    // --- 募集主が自分の募集(hold)に戻ってきた: 席0に座る。参加者が待っていれば、そのまま開始 ---
    if (hold && isHoldOwner && ownerAway) {
      detachSocketFromRooms(socket, roomId, { dropHold: true, pid: playerId }); // 今の対戦(CPU戦など)を抜ける。この部屋の hold は残す
      const waiting2 = room.sockets[1];
      if (hold.callTimer) { clearTimeout(hold.callTimer); hold.callTimer = null; }
      hold.socket = socket; hold.lostAt = 0; hold.calling = false; hold.accepted = false;
      if (waiting2) { room.hold = null; try { socket.emit('recruitHoldEnded', { roomId, reason: 'matched' }); } catch (e) {} } // 2人揃う → 開始。hold は役目を終える
      let seatO = room.join(socket, name, deck, playerId, 0);
      if (seatO < 0) { socket.emit('error', { msg: '満席です' }); return; }
      socket.join(roomId);
      if (waiting2 && quickMatchWaiting === roomId) quickMatchWaiting = null;
      try { io.emit('lobbyRooms', {}); } catch (e) {}
      if (waiting2) {
        socket.emit('joined', { roomId, seat: seatO, names: room.names });
        waiting2.emit('opponentJoined', { name: name || 'P1' });
        console.log('[hold] 募集主が戻って開始 room=' + roomId);
      } else {
        socket.emit('waiting', { roomId, seat: seatO, names: room.names, kind: hold.quick ? 'quick' : undefined }); // 誰も来ていない: 座って待つ状態に戻る
        socket.emit('recruitHolding', { roomId, quick: !!hold.quick });
      }
      return;
    }
    // --- 募集主が席を外している募集に、参加者が来た: 席1で待たせて、募集主を呼ぶ ---
    if (hold && ownerAway && !isHoldOwner) {
      detachSocketFromRooms(socket, roomId, { dropHold: true, pid: playerId });
      if (rooms.get(roomId) !== room || !holdOf(room)) { socket.emit('error', { msg: 'ルームが見つかりません' }); return; }
      let seatJ = room.join(socket, name, deck, playerId, 1);
      if (seatJ < 0) { socket.emit('error', { msg: '満席です' }); return; }
      socket.join(roomId);
      if (quickMatchWaiting === roomId) quickMatchWaiting = null; // クイックマッチの待機に部屋番号で入った: 呼び出し中は待機枠から外す
      hold.calling = true; hold.accepted = false;
      if (hold.callTimer) clearTimeout(hold.callTimer);
      hold.callTimer = setTimeout(() => { hold.callTimer = null; dropHold(roomId, 'no-show'); }, RECRUIT_CALL_MS);
      socket.emit('joined', { roomId, seat: seatJ, names: [hold.name || null, room.names[1]] });
      socket.emit('recruitCalling', { roomId, name: hold.name || '', waitMs: RECRUIT_CALL_MS, quick: !!hold.quick });
      if (hold.socket && hold.socket.connected !== false) hold.socket.emit('recruitCall', { roomId, name: name || '' });
      try { io.emit('lobbyRooms', {}); } catch (e) {} // 呼び出し中の募集は一覧から外す
      console.log('[hold] 参加者が来た → 募集主を呼び出し room=' + roomId);
      return;
    }
    detachSocketFromRooms(socket, roomId, { dropHold: true, pid: playerId }); // 検証が全部通ってから前の部屋を抜ける(別の部屋に入るので、出していた募集も閉じる)
    if (rooms.get(roomId) !== room) { socket.emit('error', { msg: 'ルームが見つかりません' }); return; }
    let seat = room.join(socket, name, deck, playerId);
    if (seat < 0) { socket.emit('error', { msg: '満席です' }); return; }
    if (hold) { if (hold.callTimer) clearTimeout(hold.callTimer); room.hold = null; if (hold.socket && hold.socket.connected !== false) { try { hold.socket.emit('recruitHoldEnded', { roomId, reason: 'matched' }); } catch (e) {} } } // 募集主が座って待っていた募集に参加者が来た(従来どおり即開始)
    if (quickMatchWaiting === roomId) quickMatchWaiting = null; // クイックマッチの待機室にルームIDで合流した場合も待機枠を空ける
    try { io.emit('lobbyRooms', {}); } catch (e) {} // ロビーの「参加できる募集」を更新させる(埋まった募集を消す)
    socket.join(roomId);
    socket.emit('joined', { roomId, seat, names: room.names });
    let other = room.sockets[1 - seat];
    if (other) other.emit('opponentJoined', { name: name || 'P' + (seat + 1) });
  });

  // 募集主のクライアントが recruitCall を受けて送る: 「今の対戦を抜けて、募集の部屋へ移ってよいか」をサーバーが確かめる。
  // クライアントが自分で leaveRoom すると、呼び出しが取り消された後・対人戦の最中でも抜けてしまい、敗北が付く(Codex 指摘)。
  // ここで確かめてから、サーバーが1人用の部屋だけを抜けさせ、recruitGo を返す
  socket.on('recruitAccept', (data) => {
    const rid = data && String(data.roomId || ''); const room = rooms.get(rid); const h = holdOf(room);
    const pid = Auth.trustedPid(socket, data && data.playerId);
    const mine = !!(h && pid && h.pid === pid && (!h.deviceKey || h.deviceKey === socket.deviceKey));
    if (!h || !mine || !h.calling || !room.sockets[1]) { socket.emit('recruitCallCancelled', { roomId: rid }); return; } // もう呼び出しは無い(参加者が抜けた・募集が閉じた)
    if (!holdAlive(room)) { dropHold(rid, 'expired'); socket.emit('recruitCallCancelled', { roomId: rid }); return; } // 期限切れ: 今の対戦は抜けさせない
    if (inLivePvp(socket)) { dropHold(rid, 'owner-in-pvp'); socket.emit('recruitCallCancelled', { roomId: rid }); return; } // 対人戦の最中は呼び戻さない(募集は閉じる)
    beginStart(socket);
    detachSocketFromRooms(socket, rid); // 1人用の対戦(CPU戦など)を抜ける。hold は残す
    socket.roomId = null; socket.seat = undefined;
    h.socket = socket; h.lostAt = 0; h.accepted = true;
    // 再読込して入り直すまでの時間を見込んで、待ち時間を取り直す
    if (h.callTimer) clearTimeout(h.callTimer);
    h.callTimer = setTimeout(() => { h.callTimer = null; dropHold(rid, 'no-show'); }, RECRUIT_CALL_MS);
    socket.emit('recruitGo', { roomId: rid, name: (room.names && room.names[1]) || '', quick: !!h.quick });
  });

  // 募集を出した人のクライアントが送る: この待機部屋を「席を外しても残す」募集にする(掲示板への投稿が成功した後)
  socket.on('recruitHold', (data) => {
    const rid = data && String(data.roomId || ''); const room = rooms.get(rid);
    if (!room || room.state !== 'waiting' || quickMatchWaiting === rid) return;
    if (room.sockets[0] !== socket || room.sockets[1]) return; // 自分が作って1人で待っている部屋だけ
    const pid = room.playerIds && room.playerIds[0]; if (!pid) return;
    dropHoldsOf(socket, rid, 'replaced', pid); // 募集は1人(1アカウント)1つ
    room.hold = { pid, deviceKey: socket.deviceKey || null, socket, name: room.names[0], createdAt: Date.now(), lostAt: 0, calling: false, callTimer: null };
    socket.emit('recruitHolding', { roomId: rid });
    console.log('[hold] 開始 room=' + rid);
  });

  socket.on('action', ({ type, data }) => {
    let roomId = socket.roomId;
    if (!roomId) return;
    let room = rooms.get(roomId);
    if (!room) return;
    room.handleAction(socket, type, data || {});
  });

  // 明示的に部屋を離れる(チュートリアルの「ロビーに戻る」等)。対戦中なら相手の勝ち扱い、待機/CPU戦なら部屋を消す
  socket.on('leaveRoom', (data) => {
    // roomId 付き(掲示板の募集の後始末など)は「その待機中の部屋にまだ居る時だけ」抜ける。
    // 応答待ちの間に別の対戦へ移っていた場合に、その対戦から退出(=敗北)させないため
    if (data && data.roomId) {
      const rid = String(data.roomId);
      const room = rooms.get(rid);
      if (!room || room.state !== 'waiting' || socket.roomId !== rid) return;
    }
    beginStart(socket); // ここまで来たら実際に退出する。読み込み待ちの古い開始要求は捨てる(対象外の roomId 付き退出では進めない)
    const cur = socket.roomId && rooms.get(socket.roomId);
    const wasWaiting = !!(cur && cur.state === 'waiting');
    detachSocketFromRooms(socket);
    socket.roomId = null; socket.seat = undefined;
    if (wasWaiting) { try { io.emit('lobbyRooms', {}); } catch (e) {} } // 募集一覧が変わる時だけ流す(誰でも送れるイベントなので無条件に全員へ配らない)
  });

  socket.on('rejoin', (data) => {
    if (AppGate.blocked(socket)) { socket.emit('updateRequired', { minClientV: AppGate.get(), store: AppGate.STORE }); socket.emit('rejoinFailed'); return; } // 古いアプリは対戦に戻れない。画面は更新確認(shared/app_gate.js)が再接続時にも出す
    let playerId = Auth.trustedPid(socket, data && data.playerId);
    if (!playerId) return;
    let startup = !!(data && data.startup);
    // 同じプレイヤーの対戦中の部屋が複数残っている場合は一番新しい部屋に戻す
    let best = null;
    for (let [rid, room] of rooms) {
      if (room.state !== 'playing') continue;
      let seat = -1;
      if (room.playerIds && room.playerIds[0] === playerId) seat = 0;
      else if (room.playerIds && room.playerIds[1] === playerId) seat = 1;
      if (seat < 0) continue;
      let cur = room.sockets[seat];
      let keyRoom = room.deviceKeys && room.deviceKeys[seat], keyReq = socket.deviceKey;
      let sameDevice = !!(keyRoom && keyReq && keyRoom === keyReq);
      // 別の端末からは戻れない(同じアカウントを2台で開いた時に、他方の対戦へ引き込まれるのを防ぐ)。鍵の無い旧クライアント同士は従来通り
      if (keyRoom && !sameDevice) continue; // 鍵付きの席は同じ鍵の要求だけ通す(鍵を省略した要求も拒否)
      if (startup && room.isTutorial) continue; // チュートリアルは起動時の自動復帰の対象外(「ロビーに戻る」で戻れなくなるため)
      // その席に生きている別の接続がいるなら横取りしない。ただし同じ端末の再起動(強制終了直後で古い接続がまだ切断検知されていない)なら置き換える
      if (cur && cur !== socket && cur.connected !== false && !sameDevice) continue;
      if (!best || (room.createdAt || 0) > (best.room.createdAt || 0)) best = { rid, room, seat };
    }
    // 募集(hold)を出したまま再読込した人の扱い(戻り先を決めてから):
    //  - 対人戦へ戻る → 募集は閉じる(対人戦の最中に呼び戻さない)
    //  - それ以外(戻り先なし・1人用の対戦) → 新しい接続を募集主として結び直す(同じ端末だけ)
    const backToPvp = !!(best && !best.room._aiSocket && !best.room.isAI && !best.room.isTutorial && !best.room.questId);
    if (backToPvp) { dropHoldsOf(socket, undefined, 'owner-in-pvp', playerId); }
    else {
      for (const [hrid, hroom] of Array.from(rooms)) {
        const h = holdOf(hroom); if (!h || h.pid !== playerId) continue;
        if (h.deviceKey && h.deviceKey !== socket.deviceKey) continue;
        if (!holdAlive(hroom)) { dropHold(hrid, 'expired'); continue; }
        if (h.socket === socket) continue;
        const oldS = h.socket, oldSeat = oldS ? hroom.sockets.indexOf(oldS) : -1;
        if (oldS && oldS.connected !== false && oldSeat >= 0) {
          // 元の接続がまだ座って待っている。同じ端末(鍵が一致)なら再読込の直後で、古い接続の切断がまだ検知されていないだけ → 席ごと新しい接続へ引き継ぐ
          // (引き継がないと、古い接続が切れた後も募集が古い接続を指したままになり、呼び出しが届かない)。鍵の無い募集は従来どおり触らない
          if (!h.deviceKey) continue;
          hroom.sockets[oldSeat] = socket; socket.roomId = hrid; socket.seat = oldSeat; try { socket.join(hrid); } catch (e) {}
          oldS.roomId = null; oldS.seat = undefined; try { oldS.leave(hrid); oldS.disconnect(true); } catch (e) {}
          h.socket = socket; h.lostAt = 0;
          socket.emit('waiting', { roomId: hrid, seat: oldSeat, names: hroom.names, kind: h.quick ? 'quick' : undefined });
          socket.emit('recruitHolding', { roomId: hrid, quick: !!h.quick });
          continue;
        }
        h.socket = socket; h.lostAt = 0;
        socket.emit('recruitHolding', { roomId: hrid, quick: !!h.quick });
        if (h.calling && !h.accepted) socket.emit('recruitCall', { roomId: hrid, name: (hroom.names && hroom.names[1]) || '', quick: !!h.quick }); // 再読込の間に参加者が来ていた
        else if (h.calling && h.accepted) socket.emit('recruitGo', { roomId: hrid, name: (hroom.names && hroom.names[1]) || '', quick: !!h.quick }); // 移動を認めた後(今の対戦はもう抜けている)に通信が切れた: 続きから
      }
    }
    if (best) {
      beginStart(socket); // 実際に対戦へ戻る時だけ、読み込み待ちの古い開始要求を捨てる(復帰先が無い自動確認では捨てない)
      let { rid, room, seat } = best;
      console.log('[rejoin] playerId=' + playerId + ' → room=' + rid + ' seat=' + seat);
      if (room._disconnectTimer && room._disconnectTimer[seat]) {
        clearTimeout(room._disconnectTimer[seat]);
        room._disconnectTimer[seat] = null;
      }
      let old = room.sockets[seat];
      socket.seat = seat;
      socket.roomId = rid;
      room.sockets[seat] = socket; // 先に席を新しい接続に差し替える(古い接続の切断処理が「対戦離脱」と誤認しないように)
      socket.join(rid);
      if (old && old !== socket) { old.roomId = null; old.seat = undefined; try { old.disconnect(true); } catch (e) {} } // 同じ端末の古い接続を切る
      socket.emit('joined', { roomId: rid, seat, names: room.names, rejoin: true, isBossRush: !!room.isBossRush, isEndless: !!room.isEndless });
      let gs = room.game;
      if (gs) {
        // ターン制限の残り時間を送り直す(送らないと復帰後に表示が無いまま時間切れになる)
        let ts = room.getTurnTimerState && room.getTurnTimerState();
        if (ts) socket.emit('turnTimer', ts);
        // broadcastState()は使わない: プロンプト待ちで保留中の処理(_afterSweepAction)を早撃ちしてしまうため。
        // 状態だけ送り直し、その席に未回答のプロンプトがあれば再送する
        gs.emit('stateUpdate');
        if (gs.G.phase === 'start') socket.emit('turnScreen', { currentPlayer: gs.G.cp, turn: gs.G.turn, isYourTurn: gs.G.cp === seat });
        let pp = gs.pendingPrompt && gs.pendingPrompt[seat];
        if (pp) gs.emit('prompt', { player: seat, type: pp.type, data: pp.data });
        // 解決演出のack待ち中に切断していた場合、この席の分を自動ackして解決を止めない
        // (誰もackしていない状態でもフラグで判定できる)
        if (gs._awaitingAck && !(gs.ackResolve && gs.ackResolve.has(seat))) {
          gs.handleAckResolve(seat);
          // 通常のack(handleAction)と同じくタイマーの再開/満了判定を通す(通さないと解決後もタイマーが止まったまま)
          setTimeout(() => { if (room._turnTimerExpired) room._checkTimerExpired(); else room._resumeTurnTimer(); }, 100);
        }
      }
      return;
    }
    socket.emit('rejoinFailed');
  });

  socket.on('disconnect', () => {
    console.log('切断:', socket.id);
    let roomId = socket.roomId;
    // 出していた募集(hold)は、切断してもすぐには消さない(ロビーへ戻る再読込で切れるため)。HOLD_LOST_GRACE_MS 以内に同じ人が戻れば続く
    for (const [, hroom] of rooms) { const h = holdOf(hroom); if (h && h.socket === socket) { h.lostAt = Date.now(); } }
    detachSocketFromRooms(socket, roomId); // 最新の部屋以外に席が残っていれば抜ける(最新の部屋は下で再接続待ちを考慮)
    if (roomId && rooms.has(roomId) && holdOf(rooms.get(roomId))) {
      // hold 付きの待機部屋に座ったまま切れた(募集主 または 呼び出し待ちの参加者): 席だけ空ける
      const hroom = rooms.get(roomId); const h = hroom.hold; const hs = hroom.sockets.indexOf(socket);
      if (hs >= 0) hroom.sockets[hs] = null;
      if (h.socket !== socket) releaseCalling(roomId, hroom);
    } else if (roomId && rooms.has(roomId)) {
      let room = rooms.get(roomId);
      let seat = socket.seat;
      if (room.state === 'playing' && room.playerIds && room.playerIds[seat]) {
        console.log('[disconnect] 再接続待機 seat=' + seat + ' playerId=' + room.playerIds[seat]);
        room.sockets[seat] = null;
        if (!room._disconnectTimer) room._disconnectTimer = [null, null];
        room._disconnectTimer[seat] = setTimeout(() => {
          console.log('[disconnect] 再接続タイムアウト seat=' + seat);
          room._disconnectTimer[seat] = null;
          room.leave(socket);
          if (noHumansLeft(room)) {
            stopRoomAi(room);
            rooms.delete(roomId);
            if (quickMatchWaiting === roomId) quickMatchWaiting = null;
          }
        }, RECONNECT_GRACE_MS);
      } else {
        room.leave(socket);
        if (noHumansLeft(room)) {
          stopRoomAi(room);
          rooms.delete(roomId);
          if (quickMatchWaiting === roomId) quickMatchWaiting = null;
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3200;
// 部屋の定期掃除(60秒ごと): 人間がいない部屋、終了から10分過ぎた部屋、作成から3時間過ぎた部屋を削除。
// これが無いとCPU戦の部屋(AIダミー接続が席に残る)が永久に溜まりメモリが尽きる(2026-09-20 本番で136部屋を確認)
setInterval(() => {
  let now = Date.now(), removed = 0;
  for (let [rid, room] of rooms) {
    // 再接続待ち(30秒)中・ボスラッシュの次ステージ待ち中は絶対に触らない
    let waitingDisconnected = room._disconnectTimer && (room._disconnectTimer[0] || room._disconnectTimer[1]);
    if (waitingDisconnected || room._pendingBossRush) continue;
    // 募集(hold)付きの待機部屋は、人が座っていなくても期限までは残す
    if (holdOf(room)) { if (holdAlive(room)) continue; if (dropHold(rid, 'expired')) removed++; continue; }
    let humans = [0, 1].filter(i => room.sockets[i] && room.sockets[i] !== room._aiSocket && room.sockets[i].connected !== false).length;
    let finishedLong = room.state === 'finished' && room.finishedAt && now - room.finishedAt > 10 * 60 * 1000;
    // 経過時間だけを理由に削除はしない(長時間のエンドレス戦などプレイ中の部屋を消してしまうため)
    if (humans === 0 || finishedLong) {
      if (room._clearTurnTimer) room._clearTurnTimer();
      stopRoomAi(room);
      rooms.delete(rid);
      if (quickMatchWaiting === rid) quickMatchWaiting = null;
      removed++;
    }
  }
  if (removed) console.log('[sweep] rooms removed=' + removed + ' remaining=' + rooms.size);
}, 60 * 1000);

server.listen(PORT, () => {
  console.log(`サルベドTCG サーバー起動: http://localhost:${PORT}`);
});

app.get('/ranking', async (req, res) => {
  let days = req.query.days ? parseInt(req.query.days) : null;
  let ranking = await getRanking(days);
  res.json(ranking);
});

app.get('/endless-ranking', async (req, res) => {
  let days = req.query.days ? parseInt(req.query.days) : null;
  let ranking = await getEndlessRanking(days);
  res.json(ranking);
});

const ytCache = new Map();

async function fetchYtFeed(channelId) {
  try {
    const r = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId);
    if (!r.ok) throw new Error(r.status);
    const xml = await r.text();
    if (xml && xml.includes('<entry>')) {
      ytCache.set(channelId, { xml, updatedAt: Date.now() });
    }
    return xml;
  } catch (e) {
    return null;
  }
}

app.get('/yt-feed', async (req, res) => {
  const channelId = req.query.id;
  if (!channelId || !/^UC[\w-]{22}$/.test(channelId)) return res.status(400).send('invalid id');
  res.set('Content-Type', 'application/xml');
  res.set('Access-Control-Allow-Origin', '*');
  const xml = await fetchYtFeed(channelId);
  if (xml) return res.send(xml);
  const cached = ytCache.get(channelId);
  if (cached) return res.send(cached.xml);
  res.status(502).send('fetch error');
});

// 端末側でページが拡大されたままになる問題の診断ログ(機種・幅・倍率のみ。個人情報なし)。直近50件を/debugで見る
const zoomDiag = [];
const zoomDiagLast = new Map();
app.post('/diag/zoom', express.json({ limit: '4kb' }), (req, res) => {
  // 未認証で叩ける口なので、本文は4KB上限・同一IPは10秒に1回だけ受け付ける
  let ip = req.ip || '';
  let now = Date.now();
  if (now - (zoomDiagLast.get(ip) || 0) < 10000) { res.set('Access-Control-Allow-Origin', '*'); return res.json({ ok: true }); }
  zoomDiagLast.set(ip, now);
  if (zoomDiagLast.size > 5000) zoomDiagLast.clear();
  res.set('Access-Control-Allow-Origin', '*');
  try {
    let b = req.body || {};
    zoomDiag.push({ at: new Date().toISOString(), ua: (String(b.ua || '').slice(0, 160) + ' ').trim(), scale: +b.scale || null, innerW: +b.innerW || null, innerH: +b.innerH || null, screenW: +b.screenW || null, dpr: +b.dpr || null, vvW: +b.vvW || null, layoutW: +b.layoutW || null, docScrollW: +b.docScrollW || null, lobbyW: +b.lobbyW || null, lobbyScrollW: +b.lobbyScrollW || null, tries: +b.tries || 0, cap: !!b.cap });
    if (zoomDiag.length > 50) zoomDiag.shift();
  } catch (e) {}
  res.json({ ok: true });
});
app.options('/diag/zoom', (req, res) => { res.set('Access-Control-Allow-Origin', '*'); res.set('Access-Control-Allow-Headers', 'Content-Type'); res.sendStatus(204); });

// コメント機能（Googleスプレッドシートに保存。Renderの再デプロイでも消えない）
// limit: お問い合わせのスクリーンショット添付(base64、最大4MB)を受けられるように拡張
app.use(express.json({ limit: '8mb' }));

// アカウント機能(登録/ログイン/再設定/削除)
Auth.mount(app);
// ロビー掲示板(投稿/いいね/通報/ブロック/お知らせ/対戦募集)。rooms への参照は募集の検証に使う
const quickWaitingCount = () => { const r = quickMatchWaiting && rooms.get(quickMatchWaiting); return (r && r.state === 'waiting') ? 1 : 0; };
require('./board').mount(app, io, () => rooms, Auth, Lobby.extras, quickWaitingCount);
// クイックマッチで待っている人が「現れた／いなくなった」は、ロビーの「いま相手が待ってる！」の印に直結する。
// 待機は押した時・マッチした時・解除・切断の期限切れなど多くの経路で変わるので、1秒ごとに数を見比べて変わった時だけ lobbyRooms を流す
// (以前は20秒ごとの再取得でしか気づけず、印が出るまで最大20秒かかっていた)
{ let lastQW = quickWaitingCount(); const t = setInterval(() => { let n; try { n = quickWaitingCount(); } catch (e) { return; } if (n !== lastQW) { lastQW = n; try { io.emit('lobbyRooms', {}); } catch (e) {} } }, 1000); if (t.unref) t.unref(); }


const commentRateLimit = new Map();
function checkRateLimit(ip) {
  let last = commentRateLimit.get(ip) || 0;
  let now = Date.now();
  if (now - last < 30000) return false;
  commentRateLimit.set(ip, now);
  if (commentRateLimit.size > 10000) {
    let entries = [...commentRateLimit.entries()].sort((a, b) => a[1] - b[1]);
    entries.slice(0, 5000).forEach(([k]) => commentRateLimit.delete(k));
  }
  return true;
}

app.get('/comments', async (req, res) => {
  let page = req.query.page;
  if (!page) return res.status(400).json({ error: 'page required' });
  res.set('Access-Control-Allow-Origin', '*');
  let comments = await Comments.getComments(page);
  res.json(comments);
});

app.post('/comments', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (!checkRateLimit(ip)) return res.status(429).json({ error: '連投制限中です（30秒間隔）' });
  let { page, name, text } = req.body;
  if (!page || !text || !text.trim()) return res.status(400).json({ error: 'page and text required' });
  name = (name || '').trim().slice(0, 30) || '名無し';
  text = text.trim().slice(0, 1000);
  try {
    await Comments.addComment(page, name, text, ip);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Comments] post error:', e.message);
    res.status(500).json({ error: 'failed to save comment' });
  }
});

// 管理用: コメント削除（クエリにadmin_keyが必要）
app.delete('/comments', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  let { page, idx, admin_key } = req.query;
  if (admin_key !== 'salvado_admin_2026') return res.status(403).json({ error: 'unauthorized' });
  if (!page) return res.status(400).json({ error: 'page required' });
  let i = parseInt(idx);
  if (isNaN(i)) return res.status(400).json({ error: 'invalid idx' });
  try {
    let result = await Comments.deleteComment(page, i);
    if (!result.ok) return res.status(400).json({ error: 'invalid idx' });
    res.json(result);
  } catch (e) {
    console.error('[Comments] delete error:', e.message);
    res.status(500).json({ error: 'failed to delete comment' });
  }
});

app.options('/comments', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

const INQUIRY_CATEGORIES = ['アカウントについて', 'カードについて', '不具合について', 'ご意見・ご要望', 'その他'];

app.post('/inquiry', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (!checkRateLimit(ip)) return res.status(429).json({ error: '連投制限中です（30秒間隔）' });
  let { category, name, contact, text, playerId, bug } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });
  name = (name || '').trim().slice(0, 30);
  contact = (contact || '').trim().slice(0, 100);
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!contact) return res.status(400).json({ error: 'contact required' });
  category = INQUIRY_CATEGORIES.includes(category) ? category : 'その他';
  playerId = (playerId || '').trim().slice(0, 60);
  text = text.trim().slice(0, 1000);

  let bugFields = null;
  if (category === '不具合について' && bug) {
    if (!bug.screen || !bug.screen.trim()) return res.status(400).json({ error: 'screen required' });
    bugFields = {
      occurredAt: (bug.occurredAt || '').trim().slice(0, 40),
      screen: bug.screen.trim().slice(0, 40),
      action: (bug.action || '').trim().slice(0, 200),
      errorMsg: (bug.errorMsg || '').trim().slice(0, 200),
      device: (bug.device || '').trim().slice(0, 200),
      network: (bug.network || '').trim().slice(0, 100),
      screenshotDataUrl: typeof bug.screenshotDataUrl === 'string' ? bug.screenshotDataUrl : null,
      screenshotName: (bug.screenshotName || '').trim().slice(0, 100),
    };
  }

  try {
    await InquiryMailer.sendInquiry({ category, name, contact, playerId, text, ip, bug: bugFields });
    res.json({ ok: true });
  } catch (e) {
    console.error('[InquiryMailer] send error:', e.message);
    res.status(500).json({ error: 'failed to send inquiry' });
  }
});

app.options('/inquiry', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

// ユーザーデータAPI
app.get('/api/user/:id', async (req, res) => {
  try {
    let user = await db.getUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json(user);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ゲスト(p_)の名前変更。ロビーの「名前変更」→即サーバーに反映(以前は対戦参加時にしか更新されず、
// 変更直後の再読込で古い名前に戻っていた)。アカウント(u_)は /auth/name 経由(重複禁止・回数制限)
app.options('/api/user/:id/name', (req, res) => { // アプリ(別オリジン)からの JSON POST のプリフライト
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.sendStatus(204);
});
app.post('/api/user/:id/name', Auth.requireOwner, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (Auth.isAccountId(id)) return res.status(403).json({ error: 'アカウントの名前はアカウント設定から変更してください' });
    if (!/^p_[A-Za-z0-9]{6,40}$/.test(id)) return res.status(400).json({ error: 'id' });
    const name = String((req.body && req.body.name) || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    if (!name) return res.status(400).json({ error: '名前を入力してください' });
    if (Auth.isReservedByAccount(name)) return res.status(400).json({ error: 'この名前はアカウント登録している人が使っています' });
    await db.upsertUser(id, name);
    res.json({ ok: true, display_name: name });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 強制更新の最低版。GET は誰でも(アプリの更新確認が読む)。POST は管理用トークンが必要で、再起動なしに切り替わる(0 で無効)
app.get('/api/app/min-version', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ minClientV: AppGate.get(), store: AppGate.STORE });
});
app.post('/api/app/min-version', async (req, res) => {
  const token = process.env.BOARD_ADMIN_TOKEN || '';
  if (!token || req.get('x-admin-token') !== token) return res.status(403).json({ error: 'forbidden' });
  try {
    const v = await AppGate.set(req.body && req.body.minClientV);
    res.json({ ok: true, minClientV: v });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 新カードの公開スイッチ。GET は公開中かどうかだけ(カード一覧ページが読む)。POST は管理用トークンが必要で、再起動なしに切り替わる。
// POST の本文: { released: true/false, previewNames: ['アカウントの表示名', ...] または preview: ['u_...', ...] }(どれも省略可。省略した項目は変えない)
app.get('/api/app/newcards', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ released: Release.visibleTo(null) }); }); // デバッグ用の全解除(UNLOCK_ALL_CARDS=1)の時も true
app.post('/api/app/newcards', async (req, res) => {
  const token = process.env.BOARD_ADMIN_TOKEN || '';
  if (!token || req.get('x-admin-token') !== token) return res.status(403).json({ error: 'forbidden' });
  try {
    const b = req.body || {}; const next = {};
    // 指定された項目の型が違う時は、何も変えずに 400 を返す("false" のような文字列を黙って無視して「成功」と返さない)
    if (b.released !== undefined && typeof b.released !== 'boolean') return res.status(400).json({ error: 'released は true / false で指定してください' });
    if (b.previewNames !== undefined && !Array.isArray(b.previewNames)) return res.status(400).json({ error: 'previewNames は配列で指定してください' });
    if (b.preview !== undefined && !Array.isArray(b.preview)) return res.status(400).json({ error: 'preview は配列で指定してください' });
    if (Array.isArray(b.previewNames) && !b.previewNames.every(x => typeof x === 'string' && x)) return res.status(400).json({ error: 'previewNames の中身は、アカウントの表示名(文字列)にしてください' });
    if (Array.isArray(b.preview) && !b.preview.every(x => typeof x === 'string' && x.startsWith('u_'))) return res.status(400).json({ error: 'preview の中身は、アカウントID(u_ で始まる文字列)にしてください' });
    if (typeof b.released === 'boolean') next.released = b.released;
    let notFound = [];
    if (Array.isArray(b.previewNames)) {
      const ids = [];
      for (const n of b.previewNames.slice(0, 50)) { const id = (typeof n === 'string') ? await db.getAccountIdByName(n) : null; if (id) ids.push(id); else notFound.push(n); }
      next.preview = ids;
    } else if (Array.isArray(b.preview)) next.preview = b.preview;
    const st = await Release.set(next);
    const closed = st.released ? 0 : closeWaitingNewCardRooms(); // 非公開の時は、新カード入りで待機中の部屋を取り消す
    res.json({ ok: true, released: st.released, preview: st.preview, notFound, closedRooms: closed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- 人気化の作戦 Phase 0: 計測・対戦会・ロビーの表示設定 ----
// 計測(到達→初戦→対人→再訪)。クライアントが送る。個人情報は入れない(端末の識別子・プレイヤーID・イベント名・短い付帯情報だけ)
const TRACK_EVENTS = new Set(['open', 'tutorial_start', 'tutorial_end', 'first_match_prompt', 'first_match_start', 'quickmatch_press', 'store_click']);
const trackBucket = new Map(); // device -> {n, at}
app.post('/api/track', (req, res) => {
  const b = req.body || {};
  const device = (typeof b.device === 'string' && /^d_[A-Za-z0-9]{6,40}$/.test(b.device)) ? b.device : null;
  const pid = (typeof b.pid === 'string' && /^[pu]_[A-Za-z0-9_-]{6,64}$/.test(b.pid)) ? b.pid : null;
  const event = (typeof b.event === 'string' && TRACK_EVENTS.has(b.event)) ? b.event : null;
  if (!device || !event) return res.status(400).json({ ok: false });
  const now = Date.now(); const bk = trackBucket.get(device) || { n: 0, at: now };
  if (now - bk.at > 3600000) { bk.n = 0; bk.at = now; }
  if (++bk.n > 60) { trackBucket.set(device, bk); return res.json({ ok: true, dropped: true }); } // 1端末1時間60件まで
  trackBucket.set(device, bk);
  if (trackBucket.size > 20000) trackBucket.clear();
  let meta = null;
  if (b.meta && typeof b.meta === 'object') { meta = {}; for (const k of ['from', 'ref', 'native', 'clientV', 'first', 'mode', 'result']) { const v = b.meta[k]; if (typeof v === 'string') meta[k] = v.slice(0, 80); else if (typeof v === 'number' || typeof v === 'boolean') meta[k] = v; } }
  db.addEvent(device, pid, event, meta).catch(e => console.error('track error:', e.message));
  res.json({ ok: true });
});
app.options('/api/track', (req, res) => { res.set('Access-Control-Allow-Origin', '*'); res.set('Access-Control-Allow-Headers', 'Content-Type'); res.sendStatus(204); });
// 段階別の集計(管理用トークン)。?days=7
app.get('/api/admin/funnel', async (req, res) => {
  const token = process.env.BOARD_ADMIN_TOKEN || '';
  if (!token || req.get('x-admin-token') !== token) return res.status(403).json({ error: 'forbidden' });
  try { res.json(await db.funnel(Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7)))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// 対戦会の日程(GET は誰でも。POST は管理用トークン): { label, from:'YYYY-MM-DD', slots:[{dow:0-6, h, m, len}] }
app.get('/api/app/meetups', async (req, res) => { res.set('Cache-Control', 'no-store'); try { const c = await Lobby.getMeetups(); res.json({ config: c, now: Lobby.meetupInfo(c) }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/app/meetups', async (req, res) => {
  const token = process.env.BOARD_ADMIN_TOKEN || '';
  if (!token || req.get('x-admin-token') !== token) return res.status(403).json({ error: 'forbidden' });
  try {
    const b = req.body || {}; const cur = await Lobby.getMeetups(); const next = Object.assign({}, cur);
    if (b.label !== undefined) { if (typeof b.label !== 'string' || !b.label) return res.status(400).json({ error: 'label は文字列' }); next.label = b.label.slice(0, 30); }
    if (b.from !== undefined) { if (b.from !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.from))) return res.status(400).json({ error: 'from は YYYY-MM-DD' }); next.from = b.from; }
    if (b.slots !== undefined) {
      if (!Array.isArray(b.slots) || b.slots.length > 14 || !b.slots.every(x => x && Number.isInteger(x.dow) && x.dow >= 0 && x.dow <= 6 && Number.isInteger(x.h) && x.h >= 0 && x.h <= 23 && (x.m === undefined || (Number.isInteger(x.m) && x.m >= 0 && x.m <= 59)) && (x.len === undefined || (Number.isInteger(x.len) && x.len >= 5 && x.len <= 240)))) return res.status(400).json({ error: 'slots の形が不正です' });
      next.slots = b.slots.map(x => ({ dow: x.dow, h: x.h, m: x.m || 0, len: x.len || 30 }));
    }
    await Settings.set('meetups', next);
    res.json({ ok: true, config: next, now: Lobby.meetupInfo(next) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// ロビーの表示設定(管理用トークン): { showPlayedToday: true/false, starterDeck: 'fantasy'|'lovecome'|'creator' }
app.get('/api/app/lobby-flags', async (req, res) => { res.set('Cache-Control', 'no-store'); try { res.json(await Lobby.getFlags()); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/app/lobby-flags', async (req, res) => {
  const token = process.env.BOARD_ADMIN_TOKEN || '';
  if (!token || req.get('x-admin-token') !== token) return res.status(403).json({ error: 'forbidden' });
  try {
    const b = req.body || {}; const cur = await Lobby.getFlags(); const next = Object.assign({}, cur);
    if (b.showPlayedToday !== undefined) { if (typeof b.showPlayedToday !== 'boolean') return res.status(400).json({ error: 'showPlayedToday は true/false' }); next.showPlayedToday = b.showPlayedToday; }
    if (b.starterDeck !== undefined) { if (!require('../shared/cards').STARTER_DECKS[b.starterDeck]) return res.status(400).json({ error: 'starterDeck は fantasy / lovecome / creator' }); next.starterDeck = b.starterDeck; }
    if (b.newcardsTeaser !== undefined) { if (b.newcardsTeaser !== 'auto' && b.newcardsTeaser !== 'off') return res.status(400).json({ error: 'newcardsTeaser は auto / off' }); next.newcardsTeaser = b.newcardsTeaser; }
    if (b.newcardsWhen !== undefined) { if (typeof b.newcardsWhen !== 'string' || !b.newcardsWhen || b.newcardsWhen.length > 20) return res.status(400).json({ error: 'newcardsWhen は20文字までの文字列' }); next.newcardsWhen = b.newcardsWhen; }
    await Settings.set('lobby_flags', next); await Lobby.refreshStarter();
    res.json({ ok: true, flags: next });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 使用権を解除済みのカード(デッキ編集の表示用)。all=true はデバッグ用の全解除(UNLOCK_ALL_CARDS=1)
app.get('/api/user/:id/unlocks', Auth.requireOwner, async (req, res) => {
  try {
    // visible: この人に新カードとクエストを見せてよいか(公開スイッチ、または先行テストのアカウント)。false の間、クライアントは何も表示しない
    const idOk = /^[pu]_[A-Za-z0-9_-]{6,64}$/.test(req.params.id);
    const visible = idOk ? Release.visibleTo(req.params.id) : Release.visibleTo(null);
    if (!idOk || !visible) return res.json({ cards: [], all: Unlocks.unlockAll(), visible });
    const set = await Unlocks.load(req.params.id, req.get('x-device-key')); // ゲストは端末の鍵が合う時だけ返る
    res.json({ cards: Array.from(set), all: Unlocks.unlockAll(), visible });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/user/:id/inventory', async (req, res) => {
  try {
    let items = await db.getInventory(req.params.id, req.query.app || 'tcg', req.query.type || null);
    res.json(items);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/user/:id/achievements', async (req, res) => {
  try {
    let list = await db.getAchievements(req.params.id, req.query.app || 'tcg');
    res.json(list);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/user/:id/decks', async (req, res) => {
  try {
    let decks = await db.getUserDecks(req.params.id);
    res.json(decks);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/user/:id/decks', Auth.requireOwner, async (req, res) => {
  try {
    let { slot, name, deck_data } = req.body;
    if (slot === undefined) return res.status(400).json({ error: 'slot required' });
    await db.saveUserDeck(req.params.id, slot, name, deck_data);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/user/:id/decks/:slot', Auth.requireOwner, async (req, res) => {
  try {
    await db.deleteUserDeck(req.params.id, parseInt(req.params.slot, 10));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// デバッグ用: 現在のゲーム状態確認
app.get('/debug', (req, res) => {
  let info = [];
  rooms.forEach((room, id) => {
    if (room.game) {
      let G = room.game.G;
      info.push({
        roomId: id, state: room.state, isAI: !!room.isAI,
        humans: [0, 1].filter(i => room.sockets[i] && room.sockets[i] !== room._aiSocket).length,
        ageMin: room.createdAt ? Math.round((Date.now() - room.createdAt) / 60000) : null,
        phase: G.phase, cp: G.cp, turn: G.turn,
        chainDepth: G.chainDepth, effectStack: G.effectStack.length,
        pendingPrompt: [!!room.game.pendingPrompt[0], !!room.game.pendingPrompt[1]],
        waitingAction: !!G.waitingAction,
        // 詰まり調査用: 解決確認待ち・ack・キュー・保留ターン終了
        deferredEndTurn: room.game._deferredEndTurn == null ? null : room.game._deferredEndTurn,
        awaitingAck: !!room.game._awaitingAck,
        acks: room.game.ackResolve ? [...room.game.ackResolve] : null,
        combatQueue: room.game._combatQueue ? room.game._combatQueue.length : null,
        resolveQueue: room.game._resolveQueue ? room.game._resolveQueue.length : null
      });
    }
  });
  res.json({ rooms: info.length, roomsTotal: rooms.size, waiting: quickMatchWaiting, rssMB: Math.round(process.memoryUsage().rss / 1048576), zoomDiag, list: info });
});
