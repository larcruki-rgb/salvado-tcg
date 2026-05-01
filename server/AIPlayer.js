// サルベドTCG AI対戦システム（socket-route版）
// AIはsocket.emit('action')で操作。人間と同じルートを通る。
// GameStateの直接呼び出しは一切行わない。

const SUMMON_PRIORITY = ['tomo','shinigami','jun','izuna','milia','ark'];
const REMOVE_PRIORITY = ['miiko','shinigami','tomo','ark','milia','izuna'];
const DRAW_CARDS = ['hikaru','oyuchi','nari','ai_tsubame','salvado_cat','sakamachi'];

class AIPlayer {
  constructor(socket, gs) {
    this.socket = socket;
    this.gs = gs;
    this.seat = socket.seat;
    this.state = null;
    this.acting = false;

    this.waitingAck = false;

    socket.on('stateUpdate', (state) => {
      this.state = state;
      if (!this.waitingAck) {
        setTimeout(() => {
          if (!this.waitingAck && this.isReady()) {
            console.log('[AI] stateUpdate → doMainPhase');
            this.doMainPhase();
          }
        }, 800);
      }
    });

    socket.on('turnScreen', (data) => {
      console.log('[AI] turnScreen isYourTurn=' + data.isYourTurn + ' turn=' + data.turn + ' waitingAck=' + this.waitingAck + ' phase=' + this.gs.G.phase);
      if (data.isYourTurn) {
        console.log('[AI] ターン開始');
        setTimeout(() => {
          console.log('[AI] startTurn送信 phase=' + this.gs.G.phase);
          this.send('startTurn');
          setTimeout(() => this.doMainPhase(), 600);
        }, 800);
      }
    });

    socket.on('prompt', ({ type, data }) => {
      console.log('[AI] prompt: ' + type);
      setTimeout(() => this.handlePrompt(type, data), 500);
    });

    socket.on('resolveResults', ({ results }) => {      this.waitingAck = true;
      console.log('[AI] resolveResults');
      setTimeout(() => {
        this.send('ackResolve');        this.waitingAck = false;
        setTimeout(() => this.doMainPhase(), 600);
      }, 400);
    });
  }

  send(type, data) {
    this.socket.emit('action', Object.assign({ type }, data || {}));
  }

  me() { return this.gs.G.players[this.seat]; }
  opp() { return this.gs.G.players[1 - this.seat]; }
  avMana() { return this.gs.avMana(this.seat); }

  isReady() {
    let G = this.gs.G;
    if (G.cp !== this.seat) return false;
    if (G.phase !== 'main' && G.phase !== 'main2') return false;
    if (this.gs.pendingPrompt[0] || this.gs.pendingPrompt[1]) return false;
    if (G.effectStack.length > 0 || G.chainDepth > 0) return false;
    if (G.waitingAction) return false;
    return true;
  }

  canPlay(c) {
    if (c.type === 'creature' && !this.gs.checkLeg(c, this.seat)) return false;
    return true;
  }

  // === メインフェイズ ===

  doMainPhase() {
    if (!this.isReady()) {
      console.log('[AI] doMainPhase skipped (not ready)');
      return;
    }
    if (this.acting) return;
    this.acting = true;

    let hand = this.me().hand;
    let mana = this.avMana();
    console.log('[AI] doMainPhase mana=' + mana + ' hand=' + hand.length);

    let reserveMana = 0;
    if (hand.some(c => c.id === 'douga_sakujo')) reserveMana = Math.max(reserveMana, 3);
    if (this.me().field.some(c => c.id === 'miiko') || this.me().field.some(c => c.enchantments && c.enchantments.some(e => e.id === 'parasite')))
      reserveMana = Math.max(reserveMana, 2);
    let usableMana = mana - reserveMana;

    // マナ置き（10マナ未満の時のみ）
    if (!this.gs.G.manaPlaced && mana < 10) {
      let idx = this.pickManaCard();
      if (idx >= 0) {
        console.log('[AI] マナ置き idx=' + idx);
        this.send('placeMana', { idx });
        this.acting = false;
        setTimeout(() => this.doMainPhase(), 500);
        return;
      }
    }

    // A: 優先召喚
    for (let pid of SUMMON_PRIORITY) {
      let idx = hand.findIndex(c => c.id === pid && c.type === 'creature' && c.cost <= usableMana && this.canPlay(c));
      if (idx >= 0) { this.send('playCard', { idx }); this.acting = false; return; }
    }

    // B: 除去
    let oppField = this.opp().field.filter(c => c.type === 'creature');
    let myCreatures = this.me().field.filter(c => c.type === 'creature').length;

    if (oppField.length - myCreatures >= 3) {
      let idx = hand.findIndex(c => c.id === 'channel_sakujo' && c.cost <= usableMana);
      if (idx >= 0) { this.send('playCard', { idx }); this.acting = false; return; }
    }

    if (oppField.length > 0) {
      let idx = hand.findIndex(c => (c.id === 'kikaku_botsu' || c.id === 'salvado_cat_yarakashi') && c.cost <= usableMana);
      if (idx >= 0 && oppField.some(c => REMOVE_PRIORITY.includes(c.id))) {
        this.send('playCard', { idx }); this.acting = false; return;
      }
    }

    // C: ドローソース(残5マナ以上)
    if (usableMana >= 5) {
      for (let did of DRAW_CARDS) {
        let idx = hand.findIndex(c => c.id === did && c.cost <= usableMana);
        if (idx >= 0) { this.send('playCard', { idx }); this.acting = false; return; }
      }
    }

    // その他クリーチャー（コスト高い順）
    let others = hand.map((c, i) => ({ c, i }))
      .filter(x => x.c.type === 'creature' && x.c.cost <= usableMana && !SUMMON_PRIORITY.includes(x.c.id) && this.canPlay(x.c))
      .sort((a, b) => b.c.cost - a.c.cost);
    if (others.length > 0) { this.send('playCard', { idx: others[0].i }); this.acting = false; return; }

    // エンチャント
    let eIdx = hand.findIndex(c => c.type === 'enchantment' && c.cost <= usableMana);
    if (eIdx >= 0 && this.me().field.some(c => c.type === 'creature')) {
      this.send('playCard', { idx: eIdx }); this.acting = false; return;
    }

    // 何も出せなかった場合、マナ置きしてなければ置く
    if (!this.gs.G.manaPlaced) {
      let idx = this.pickManaCard();
      if (idx >= 0) {
        console.log('[AI] マナ置き(後回し) idx=' + idx);
        this.send('placeMana', { idx });
      }
    }

    this.acting = false;

    // メイン終了 → 攻撃 or ターンエンド
    if (this.gs.G.phase === 'main') {
      this.doAttack();
    } else {
      this.send('endTurn');
    }
  }

  doAttack() {
    let attackable = this.me().field.filter(c =>
      c.type === 'creature' && !c.tapped && !c.summonSick &&
      (!c.abilities || !c.abilities.includes('cannot_attack'))
    );
    if (attackable.length === 0) {
      console.log('[AI] 攻撃不可→endTurn cp=' + this.gs.G.cp + ' seat=' + this.seat + ' phase=' + this.gs.G.phase + ' chain=' + this.gs.G.chainDepth + ' eStack=' + this.gs.G.effectStack.length + ' pp0=' + !!this.gs.pendingPrompt[0] + ' pp1=' + !!this.gs.pendingPrompt[1]);
      this.send('endTurn');
      return;
    }
    this.send('startCombat');
    this.me().field.forEach((c, i) => {
      if (c.type === 'creature' && !c.tapped && !c.summonSick &&
          (!c.abilities || !c.abilities.includes('cannot_attack'))) {
        this.send('toggleAttacker', { fi: i });
      }
    });
    setTimeout(() => this.send('confirmAttack'), 400);
  }

  pickManaCard() {
    let hand = this.me().hand;
    if (hand.length === 0) return -1;
    let candidates = hand.map((c, i) => ({ c, i }));
    candidates.sort((a, b) => {
      let ap = SUMMON_PRIORITY.indexOf(a.c.id); if (ap < 0) ap = 99;
      let bp = SUMMON_PRIORITY.indexOf(b.c.id); if (bp < 0) bp = 99;
      if (ap !== bp) return bp - ap;
      return a.c.cost - b.c.cost;
    });
    return candidates[0].i;
  }

  // === プロンプト応答 ===

  respond(data) {
    this.send('promptResponse', data);
  }

  handlePrompt(type, data) {
    console.log('[AI] handlePrompt type=' + type);
    switch (type) {
      case 'chain':
      case 'chain_attack':
        this.handleChain(type, data); break;
      case 'block':
        this.handleBlock(data); break;
      case 'regen_confirm':
        this.respond({ regen: true }); break;
      case 'enchant_target':
        this.handleEnchantTarget(data); break;
      case 'buff_target':
        if (data.targets && data.targets.length > 0)
          this.respond({ targetIdx: data.targets[0].idx });
        break;
      case 'debuff_target':
        this.handlePriorityTarget(data); break;
      case 'destroy_target':
      case 'shinigami_destroy_target':
      case 'yarakashi_target':
        this.handlePriorityTarget(data); break;
      case 'ichiko_choice':
        this.handleIchiko(); break;
      case 'makkinii_choice':
        this.respond({ choice: data.canMana ? 'mana' : 'alt' }); break;
      case 'shuffle_confirm':
      case 'asaki_peek':
        this.respond({ shuffle: true }); break;
      case 'nari_pick':
      case 'sakamachi_pick':
        this.handlePickBest(data); break;
      case 'gomo_pick':
        if (data.cards && data.cards.length > 0) {
          let sorted = [...data.cards].sort((a, b) => b.cost - a.cost);
          this.respond({ selected: sorted.slice(0, 2).map(c => c.idx) });
        } else { this.respond({ selected: [] }); } break;
      case 'salvado_cat_pick':
        if (data.cards && data.cards.length > 0) {
          let sorted = [...data.cards].sort((a, b) => b.cost - a.cost);
          this.respond({ selected: sorted.slice(0, 3).map(c => c.idx) });
        } break;
      case 'discard_one':
        if (data.cards && data.cards.length > 0) {
          let best = data.cards.reduce((a, b) => a.cost >= b.cost ? a : b);
          this.respond({ idx: best.idx });
        } break;
      case 'seishun_kiben_target':
      case 'free_play':
        if (data.targets && data.targets.length > 0) {
          let best = data.targets.reduce((a, b) => a.cost >= b.cost ? a : b);
          this.respond({ idx: best.idx });
        } else {
          this.respond({ idx: -1 });
        } break;
      case 'counterspell_target':
        if (data.targets && data.targets.length > 0)
          this.respond({ idx: 0 });
        break;
      case 'target_damage':
        this.handlePriorityTarget(data); break;
      case 'waiting':
        break;
      default:
        this.respond({}); break;
    }
  }

  handleChain(type, data) {
    let hand = this.me().hand;
    let mana = this.avMana();
    let desc = data.description || '';

    let dIdx = hand.findIndex(c => c.id === 'douga_sakujo' && c.cost <= mana);
    if (dIdx >= 0) {
      let counterTargets = ['死神少女','ジュン','トモ','アーク','ミリア','イズナ','チャンネル削除'];
      if (counterTargets.some(n => desc.includes(n))) {
        this.respond({ action: 'playSupport', idx: dIdx }); return;
      }
    }

    let shinigamiField = this.me().field.find(c => c.id === 'shinigami' && !c.tapped);
    if (shinigamiField && this.me().life >= 800) {
      let counterTargets2 = ['トモ','アーク','ミリア','死神少女','チャンネル削除'];
      if (counterTargets2.some(n => desc.includes(n))) {
        let fi = this.me().field.indexOf(shinigamiField);
        this.respond({ action: 'activate', fi, aid: 'shinigami_counter' }); return;
      }
    }

    let izunaField = this.me().field.find(c => c.id === 'izuna' && !c.tapped);
    if (izunaField && mana >= 2 && this.opp().field.some(c => c.type === 'creature')) {
      let fi = this.me().field.indexOf(izunaField);
      this.respond({ action: 'activate', fi, aid: 'activated_izuna' }); return;
    }

    if (type === 'chain_attack') {
      let kwIdx = hand.findIndex(c => c.id === 'kanwa_kyuudai' && c.cost <= mana);
      if (kwIdx >= 0) { this.respond({ action: 'playSupport', idx: kwIdx }); return; }

      let mkIdx = hand.findIndex(c => c.id === 'makkinii' && c.cost <= mana);
      if (mkIdx >= 0) { this.respond({ action: 'playSupport', idx: mkIdx }); return; }

      let scIdx = hand.findIndex(c => c.id === 'super_chat' && c.cost <= mana);
      if (scIdx >= 0) { this.respond({ action: 'playSupport', idx: scIdx }); return; }

      let iIdx = hand.findIndex(c => c.id === 'ichiko' && c.cost <= mana);
      if (iIdx >= 0) { this.respond({ action: 'playSupport', idx: iIdx }); return; }
    }

    let shIdx = hand.findIndex(c => c.id === 'shueki_teishi' && c.cost <= mana);
    if (shIdx >= 0) { this.respond({ action: 'playSupport', idx: shIdx }); return; }

    this.respond({ action: 'pass' });
  }

  handleBlock(data) {
    let assignments = {};
    let attackers = data.attackers || [];
    let blockers = data.blockers || [];
    let usedBlockers = new Set();

    attackers.forEach((atk, ai) => {
      if (atk.flying) {
        let fb = blockers.find(b => b.flying && !usedBlockers.has(b.idx));
        if (fb) { assignments[ai] = fb.idx; usedBlockers.add(fb.idx); }
      }
    });
    attackers.forEach((atk, ai) => {
      if (assignments[ai] !== undefined) return;
      if (atk.flying) return;
      let b = blockers.find(b => !usedBlockers.has(b.idx));
      if (b) { assignments[ai] = b.idx; usedBlockers.add(b.idx); }
    });
    this.respond({ assignments });
  }

  handleEnchantTarget(data) {
    if (!data.targets || data.targets.length === 0) { this.respond({ fieldIdx: -1 }); return; }
    let best = data.targets[0];
    let bestP = 0;
    data.targets.forEach(t => {
      let card = this.me().field[t.idx];
      if (card) { let p = this.gs.getP(card, this.seat); if (p > bestP) { bestP = p; best = t; } }
    });
    this.respond({ fieldIdx: best.idx });
  }

  handlePriorityTarget(data) {
    if (!data.targets || data.targets.length === 0) { this.respond({ targetIdx: -1 }); return; }
    let oppTargets = data.targets.filter(t => t.pi !== undefined && t.pi !== this.seat);
    let pool = oppTargets.length > 0 ? oppTargets : data.targets;
    let best = null;
    for (let rid of REMOVE_PRIORITY) {
      best = pool.find(t => t.id === rid);
      if (best) break;
    }
    if (!best) best = pool[0];
    let resp = { targetIdx: best.idx };
    if (best.pi !== undefined) resp.pi = best.pi;
    this.respond(resp);
  }

  handleIchiko() {
    let myLife = this.me().life;
    let myC = this.me().field.filter(c => c.type === 'creature').length;
    let oppC = this.opp().field.filter(c => c.type === 'creature').length;
    if (myLife <= 500) this.respond({ mode: 2 });
    else if (myC >= 3) this.respond({ mode: 3 });
    else if (oppC >= 2) this.respond({ mode: 4 });
    else this.respond({ mode: 1 });
  }

  handlePickBest(data) {
    if (!data.cards || data.cards.length === 0) {
      this.respond({ idx: -1 }); return;
    }
    let best = data.cards.reduce((a, b) => a.cost >= b.cost ? a : b);
    this.respond({ idx: best.idx });
  }
}

module.exports = AIPlayer;
