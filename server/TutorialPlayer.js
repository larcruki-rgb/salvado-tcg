const { makeCard, CARD_DB } = require('../shared/cards');

// チュートリアルの相手役(台本どおりに動く)
//  ターン1: 動画編集(キャマキリを対象) → プレイヤーが動画削除で打ち消す → 一般女子高生Aを投稿 → ターン終了
//  ターン2: ママチャリ暴走族(俊足)を投稿 → それで攻撃(プレイヤーのブロック練習) → ターン終了
//  ブロック: プレイヤーの攻撃はキャマキリを一般女子高生Aで止める(妹系ヒロインは通す)
const READ_FALLBACK_MS = 12000; // 「次へ」を送ってこない古いクライアント向けの待ち時間
const AFTER_PLAY_MS = 3500;     // 相手がカードを出してからターンを終えるまでの間

class TutorialPlayer {
  constructor(socket, gs) {
    this.socket = socket;
    this.gs = gs;
    this.seat = socket.seat;
    this.waitingAck = false;
    this._attackedTurn = 0;
    // 打ち消しの説明を読む時間: プレイヤーが「次へ」を押す(tutorialContinue)まで、相手役は次の行動をしない。
    // 新しいクライアントは説明を出した時に tutorialHold を送る → 押すまで待つ。送ってこない古いクライアントは READ_FALLBACK_MS で先へ進む
    this._readOk = false; this._hold = false; this._readSince = 0; this._jkAt = 0; this._readTimer = null;

    socket.on('stateUpdate', (state) => {
      if (!this.waitingAck && this.gs.G.cp === this.seat && (this.gs.G.phase === 'main' || this.gs.G.phase === 'main2')) {
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
        this.waitingAck = false; // send より先に下ろす(AIPlayer と同じ理由)
        this.send('ackResolve');
        setTimeout(() => {
          if (this.gs.G.cp === this.seat && (this.gs.G.phase === 'main' || this.gs.G.phase === 'main2')) this.doTurn();
        }, 600);
      }, 400);
    });
  }

  _scheduleRetry(ms) { if (this._readTimer) clearTimeout(this._readTimer); this._readTimer = setTimeout(() => { this._readTimer = null; this.doTurn(); }, Math.max(50, ms)); }
  // プレイヤーが説明を出した(=押すまで待ってほしい)
  onHold() { this._hold = true; }
  // プレイヤーが「次へ」を押した
  onContinue() { this._readOk = true; this._hold = false; if (this._readTimer) { clearTimeout(this._readTimer); this._readTimer = null; } this.doTurn(); }

  send(type, data) {
    this.socket.emit('action', Object.assign({ type }, data || {}));
  }

  me() { return this.gs.G.players[this.seat]; }

  doTurn() {
    let turn = this.gs.G.turn;
    let hand = this.me().hand;
    let phase = this.gs.G.phase;

    if (this.gs.G.cp !== this.seat) return;
    if (this.gs.pendingPrompt[0] || this.gs.pendingPrompt[1]) return;
    if (this.gs.G.effectStack.length > 0 || this.gs.G.chainDepth > 0) return;
    if (phase === 'main2') { this.send('endTurn'); return; }
    if (phase !== 'main') return;

    const tryPlay = (id) => {
      let i = hand.findIndex(c => c.id === id);
      let card = i >= 0 ? hand[i] : null;
      if (card && this.gs.avMana(this.seat) >= card.cost) { this.send('playCard', { idx: i }); return true; }
      return false;
    };

    if (turn === 1) {
      // 動画編集(プレイヤーが打ち消す) → [説明を読む時間] → 一般女子高生A → [少し待つ] → ターン終了
      if (tryPlay('douga_henshuu')) return;
      if (hand.some(c => c.id === 'jk_a')) {
        if (!this._readOk) {
          if (!this._readSince) this._readSince = Date.now();
          const waited = Date.now() - this._readSince;
          if (this._hold || waited < READ_FALLBACK_MS) { this._scheduleRetry(this._hold ? 2000 : READ_FALLBACK_MS - waited + 50); return; }
        }
        if (tryPlay('jk_a')) { this._jkAt = Date.now(); return; }
      }
      // 女子高生Aを出した直後にターンを終えると、「相手は〜を投稿した」を読む間が無い
      if (this._jkAt && Date.now() - this._jkAt < AFTER_PLAY_MS) { this._scheduleRetry(AFTER_PLAY_MS - (Date.now() - this._jkAt) + 50); return; }
      this.send('endTurn');
    } else if (turn === 2) {
      // ママチャリ暴走族(俊足)を出して、それで攻撃する
      if (tryPlay('mamachari')) return;
      let fi = this.me().field.findIndex(c => c.id === 'mamachari' && !c.tapped && !c.summonSick);
      if (fi >= 0 && this._attackedTurn !== turn) {
        this.send('startCombat');
        // 解決演出の ack 待ち(_busy)などで受け付けられなかった時は、次の盤面更新でやり直す(ここで「攻撃済み」にしない)
        if (this.gs.G.phase !== 'attack') return;
        this._attackedTurn = turn;
        this.send('toggleAttacker', { fi });
        setTimeout(() => this.send('confirmAttack'), 400);
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
      case 'block': {
        // キャマキリを一般女子高生Aでブロック(妹系ヒロインは通す)。
        // assignments のキーは「攻撃側の場の番号」(data.attackers[].idx)。一覧の中の順番ではない
        let assignments = {};
        if (data.attackers && data.blockers && data.blockers.length > 0) {
          let kya = data.attackers.find(a => a.name && a.name.includes('キャマキリ')) || data.attackers[0];
          if (kya) assignments[kya.idx] = data.blockers[0].idx;
        }
        this.send('promptResponse', { assignments });
        break;
      }
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
