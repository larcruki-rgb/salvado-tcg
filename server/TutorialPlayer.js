const { makeCard, CARD_DB } = require('../shared/cards');

class TutorialPlayer {
  constructor(socket, gs) {
    this.socket = socket;
    this.gs = gs;
    this.seat = socket.seat;
    this.waitingAck = false;

    socket.on('stateUpdate', (state) => {
      if (!this.waitingAck && this.gs.G.cp === this.seat && this.gs.G.phase === 'main') {
        setTimeout(() => this.doTurn(), 800);
      }
    });

    socket.on('turnScreen', (data) => {
      if (data.isYourTurn) {
        setTimeout(() => {
          this.send('startTurn');
          setTimeout(() => this.doTurn(), 600);
        }, 1500);
      }
    });

    socket.on('prompt', ({ type, data }) => {
      setTimeout(() => this.handlePrompt(type, data), 500);
    });

    socket.on('resolveResults', () => {
      this.waitingAck = true;
      setTimeout(() => {
        this.send('ackResolve');
        this.waitingAck = false;
        setTimeout(() => {
          if (this.gs.G.cp === this.seat && this.gs.G.phase === 'main') this.doTurn();
        }, 600);
      }, 400);
    });
  }

  send(type, data) {
    this.socket.emit('action', Object.assign({ type }, data || {}));
  }

  me() { return this.gs.G.players[this.seat]; }

  doTurn() {
    let turn = this.gs.G.turn;
    let hand = this.me().hand;
    let phase = this.gs.G.phase;

    if (phase !== 'main') return;
    if (this.gs.pendingPrompt[0] || this.gs.pendingPrompt[1]) return;
    if (this.gs.G.effectStack.length > 0 || this.gs.G.chainDepth > 0) return;

    if (turn === 1) {
      // ターン1: 動画編集を使う → チェーンでプレイヤーに割り込みさせる
      // → 打ち消された後、パン屋の娘カエラを投稿
      let doHenIdx = hand.findIndex(c => c.id === 'douga_henshuu');
      if (doHenIdx >= 0 && this.gs.avMana(this.seat) >= 2) {
        this.send('playCard', { idx: doHenIdx });
        return;
      }
      let kaeraIdx = hand.findIndex(c => c.id === 'kaera');
      if (kaeraIdx >= 0 && this.gs.avMana(this.seat) >= 1) {
        this.send('playCard', { idx: kaeraIdx });
        return;
      }
      this.send('endTurn');
    } else {
      this.send('endTurn');
    }
  }

  handlePrompt(type, data) {
    switch (type) {
      case 'chain':
      case 'chain_attack':
        this.send('promptResponse', { action: 'pass' });
        break;
      case 'block':
        // カエラでキャマキリをブロック
        let assignments = {};
        if (data.attackers && data.blockers && data.blockers.length > 0) {
          let kyamaIdx = data.attackers.findIndex(a => a.name && a.name.includes('キャマキリ'));
          if (kyamaIdx >= 0) {
            assignments[kyamaIdx] = data.blockers[0].idx;
          } else {
            assignments[0] = data.blockers[0].idx;
          }
        }
        this.send('promptResponse', { assignments });
        break;
      case 'debuff_target':
        // キャマキリを対象に選ぶ
        if (data.targets && data.targets.length > 0) {
          let kya = data.targets.find(t => t.name && t.name.includes('キャマキリ'));
          let target = kya || data.targets[0];
          this.send('promptResponse', { targetIdx: target.idx, pi: target.pi });
        }
        break;
      case 'regen_confirm':
        this.send('promptResponse', { accept: false });
        break;
      default:
        this.send('promptResponse', {});
        break;
    }
  }
}

module.exports = TutorialPlayer;
