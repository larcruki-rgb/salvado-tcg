const GameState = require('./GameState');
const AIPlayer = require('./AIPlayer');
const TutorialPlayer = require('./TutorialPlayer');
const EventEmitter = require('events');

class GameRoom {
  constructor(roomId) {
    this.roomId = roomId;
    this.sockets = [null, null];
    this.names = ['P1', 'P2'];
    this.state = 'waiting';
    this.game = null;
    this.ai = null;
  }

  join(socket, name, deckDef) {
    let seat = -1;
    if (!this.sockets[0]) seat = 0;
    else if (!this.sockets[1]) seat = 1;
    else return -1;

    this.sockets[seat] = socket;
    this.names[seat] = name || ('P' + (seat + 1));
    if (!this.deckDefs) this.deckDefs = [null, null];
    this.deckDefs[seat] = deckDef || null;
    socket.seat = seat;
    socket.roomId = this.roomId;

    if (this.sockets[0] && this.sockets[1]) {
      this.start();
    }
    return seat;
  }

  joinAI(deckDef, tutorial) {
    if (tutorial) this.isTutorial = true;
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
    if (this.state === 'playing') {
      this.state = 'finished';
      let other = this.sockets[1 - seat];
      if (other) other.emit('opponentLeft');
    }
  }

  start() {
    this.state = 'playing';
    this.game = new GameState(this.roomId);
    const gs = this.game;

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
    });

    gs.on('turnScreen', ({ player, turn }) => {
      for (let i = 0; i < 2; i++) {
        if (this.sockets[i]) this.sockets[i].emit('turnScreen', { currentPlayer: player, turn, isYourTurn: player === i });
      }
    });

    gs.on('resolveResults', ({ results, thenAction }) => {
      for (let i = 0; i < 2; i++) {
        if (this.sockets[i]) this.sockets[i].emit('resolveResults', { results, thenAction });
      }
    });

    gs.on('summonVoice', ({ cardId }) => {
      for (let i = 0; i < 2; i++) {
        if (this.sockets[i]) this.sockets[i].emit('summonVoice', { cardId });
      }
    });

    gs.on('peekHand', ({ player, cards }) => {
      if (this.sockets[player]) this.sockets[player].emit('peekHand', { player, cards });
    });

    gs.on('gameOver', ({ loser, winner }) => {
      this.state = 'finished';
      for (let i = 0; i < 2; i++) {
        if (this.sockets[i]) this.sockets[i].emit('gameOver', { winner, loser, youWin: winner === i });
      }
    });

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
    } else {
      gs.init(this.deckDefs);
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
      case 'ackResolve': this.game.handleAckResolve(seat); break;
    }
  }
}

module.exports = GameRoom;
