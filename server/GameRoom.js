const GameState = require('./GameState');
const AIPlayer = require('./AIPlayer');
const TutorialPlayer = require('./TutorialPlayer');
const EventEmitter = require('events');
const { recordMatch, recordEndless } = require('./Ranking');
const db = require('./db');
const { BOSS_RUSH_COURSES } = require('../shared/quests');

const ENDLESS_WEAK = ['reichen', 'sagi', 'lucia', 'asaki'];
const ENDLESS_MID = [{ id: 'yuri', enchantments: ['smasher'] }, 'shinigami', 'azusa', 'milia'];
const ENDLESS_STRONG = ['maoria', 'tomo', 'ark'];
const ENDLESS_EXTREME = [
  { id: 'maoria', enchantments: ['parasite'] },
  { id: 'tomo', enchantments: ['alminium'] },
  { id: 'ark', enchantments: ['rena'] }
];
const ENDLESS_MANA = [5, 7, 10, 13, 15];

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickRandom(pool, n) {
  let copy = pool.slice();
  shuffle(copy);
  return copy.slice(0, n);
}

function generateEndlessStage(stage) {
  let field, mana = ENDLESS_MANA[Math.min(stage, ENDLESS_MANA.length - 1)];
  if (stage === 0) {
    field = pickRandom(ENDLESS_WEAK, 3);
  } else if (stage === 1) {
    field = pickRandom(ENDLESS_MID, 3);
  } else if (stage === 2) {
    field = ENDLESS_STRONG.slice();
  } else if (stage === 3) {
    let extra = pickRandom([...ENDLESS_WEAK, ...ENDLESS_MID], 2);
    field = [...ENDLESS_STRONG, ...extra];
  } else {
    let ex = ENDLESS_EXTREME[Math.floor(Math.random() * ENDLESS_EXTREME.length)];
    let exBaseId = ex.id;
    let pool = [...ENDLESS_STRONG, ...ENDLESS_MID, ...ENDLESS_WEAK].filter(e => {
      let id = typeof e === 'string' ? e : e.id;
      return id !== exBaseId;
    });
    field = [ex, ...pickRandom(pool, 5)];
  }
  let name = 'WAVE ' + (stage + 1);
  return { name, cpu: { life: 1000, mana, field } };
}

class GameRoom {
  constructor(roomId) {
    this.roomId = roomId;
    this.sockets = [null, null];
    this.names = ['P1', 'P2'];
    this.state = 'waiting';
    this.game = null;
    this.ai = null;
  }

  join(socket, name, deckDef, playerId) {
    let seat = -1;
    if (!this.sockets[0]) seat = 0;
    else if (!this.sockets[1]) seat = 1;
    else return -1;

    this.sockets[seat] = socket;
    this.names[seat] = name || ('P' + (seat + 1));
    if (!this.deckDefs) this.deckDefs = [null, null];
    this.deckDefs[seat] = deckDef || null;
    if (!this.playerIds) this.playerIds = [null, null];
    this.playerIds[seat] = playerId || null;
    socket.seat = seat;
    socket.roomId = this.roomId;

    if (this.sockets[0] && this.sockets[1]) {
      this.start();
    }
    return seat;
  }

  joinAI(deckDef, tutorial, questId) {
    if (tutorial) this.isTutorial = true;
    if (questId) this.questId = questId;
    const aiSocket = new EventEmitter();
    aiSocket.seat = 1;
    aiSocket.roomId = this.roomId;
    this.sockets[1] = aiSocket;
    this.names[1] = 'CPU';
    if (!this.deckDefs) this.deckDefs = [null, null];
    this.deckDefs[1] = deckDef || null;
    this.isAI = true;
    this._aiSocket = aiSocket;
    if (this.sockets[0]) this.start();
    return 1;
  }

  leave(socket) {
    let seat = socket.seat;
    if (seat === undefined) return;
    this.sockets[seat] = null;
    this._clearTurnTimer();
    if (this.state === 'playing') {
      this.state = 'finished';
      let other = this.sockets[1 - seat];
      if (other) other.emit('opponentLeft');
      if (!this.isAI && !this.isTutorial && !this.questId) {
        let winner = 1 - seat;
        let loserPid = this.playerIds && this.playerIds[seat];
        let winnerPid = this.playerIds && this.playerIds[winner];
        if (loserPid) recordMatch(loserPid, this.names[seat], false);
        if (winnerPid) recordMatch(winnerPid, this.names[winner], true);
        try {
          if (loserPid) db.recordMatch(loserPid, 'ranked', 'lose', null);
          if (winnerPid) db.recordMatch(winnerPid, 'ranked', 'win', null);
        } catch(e) { console.error('db recordMatch error:', e.message); }
      }
    }
  }

  _startTurnTimer(player) {
    this._clearTurnTimer();
    console.log('[TIMER] _startTurnTimer p=' + player + ' isAI=' + this.isAI + ' isTut=' + this.isTutorial);
    if (this.isAI || this.isTutorial) return;
    this._turnTimerExpired = false;
    this._turnTimerPlayer = player;
    this._turnTimerStart = Date.now();
    this._turnTimerRemaining = 90000;
    for (let i = 0; i < 2; i++) {
      if (this.sockets[i]) this.sockets[i].emit('turnTimer', { remaining: 90, total: 90 });
    }
    this._turnTimer = setTimeout(() => this._onTurnTimeout(), 90000);
  }

  _clearTurnTimer() {
    if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; }
    if (this._turnTimerTick) { clearInterval(this._turnTimerTick); this._turnTimerTick = null; }
    this._turnTimerExpired = false;
  }

  _pauseTurnTimer() {
    if (!this._turnTimer) return;
    clearTimeout(this._turnTimer);
    this._turnTimer = null;
    let elapsed = Date.now() - this._turnTimerStart;
    this._turnTimerRemaining = Math.max(0, this._turnTimerRemaining - elapsed);
    console.log('[TIMER] _pauseTurnTimer elapsed=' + elapsed + ' remaining=' + this._turnTimerRemaining);
  }

  _resumeTurnTimer() {
    if (this.isAI || this.isTutorial || this._turnTimerExpired) return;
    if (this._turnTimer) return;
    if (this.game && (this.game.G.chainDepth > 0 || this.game.G.effectStack.length > 0 || this.game.pendingPrompt[0] || this.game.pendingPrompt[1])) return;
    console.log('[TIMER] _resumeTurnTimer remaining=' + this._turnTimerRemaining);
    if (this._turnTimerRemaining == null || this._turnTimerRemaining <= 0) { this._onTurnTimeout(); return; }
    this._turnTimerStart = Date.now();
    for (let i = 0; i < 2; i++) {
      if (this.sockets[i]) this.sockets[i].emit('turnTimer', { remaining: Math.ceil(this._turnTimerRemaining / 1000), total: 60 });
    }
    this._turnTimer = setTimeout(() => this._onTurnTimeout(), this._turnTimerRemaining);
  }

  _onTurnTimeout() {
    this._turnTimer = null;
    console.log('[TIMER] _onTurnTimeout state=' + this.state + ' player=' + this._turnTimerPlayer);
    if (this.state !== 'playing' || !this.game) return;
    const gs = this.game;
    const p = this._turnTimerPlayer;
    if (gs.G.chainDepth > 0 || gs.G.effectStack.length > 0 || gs.pendingPrompt[0] || gs.pendingPrompt[1]) {
      this._turnTimerExpired = true;
      return;
    }
    for (let i = 0; i < 2; i++) {
      if (this.sockets[i]) this.sockets[i].emit('turnTimer', { remaining: 0, total: 60 });
    }
    gs.endTurn(p);
  }

  _checkTimerExpired() {
    if (!this._turnTimerExpired) return;
    if (!this.game) return;
    const gs = this.game;
    if (gs.G.chainDepth > 0 || gs.G.effectStack.length > 0 || gs.pendingPrompt[0] || gs.pendingPrompt[1]) return;
    this._turnTimerExpired = false;
    for (let i = 0; i < 2; i++) {
      if (this.sockets[i]) this.sockets[i].emit('turnTimer', { remaining: 0, total: 60 });
    }
    gs.endTurn(this._turnTimerPlayer);
  }

  _setupGameEvents(gs) {
    gs.on('stateUpdate', () => {
      for (let i = 0; i < 2; i++) {
        if (this.sockets[i]) this.sockets[i].emit('stateUpdate', gs.getStateForPlayer(i));
      }
    });
    gs.on('log', (msg) => {
      for (let i = 0; i < 2; i++) {
        if (this.sockets[i]) this.sockets[i].emit('log', msg);
      }
    });
    gs.on('toast', (data) => {
      for (let i = 0; i < 2; i++) {
        if (this.sockets[i]) this.sockets[i].emit('toast', data);
      }
    });
    gs.on('prompt', ({ player, type, data }) => {
      if (this.sockets[player]) this.sockets[player].emit('prompt', { type, data });
      this._pauseTurnTimer();
    });
    gs.on('turnScreen', ({ player, turn }) => {
      for (let i = 0; i < 2; i++) {
        if (this.sockets[i]) this.sockets[i].emit('turnScreen', { currentPlayer: player, turn, isYourTurn: player === i });
      }
      this._startTurnTimer(player);
    });
    gs.on('resolveResults', ({ results, thenAction }) => {
      for (let i = 0; i < 2; i++) {
        if (this.sockets[i]) {
          let r = results.map(x => {
            if (x.attackerPlayer !== undefined) return Object.assign({}, x, { isMyAttack: x.attackerPlayer === i });
            return x;
          });
          this.sockets[i].emit('resolveResults', { results: r, thenAction });
        }
      }
      this._pauseTurnTimer();
    });
    gs.on('chainDeclare', ({ player, cardId }) => {
      for (let i = 0; i < 2; i++) {
        if (this.sockets[i]) this.sockets[i].emit('chainDeclare', { isMe: player === i, cardId: cardId || null });
      }
    });
    gs.on('summonVoice', ({ cardId }) => {
      for (let i = 0; i < 2; i++) {
        if (this.sockets[i]) this.sockets[i].emit('summonVoice', { cardId });
      }
    });
    gs.on('lifeChange', (data) => {
      for (let i = 0; i < 2; i++) {
        if (this.sockets[i]) this.sockets[i].emit('lifeChange', { ...data, isMe: data.player === i });
      }
    });
    gs.on('peekHand', ({ player, cards }) => {
      if (this.sockets[player]) this.sockets[player].emit('peekHand', { player, cards });
    });
    gs.on('gameOver', ({ loser, winner }) => {
      this._clearTurnTimer();
      if (this.isBossRush && winner === 0) {
        let canContinue = false;
        if (this.isEndless) {
          canContinue = true;
        } else {
          let course = this.bossRushCourseId ? BOSS_RUSH_COURSES.find(c => c.id === this.bossRushCourseId) : BOSS_RUSH_COURSES[0];
          let maxStage = course ? course.stages.length - 1 : 2;
          canContinue = this.bossRushStage < maxStage;
        }
        if (canContinue) {
          const p = this.game.G.players[0];
          let grave = p.grave.map(c => JSON.parse(JSON.stringify(c)));
          let deck = p.deck.map(c => JSON.parse(JSON.stringify(c)));
          shuffle(grave);
          deck = [...deck, ...grave];
          const playerState = {
            life: p.life,
            field: p.field.filter(c => c).map(c => JSON.parse(JSON.stringify(c))),
            hand: p.hand.map(c => JSON.parse(JSON.stringify(c))),
            deck: deck,
            mana: p.mana.map(c => JSON.parse(JSON.stringify(c))),
            manaCards: p.manaCards,
            grave: []
          };
          this.bossRushStage++;
          if (this.isEndless && this.bossRushStage >= 5) {
            if (playerState.life > 2000) playerState.life = 2000;
            if (playerState.field.length > 4) {
              playerState.field.sort((a, b) => (b.power || 0) - (a.power || 0));
              let removed = playerState.field.splice(4);
              removed.forEach(c => playerState.grave.push(c));
            }
            if (playerState.hand.length > 7) {
              shuffle(playerState.hand);
              let removedHand = playerState.hand.splice(7);
              removedHand.forEach(c => playerState.deck.push(c));
            }
            if (playerState.mana.length > 10) {
              let removedMana = playerState.mana.splice(10);
              removedMana.forEach(c => playerState.deck.push(c));
              playerState.manaCards = playerState.mana.length;
            }
          }
          this._pendingBossRush = playerState;
          this._pendingBossRushTimer = setTimeout(() => this._triggerBossRushNext(), 5000);
          return;
        }
      }
      this.state = 'finished';
      if (this.isEndless && winner === 1) {
        let pid = this.playerIds && this.playerIds[0];
        if (pid) recordEndless(pid, this.names[0], this.bossRushStage);
        try { if (pid) db.recordMatch(pid, 'endless', 'lose', { stage: this.bossRushStage }); } catch(e) { console.error('db recordMatch error:', e.message); }
        for (let i = 0; i < 2; i++) {
          if (this.sockets[i]) this.sockets[i].emit('gameOver', { winner, loser, youWin: winner === i, endlessStage: this.bossRushStage });
        }
        return;
      }
      for (let i = 0; i < 2; i++) {
        if (this.sockets[i]) this.sockets[i].emit('gameOver', { winner, loser, youWin: winner === i });
      }
      if (!this.isAI && !this.isTutorial && !this.questId) {
        for (let i = 0; i < 2; i++) {
          let pid = this.playerIds && this.playerIds[i];
          if (pid) recordMatch(pid, this.names[i], winner === i);
          try { if (pid) db.recordMatch(pid, 'ranked', winner === i ? 'win' : 'lose', null); } catch(e) { console.error('db recordMatch error:', e.message); }
        }
      }
    });
  }

  start() {
    this.state = 'playing';
    this.game = new GameState(this.roomId);
    const gs = this.game;
    this._setupGameEvents(gs);

    // AI/Tutorial: ダミーsocketのactionイベントをhandleActionに中継
    if (this._aiSocket) {
      this._aiSocket.on('action', (data) => {
        this.handleAction(this._aiSocket, data.type, data);
      });
      if (this.isTutorial) {
        this.ai = new TutorialPlayer(this._aiSocket, gs);
        console.log('[GameRoom] Tutorial opponent created');
      } else {
        this.ai = new AIPlayer(this._aiSocket, gs);
        console.log('[GameRoom] AI created (socket-route)');
      }
    }

    if (this.isTutorial) {
      gs.initTutorial();
    } else if (this.questId) {
      gs.initQuest(this.questId, this.deckDefs && this.deckDefs[0]);
    } else if (this.isBossRush && this.isEndless) {
      let bossData = generateEndlessStage(this.bossRushStage);
      gs.initBossRush(this.deckDefs && this.deckDefs[0], this.bossRushStage, this.bossRushLife, null, null, bossData);
    } else if (this.isBossRush) {
      gs.initBossRush(this.deckDefs && this.deckDefs[0], this.bossRushStage, this.bossRushLife, this.bossRushCourseId);
    } else if (this.puzzleId) {
      gs.initPuzzle(this.puzzleId);
    } else {
      gs.init(this.deckDefs);
    }
  }

  _triggerBossRushNext() {
    if (!this._pendingBossRush) return;
    const ps = this._pendingBossRush;
    this._pendingBossRush = null;
    if (this._pendingBossRushTimer) { clearTimeout(this._pendingBossRushTimer); this._pendingBossRushTimer = null; }
    for (let i = 0; i < 2; i++) {
      if (this.sockets[i]) this.sockets[i].emit('bossRushNext', { stage: this.bossRushStage, life: ps.life });
    }
    setTimeout(() => this.startBossRushStage(ps), 3000);
  }

  startBossRushStage(playerState) {
    this.bossRushLife = playerState.life;
    if (this._aiSocket) {
      this._aiSocket.removeAllListeners('action');
      this._aiSocket.removeAllListeners('stateUpdate');
      this._aiSocket.removeAllListeners('prompt');
      this._aiSocket.removeAllListeners('turnScreen');
      this._aiSocket.removeAllListeners('resolveResults');
    }
    this.game = new GameState(this.roomId);
    const gs = this.game;
    this._setupGameEvents(gs);
    if (this._aiSocket) {
      this._aiSocket.on('action', (data) => {
        this.handleAction(this._aiSocket, data.type, data);
      });
      this.ai = new AIPlayer(this._aiSocket, gs);
    }
    if (this.isEndless) {
      let bossData = generateEndlessStage(this.bossRushStage);
      gs.initBossRush(this.deckDefs && this.deckDefs[0], this.bossRushStage, playerState.life, null, playerState, bossData);
    } else {
      gs.initBossRush(this.deckDefs && this.deckDefs[0], this.bossRushStage, playerState.life, this.bossRushCourseId, playerState);
    }
  }

  handleAction(socket, action, data) {
    if (this.state !== 'playing' || !this.game) return;
    let seat = socket.seat;

    switch (action) {
      case 'startTurn': this.game.startTurn(seat); break;
      case 'placeMana': this.game.placeMana(seat, data.idx); break;
      case 'playCard': this.game.playCard(seat, data.idx); break;
      case 'startCombat': this.game.startCombat(seat); break;
      case 'toggleAttacker': this.game.toggleAttacker(seat, data.fi); break;
      case 'confirmAttack': this.game.confirmAttack(seat); break;
      case 'cancelAttack': this.game.cancelAttack(seat); break;
      case 'activateAbility': this.game.activateAbility(data.fi, data.aid, seat); break;
      case 'endTurn': this.game.endTurn(seat); break;
      case 'enchantTarget': this.game.handleEnchantTarget(seat, data.fieldIdx); break;
      case 'creatorDiscard': this.game.handleCreatorDiscard(seat, data.selected); break;
      case 'promptResponse': this.game.handlePromptResponse(seat, data); break;
      case 'ackResolve':
        this.game.handleAckResolve(seat);
        if (this._pendingBossRush) this._triggerBossRushNext();
        break;
    }
    if (this._turnTimerExpired) {
      setTimeout(() => this._checkTimerExpired(), 100);
    } else if ((action === 'ackResolve' || action === 'promptResponse') && !this._turnTimer) {
      setTimeout(() => this._resumeTurnTimer(), 100);
    }
  }
}

module.exports = GameRoom;
