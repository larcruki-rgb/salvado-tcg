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

// 人間の席が全て空か(AIのダミー接続は人間ではない、切断済みの接続も人間ではない)
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
function detachSocketFromRooms(socket, exceptRoomId) {
  for (let [rid, room] of rooms) {
    if (rid === exceptRoomId) continue;
    let seat = room.sockets.indexOf(socket);
    if (seat < 0) continue;
    if (room.state === 'playing') {
      room.leave(socket, seat); // 対戦中なら相手の勝ち扱い(opponentLeft)
    } else {
      room.sockets[seat] = null;
      if (room._clearTurnTimer) room._clearTurnTimer();
    }
    if (noHumansLeft(room)) {
      rooms.delete(rid);
      if (quickMatchWaiting === rid) quickMatchWaiting = null;
    }
  }
  if (socket.roomId && !rooms.has(socket.roomId)) { socket.roomId = null; socket.seat = undefined; }
}

io.on('connection', (socket) => {
  console.log('接続:', socket.id);

  socket.on('quickMatch', (data) => {
    let name = typeof data === 'string' ? data : (data && data.name);
    let deck = typeof data === 'object' && data ? data.deck : undefined;
    let playerId = Auth.trustedPid(socket, typeof data === 'object' && data ? data.playerId : undefined);
    name = Auth.guestSafeName(name, playerId);
    { const v = DeckValidation.validateDeck(playerId, deck);
      if (!v.ok) {
        socket.emit('deckRejected', { reason: v.reason || 'invalid deck' });
        socket.emit('error', { msg: v.reason || 'デッキが不正です' }); // 旧クライアント(1.2以前)向けの表示
        return; } }
    db.upsertUser(playerId, name).catch(e => console.error('db upsert error:', e.message));
    if (quickMatchWaiting && rooms.has(quickMatchWaiting)) {
      let room = rooms.get(quickMatchWaiting);
      // 同じ接続の二度押し: そのまま待機を続ける(自分自身とマッチさせない)
      if (room.sockets[0] === socket) {
        socket.emit('waiting', { roomId: quickMatchWaiting });
        return;
      }
      // 同じプレイヤーIDの別接続(アプリを閉じた直後の古い接続、別端末の同一アカウント)が待機枠にいる:
      // 古い方を捨てて、この接続で待ち直す。以前は「waitingだけ返して部屋に入れない」だったため、
      // 古い接続が消えた後に本人がどの部屋にもいない永久待機になっていた
      if (playerId && room.playerIds && room.playerIds[0] === playerId) {
        let old = room.sockets[0];
        rooms.delete(quickMatchWaiting); quickMatchWaiting = null;
        if (old && old !== socket) { old.roomId = null; old.seat = undefined; }
        detachSocketFromRooms(socket);
        // ↓ 新しいルーム作成へ
      } else {
      detachSocketFromRooms(socket); // 前の部屋(待機枠・CPU戦など)から抜けてから合流
      let seat = room.join(socket, name, deck, playerId);
      if (seat >= 0) {
        socket.join(quickMatchWaiting);
        socket.emit('joined', { roomId: quickMatchWaiting, seat, names: room.names });
        // 相手にも通知
        let other = room.sockets[1 - seat];
        if (other) other.emit('opponentJoined', { name: name || 'P' + (seat + 1) });
        quickMatchWaiting = null;
        return;
      }
      }
    } else {
      detachSocketFromRooms(socket);
    }
    // 新しいルーム作成
    let roomId = generateRoomId();
    let room = new GameRoom(roomId);
    rooms.set(roomId, room);
    let seat = room.join(socket, name, deck, playerId);
    socket.join(roomId);
    socket.emit('waiting', { roomId });
    quickMatchWaiting = roomId;
  });


  socket.on('aiMatch', (data) => {
    let name = typeof data === 'string' ? data : (data && data.name);
    let deck = typeof data === 'object' && data ? data.deck : undefined;
    let playerId = Auth.trustedPid(socket, data && data.playerId);
    name = Auth.guestSafeName(name, playerId);
    { const v = DeckValidation.validateDeck(playerId, deck);
      if (!v.ok) {
        socket.emit('deckRejected', { reason: v.reason || 'invalid deck' });
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
    let roomId = 'tutorial_' + generateRoomId();
    let room = new GameRoom(roomId);
    rooms.set(roomId, room);
    detachSocketFromRooms(socket); // 検証が全部通ってから前の部屋(待機枠・CPU戦など)を抜ける(失敗時に今の対戦を壊さない)
    let seat = room.join(socket, 'あなた');
    socket.join(roomId);
    room.joinAI(null, true);
    socket.emit('joined', { roomId, seat, names: ['あなた', '相手'], isTutorial: true });
  });


  socket.on('questMatch', (data) => {
    let name = data && data.name;
    let deck = data && data.deck;
    let playerId = Auth.trustedPid(socket, data && data.playerId);
    name = Auth.guestSafeName(name, playerId);
    { const v = DeckValidation.validateDeck(playerId, deck);
      if (!v.ok) {
        socket.emit('deckRejected', { reason: v.reason || 'invalid deck' });
        socket.emit('error', { msg: v.reason || 'デッキが不正です' }); // 旧クライアント(1.2以前)向けの表示
        return; } }
    db.upsertUser(playerId, name).catch(e => console.error('db upsert error:', e.message));
    let questId = data && data.questId;
    let roomId = 'quest_' + generateRoomId();
    let room = new GameRoom(roomId);
    rooms.set(roomId, room);
    detachSocketFromRooms(socket); // 検証が全部通ってから前の部屋(待機枠・CPU戦など)を抜ける(失敗時に今の対戦を壊さない)
    let seat = room.join(socket, name, deck, playerId);
    socket.join(roomId);
    room.joinAI(AI_DECK, false, questId);
    socket.emit('joined', { roomId, seat, names: [name || 'あなた', 'CPU'], isQuest: true });
  });

  socket.on('bossRush', (data) => {
    let name = data && data.name;
    let deck = data && data.deck;
    let playerId = Auth.trustedPid(socket, data && data.playerId);
    name = Auth.guestSafeName(name, playerId);
    { const v = DeckValidation.validateDeck(playerId, deck);
      if (!v.ok) {
        socket.emit('deckRejected', { reason: v.reason || 'invalid deck' });
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

  socket.on('endlessBoss', (data) => {
    let name = data && data.name;
    let deck = data && data.deck;
    let playerId = Auth.trustedPid(socket, data && data.playerId);
    name = Auth.guestSafeName(name, playerId);
    { const v = DeckValidation.validateDeck(playerId, deck);
      if (!v.ok) {
        socket.emit('deckRejected', { reason: v.reason || 'invalid deck' });
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
    let name = data && data.name;
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

  socket.on('createRoom', (data) => {
    let name = typeof data === 'string' ? data : (data && data.name);
    let deck = typeof data === 'object' && data ? data.deck : undefined;
    let playerId = Auth.trustedPid(socket, typeof data === 'object' && data ? data.playerId : undefined);
    name = Auth.guestSafeName(name, playerId);
    { const v = DeckValidation.validateDeck(playerId, deck);
      if (!v.ok) {
        socket.emit('deckRejected', { reason: v.reason || 'invalid deck' });
        socket.emit('error', { msg: v.reason || 'デッキが不正です' }); // 旧クライアント(1.2以前)向けの表示
        return; } }
    db.upsertUser(playerId, name).catch(e => console.error('db upsert error:', e.message));
    let roomId = generateRoomId();
    let room = new GameRoom(roomId);
    rooms.set(roomId, room);
    detachSocketFromRooms(socket); // 検証が全部通ってから前の部屋(待機枠・CPU戦など)を抜ける(失敗時に今の対戦を壊さない)
    let seat = room.join(socket, name, deck, playerId);
    socket.join(roomId);
    socket.emit('waiting', { roomId });
  });

  socket.on('joinRoom', (data) => {
    let roomId = typeof data === 'string' ? data : (data && data.roomId);
    let name = typeof data === 'object' && data ? data.name : undefined;
    let deck = typeof data === 'object' && data ? data.deck : undefined;
    let playerId = Auth.trustedPid(socket, typeof data === 'object' && data ? data.playerId : undefined);
    name = Auth.guestSafeName(name, playerId);
    { const v = DeckValidation.validateDeck(playerId, deck);
      if (!v.ok) {
        socket.emit('deckRejected', { reason: v.reason || 'invalid deck' });
        socket.emit('error', { msg: v.reason || 'デッキが不正です' }); // 旧クライアント(1.2以前)向けの表示
        return; } }
    db.upsertUser(playerId, name).catch(e => console.error('db upsert error:', e.message));
    let room = rooms.get(roomId);
    if (!room) { socket.emit('error', { msg: 'ルームが見つかりません' }); return; }
    // 自分が作った待機中の部屋に入ろうとした: そのまま待機を続ける(自分自身と対戦させない)
    if (room.sockets.indexOf(socket) >= 0) { socket.emit('waiting', { roomId }); return; }
    if (room.sockets[0] && room.sockets[1]) { socket.emit('error', { msg: '満席です' }); return; }
    detachSocketFromRooms(socket); // 検証が全部通ってから前の部屋を抜ける
    let seat = room.join(socket, name, deck, playerId);
    if (seat < 0) { socket.emit('error', { msg: '満席です' }); return; }
    socket.join(roomId);
    socket.emit('joined', { roomId, seat, names: room.names });
    let other = room.sockets[1 - seat];
    if (other) other.emit('opponentJoined', { name: name || 'P' + (seat + 1) });
  });

  socket.on('action', ({ type, data }) => {
    let roomId = socket.roomId;
    if (!roomId) return;
    let room = rooms.get(roomId);
    if (!room) return;
    room.handleAction(socket, type, data || {});
  });

  // 明示的に部屋を離れる(チュートリアルの「ロビーに戻る」等)。対戦中なら相手の勝ち扱い、待機/CPU戦なら部屋を消す
  socket.on('leaveRoom', () => {
    detachSocketFromRooms(socket);
    socket.roomId = null; socket.seat = undefined;
  });

  socket.on('rejoin', (data) => {
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
    if (best) {
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
    detachSocketFromRooms(socket, roomId); // 最新の部屋以外に席が残っていれば抜ける(最新の部屋は下で再接続待ちを考慮)
    if (roomId && rooms.has(roomId)) {
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
            rooms.delete(roomId);
            if (quickMatchWaiting === roomId) quickMatchWaiting = null;
          }
        }, RECONNECT_GRACE_MS);
      } else {
        room.leave(socket);
        if (noHumansLeft(room)) {
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
    let humans = [0, 1].filter(i => room.sockets[i] && room.sockets[i] !== room._aiSocket && room.sockets[i].connected !== false).length;
    let finishedLong = room.state === 'finished' && room.finishedAt && now - room.finishedAt > 10 * 60 * 1000;
    // 経過時間だけを理由に削除はしない(長時間のエンドレス戦などプレイ中の部屋を消してしまうため)
    if (humans === 0 || finishedLong) {
      if (room._clearTurnTimer) room._clearTurnTimer();
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
        waitingAction: !!G.waitingAction
      });
    }
  });
  res.json({ rooms: info.length, waiting: quickMatchWaiting, rssMB: Math.round(process.memoryUsage().rss / 1048576), zoomDiag, list: info });
});
