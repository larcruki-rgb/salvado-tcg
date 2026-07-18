const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const GameRoom = require('./GameRoom');
const { getRanking, getEndlessRanking } = require('./Ranking');
const Comments = require('./Comments');
const db = require('./db');

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
const io = new Server(server, { cors: { origin: '*' } });

// 静的ファイル配信
app.use(express.static(path.join(__dirname, '../client'), { etag: false, maxAge: 0 }));
app.use('/shared', express.static(path.join(__dirname, '../shared'), { etag: false, maxAge: 0 }));
app.use('/cardlist', express.static(path.join(__dirname, '../cardlist'), { etag: false, maxAge: 0 }));
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
    let playerId = typeof data === 'object' && data ? data.playerId : undefined;
    try { db.upsertUser(playerId, name); } catch(e) { console.error('db upsert error:', e.message); }
    if (quickMatchWaiting && rooms.has(quickMatchWaiting)) {
      let room = rooms.get(quickMatchWaiting);
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
    let roomId = generateRoomId();
    let room = new GameRoom(roomId);
    rooms.set(roomId, room);
    let seat = room.join(socket, name, deck);
    socket.join(roomId);
    room.joinAI(AI_DECK);
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


  socket.on('questMatch', (data) => {
    let name = data && data.name;
    let deck = data && data.deck;
    let questId = data && data.questId;
    let roomId = 'quest_' + generateRoomId();
    let room = new GameRoom(roomId);
    rooms.set(roomId, room);
    let seat = room.join(socket, name, deck);
    socket.join(roomId);
    room.joinAI(AI_DECK, false, questId);
    socket.emit('joined', { roomId, seat, names: [name || 'あなた', 'CPU'], isQuest: true });
  });

  socket.on('bossRush', (data) => {
    let name = data && data.name;
    let deck = data && data.deck;
    let roomId = 'boss_' + generateRoomId();
    let room = new GameRoom(roomId);
    room.isBossRush = true;
    room.bossRushStage = 0;
    room.bossRushCourseId = data && data.courseId || 'boss_normal';
    rooms.set(roomId, room);
    let seat = room.join(socket, name, deck);
    socket.join(roomId);
    room.joinAI(AI_DECK);
    socket.emit('joined', { roomId, seat, names: [name || 'あなた', 'BOSS'], isBossRush: true });
  });

  socket.on('endlessBoss', (data) => {
    let name = data && data.name;
    let deck = data && data.deck;
    let playerId = data && data.playerId;
    try { db.upsertUser(playerId, name); } catch(e) { console.error('db upsert error:', e.message); }
    let roomId = 'endless_' + generateRoomId();
    let room = new GameRoom(roomId);
    room.isBossRush = true;
    room.isEndless = true;
    room.bossRushStage = 0;
    rooms.set(roomId, room);
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
    let seat = room.join(socket, name);
    socket.join(roomId);
    room.joinAI(null);
    socket.emit('joined', { roomId, seat, names: [name || 'あなた', ''], isPuzzle: true });
  });

  socket.on('createRoom', (data) => {
    let name = typeof data === 'string' ? data : (data && data.name);
    let deck = typeof data === 'object' && data ? data.deck : undefined;
    let playerId = typeof data === 'object' && data ? data.playerId : undefined;
    try { db.upsertUser(playerId, name); } catch(e) { console.error('db upsert error:', e.message); }
    let roomId = generateRoomId();
    let room = new GameRoom(roomId);
    rooms.set(roomId, room);
    let seat = room.join(socket, name, deck, playerId);
    socket.join(roomId);
    socket.emit('waiting', { roomId });
  });

  socket.on('joinRoom', (data) => {
    let roomId = typeof data === 'string' ? data : (data && data.roomId);
    let name = typeof data === 'object' && data ? data.name : undefined;
    let deck = typeof data === 'object' && data ? data.deck : undefined;
    let playerId = typeof data === 'object' && data ? data.playerId : undefined;
    try { db.upsertUser(playerId, name); } catch(e) { console.error('db upsert error:', e.message); }
    let room = rooms.get(roomId);
    if (!room) { socket.emit('error', { msg: 'ルームが見つかりません' }); return; }
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

  socket.on('rejoin', (data) => {
    let playerId = data && data.playerId;
    if (!playerId) return;
    for (let [rid, room] of rooms) {
      if (room.state !== 'playing') continue;
      let seat = -1;
      if (room.playerIds && room.playerIds[0] === playerId) seat = 0;
      else if (room.playerIds && room.playerIds[1] === playerId) seat = 1;
      if (seat < 0) continue;
      console.log('[rejoin] playerId=' + playerId + ' → room=' + rid + ' seat=' + seat);
      if (room._disconnectTimer && room._disconnectTimer[seat]) {
        clearTimeout(room._disconnectTimer[seat]);
        room._disconnectTimer[seat] = null;
      }
      socket.seat = seat;
      socket.roomId = rid;
      room.sockets[seat] = socket;
      socket.join(rid);
      socket.emit('joined', { roomId: rid, seat, names: room.names, rejoin: true, isBossRush: !!room.isBossRush, isEndless: !!room.isEndless });
      if (room.game) room.game.broadcastState();
      if (room.game && room.game.ackResolve && !room.game.ackResolve.has(seat)) {
        room.game.handleAckResolve(seat);
      }
      return;
    }
    socket.emit('rejoinFailed');
  });

  socket.on('disconnect', () => {
    console.log('切断:', socket.id);
    let roomId = socket.roomId;
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
          if (!room.sockets[0] && !room.sockets[1]) {
            rooms.delete(roomId);
            if (quickMatchWaiting === roomId) quickMatchWaiting = null;
          }
        }, 10000);
      } else {
        room.leave(socket);
        if (!room.sockets[0] && !room.sockets[1]) {
          rooms.delete(roomId);
          if (quickMatchWaiting === roomId) quickMatchWaiting = null;
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3200;
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

// コメント機能（Googleスプレッドシートに保存。Renderの再デプロイでも消えない）
app.use(express.json());

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

// ユーザーデータAPI
app.get('/api/user/:id', (req, res) => {
  try {
    let user = db.getUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json(user);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/user/:id/inventory', (req, res) => {
  try {
    let items = db.getInventory(req.params.id, req.query.app || 'tcg', req.query.type || null);
    res.json(items);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/user/:id/achievements', (req, res) => {
  try {
    let list = db.getAchievements(req.params.id, req.query.app || 'tcg');
    res.json(list);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/user/:id/decks', (req, res) => {
  try {
    let decks = db.getUserDecks(req.params.id);
    res.json(decks);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/user/:id/decks', (req, res) => {
  try {
    let { slot, name, deck_data } = req.body;
    if (slot === undefined) return res.status(400).json({ error: 'slot required' });
    db.saveUserDeck(req.params.id, slot, name, deck_data);
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
