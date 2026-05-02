const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const GameRoom = require('./GameRoom');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// 静的ファイル配信
app.use(express.static(path.join(__dirname, '../client'), { etag: false, maxAge: 0 }));
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// ルーム管理
const rooms = new Map();
let quickMatchWaiting = null;

function generateRoomId() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

io.on('connection', (socket) => {
  console.log('接続:', socket.id);

  socket.on('quickMatch', (data) => {
    let name = typeof data === 'string' ? data : (data && data.name);
    let deck = typeof data === 'object' && data ? data.deck : undefined;
    if (quickMatchWaiting && rooms.has(quickMatchWaiting)) {
      let room = rooms.get(quickMatchWaiting);
      let seat = room.join(socket, name, deck);
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
    // 新しいルーム作成
    let roomId = generateRoomId();
    let room = new GameRoom(roomId);
    rooms.set(roomId, room);
    let seat = room.join(socket, name, deck);
    socket.join(roomId);
    socket.emit('waiting', { roomId });
    quickMatchWaiting = roomId;
  });


  socket.on('aiMatch', (data) => {
    let name = typeof data === 'string' ? data : (data && data.name);
    let deck = typeof data === 'object' && data ? data.deck : undefined;
    let roomId = generateRoomId();
    let room = new GameRoom(roomId);
    rooms.set(roomId, room);
    let seat = room.join(socket, name, deck);
    socket.join(roomId);
    const aiDeck = [
      {id:'maoria',count:1},{id:'tomo',count:1},{id:'izuna',count:1},{id:'miiko',count:2},
      {id:'kaera',count:2},{id:'jk_a',count:2},{id:'iron_boss',count:1},{id:'iron_chaser',count:2},
      {id:'asaki',count:1},{id:'azusa',count:1},{id:'shinigami',count:1},{id:'jun',count:1},
      {id:'mamachari',count:2},{id:'kyamakiri',count:2},{id:'milia',count:1},{id:'daria',count:2},
      {id:'seitokaichou',count:2},{id:'osananajimi',count:2},{id:'onna_joushi',count:2},
      {id:'ark',count:1},{id:'imouto',count:2},{id:'mensetsu_kan',count:2},{id:'reichen',count:1},
      {id:'sagi',count:1},{id:'dansou',count:2},{id:'ki_no_sei',count:2},
      {id:'hikaru',count:2},{id:'oyuchi',count:2},{id:'nanase',count:2},{id:'kikaku_botsu',count:2},
      {id:'douga_henshuu',count:2},{id:'channel_sakujo',count:1},{id:'komi',count:2},
      {id:'katorina',count:2},{id:'seishun_kiben',count:1},{id:'gomo',count:2},{id:'akapo',count:2},
    ];
    room.joinAI(aiDeck);
    socket.emit('joined', { roomId, seat, names: room.names });
  });

  socket.on('tutorialMatch', () => {
    let roomId = 'tutorial_' + generateRoomId();
    let room = new GameRoom(roomId);
    rooms.set(roomId, room);
    let seat = room.join(socket, 'あなた');
    socket.join(roomId);
    room.joinAI(null, true);
    socket.emit('joined', { roomId, seat, names: ['あなた', '相手'], isTutorial: true });
  });

  socket.on('createRoom', (data) => {
    let name = typeof data === 'string' ? data : (data && data.name);
    let deck = typeof data === 'object' && data ? data.deck : undefined;
    let roomId = generateRoomId();
    let room = new GameRoom(roomId);
    rooms.set(roomId, room);
    let seat = room.join(socket, name, deck);
    socket.join(roomId);
    socket.emit('waiting', { roomId });
  });

  socket.on('joinRoom', (data) => {
    let roomId = typeof data === 'string' ? data : (data && data.roomId);
    let name = typeof data === 'object' && data ? data.name : undefined;
    let deck = typeof data === 'object' && data ? data.deck : undefined;
    let room = rooms.get(roomId);
    if (!room) { socket.emit('error', { msg: 'ルームが見つかりません' }); return; }
    let seat = room.join(socket, name, deck);
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

  socket.on('disconnect', () => {
    console.log('切断:', socket.id);
    let roomId = socket.roomId;
    if (roomId && rooms.has(roomId)) {
      let room = rooms.get(roomId);
      room.leave(socket);
      if (!room.sockets[0] && !room.sockets[1]) {
        rooms.delete(roomId);
        if (quickMatchWaiting === roomId) quickMatchWaiting = null;
      }
    }
  });
});

const PORT = process.env.PORT || 3200;
server.listen(PORT, () => {
  console.log(`サルベドTCG サーバー起動: http://localhost:${PORT}`);
});

// デバッグ用: 現在のゲーム状態確認
app.get('/debug', (req, res) => {
  let info = [];
  rooms.forEach((room, id) => {
    if (room.game) {
      let G = room.game.G;
      info.push({
        roomId: id,
        phase: G.phase, cp: G.cp, turn: G.turn,
        chainDepth: G.chainDepth, effectStack: G.effectStack.length,
        pendingPrompt: [!!room.game.pendingPrompt[0], !!room.game.pendingPrompt[1]],
        waitingAction: !!G.waitingAction
      });
    }
  });
  res.json(info);
});
