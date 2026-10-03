const GameState = require('./GameState');
const AIPlayer = require('./AIPlayer');
const TutorialPlayer = require('./TutorialPlayer');
const EventEmitter = require('events');
const { recordMatch, recordEndless } = require('./Ranking');
const db = require('./db');
const { BOSS_RUSH_COURSES, QUESTS } = require('../shared/quests');
const { CARD_DB } = require('../shared/cards');
const Unlocks = require('./unlocks');

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

// ターン制限時間(ms)。テスト用に環境変数で短縮できる
const TURN_TIMER_MS = +process.env.TURN_TIMER_MS || 90000;
// 表示は TURN_TIMER_MS のまま、サーバーの実際の期限はこの分だけ後ろにずらす。
// 残り0秒で押した操作が通信の遅れで届いても、まだ自分のターン内として受理される(交代後に届いて拒否されるのを防ぐ)
const TURN_TIMER_GRACE_MS = process.env.TURN_TIMER_GRACE_MS !== undefined ? +process.env.TURN_TIMER_GRACE_MS : 2000;
const dispSec = ms => Math.max(0, Math.ceil((ms - TURN_TIMER_GRACE_MS) / 1000)); // クライアント表示用(猶予を差し引く)
// 解決演出の確認(ack)が片方から来ない時の安全網。この時間を過ぎたら来ていない席の分をサーバーが代わりに入れて進める
const ACK_TIMEOUT_MS = +process.env.ACK_TIMEOUT_MS || 20000;
// 質問(プロンプト)の制限時間。質問中は90秒のターン制限が止まるため、質問そのものに時間をつける。
// 割り込み確認/ブロック選択: PROMPT_TIMEOUT_MS で自動パス/ブロック無し。それ以外: PROMPT_TIMEOUT_MS で再送、PROMPT_FORFEIT_MS で放置扱い(敗北)
const PROMPT_TIMEOUT_MS = +process.env.PROMPT_TIMEOUT_MS || 30000;
const PROMPT_FORFEIT_MS = +process.env.PROMPT_FORFEIT_MS || 90000;

class GameRoom {
  constructor(roomId) {
    this.createdAt = Date.now();
    this._acted = [0, 0];         // 各席の明示的な操作回数(試合全体。放置判定用)
    this._actedThisTurn = [0, 0]; // そのターン中の操作回数(時間切れが「放置」かどうかの判定用)
    this._timeoutStreak = [0, 0]; // 各席の「操作なしの時間切れ」の連続回数(操作したターンの時間切れは数えない)
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
    if (!this.deviceKeys) this.deviceKeys = [null, null];
    this.deviceKeys[seat] = socket.deviceKey || null; // 起動時の自動復帰を同じ端末だけに許可するための鍵
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

  leave(socket, seatArg) {
    let seat = seatArg !== undefined ? seatArg : socket.seat;
    if (seat === undefined || seat < 0) return;
    this.sockets[seat] = null;
    this._clearTurnTimer();
    this._clearAckTimeout();
    this._clearAllPromptTimeouts();
    if (this.state === 'playing') {
      this.state = 'finished'; this.finishedAt = Date.now();
      let other = this.sockets[1 - seat];
      if (other) other.emit('opponentLeft');
      if (!this.isAI && !this.isTutorial && !this.questId) {
        let winner = 1 - seat;
        let loserPid = this.playerIds && this.playerIds[seat];
        let winnerPid = this.playerIds && this.playerIds[winner];
        if (loserPid) recordMatch(loserPid, this.names[seat], false);
        if (winnerPid) recordMatch(winnerPid, this.names[winner], true);
        const turn = this.game && this.game.G ? this.game.G.turn : null;
        if (loserPid) db.recordMatch(loserPid, 'ranked', 'lose', { reason: 'disconnect', turn, opp: this.names[winner] }).catch(e => console.error('db recordMatch error:', e.message));
        if (winnerPid) db.recordMatch(winnerPid, 'ranked', 'win', { reason: 'disconnect', turn, opp: this.names[seat] }).catch(e => console.error('db recordMatch error:', e.message));
      }
    }
  }

  _startTurnTimer(player) {
    this._clearTurnTimer();
    console.log('[TIMER] _startTurnTimer p=' + player + ' isAI=' + this.isAI + ' isTut=' + this.isTutorial);
    if (this.isAI || this.isTutorial) return;
    this._turnTimerExpired = false;
    this._turnTimerPlayer = player;
    this._actedThisTurn[player] = 0; // 新しいターン
    this._turnTimerStart = Date.now();
    this._turnTimerRemaining = TURN_TIMER_MS + TURN_TIMER_GRACE_MS;
    for (let i = 0; i < 2; i++) {
      if (this.sockets[i]) this.sockets[i].emit('turnTimer', { remaining: Math.ceil(TURN_TIMER_MS / 1000), total: Math.ceil(TURN_TIMER_MS / 1000) });
    }
    this._turnTimer = setTimeout(() => this._onTurnTimeout(), this._turnTimerRemaining);
  }

  // 再接続した席に送る、ターン制限の現在値(進行中なら残り秒、プロンプト等で一時停止中なら停止時点の残り秒)
  getTurnTimerState() {
    if (this.isAI || this.isTutorial || this.state !== 'playing') return null;
    const total = Math.ceil(TURN_TIMER_MS / 1000);
    if (this._turnTimer) return { remaining: dispSec(Math.max(0, this._turnTimerRemaining - (Date.now() - this._turnTimerStart))), total };
    if (this._turnTimerRemaining != null) return { remaining: dispSec(this._turnTimerRemaining), total };
    return null;
  }

  // 質問(プロンプト)の制限時間
  _armPromptTimeout(player) {
    if (this.isAI && player === 1) return; // CPU側の質問はAIが自分で答える
    if (this.isTutorial) return; // チュートリアルは制限時間なし(割り込みの自動パスで台本のキャマキリが破壊され、進行不能になる)
    this._clearPromptTimeout(player);
    if (!this._promptTimers) this._promptTimers = [null, null];
    const gs = this.game; const pending = gs && gs.pendingPrompt[player];
    if (!pending) return;
    this._promptTimers[player] = setTimeout(() => {
      this._promptTimers[player] = null;
      if (!this.game || this.game._gameOver || this.state !== 'playing') return;
      if (this.game.pendingPrompt[player] !== pending) return; // もう答えている
      const t = pending.type;
      if (t === 'chain' || t === 'chain_attack') {
        console.log('[prompt-timeout] seat=' + player + ' ' + t + ' → 自動パス room=' + this.roomId);
        for (let i = 0; i < 2; i++) if (this.sockets[i]) this.sockets[i].emit('log', (this.names[player] || 'P' + (player + 1)) + ' は時間切れで割り込みしませんでした');
        this.handleAction(this.sockets[player] || { seat: player }, 'promptResponse', { data: { action: 'pass' } });
      } else if (t === 'block') {
        console.log('[prompt-timeout] seat=' + player + ' block → ブロック無し room=' + this.roomId);
        for (let i = 0; i < 2; i++) if (this.sockets[i]) this.sockets[i].emit('log', (this.names[player] || 'P' + (player + 1)) + ' は時間切れでブロックしませんでした');
        this.handleAction(this.sockets[player] || { seat: player }, 'promptResponse', { data: { assignments: {} } });
      } else {
        // 答えないと進めない質問: 再送して、さらに待っても無回答なら放置扱い
        console.log('[prompt-timeout] seat=' + player + ' ' + t + ' → 再送 room=' + this.roomId);
        if (this.sockets[player]) this.sockets[player].emit('prompt', { type: pending.type, data: pending.data });
        this._promptTimers[player] = setTimeout(() => {
          this._promptTimers[player] = null;
          if (!this.game || this.game._gameOver || this.state !== 'playing') return;
          if (this.game.pendingPrompt[player] !== pending) return;
          console.log('[prompt-timeout] seat=' + player + ' ' + t + ' → 放置扱いで敗北 room=' + this.roomId);
          for (let i = 0; i < 2; i++) if (this.sockets[i]) this.sockets[i].emit('log', (this.names[player] || 'P' + (player + 1)) + ' は選択に応答しなかったため敗北');
          this.game._terminate(player, 'prompt_timeout');
        }, Math.max(0, PROMPT_FORFEIT_MS - PROMPT_TIMEOUT_MS));
      }
    }, PROMPT_TIMEOUT_MS);
  }
  _clearPromptTimeout(player) { if (this._promptTimers && this._promptTimers[player]) { clearTimeout(this._promptTimers[player]); this._promptTimers[player] = null; } }
  _clearAllPromptTimeouts() { if (this._promptTimers) { this._clearPromptTimeout(0); this._clearPromptTimeout(1); } }

  // 確認(ack)待ちの安全網: 一定時間で来ていない席を自動ack(相手が放置・裏に回した等で対戦が固まるのを防ぐ)
  _armAckTimeout() {
    this._clearAckTimeout();
    this._ackTimer = setTimeout(() => {
      this._ackTimer = null;
      const gs = this.game;
      if (!gs || gs._gameOver || !gs._awaitingAck || this.state !== 'playing') return;
      const got = gs.ackResolve || new Set();
      for (let i = 0; i < 2; i++) {
        if (!gs._awaitingAck) break;
        if (!got.has(i)) { console.log('[ack-timeout] seat=' + i + ' を自動ack room=' + this.roomId); gs.handleAckResolve(i); }
      }
      if (gs._awaitingAck) { this._armAckTimeout(); return; } // 次の演出が続いた場合もう一度見張る
      // 通常のack(handleAction)と同じくターン制限タイマーの復帰/満了判定を通す(通さないと解決後もタイマーが止まったまま)
      setTimeout(() => { if (this._turnTimerExpired) this._checkTimerExpired(); else if (!this._turnTimer) this._resumeTurnTimer(); }, 100);
    }, ACK_TIMEOUT_MS);
  }
  _clearAckTimeout() { if (this._ackTimer) { clearTimeout(this._ackTimer); this._ackTimer = null; } }

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
    if (this.game && (this.game.G.chainDepth > 0 || this.game.G.effectStack.length > 0 || this.game.pendingPrompt[0] || this.game.pendingPrompt[1] || this.game._awaitingAck)) return;
    console.log('[TIMER] _resumeTurnTimer remaining=' + this._turnTimerRemaining);
    if (this._turnTimerRemaining == null || this._turnTimerRemaining <= 0) { this._onTurnTimeout(); return; }
    this._turnTimerStart = Date.now();
    for (let i = 0; i < 2; i++) {
      if (this.sockets[i]) this.sockets[i].emit('turnTimer', { remaining: dispSec(this._turnTimerRemaining), total: Math.ceil(TURN_TIMER_MS / 1000) });
    }
    this._turnTimer = setTimeout(() => this._onTurnTimeout(), this._turnTimerRemaining);
  }

  _onTurnTimeout() {
    this._turnTimer = null;
    console.log('[TIMER] _onTurnTimeout state=' + this.state + ' player=' + this._turnTimerPlayer);
    if (this.state !== 'playing' || !this.game) return;
    const gs = this.game;
    const p = this._turnTimerPlayer;
    if (gs.G.chainDepth > 0 || gs.G.effectStack.length > 0 || gs.pendingPrompt[0] || gs.pendingPrompt[1] || gs._awaitingAck) {
      this._turnTimerExpired = true;
      return;
    }
    this._expireTurn(p);
  }

  // 時間切れでターンを終える。一度も操作していないプレイヤーの時間切れ、または2ターン連続の時間切れは
  // 放置(閉じたアプリの幽霊接続・バックグラウンドの端末)とみなして敗北にする。
  // これが無いと、幽霊とマッチした相手は「相手が何もしない」まま永久に待たされる
  _expireTurn(p) {
    const gs = this.game;
    // そのターンに何か操作していれば「考えていて時間が切れた」だけ → ターンが終わるだけで、放置のカウントには入れない(リセット)。
    // 操作ゼロの時間切れだけを数え、①試合を通して一度も操作していない、②操作なしの時間切れが2ターン連続、で放置=敗北
    const idle = (this._actedThisTurn[p] || 0) === 0;
    this._timeoutStreak[p] = idle ? (this._timeoutStreak[p] || 0) + 1 : 0;
    for (let i = 0; i < 2; i++) {
      if (this.sockets[i]) this.sockets[i].emit('turnTimer', { remaining: 0, total: 60 });
    }
    if (idle && (this._acted[p] === 0 || this._timeoutStreak[p] >= 2)) {
      console.log('[TIMER] AFK forfeit p=' + p + ' acted=' + this._acted[p] + ' idleStreak=' + this._timeoutStreak[p]);
      for (let i = 0; i < 2; i++) {
        if (this.sockets[i]) this.sockets[i].emit('log', this.names[p] + ' は操作がないまま時間切れが続いたため敗北');
      }
      gs._terminate(p, 'afk');
      return;
    }
    if (idle) { for (let i = 0; i < 2; i++) if (this.sockets[i]) this.sockets[i].emit('log', this.names[p] + ' は時間切れ(操作なし)。次も操作がなければ敗北'); }
    gs.endTurn(p);
  }

  _checkTimerExpired() {
    if (!this._turnTimerExpired) return;
    if (!this.game) return;
    const gs = this.game;
    if (gs.G.chainDepth > 0 || gs.G.effectStack.length > 0 || gs.pendingPrompt[0] || gs.pendingPrompt[1] || gs._awaitingAck) return;
    this._turnTimerExpired = false;
    this._expireTurn(this._turnTimerPlayer);
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
      this._armPromptTimeout(player);
    });
    gs.on('turnScreen', ({ player, turn }) => {
      for (let i = 0; i < 2; i++) {
        if (this.sockets[i]) this.sockets[i].emit('turnScreen', { currentPlayer: player, turn, isYourTurn: player === i });
      }
      this._startTurnTimer(player);
    });
    gs.on('resolveResults', ({ results, thenAction }) => {
      gs._awaitingAck = true; // 両者のackが揃うまで解決が止まる。再接続時の自動ack判定に使う
      this._armAckTimeout();
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
    gs.on('gameOver', ({ loser, winner, reason }) => {
      const detail = { reason: reason || 'life', turn: gs.G ? gs.G.turn : null, opp: [this.names[1], this.names[0]] }; // 戦績の理由(降参/放置/無回答/LP0)。後から問い合わせを調べられるように
      this._clearTurnTimer();
      this._clearAckTimeout();
      this._clearAllPromptTimeouts();
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
          let grave = p.grave.filter(c => !c.isToken).map(c => JSON.parse(JSON.stringify(c)));
          let deck = p.deck.filter(c => !c.isToken).map(c => JSON.parse(JSON.stringify(c)));
          shuffle(grave);
          deck = [...deck, ...grave];
          const playerState = {
            life: p.life,
            field: p.field.filter(c => c && !c.isToken).map(c => JSON.parse(JSON.stringify(c))),
            hand: p.hand.filter(c => !c.isToken).map(c => JSON.parse(JSON.stringify(c))),
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
              removed.forEach(c => { c.counters = []; playerState.grave.push(c); }); // 場を離れるのでカウンターは消す
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
      this.state = 'finished'; this.finishedAt = Date.now();
      if (this.isEndless && winner === 1) {
        let pid = this.playerIds && this.playerIds[0];
        if (pid) recordEndless(pid, this.names[0], this.bossRushStage);
        if (pid) db.recordMatch(pid, 'endless', 'lose', { stage: this.bossRushStage, reason: detail.reason }).catch(e => console.error('db recordMatch error:', e.message));
        for (let i = 0; i < 2; i++) {
          if (this.sockets[i]) this.sockets[i].emit('gameOver', { winner, loser, youWin: winner === i, endlessStage: this.bossRushStage, reason: detail.reason });
        }
        return;
      }
      for (let i = 0; i < 2; i++) {
        if (this.sockets[i]) this.sockets[i].emit('gameOver', { winner, loser, youWin: winner === i, reason: detail.reason });
      }
      if (this.questId && this.isAI && winner === 0) this._grantQuestReward();
      if (!this.isAI && !this.isTutorial && !this.questId) {
        for (let i = 0; i < 2; i++) {
          let pid = this.playerIds && this.playerIds[i];
          if (pid) recordMatch(pid, this.names[i], winner === i);
          if (pid) db.recordMatch(pid, 'ranked', winner === i ? 'win' : 'lose', { reason: detail.reason, turn: detail.turn, opp: detail.opp[i] }).catch(e => console.error('db recordMatch error:', e.message));
        }
      } else if (this.isAI && !this.isTutorial) {
        // CPU戦/クエスト/ボスラッシュは「自分の戦績」用にだけ記録(ランキング集計には含めない)
        let pid = this.playerIds && this.playerIds[0];
        let mode = this.questId ? 'quest' : (this.isBossRush ? 'boss' : 'cpu');
        if (pid) db.recordMatch(pid, mode, winner === 0 ? 'win' : 'lose', this.questId ? { quest: this.questId } : null).catch(e => console.error('db recordMatch error:', e.message));
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

  // クエスト報酬(カードの使用権の解除)。勝敗はサーバーが判定しているので、付与もここで行う(クライアントの申告では付与しない)。
  // 付与先は対戦開始時に確定した席0のID。ゲスト(p_)に付いた解除は、後からログインしても引き継がない(過去データを移行しない方針)。
  // 保存が済んでから結果を知らせる。失敗したら1回だけやり直す
  _grantQuestReward() {
    const quest = QUESTS.find(q => q.id === this.questId);
    const cards = quest && quest.reward && quest.reward.unlockCards;
    if (!cards || cards.length === 0) return;
    const sock = this.sockets[0];
    const pid = this.playerIds && this.playerIds[0];
    const nameOf = id => { const c = CARD_DB.find(x => x.id === id); return c ? c.name : id; };
    if (!pid) { if (sock) sock.emit('questReward', { ok: false, reason: 'noid', cards: [] }); return; }
    const devKey = (this.deviceKeys && this.deviceKeys[0]) || (sock && sock.deviceKey) || null; // ゲストは、クリアしたこの端末でだけ使えるようにする
    const tryGrant = (left) => Unlocks.grant(pid, cards, this.names[0], devKey).then(added => {
      console.log('[quest-reward] ' + this.questId + ' pid=' + pid + ' added=' + added.join(','));
      if (sock) sock.emit('questReward', { ok: true, cards: added, names: added.map(nameOf), all: cards, guest: !String(pid).startsWith('u_') });
    }).catch(e => {
      console.error('[quest-reward] error pid=' + pid + ': ' + e.message);
      if (e && e.message === 'nodevice') { if (sock) sock.emit('questReward', { ok: false, reason: 'nodevice', cards: [] }); return; }
      if (left > 0) return new Promise(r => setTimeout(r, 1500)).then(() => tryGrant(left - 1));
      if (sock) sock.emit('questReward', { ok: false, reason: 'save', cards: [] });
    });
    tryGrant(1);
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
    // 自動送信される startTurn/ackResolve/resendPrompt 以外は「本人の操作」として数える(放置判定用)。
    // 連続時間切れの回数は、自分でターンを終えた時だけリセットする(ターン中に何か操作しても時間切れは時間切れ)
    if ((seat === 0 || seat === 1) && action !== 'startTurn' && action !== 'ackResolve' && action !== 'resendPrompt') {
      this._acted[seat]++;
      this._actedThisTurn[seat] = (this._actedThisTurn[seat] || 0) + 1;
      if (action === 'endTurn') this._timeoutStreak[seat] = 0;
    }

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
      case 'surrender': this.game.surrender(seat); break;
      case 'enchantTarget': this.game.handleEnchantTarget(seat, data.fieldIdx); break;
      case 'creatorDiscard': this.game.handleCreatorDiscard(seat, data.selected); break;
      case 'promptResponse': this._clearPromptTimeout(seat); this.game.handlePromptResponse(seat, data); break;
      // クライアント側でプロンプトの表示が消えた時の再送（進行不能の自己回復）。未回答のものだけ再送する
      case 'resendPrompt': {
        let pp = this.game.pendingPrompt && this.game.pendingPrompt[seat];
        if (pp) this.game.emit('prompt', { player: seat, type: pp.type, data: pp.data });
        break;
      }
      case 'ackResolve':
        this.game.handleAckResolve(seat);
        if (!this.game._awaitingAck) this._clearAckTimeout();
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
