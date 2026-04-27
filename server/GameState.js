const DM = 100;
const EventEmitter = require('events');
const { CARD_DB, TOKEN_MONSTER, TOKEN_JK, TOKEN_V, makeCard, buildDeck } = require('../shared/cards');

class GameState extends EventEmitter {
  constructor(roomId) {
    super();
    this.roomId = roomId;
    this.G = {
      lastAction: '',
      players: [
        { hand: [], field: [], mana: [], grave: [], deck: [], life: 20 },
        { hand: [], field: [], mana: [], grave: [], deck: [], life: 20 }
      ],
      cp: 0, phase: 'start', turn: 1,
      attackers: [], blockers: {},
      waitingAction: null, manaPlaced: false,
      chain: [], chainDepth: 0, effectStack: [],
      chainContext: null, chainResponder: undefined
    };
    this.logs = [];
    this.pendingPrompt = [null, null];
  }

  // ======== ユーティリティ ========
  opp() { return this.G.cp === 0 ? 1 : 0; }
  me() { return this.G.cp; }
  avMana(p) { if (p === undefined) p = this.me(); return this.G.players[p].mana.filter(c => !c.manaTapped).length; }

  tapMana(amt, p) {
    if (p === undefined) p = this.me();
    let n = 0;
    this.G.players[p].mana.forEach(c => { if (n < amt && !c.manaTapped) { c.manaTapped = true; n++; } });
  }

  untapAll() {
    this.G.players[this.me()].field.forEach(c => { c.tapped = false; c.summonSick = false; c.tempBuff = { power: 0, toughness: 0 }; });
    this.G.players[this.me()].mana.forEach(c => { c.manaTapped = false; });
  }

  getP(c, p) {
    let pw = (c.power || 0) + (c.tempBuff ? c.tempBuff.power : 0);
    if (c.enchantments) c.enchantments.forEach(e => { if (e.id === 'parasite') pw += 2; });
    this.G.players[p].field.forEach(o => { if (o.abilities.includes('lord_evil') && c.subtype && c.subtype.includes('悪')) pw += 1; });
    this.G.players[p].field.forEach(o => { if (o !== c && o.abilities.includes('lord_ally')) pw += 1; });
    this.G.players[1 - p].field.forEach(o => { if (o.abilities.includes('debuff_opp')) pw -= 1; });
    return pw;
  }

  getT(c, p) {
    let t = (c.toughness || 0) + (c.tempBuff ? c.tempBuff.toughness : 0);
    if (c.enchantments) c.enchantments.forEach(e => { if (e.id === 'parasite') t += 2; });
    this.G.players[p].field.forEach(o => { if (o.abilities.includes('lord_evil') && c.subtype && c.subtype.includes('悪')) t += 1; });
    this.G.players[p].field.forEach(o => { if (o !== c && o.abilities.includes('lord_ally')) t += 1; });
    this.G.players[1 - p].field.forEach(o => { if (o.abilities.includes('debuff_opp')) t -= 1; });
    return t;
  }

  canPlay(c, p) {
    if (p === undefined) p = this.me();
    if (c.id === 'makkinii') {
      let creators = this.G.players[p].hand.filter(h => h !== c && h.subtype && h.subtype.some(s => ['クリエイター','管理者','ディレクター','ライター','イラストレーター','声優'].includes(s)));
      if (creators.length >= 2) return true;
    }
    return this.avMana(p) >= c.cost;
  }

  checkLeg(c, p) {
    if (p === undefined) p = this.me();
    if (!c.hero && !c.heroine) return true;
    return !this.G.players[p].field.find(f => f.id === c.id);
  }

  getActivatable(c) {
    let abs = [];
    if (c.type !== 'creature') return abs;
    if (c.abilities.includes('create_token_jk')) abs.push({ id: 'create_token_jk', label: 'トークン(【応援3】)' });
    if (c.abilities.includes('activated_reichen_heal')) abs.push({ id: 'activated_reichen_heal', label: '回復(【応援1】)' });
    if (c.abilities.includes('activated_sagi_recover')) abs.push({ id: 'activated_sagi_recover', label: '墓地回収(【応援4】)' });
    if (!c.tapped) {
      if (c.abilities.includes('activated_izuna')) abs.push({ id: 'activated_izuna', label: 'ダメージ(【応援2】+T)' });
      if (c.abilities.includes('activated_reichen_dmg')) abs.push({ id: 'activated_reichen_dmg', label: '500ダメージ(【応援4】+T)' });
      if (c.abilities.includes('activated_maoria')) abs.push({ id: 'activated_maoria', label: '火力(【応援3】+T)' });
      if (c.abilities.includes('activated_asaki')) abs.push({ id: 'activated_asaki', label: '手札覗き(T)' });
      if (c.abilities.includes('activated_azusa')) abs.push({ id: 'activated_azusa', label: 'ハンデス(2+T)' });
      if (c.abilities.includes('activated_shinigami')) {
        abs.push({ id: 'shinigami_destroy', label: '確定除去(T+LP3)' });
        abs.push({ id: 'shinigami_discard', label: 'ハンデス(T+LP2)' });
        if (this.G.chainDepth > 0) abs.push({ id: 'shinigami_counter', label: '打ち消し(T+LP5)' });
      }
      if (c.abilities.includes('activated_sagi_counter') && this.G.chainDepth > 0) abs.push({ id: 'activated_sagi_counter', label: '打ち消し(【応援3】+T)' });
    }
    return abs;
  }

  abilityManaCost(aid) {
    const COSTS = { activated_izuna: 2, activated_maoria: 3, activated_asaki: 0, activated_azusa: 2, create_token_jk: 3, activated_reichen_heal: 1, activated_reichen_dmg: 4, activated_sagi_counter: 3, activated_sagi_recover: 4 };
    return COSTS[aid] || 0; // shinigami abilities cost 0 mana (life cost instead)
  }

  // チェーン復帰 or broadcastの統合ヘルパー
  returnToChain(p) {
    let other = p === 0 ? 1 : 0;
    console.log('[returnToChain] p=' + p + ' chainDepth=' + this.G.chainDepth + ' chainContext=' + this.G.chainContext + ' canRespond=' + this._canChainRespond(other) + ' oppHand=' + this.G.players[other].hand.filter(c => c.speed === 'instant').map(c => c.name).join(',') + ' oppMana=' + this.avMana(other));
    if (this.G.chainContext === 'attack') { this.offerChainAttack(other); }
    else if (this.G.chainDepth > 0) { this.offerChain('play', other); }
    else { this.broadcastState(); }
  }

  // ======== ログ・通知 ========
  log(m) { this.logs.push(m); this.emit('log', m); }
  toast(msg, type) { this.emit('toast', { msg, type }); }

  // ======== プロンプト ========
  prompt(playerIdx, type, data) {
    this.pendingPrompt[playerIdx] = { type, data };
    this.emit('stateUpdate');
    for (let i = 0; i < 2; i++) {
      if (this.pendingPrompt[i]) this.emit('prompt', { player: i, type: this.pendingPrompt[i].type, data: this.pendingPrompt[i].data });
    }
  }

  // ======== 状態フィルタリング ========
  getStateForPlayer(playerIdx) {
    const G = this.G;
    const myP = G.players[playerIdx];
    const oppP = G.players[1 - playerIdx];
    const addEffStats = (field, pi) => field.map(c => ({...c, effP: this.getP(c, pi), effT: this.getT(c, pi)}));
    return {
      me: { hand: myP.hand, field: addEffStats(myP.field, playerIdx), mana: myP.mana, grave: myP.grave, deckCount: myP.deck.length, life: myP.life },
      opp: { handCount: oppP.hand.length, field: addEffStats(oppP.field, 1 - playerIdx), mana: oppP.mana, grave: oppP.grave, deckCount: oppP.deck.length, life: oppP.life },
      phase: G.phase, turn: G.turn, cp: G.cp, isMyTurn: G.cp === playerIdx, myIndex: playerIdx,
      attackers: G.attackers, manaPlaced: G.manaPlaced,
      effectStack: G.effectStack.map(e => ({ description: e.description, player: e.player, cancelled: !!e.cancelled })),
      chainDepth: G.chainDepth, chainContext: G.chainContext, lastAction: G.lastAction, waitingAction: !!G.waitingAction, hasPendingPrompt: !!(this.pendingPrompt[0] || this.pendingPrompt[1]), logs: this.logs.slice(-20)
    };
  }

  // ======== HP0掃除（蘇生チェック付き）========
  sweepDeadCreatures() {
    for (let pi = 0; pi < 2; pi++) {
      for (let fi = this.G.players[pi].field.length - 1; fi >= 0; fi--) {
        let c = this.G.players[pi].field[fi];
        if (c.type !== 'creature') continue;
        if ((c.damage || 0) < this.getT(c, pi)) continue;

        // タフネス0以下は蘇生不可（状況起因の死亡）
        if (this.getT(c, pi) > 0) {
          // ミーコ蘇生
          let miiko = this.G.players[pi].field.find(f => f.abilities.includes('regen_miiko') && f !== c && (f.damage || 0) < this.getT(f, pi));
          if (miiko && this.avMana(pi) >= 2 && !this.pendingPrompt[pi]) {
            this.prompt(pi, 'regen_confirm', { card: { name: c.name, uid: c.uid }, source: 'miiko', cost: 2, manaLeft: this.avMana(pi) });
            return true;
          }
          // 寄生体蘇生
          if (c.enchantments && c.enchantments.some(e => e.id === 'parasite') && this.avMana(pi) >= 1 && !this.pendingPrompt[pi]) {
            this.prompt(pi, 'regen_confirm', { card: { name: c.name, uid: c.uid }, source: 'parasite', cost: 1, manaLeft: this.avMana(pi) });
            return true;
          }
        }
        // 破壊
        this._executeDestroy(c, pi);
      }
    }
    return false;
  }

  broadcastState() {
    if (this.sweepDeadCreatures()) return;
    if (this._afterSweepAction) {
      let action = this._afterSweepAction;
      this._afterSweepAction = null;
      this[action]();
      return;
    }
    this.emit('stateUpdate');
    for (let i = 0; i < 2; i++) {
      if (this.pendingPrompt[i]) this.emit('prompt', { player: i, type: this.pendingPrompt[i].type, data: this.pendingPrompt[i].data });
    }
  }

  // ======== ゲーム初期化 ========
  init(deckDefs) {
    this.G.players[0].deck = buildDeck(deckDefs && deckDefs[0]);
    this.G.players[1].deck = buildDeck(deckDefs && deckDefs[1]);
    for (let p = 0; p < 2; p++) {
      for (let i = 0; i < 7; i++) this.G.players[p].hand.push(this.G.players[p].deck.pop());
      for (let i = 0; i < 3 && this.G.players[p].deck.length > 0; i++) {
        let mc = this.G.players[p].deck.pop();
        mc.manaTapped = false;
        this.G.players[p].mana.push(mc);
      }
    }
    this.G.cp = 0; this.G.phase = 'start'; this.G.turn = 1;
    this.emit('turnScreen', { player: this.G.cp, turn: this.G.turn });
  }

  initTutorial() {
    const mc = (id) => makeCard(CARD_DB.find(c => c.id === id));
    // プレイヤー手札: キャマキリ、動画削除、妹系ヒロイン、視聴者用ダミー2枚
    this.G.players[0].hand = [mc('kyamakiri'), mc('douga_sakujo'), mc('imouto'), mc('kaera'), mc('kaera')];
    // プレイヤー視聴者: 3枚
    for (let i = 0; i < 3; i++) { let m = mc('kaera'); m.manaTapped = false; this.G.players[0].mana.push(m); }
    // プレイヤーデッキ: 適当に数枚（ドロー用）
    for (let i = 0; i < 10; i++) this.G.players[0].deck.push(mc('kaera'));
    this.G.players[0].life = 20;
    // 相手手札: 動画編集、カエラ
    this.G.players[1].hand = [mc('douga_henshuu'), mc('kaera')];
    // 相手視聴者: 3枚
    for (let i = 0; i < 3; i++) { let m = mc('kaera'); m.manaTapped = false; this.G.players[1].mana.push(m); }
    for (let i = 0; i < 10; i++) this.G.players[1].deck.push(mc('kaera'));
    this.G.players[1].life = 20;
    this.G.cp = 0; this.G.phase = 'start'; this.G.turn = 1;
    this.isTutorial = true;
    this.emit('turnScreen', { player: this.G.cp, turn: this.G.turn });
  }

  // ======== ターン開始 ========
  startTurn(playerIdx) {
    if (playerIdx !== this.G.cp) return;
    this.untapAll();
    // 寄生体トークン生成
    this.G.players[this.me()].field.forEach(c => {
      if (c.enchantments) c.enchantments.forEach(e => {
        if (e.id === 'parasite') {
          let tk = makeCard(TOKEN_MONSTER); tk.summonSick = true;
          this.G.players[this.me()].field.push(tk);
          this.log('寄生体→魔物トークン生成');
        }
      });
    });
    if (!(this.G.turn === 1 && this.G.cp === 0)) {
      if (this.G.players[this.me()].deck.length > 0) {
        this.G.players[this.me()].hand.push(this.G.players[this.me()].deck.pop());
        this.log('P' + (this.me() + 1) + 'ドロー');
      }
    }
    this.G.phase = 'main'; this.G.manaPlaced = false;
    this.broadcastState();
  }

  // ======== マナセット ========
  placeMana(playerIdx, idx) {
    if (playerIdx !== this.me() || this.G.manaPlaced) return;
    if (this.G.chainDepth > 0 || this.G.effectStack.length > 0) return;
    if (this.pendingPrompt[0] || this.pendingPrompt[1]) return;
    if (this.pendingPrompt[0] || this.pendingPrompt[1]) return;
    let c = this.G.players[playerIdx].hand[idx];
    if (!c) return;
    c.manaTapped = false;
    this.G.players[playerIdx].mana.push(c);
    this.G.players[playerIdx].hand.splice(idx, 1);
    this.G.manaPlaced = true;
    this.log(c.name + '→視聴者');
    this.toast(c.name + ' → フォロー', 'effect');
    if (this.G.phase === 'mana') this.G.phase = 'main';
    this.broadcastState();
  }

  // ======== カードプレイ ========
  playCard(playerIdx, idx) {
    if (playerIdx === undefined) playerIdx = this.me();
    if (this.G.chainDepth > 0 || this.G.effectStack.length > 0) return;
    if (this.pendingPrompt[0] || this.pendingPrompt[1]) return;
    let c = this.G.players[playerIdx].hand[idx];
    if (!c) return;
    if (!this.canPlay(c, playerIdx)) { this.log('応援不足'); return; }
    if (c.type === 'creature' && !this.checkLeg(c, playerIdx)) { this.log(c.name + '同名制限'); return; }
    if (c.type === 'support') { this.playSupport(c, idx, playerIdx); return; }
    if (c.type === 'enchantment') {
      let enchTargets = this.G.players[playerIdx].field.map((f, i) => ({ f, i })).filter(x => x.f.type === 'creature').map(x => ({ name: x.f.name, idx: x.i }));
      if (enchTargets.length === 0) { this.log('寄生体:対象なし'); this.broadcastState(); return; }
      this.G.waitingAction = { type: 'enchant_target', card: c, handIdx: idx, player: playerIdx };
      this.prompt(playerIdx, 'enchant_target', {
        card: { name: c.name, id: c.id },
        targets: enchTargets
      });
      return;
    }
    // 投稿キャラ投稿 → スタック
    this.tapMana(c.cost, playerIdx);
    this.G.players[playerIdx].hand.splice(idx, 1);
    this.G.lastAction = 'P' + (playerIdx + 1) + ': ' + c.name + 'を投稿宣言 (' + (c.power*DM) + '/' + (c.toughness*DM) + ')';
    this.log('P' + (playerIdx + 1) + ':' + c.name + '投稿宣言');
    this.toast(c.name + ' 投稿宣言', 'summon');
    const self = this, summonCard = c, summonPlayer = playerIdx;
    this.G.effectStack.push({
      player: playerIdx, description: c.name + 'を投稿 (' + (c.power*DM) + '/' + (c.toughness*DM) + ')', isSummon: true,
      resolve() {
        summonCard.summonSick = true; summonCard.tapped = false; summonCard.damage = 0;
        summonCard.enchantments = []; summonCard.tempBuff = { power: 0, toughness: 0 };
        self.G.players[summonPlayer].field.push(summonCard);
        self.log(summonCard.name + '投稿');
        self.toast(summonCard.name + ' 投稿 (' + (summonCard.power*DM) + '/' + (summonCard.toughness*DM) + ')', 'summon');
        self.emit('summonVoice', { cardId: summonCard.id });
        if (summonCard.abilities.includes('etb_heal')) { self.G.players[summonPlayer].life += 2; self.log(summonCard.name + ':LP+' + DM*2 + '→' + self.G.players[summonPlayer].life*DM); }
        if (summonCard.abilities.includes('haste')) summonCard.summonSick = false;
        if (summonCard.abilities.includes('etb_search_shinigami')) {
          let di = self.G.players[summonPlayer].deck.findIndex(d => d.id === 'shinigami');
          if (di >= 0) { let found = self.G.players[summonPlayer].deck.splice(di, 1)[0]; self.G.players[summonPlayer].hand.push(found); self.log('ジュン:死神少女→手札'); }
          else { self.log('ジュン:死神少女なし'); }
        }
        if (summonCard.abilities.includes('etb_draw')) {
          if (self.G.players[summonPlayer].deck.length > 0) {
            let drawn = self.G.players[summonPlayer].deck.pop();
            self.G.players[summonPlayer].hand.push(drawn);
            self.log(summonCard.name + ':1枚ドロー');
          }
        }
        if (summonCard.abilities.includes('etb_search_hero')) {
          let di = self.G.players[summonPlayer].deck.findIndex(d => d.hero === true);
          if (di >= 0) { let found = self.G.players[summonPlayer].deck.splice(di, 1)[0]; self.G.players[summonPlayer].hand.push(found); self.log(summonCard.name + ':' + found.name + '→手札'); }
          else { self.log(summonCard.name + ':主人公なし'); }
        }
        if (summonCard.abilities.includes('etb_destroy_hero')) {
          let oppIdx = summonPlayer === 0 ? 1 : 0;
          let heroes = self.G.players[oppIdx].field.map((f, i) => ({ f, i })).filter(x => x.f.hero === true && x.f.type === 'creature');
          if (heroes.length === 1) {
            self.destroyCreature(heroes[0].f, oppIdx);
            self.log('面接官ヒロイン:' + heroes[0].f.name + 'を破壊');
            self.sweepDeadCreatures();
          } else if (heroes.length > 1) {
            let targets = heroes.map(h => ({ name: h.f.name, idx: h.i, pi: oppIdx }));
            self.prompt(summonPlayer, 'mensetsu_target', { targets });
          } else { self.log('面接官ヒロイン:対象なし'); }
        }
        if (summonCard.abilities.includes('etb_peek_top')) {
          let deck = self.G.players[summonPlayer].deck;
          if (deck.length > 0) {
            let topCard = deck[deck.length - 1];
            self.log(summonCard.name + ':デッキトップ確認');
            self.prompt(summonPlayer, 'shuffle_confirm', { topCard: { name: topCard.name, cost: topCard.cost } });
          }
        }
        return summonCard.name + ' 投稿完了';
      },
      onCancel() {
        self.G.players[summonPlayer].grave.push(summonCard);
        self.log(summonCard.name + 'は打ち消された');
        return summonCard.name + ' 打ち消し → ゴミ箱';
      }
    });
    this.offerChain('play');
  }

  // ======== サポート発動 ========
  playSupport(c, idx, p) {
    const self = this;
    if (c.id === 'makkinii') {
      let creatorCards = this.G.players[p].hand.filter((h, i) => i !== idx && h.subtype && h.subtype.some(s => ['クリエイター','管理者','ディレクター','ライター','イラストレーター','声優'].includes(s)));
      let canMana = this.avMana(p) >= c.cost;
      let canAlt = creatorCards.length >= 2;
      if (canMana && canAlt) { this.prompt(p, 'makkinii_choice', { idx, canMana, canAlt, remainingMana: this.avMana(p) - c.cost }); return; }
      else if (canMana) { this.tapMana(c.cost, p); }
      else if (canAlt) { this.startCreatorDiscard(c, idx, p); return; }
      else { this.log('コスト不足'); return; }
    } else {
      if (!this.canPlay(c, p)) { this.log('応援不足'); return; }
      this.tapMana(c.cost, p);
    }
    let cardName = c.name;
    let handIdx = this.G.players[p].hand.indexOf(c);
    if (handIdx >= 0) { this.G.players[p].hand.splice(handIdx, 1); this.G.players[p].grave.push(c); }
    this.G.lastAction = 'P' + (p + 1) + ': ' + cardName + 'を発動';
    this.log('P' + (p + 1) + ':' + cardName + '発動');
    this.toast(cardName + ' 発動', 'effect');
    this._pushSupportEffect(c, cardName, p);
  }

  // ======== サポート効果（データ駆動）========
  _pushSupportEffect(c, cardName, p) {
    const self = this;
    const opp = p === 0 ? 1 : 0;
    const handler = SUPPORT_EFFECTS[c.id];
    if (handler) {
      handler.call(this, c, cardName, p, opp);
    } else {
      this.broadcastState();
    }
  }

  // ======== チェーンシステム ========
  _canChainRespond(o) {
    let hasSup = this.G.players[o].hand.some(c => c.type === 'support' && c.speed === 'instant'
      && (this.avMana(o) >= c.cost || (c.id === 'makkinii' && this.canPlay(c, o)))
      && !(c.abilities.includes('counterspell') && !this.G.effectStack.some(e => !e.cancelled)));
    let hasAb = this.G.players[o].field.some(c => this.getActivatable(c).some(a => this.avMana(o) >= this.abilityManaCost(a.id)));
    return hasSup || hasAb;
  }

  _getChainOptions(o) {
    let supports = this.G.players[o].hand.map((c, i) => ({ card: c, idx: i }))
      .filter(x => x.card.type === 'support' && x.card.speed === 'instant'
        && (this.avMana(o) >= x.card.cost || (x.card.id === 'makkinii' && this.canPlay(x.card, o)))
        && !(x.card.abilities.includes('counterspell') && !this.G.effectStack.some(e => !e.cancelled)));
    let abilities = [];
    this.G.players[o].field.forEach((c, i) => {
      this.getActivatable(c).forEach(a => { if (this.avMana(o) >= this.abilityManaCost(a.id)) abilities.push({ fi: i, cardName: c.name, ability: a }); });
    });
    return { supports: supports.map(s => ({ idx: s.idx, name: s.card.name, cost: s.card.cost })), abilities };
  }

  offerChain(trigger, responder) {
    this.G.chainContext = null;
    let o = (responder !== undefined) ? responder : this.opp();
    if (!this._canChainRespond(o) || this.G.chainDepth >= 3) { this.resolveStack(); return; }
    this.G.chainDepth++;
    this.G.chainResponder = o;
    let opts = this._getChainOptions(o);
    this.prompt(o, 'chain', {
      lastAction: this.G.lastAction,
      stack: this.G.effectStack.map(e => ({ description: e.description, player: e.player, cancelled: !!e.cancelled })),
      supports: opts.supports, abilities: opts.abilities, chainDepth: this.G.chainDepth
    });
  }

  offerChainAttack(responder) {
    let o = (responder !== undefined) ? responder : this.opp();
    this.G.chainResponder = o;
    if (!this._canChainRespond(o) || this.G.chainDepth >= 3) { this.resolveStack('showBlockPrompt'); return; }
    this.G.chainDepth++;
    let atkNames = this.G.attackers.map(ai => this.G.players[this.me()].field[ai] ? this.G.players[this.me()].field[ai].name : '?').join(', ');
    let opts = this._getChainOptions(o);
    this.prompt(o, 'chain_attack', {
      attackers: atkNames, lastAction: this.G.lastAction,
      stack: this.G.effectStack.map(e => ({ description: e.description, player: e.player, cancelled: !!e.cancelled })),
      supports: opts.supports, abilities: opts.abilities, chainDepth: this.G.chainDepth
    });
  }

  passChain() {
    this.G.chainDepth = 0; this.G.chainContext = null;
    this.resolveStack();
  }

  passChainAttack() {
    this.G.chainDepth = 0; this.G.chainContext = null;
    this.resolveStack('showBlockPrompt');
  }

  // ======== スタック解決（統合版）========
  resolveStack(thenCallback) {
    let wasAttack = this.G.chainContext === 'attack';
    if (wasAttack) this.G.chainContext = null;
    let afterFunc = thenCallback || (wasAttack ? 'showBlockPrompt' : null);

    if (this.G.effectStack.length === 0) {
      this.G.chainDepth = 0;
      this._afterSweepAction = afterFunc || null;
      if (this.sweepDeadCreatures()) return;
      this._afterSweepAction = null;
      if (afterFunc) { this[afterFunc](); } else { this.broadcastState(); }
      return;
    }
    let results = [];
    while (this.G.effectStack.length > 0) {
      let eff = this.G.effectStack.pop();
      if (eff.cancelled) {
        if (eff.onCancel) { let cr = eff.onCancel(); if (cr) results.push(cr); }
        else { results.push('【打ち消し】' + eff.description); }
        continue;
      }
      let r = eff.resolve();
      if (r) results.push(r);
    }
    if (results.length > 0 && !this.pendingPrompt[0] && !this.pendingPrompt[1]) {
      this.emit('resolveResults', { results });
    }
    this.G.effectStack = [];
    this.G.chainDepth = 0;
    this._afterSweepAction = afterFunc || null;
    if (this.sweepDeadCreatures()) { this.checkWin(); return; }
    this._afterSweepAction = null;
    if (!this.pendingPrompt[0] && !this.pendingPrompt[1]) {
      if (afterFunc) { this[afterFunc](); } else { this.broadcastState(); }
    }
    this.checkWin();
  }

  // ======== 戦闘 ========
  startCombat(playerIdx) {
    if (playerIdx !== this.me() || this.G.phase !== 'main') return;
    if (this.G.chainDepth > 0 || this.G.effectStack.length > 0) return;
    if (this.pendingPrompt[0] || this.pendingPrompt[1]) return;
    this.G.phase = 'attack'; this.G.attackers = [];
    this.log('戦闘開始:攻撃者選択');
    this.broadcastState();
  }

  toggleAttacker(playerIdx, fi) {
    if (playerIdx !== this.me() || this.G.phase !== 'attack') return;
    let c = this.G.players[playerIdx].field[fi];
    if (!c || c.type !== 'creature' || c.tapped) return;
    if (c.summonSick && !c.abilities.includes('haste')) return;
    if (c.abilities.includes('cannot_attack')) return;
    let ai = this.G.attackers.indexOf(fi);
    if (ai >= 0) this.G.attackers.splice(ai, 1); else this.G.attackers.push(fi);
    this.broadcastState();
  }

  cancelAttack(playerIdx) {
    if (playerIdx !== this.me() || this.G.phase !== 'attack') return;
    this.G.phase = 'main'; this.G.attackers = [];
    this.log('攻撃キャンセル');
    this.broadcastState();
  }

  confirmAttack(playerIdx) {
    if (playerIdx !== this.me()) return;
    if (this.G.chainDepth > 0 || this.G.effectStack.length > 0) return;
    if (this.G.attackers.length === 0) { this.G.phase = 'main'; this.broadcastState(); return; }
    this.G.attackers.forEach(ai => {
      let c = this.G.players[this.me()].field[ai];
      if (!c.abilities.includes('vigilance')) c.tapped = true;
      if (c.abilities.includes('attack_evil_buff') && this.G.players[this.me()].field.some((o, oi) => oi !== ai && o.subtype && o.subtype.includes('悪'))) c.tempBuff.power += 1;
      if (c.abilities.includes('attack_power_buff')) c.tempBuff.power += 2;
    });
    let atkNames = this.G.attackers.map(ai => this.G.players[this.me()].field[ai].name).join('、');
    this.G.lastAction = 'P' + (this.me() + 1) + ': ' + atkNames + 'で攻撃';
    this.G.phase = 'block';
    this.log('攻撃確定→ブロック選択');
    this.G.chainDepth = 0; this.G.chainContext = 'attack';
    this.offerChainAttack();
  }

  showBlockPrompt() {
    let blocker = this.opp();
    let blockerCards = this.G.players[blocker].field.filter(c => c.type === 'creature' && !c.tapped);
    // 戦闘中に破壊された投稿キャラを除外
    this.G.attackers = this.G.attackers.filter(ai => this.G.players[this.me()].field[ai]);
    if (this.G.attackers.length === 0) { this.G.phase = 'main2'; this.broadcastState(); return; }
    let attackerInfo = this.G.attackers.map(ai => {
      let c = this.G.players[this.me()].field[ai];
      return { name: c.name, power: this.getP(c, this.me()), toughness: this.getT(c, this.me()), flying: c.abilities.includes('flying'), idx: ai };
    });
    this.prompt(blocker, 'block', {
      attackers: attackerInfo,
      blockers: blockerCards.map((c, i) => ({ name: c.name, power: this.getP(c, blocker), toughness: this.getT(c, blocker), flying: c.abilities.includes('flying'), idx: i }))
    });
  }

  resolveBlocks(playerIdx, assignments) {
    let def = this.opp();
    let defField = this.G.players[def].field.filter(c => c.type === 'creature' && !c.tapped);
    this.G.attackers.forEach(ai => {
      let atk = this.G.players[this.me()].field[ai];
      if (!atk) return;
      let bi = assignments[ai];
      if (bi !== undefined && bi >= 0 && defField[bi] && !(atk.abilities.includes('flying') && !defField[bi].abilities.includes('flying'))) {


        let blk = defField[bi];
        this.toast(blk.name + ' → ' + atk.name + ' をブロック', 'effect');
        let hasBlockImmune = blk.abilities.includes('block_immune') || (blk.enchantments && blk.enchantments.some(e => e.id === 'ki_no_sei'));
        if (!hasBlockImmune) blk.damage = (blk.damage || 0) + Math.max(0, this.getP(atk, this.me()));
        atk.damage = (atk.damage || 0) + Math.max(0, this.getP(blk, def));
        this.toast(atk.name + '(' + this.getP(atk, this.me())*DM + ') vs ' + blk.name + '(' + this.getP(blk, def)*DM + ')', 'destroy');
        this.log(atk.name + '(' + this.getP(atk, this.me())*DM + ') vs ' + blk.name + '(' + this.getP(blk, def)*DM + ')');
      } else {
        let dmg = Math.max(0, this.getP(atk, this.me()));
        this.G.players[def].life -= dmg;
        this.log(atk.name + '→P' + (def + 1) + 'に' + dmg*DM + '点ダメージ (LP:' + this.G.players[def].life*DM + ')');
        this.toast(atk.name + ' → P' + (def + 1) + 'に' + dmg*DM + '点ダメージ', 'destroy');
      }
    });
    this.G.phase = 'main2'; this.G.attackers = [];
    this.G.chainContext = null; this.G.chainDepth = 0;
    this.checkWin();
    this.broadcastState();
  }

  // ======== 攻撃者インデックス補正 ========
  _fixAttackerIndices(pi, removedFi) {
    if (pi !== this.me() || this.G.attackers.length === 0) return;
    this.G.attackers = this.G.attackers.map(ai => {
      if (ai === removedFi) return -1;
      if (ai > removedFi) return ai - 1;
      return ai;
    }).filter(ai => ai >= 0);
  }

  // ======== 投稿キャラ破壊 ========
  destroyCreature(c, pi) {
    c.damage = 100;
  }

  _executeDestroy(c, pi) {
    let fi = this.G.players[pi].field.indexOf(c);
    if (fi < 0) return;
    // 寄生体ライフロス（splice前にチェック）
    let hasParasite = c.enchantments && c.enchantments.some(e => e.id === 'parasite');
    if (c.isToken) {
      this.G.players[pi].field.splice(fi, 1);
      this._fixAttackerIndices(pi, fi);
      this.log(c.name + '(トークン)破壊');
    } else {
      if (c.enchantments) {
        c.enchantments.forEach(e => { this.G.players[pi].grave.push(makeCard(CARD_DB.find(d => d.id === e.id) || e.src)); });
      }
      this.G.players[pi].field.splice(fi, 1);
      this._fixAttackerIndices(pi, fi);
      c.enchantments = []; c.damage = 0; c.tempBuff = { power: 0, toughness: 0 };
      this.G.players[pi].grave.push(c);
      this.log(c.name + '破壊');
    }
    if (hasParasite) {
      this.G.players[pi].life -= 3;
      this.log('寄生体消滅:LP-3→' + this.G.players[pi].life);
    }
    this.toast(c.name + ' 破壊', 'destroy');
  }

  // ======== 能力起動 ========
  activateAbility(fi, aid, p) {
    if (p === undefined) p = this.me();
    if ((this.G.chainDepth > 0 || this.G.effectStack.length > 0) && p !== this.G.chainResponder) return;
    if (this.pendingPrompt[0] || this.pendingPrompt[1]) { if (p !== this.G.chainResponder) return; }
    const self = this;
    const opp = p === 0 ? 1 : 0;

    if (aid === 'activated_izuna') {
      let c = this.G.players[p].field[fi];
      if (!c || c.tapped || this.avMana(p) < 2) return;
      let targets = this.G.players[opp].field.map((t, i) => ({ id: t.id, name: t.name, idx: i, hp: this.getT(t, opp), damage: t.damage || 0 }));
      this.prompt(p, 'target_damage', { source: c.name, fi, damage: 2, targets, noTap: false, cost: 2 });
      return;
    }
    if (aid === 'activated_maoria') {
      let c = this.G.players[p].field[fi];
      if (!c || c.tapped || this.avMana(p) < 3) return;
      let dmg = this.getP(c, p) + 3;
      let targets = this.G.players[opp].field.map((t, i) => ({ id: t.id, name: t.name, idx: i, hp: this.getT(t, opp), damage: t.damage || 0 }));
      this.prompt(p, 'target_damage', { source: c.name, fi, damage: dmg, targets, noTap: false, cost: 3 });
      return;
    }
    if (aid === 'activated_asaki') {
      let c = this.G.players[p].field[fi];
      if (!c || c.tapped) return;
      c.tapped = true;
      let handNames = this.G.players[opp].hand.map(h => h.name);
      this.log('アサキ:相手の手札確認(' + handNames.length + '枚)');
      this.emit('peekHand', { player: p, cards: handNames });
      if (this.G.chainDepth > 0) this.returnToChain(p); else this.broadcastState();
      return;
    }
    if (aid === 'activated_azusa') {
      let c = this.G.players[p].field[fi];
      if (!c || c.tapped || this.avMana(p) < 2) return;
      this.tapMana(2, p); c.tapped = true;
      let oppHand = this.G.players[opp].hand;
      if (oppHand.length > 0) {
        let ri = Math.floor(Math.random() * oppHand.length);
        let discarded = oppHand.splice(ri, 1)[0];
        this.G.players[opp].grave.push(discarded);
        this.log('アズサ:相手の' + discarded.name + 'を捨てさせた');
        this.toast('アズサ → ' + discarded.name + ' ハンデス', 'destroy');
      } else { this.log('アズサ:相手の手札なし'); }
      this.returnToChain(p);
      return;
    }
    if (aid === 'activated_reichen_heal') {
      let c = this.G.players[p].field[fi];
      if (!c || this.avMana(p) < 1) return;
      this.tapMana(1, p);
      let targets = this.G.players[p].field.map((f, i) => ({ f, i })).filter(x => x.f.type === 'creature' && x.f.damage > 0).map(x => ({ name: x.f.name, idx: x.i }));
      if (targets.length === 0) { this.log('レイチェン:回復対象なし'); if (this.G.chainDepth > 0) this.returnToChain(p); else this.broadcastState(); return; }
      this.prompt(p, 'reichen_heal_target', { targets });
      return;
    }
    if (aid === 'activated_reichen_dmg') {
      let c = this.G.players[p].field[fi];
      if (!c || c.tapped || this.avMana(p) < 4) return;
      let targets = this.G.players[opp].field.map((t, i) => ({ id: t.id, name: t.name, idx: i, hp: this.getT(t, opp), damage: t.damage || 0 }));
      this.prompt(p, 'target_damage', { source: c.name, fi, damage: 5, targets, noTap: false, cost: 4 });
      return;
    }
    if (aid === 'activated_sagi_counter') {
      let c = this.G.players[p].field[fi];
      if (!c || c.tapped || this.avMana(p) < 3) return;
      if (this.G.chainDepth <= 0 || !this.G.effectStack.some(e => !e.cancelled)) { this.log('サギ:打ち消す対象なし'); this.returnToChain(p); return; }
      c.tapped = true;
      this.tapMana(3, p);
      let targets = this.G.effectStack.map((e, i) => ({ e, i })).filter(x => !x.e.cancelled);
      this.prompt(p, 'counterspell_target', { targets: targets.map(x => ({ idx: x.i, description: x.e.description, player: x.e.player })) });
      return;
    }
    if (aid === 'activated_sagi_recover') {
      let c = this.G.players[p].field[fi];
      if (!c || this.avMana(p) < 4) return;
      this.tapMana(4, p);
      let grave = this.G.players[p].grave;
      if (grave.length === 0) { this.log('サギ:ゴミ箱にカードなし'); if (this.G.chainDepth > 0) this.returnToChain(p); else this.broadcastState(); return; }
      let cards = grave.map((g, i) => ({ name: g.name, cost: g.cost, idx: i }));
      this.prompt(p, 'sagi_recover_pick', { cards });
      return;
    }
    if (aid === 'shinigami_destroy') {
      let c = this.G.players[p].field[fi];
      if (!c || c.tapped || this.G.players[p].life < 3) return;
      c.tapped = true;
      this.G.players[p].life -= 3;
      this.log('死神少女:LP-3→' + this.G.players[p].life);
      if (this.checkWin()) return;
      // 対象選択（自他問わず全投稿キャラ）
      let targets = [];
      for (let ti = 0; ti < 2; ti++) {
        this.G.players[ti].field.forEach((t, idx) => {
          if (t.type === 'creature' && t !== c) targets.push({ id: t.id, name: t.name, idx, pi: ti });
        });
      }
      if (targets.length === 0) { this.log('対象なし'); this.returnToChain(p); return; }
      this.prompt(p, 'shinigami_destroy_target', { fi, targets });
      return;
    }
    if (aid === 'shinigami_discard') {
      let c = this.G.players[p].field[fi];
      if (!c || c.tapped || this.G.players[p].life < 2) return;
      c.tapped = true;
      this.G.players[p].life -= 2;
      this.log('死神少女:LP-2→' + this.G.players[p].life);
      if (this.checkWin()) return;
      let opp = p === 0 ? 1 : 0;
      if (this.G.players[opp].hand.length > 0) {
        let ri = Math.floor(Math.random() * this.G.players[opp].hand.length);
        let dc = this.G.players[opp].hand.splice(ri, 1)[0];
        this.G.players[opp].grave.push(dc);
        this.log('死神少女:P' + (opp + 1) + 'の' + dc.name + '捨て');
        this.toast('死神少女 → ' + dc.name + ' ハンデス', 'destroy');
      } else { this.log('相手手札なし'); }
      this.returnToChain(p);
      return;
    }
    if (aid === 'shinigami_counter') {
      let c = this.G.players[p].field[fi];
      if (!c || c.tapped || this.G.players[p].life < 5) return;
      if (this.G.chainDepth <= 0 || !this.G.effectStack.some(e => !e.cancelled)) { this.log('打ち消す対象なし'); this.returnToChain(p); return; }
      c.tapped = true;
      this.G.players[p].life -= 5;
      this.log('死神少女:LP-5→' + this.G.players[p].life);
      if (this.checkWin()) return;
      let targets = this.G.effectStack.map((e, i) => ({ e, i })).filter(x => !x.e.cancelled);
      this.prompt(p, 'counterspell_target', { targets: targets.map(x => ({ idx: x.i, description: x.e.description, player: x.e.player })) });
      return;
    }
    if (aid === 'create_token_jk') {
      if (this.avMana(p) < 3) { this.returnToChain(p); return; }
      this.tapMana(3, p);
      let tk = makeCard(TOKEN_JK); tk.summonSick = true;
      this.G.players[p].field.push(tk);
      this.log('女子高生トークン生成');
      this.toast('女子高生トークン('+DM+'/'+DM+') 生成', 'summon');
      this.returnToChain(p);
      return;
    }
  }

  // ======== プロンプト応答（ハンドラマップ）========
  handlePromptResponse(playerIdx, response) {
    let pending = this.pendingPrompt[playerIdx];
    if (!pending) return;
    this.pendingPrompt[playerIdx] = null;
    let handler = PROMPT_HANDLERS[pending.type];
    if (handler) { handler.call(this, playerIdx, response, pending); }
    else { this.broadcastState(); }
  }

  // ======== いちこ解決 ========
  _resolveIchiko(p, mode) {
    const self = this;
    const opp = p === 0 ? 1 : 0;
    const desc = [DM*3+'点ダメージ', '自分LP'+DM*5+'回復', '味方全体+'+DM*2+'/+0', '相手全体-'+DM*1+'/+0'][mode - 1];
    this.G.effectStack.push({
      player: p, description: 'いちこ → ' + desc,
      resolve() {
        if (mode === 1) { self.G.players[opp].life -= 3; self.log('いちこ:P' + (opp + 1) + 'に' + DM*3 + '点'); return 'いちこ: ' + DM*3 + '点ダメージ'; }
        if (mode === 2) { self.G.players[p].life += 5; self.log('いちこ:LP+' + DM*5 + '→' + self.G.players[p].life*DM); return 'いちこ: LP+' + DM*5 + '回復'; }
        if (mode === 3) { self.G.players[p].field.forEach(f => { if (f.type === 'creature') f.tempBuff.power += 2; }); self.log('いちこ:味方+' + DM*2 + '/+0'); return 'いちこ: 味方全体+' + DM*2 + '/+0'; }
        if (mode === 4) { self.G.players[opp].field.forEach(f => { if (f.type === 'creature') f.tempBuff.power -= 1; }); self.log('いちこ:相手-' + DM*1 + '/+0'); return 'いちこ: 相手全体-' + DM*1 + '/+0'; }
      }
    });
    if (this.G.chainContext === 'attack') { this.offerChainAttack(p === 0 ? 1 : 0); } else { this.offerChain('play', p === 0 ? 1 : 0); }
  }

  // ======== クリエイター捨て ========
  startCreatorDiscard(c, idx, p) {
    this.G.waitingAction = { type: 'discard_creators', card: c, handIdx: idx, count: 2, selected: [], player: p };
    let creators = this.G.players[p].hand.filter((h, i) => i !== idx && h.subtype && h.subtype.some(s => ['クリエイター','管理者','ディレクター','ライター','イラストレーター','声優'].includes(s)));
    this.prompt(p, 'creator_discard', { cardName: c.name, idx, creators: creators.map((cr) => ({ name: cr.name, idx: this.G.players[p].hand.indexOf(cr) })) });
  }

  handleCreatorDiscard(playerIdx, selectedIndices) {
    let wa = this.G.waitingAction;
    if (!wa || wa.type !== 'discard_creators') return;
    if (selectedIndices.length < 2) return;
    this.pendingPrompt[playerIdx] = null;
    selectedIndices.sort((a, b) => b - a).forEach(si => {
      let dc = this.G.players[wa.player].hand.splice(si, 1)[0];
      this.G.players[wa.player].grave.push(dc);
    });
    let ci = this.G.players[wa.player].hand.indexOf(wa.card);
    let cardName = wa.card.name, pp = wa.player;
    if (ci >= 0) this.G.players[wa.player].grave.push(this.G.players[wa.player].hand.splice(ci, 1)[0]);
    this.G.lastAction = 'P' + (pp + 1) + ': ' + cardName + 'を発動（代替コスト）';
    this.log('P' + (pp + 1) + ':' + cardName + '発動(代替コスト)');
    this.toast(cardName + ' 発動(代替コスト)', 'effect');
    this._pushSupportEffect(wa.card, cardName, pp);
    this.G.waitingAction = null;
  }

  // ======== ターン終了 ========
  endTurn(playerIdx) {
    if (playerIdx !== this.me()) return;
    if (this.G.chainDepth > 0 || this.G.effectStack.length > 0) return;
    if (this.pendingPrompt[0] || this.pendingPrompt[1]) return;
    // 寄生体ライフロス（魔物1体につきLP-1）
    let monsterCount = this.G.players[this.me()].field.filter(c => c.isToken && c.id === 'token_monster').length;
    if (monsterCount > 0) {
      this.G.players[this.me()].life -= monsterCount;
      this.log('寄生体:魔物' + monsterCount + '体→LP-' + monsterCount + '→' + this.G.players[this.me()].life);
      this.toast('寄生体:魔物' + monsterCount + '体 LP-' + (monsterCount * 100), 'destroy');
    }
    this.checkWin();
    this.G.cp = this.opp();
    if (this.G.cp === 0) this.G.turn++;
    this.G.phase = 'start'; this.G.waitingAction = null;
    this.G.chainDepth = 0; this.G.chainContext = null; this.G.chainResponder = undefined;
    this.G.effectStack = [];
    this.pendingPrompt = [null, null];
    this.emit('turnScreen', { player: this.G.cp, turn: this.G.turn });
  }

  // ======== 解決結果確認 ========
  handleAckResolve(playerIdx) {
    if (!this.ackResolve) this.ackResolve = new Set();
    this.ackResolve.add(playerIdx);
    if (this.ackResolve.size >= 2) {
      this.ackResolve = null;
      let action = this.pendingAfterResolve;
      this.pendingAfterResolve = null;
      if (action === 'showBlockModal') { this.showBlockPrompt(); }
      else { this.broadcastState(); }
    }
  }

  // ======== 勝利判定 ========
  checkWin() {
    for (let p = 0; p < 2; p++) {
      if (this.G.players[p].life <= 0) { this.emit('gameOver', { loser: p, winner: 1 - p }); return true; }
    }
    return false;
  }

  // ======== サルベド猫: 選んだカードからランダム1枚手札、残りゴミ箱 ========
  _resolveSalvadoCatPicked(p, picked) {
    // ランダムで1枚を手札に
    let keepIdx = Math.floor(Math.random() * picked.length);
    picked.forEach((c, i) => {
      let di = this.G.players[p].deck.indexOf(c);
      if (di < 0) return;
      this.G.players[p].deck.splice(di, 1);
      if (i === keepIdx) {
        this.G.players[p].hand.push(c);
        this.log('サルベド猫:' + c.name + '→手札');
      } else {
        this.G.players[p].grave.push(c);
        this.log('サルベド猫:' + c.name + '→ゴミ箱');
      }
    });
  }

  // ======== エンチャント装着 ========
  handleEnchantTarget(playerIdx, fieldIdx) {
    let wa = this.G.waitingAction;
    if (!wa || wa.type !== 'enchant_target' || playerIdx !== wa.player) return;
    let target = this.G.players[playerIdx].field[fieldIdx];
    if (!target || target.type !== 'creature') return;
    this.tapMana(wa.card.cost, wa.player);
    target.enchantments = target.enchantments || [];
    target.enchantments.push({ id: wa.card.id, src: wa.card });
    this.G.players[wa.player].hand.splice(wa.handIdx, 1);
    this.log('寄生体→' + target.name);
    this.G.waitingAction = null;
    this.broadcastState();
  }
}

// ======== サポート効果マップ ========
const SUPPORT_EFFECTS = {
  makkinii(c, cardName, p, opp) {
    const self = this;
    this.G.effectStack.push({
      player: p, description: cardName + ' → 全投稿キャラ+'+DM*3+'/+'+DM*3,
      resolve() {
        self.G.players[p].field.forEach(f => { if (f.type === 'creature') { f.tempBuff.power += 3; f.tempBuff.toughness += 3; } });
        self.log('まっきーに:全体+' + DM*3 + '/+' + DM*3); return 'まっきーに: 全投稿キャラ+' + DM*3 + '/+' + DM*3;
      }
    });
    if (this.G.chainContext === 'attack') { this.offerChainAttack(p === 0 ? 1 : 0); } else { this.offerChain('play', p === 0 ? 1 : 0); }
  },

  ichiko(c, cardName, p) { this.prompt(p, 'ichiko_choice', {}); },

  douga_sakujo(c, cardName, p) {
    let targets = this.G.effectStack.map((e, i) => ({ e, i })).filter(x => !x.e.cancelled);
    if (targets.length === 0) {
      this.log('動画削除:打ち消す対象なし'); this.toast('動画削除 → 対象なし', 'effect');
      this.returnToChain(p); return;
    }
    this.prompt(p, 'counterspell_target', { targets: targets.map(x => ({ idx: x.i, description: x.e.description, player: x.e.player })) });
  },

  shueki_teishi(c, cardName, p, opp) {
    const self = this;
    this.G.effectStack.push({
      player: p, description: '収益停止 → 相手の視聴者全タップ',
      resolve() {
        self.G.players[opp].mana.forEach(m => { m.manaTapped = true; });
        self.log('収益停止:P' + (opp + 1) + '視聴者全タップ');
        return '収益停止: P' + (opp + 1) + 'の視聴者全タップ';
      }
    });
    if (this.G.chainContext === 'attack') { this.offerChainAttack(p === 0 ? 1 : 0); } else { this.offerChain('play', p === 0 ? 1 : 0); }
  },

  channel_sakujo(c, cardName, p) {
    for (let pi = 0; pi < 2; pi++) {
      [...this.G.players[pi].field].forEach(cr => { this.destroyCreature(cr, pi); });
      this.G.players[pi].hand.forEach(dc => { this.G.players[pi].grave.push(dc); });
      this.G.players[pi].hand = [];
      for (let d = 0; d < 7 && this.G.players[pi].deck.length > 0; d++) this.G.players[pi].hand.push(this.G.players[pi].deck.pop());
    }
    this.log('チャンネル削除:全場破壊+手札入替');
    this.toast('チャンネル削除!', 'destroy');
    this.broadcastState();
  },

  shiko_touchou(c, cardName, p) {
    const self = this;
    let opp = p === 0 ? 1 : 0;
    this.G.effectStack.push({
      player: p, description: '思考盗聴 → 相手の手札を見る',
      resolve() {
        let handNames = self.G.players[opp].hand.map(h => h.name);
        self.log('思考盗聴:相手の手札確認(' + handNames.length + '枚)');
        self.emit('peekHand', { player: p, cards: handNames });
        return '思考盗聴: 相手の手札を確認';
      }
    });
    this.offerChain('play', opp);
  },

  seishun_kiben(c, cardName, p) {
    const self = this;
    let opp = p === 0 ? 1 : 0;
    let targets = this.G.players[p].hand.map((h, i) => ({ name: h.name, idx: i, power: h.power, toughness: h.toughness, hero: h.hero, heroine: h.heroine })).filter(t => t.hero || t.heroine);
    if (targets.length === 0) { this.log('青春詭弁:対象なし'); this.broadcastState(); return; }
    this.G.effectStack.push({
      player: p, description: '青春詭弁 → 主人公/ヒロイン無料投稿',
      resolve() {
        self.prompt(p, 'seishun_kiben_target', { targets });
        return '青春詭弁: 対象選択中...';
      }
    });
    this.offerChain('play', opp);
  },

  kanwa_kyuudai(c, cardName, p) {
    const self = this;
    let opp = p === 0 ? 1 : 0;
    this.G.effectStack.push({
      player: p, description: '閑話休題 → 全投稿キャラタップ',
      resolve() {
        for (let ti = 0; ti < 2; ti++) {
          self.G.players[ti].field.forEach(f => { if (f.type === 'creature') f.tapped = true; });
        }
        self.log('閑話休題:全投稿キャラタップ');
        return '閑話休題: 全投稿キャラタップ';
      }
    });
    if (this.G.chainContext === 'attack') { this.offerChainAttack(opp); }
    else { this.offerChain('play', opp); }
  },

  hikaru(c, cardName, p) {
    const self = this;
    this.G.effectStack.push({
      player: p, description: 'ひかる → 2枚ドロー+全タップ',
      resolve() {
        for (let d = 0; d < 2 && self.G.players[p].deck.length > 0; d++) {
          let drawn = self.G.players[p].deck.pop(); self.G.players[p].hand.push(drawn);
          self.log('ひかる:' + drawn.name + 'ドロー');
        }
        self.G.players[p].field.forEach(f => { f.tapped = true; });
        self.G.players[p].mana.forEach(m => { m.manaTapped = true; });
        return 'ひかる: 2枚ドロー → 全タップ';
      }
    });
    this.offerChain('play', p === 0 ? 1 : 0);
  },

  oyuchi(c, cardName, p) {
    const self = this;
    this.G.effectStack.push({
      player: p, description: 'おゆち → ドロー',
      resolve() {
        if (self.G.players[p].deck.length > 0) {
          let drawn = self.G.players[p].deck.pop(); self.G.players[p].hand.push(drawn);
          self.log('おゆち:' + drawn.name + 'ドロー');
          if (drawn.subtype && drawn.subtype.some(s => s === 'イラストレーター')) {
            if (self.G.players[p].deck.length > 0) { let d2 = self.G.players[p].deck.pop(); self.G.players[p].hand.push(d2); self.log('おゆち:イラストレーター!追加ドロー:' + d2.name); }
          }
        }
        return 'おゆち: ドロー完了';
      }
    });
    this.offerChain('play', p === 0 ? 1 : 0);
  },

  nari(c, cardName, p) {
    const self = this;
    this.G.effectStack.push({
      player: p, description: 'NARI → デッキトップ5枚確認',
      resolve() {
        let top5 = self.G.players[p].deck.slice(-5).reverse();
        if (top5.length === 0) { self.log('NARI:デッキなし'); return 'NARI: デッキなし'; }
        self.prompt(p, 'nari_pick', { cards: top5.map((c, i) => ({ name: c.name, cost: c.cost, idx: i })) });
        return 'NARI: 選択中...';
      }
    });
    this.offerChain('play', p === 0 ? 1 : 0);
  },

  ai_tsubame(c, cardName, p, opp) {
    const self = this;
    this.G.effectStack.push({
      player: p, description: '愛つばめ → 3枚ドロー→相手1枚捨て',
      resolve() {
        let drawn = [];
        for (let d = 0; d < 3 && self.G.players[p].deck.length > 0; d++) { let dc = self.G.players[p].deck.pop(); self.G.players[p].hand.push(dc); drawn.push(dc); }
        self.log('愛つばめ:3枚ドロー');
        if (drawn.length > 0) {
          self.pendingPrompt[p] = { type: 'waiting', data: { msg: '相手がカードを選んでいます...' } };
          self.emit('prompt', { player: p, type: 'waiting', data: { msg: '相手がカードを選んでいます...' } });
          self.prompt(opp, 'discard_one', { cards: drawn.map(dc => ({ name: dc.name, idx: self.G.players[p].hand.indexOf(dc) })), targetPlayer: p });
        }
        return '愛つばめ: 3枚ドロー';
      }
    });
    this.offerChain('play', p === 0 ? 1 : 0);
  },

  seishun(c, cardName, p) {
    const self = this;
    let tgts = this.G.players[p].hand.filter(h => h.hero || h.heroine);
    if (tgts.length === 0) { this.log('対象なし'); this.returnToChain(p); return; }
    this.G.effectStack.push({
      player: p, description: '青春詭弁 → 主人公/ヒロイン無料投稿',
      resolve() {
        self.prompt(p, 'free_play', {
          targets: self.G.players[p].hand.filter(h => h.hero || h.heroine).map(h => ({
            name: h.name, power: h.power, toughness: h.toughness, idx: self.G.players[p].hand.indexOf(h)
          }))
        });
        return '青春詭弁: 選択中...';
      }
    });
    this.offerChain('play', p === 0 ? 1 : 0);
  },

  sakamachi(c, cardName, p) {
    const self = this;
    this.G.effectStack.push({
      player: p, description: '坂街透 → イラストレーターサーチ',
      resolve() {
        let illustrators = self.G.players[p].deck.filter(d => d.subtype && d.subtype.some(s => s === 'イラストレーター'));
        let top3 = illustrators.slice(0, 3);
        if (top3.length === 0) { self.log('坂街透:対象なし'); return '坂街透: 対象なし'; }
        self.prompt(p, 'sakamachi_pick', { cards: top3.map((c, i) => ({ name: c.name, cost: c.cost, idx: i })), mode: 'discard1' });
        return '坂街透: 選択中...';
      }
    });
    this.offerChain('play', p === 0 ? 1 : 0);
  },

  salvado_cat(c, cardName, p) {
    const self = this;
    this.G.effectStack.push({
      player: p, description: 'サルベド猫 → クリエイターサーチ',
      resolve() {
        let creators = self.G.players[p].deck.filter(d => d.subtype && d.subtype.some(s => ['クリエイター','管理者','ディレクター','ライター','イラストレーター','声優'].includes(s)));
        if (creators.length === 0) { self.log('サルベド猫:対象なし'); return 'サルベド猫: 対象なし'; }
        if (creators.length <= 3) {
          // 3枚以下なら自動選択→ランダム1枚手札、残りゴミ箱
          self._resolveSalvadoCatPicked(p, creators);
          return 'サルベド猫: ' + creators.length + '枚サーチ';
        }
        self.prompt(p, 'salvado_cat_pick', { cards: creators.map((c, i) => ({ name: c.name, cost: c.cost, idx: i })), needSelect: 3 });
        return 'サルベド猫: 選択中...';
      }
    });
    this.offerChain('play', p === 0 ? 1 : 0);
  },

  douga_henshuu(c, cardName, p, opp) {
    const self = this;
    this.G.effectStack.push({
      player: p, description: '動画編集 → 対象に-'+DM*3+'/-'+DM*3,
      resolve() {
        let targets = self.G.players[opp].field.map((t, i) => ({ id: t.id, name: t.name, idx: i })).filter(t => self.G.players[opp].field[t.idx].type === 'creature');
        if (targets.length === 0) { self.log('動画編集:対象なし'); return '動画編集: 対象なし'; }
        self.prompt(p, 'debuff_target', { targets });
        return '動画編集: 対象選択中...';
      }
    });
    this.offerChain('play', opp);
  },

  super_chat(c, cardName, p, opp) {
    let targets = this.G.players[p].field.map((t, i) => ({ id: t.id, name: t.name, idx: i })).filter(t => this.G.players[p].field[t.idx].type === 'creature');
    if (targets.length === 0) { this.log('スーパーチャット:対象なし'); this.returnToChain(p); return; }
    this.prompt(p, 'buff_target', { targets });
  },

  kikaku_botsu(c, cardName, p, opp) {
    const self = this;
    this.G.effectStack.push({
      player: p, description: '企画ボツ → 投稿キャラ1体破壊',
      resolve() {
        let targets = [];
        for (let ti = 0; ti < 2; ti++) {
          self.G.players[ti].field.forEach((t, idx) => {
            if (t.type === 'creature') targets.push({ id: t.id, name: t.name, idx, pi: ti });
          });
        }
        if (targets.length === 0) { self.log('企画ボツ:対象なし'); return '企画ボツ: 対象なし'; }
        self.prompt(p, 'destroy_target', { targets });
        return '企画ボツ: 対象選択中...';
      }
    });
    this.offerChain('play', opp);
  },

  salvado_cat_yarakashi(c, cardName, p, opp) {
    let targets = [];
    for (let ti = 0; ti < 2; ti++) {
      this.G.players[ti].field.forEach((t, idx) => {
        if (t.type === 'creature') targets.push({ id: t.id, name: t.name, idx, pi: ti });
      });
    }
    if (targets.length === 0) { this.log('サルベド猫のやらかし:対象なし'); this.broadcastState(); return; }
    this.prompt(p, 'yarakashi_target', { targets });
  },

  '99wari'(c, cardName, p, opp) {
    const self = this;
    this.G.effectStack.push({
      player: p, description: '99割間違いない → 相手全破壊+全ハンデス',
      resolve() {
        self.G.players[p].life -= 9;
        self.log('99割:LP-' + DM*9 + '→' + self.G.players[p].life*DM);
        [...self.G.players[opp].field].forEach(cr => { if (cr.type === 'creature') self.destroyCreature(cr, opp); });
        self.log('99割:相手投稿キャラ全破壊');
        self.G.players[opp].hand.forEach(dc => { self.G.players[opp].grave.push(dc); });
        let discarded = self.G.players[opp].hand.length;
        self.G.players[opp].hand = [];
        self.log('99割:相手手札' + discarded + '枚捨て');
        return '99割間違いない: LP-' + DM*9 + ' / 相手全破壊 / 手札' + discarded + '枚捨て';
      }
    });
    this.offerChain('play', opp);
  },

  katorina(c, cardName, p, opp) {
    const self = this;
    this.G.effectStack.push({
      player: p, description: 'かとりーな → Vトークン2体生成',
      resolve() {
        for (let i = 0; i < 2; i++) {
          let tk = makeCard(TOKEN_V); tk.summonSick = true;
          self.G.players[p].field.push(tk);
        }
        self.log('かとりーな:Vトークン2体生成');
        return 'かとりーな: Vトークン(' + 2*DM + '/' + 2*DM + ') x2 生成';
      }
    });
    this.offerChain('play', opp);
  },

  akapo(c, cardName, p, opp) {
    let targets = this.G.players[p].field.map((t, i) => ({ id: t.id, name: t.name, idx: i })).filter(t => this.G.players[p].field[t.idx].type === 'creature');
    if (targets.length === 0) { this.log('あかぽ:対象なし'); this.returnToChain(p); return; }
    this.prompt(p, 'akapo_target', { targets });
  },

  komi(c, cardName, p, opp) {
    const self = this;
    this.G.effectStack.push({
      player: p, description: 'komi → 味方全回復',
      resolve() {
        self.G.players[p].field.forEach(f => { if (f.type === 'creature') f.damage = 0; });
        self.log('komi:味方全投稿キャラのダメージ回復');
        return 'komi: 味方全投稿キャラ全回復';
      }
    });
    self.offerChain('play', opp);
  },

  nanase(c, cardName, p, opp) {
    const self = this;
    this.G.effectStack.push({
      player: p, description: 'ななせ → 手札4枚までドロー',
      resolve() {
        let hand = self.G.players[p].hand;
        let draw = Math.max(0, 4 - hand.length);
        for (let i = 0; i < draw && self.G.players[p].deck.length > 0; i++) {
          hand.push(self.G.players[p].deck.pop());
        }
        self.log('ななせ:' + draw + '枚ドロー(手札→' + hand.length + '枚)');
        return 'ななせ: ' + draw + '枚ドロー';
      }
    });
    self.offerChain('play', opp);
  }
};

// ======== プロンプトハンドラマップ ========
const PROMPT_HANDLERS = {
  chain(playerIdx, response, pending) {
    if (response.action === 'pass') { this.passChain(); }
    else if (response.action === 'playSupport') { let o = this.G.chainResponder; this.playSupport(this.G.players[o].hand[response.idx], response.idx, o); }
    else if (response.action === 'activate') { this.activateAbility(response.fi, response.aid, this.G.chainResponder); }
  },

  chain_attack(playerIdx, response, pending) {
    if (response.action === 'pass') { this.passChainAttack(); }
    else if (response.action === 'playSupport') { let o = this.G.chainResponder; this.G.chainContext = 'attack'; this.playSupport(this.G.players[o].hand[response.idx], response.idx, o); }
    else if (response.action === 'activate') { this.G.chainContext = 'attack'; this.activateAbility(response.fi, response.aid, this.G.chainResponder); }
  },

  block(playerIdx, response) { this.resolveBlocks(playerIdx, response.assignments || {}); },

  makkinii_choice(playerIdx, response, pending) {
    if (response.choice === 'mana') {
      let idx = pending.data.idx, c = this.G.players[playerIdx].hand[idx];
      this.tapMana(c.cost, playerIdx);
      let cardName = c.name;
      this.G.players[playerIdx].hand.splice(idx, 1); this.G.players[playerIdx].grave.push(c);
      this.G.lastAction = 'P' + (playerIdx + 1) + ': ' + cardName + 'を発動';
      this.log('P' + (playerIdx + 1) + ':' + cardName + '発動');
      this._pushSupportEffect(c, cardName, playerIdx);
    } else if (response.choice === 'alt') {
      let c = this.G.players[playerIdx].hand[pending.data.idx];
      this.startCreatorDiscard(c, pending.data.idx, playerIdx);
    } else {
      this.returnToChain(playerIdx);
    }
  },

  ichiko_choice(playerIdx, response) { this._resolveIchiko(playerIdx, response.mode); },

  counterspell_target(playerIdx, response) {
    if (response.idx >= 0 && response.idx < this.G.effectStack.length) {
      this.G.effectStack[response.idx].cancelled = true;
      this.log('動画削除:「' + this.G.effectStack[response.idx].description + '」を打ち消し');
      this.toast('動画削除 → 打ち消し!', 'destroy');
    }
    this.returnToChain(playerIdx);
  },

  discard_one(playerIdx, response, pending) {
    let tp = pending.data.targetPlayer;
    this.pendingPrompt[tp] = null; // ドロー側のwaitingを解除
    if (response.idx >= 0 && response.idx < this.G.players[tp].hand.length) {
      let c = this.G.players[tp].hand[response.idx];
      this.G.players[tp].hand.splice(response.idx, 1); this.G.players[tp].grave.push(c);
      this.log('愛つばめ:' + c.name + '捨て');
    }
    this.returnToChain(playerIdx);
  },

  regen_confirm(playerIdx, response, pending) {
    let rc = this.G.players[playerIdx].field.find(f => f.uid === pending.data.card.uid)
          || this.G.players[playerIdx].field.find(f => f.name === pending.data.card.name);
    if (response.accept) {
      this.tapMana(pending.data.cost, playerIdx);
      if (rc) { rc.damage = 0; this.log(pending.data.source + '蘇生:' + rc.name); }
    } else {
      if (rc) this._executeDestroy(rc, playerIdx);
    }
    this.broadcastState();
  },

  creator_discard(playerIdx, response) { this.handleCreatorDiscard(playerIdx, response.selected || []); },

  target_damage(playerIdx, response, pending) {
    if (response.targetIdx >= 0) {
      let opp = playerIdx === 0 ? 1 : 0;
      let target = this.G.players[opp].field[response.targetIdx];
      if (target) {
        let src = this.G.players[playerIdx].field[pending.data.fi];
        if (src) {
          this.tapMana(pending.data.cost, playerIdx);
          if (!pending.data.noTap) src.tapped = true;
          target.damage = (target.damage || 0) + pending.data.damage;
          let totalT = this.getT(target, opp);
          this.log(src.name + ':' + target.name + 'に' + pending.data.damage + '点 (累計' + target.damage + '/' + totalT + ')');
          if (target.damage >= totalT) this.destroyCreature(target, opp);
        }
      }
    }
    this.returnToChain(playerIdx);
  },

  seishun_kiben_target(playerIdx, response) {
    if (response.idx >= 0) {
      let card = this.G.players[playerIdx].hand[response.idx];
      if (card && (card.hero || card.heroine)) {
        this.G.players[playerIdx].hand.splice(response.idx, 1);
        card.summonSick = true; card.tapped = false; card.damage = 0;
        card.enchantments = []; card.tempBuff = { power: 0, toughness: 0 };
        this.G.players[playerIdx].field.push(card);
        this.log('青春詭弁:' + card.name + '無料投稿');
        this.toast(card.name + ' 無料投稿 (' + (card.power*DM) + '/' + (card.toughness*DM) + ')', 'summon');
        this.emit('summonVoice', { cardId: card.id });
        if (card.abilities.includes('etb_heal')) { this.G.players[playerIdx].life += 2; this.log(card.name + ':LP+' + DM*2 + '→' + this.G.players[playerIdx].life*DM); }
        if (card.abilities.includes('haste')) card.summonSick = false;
        if (card.abilities.includes('etb_draw')) {
          if (this.G.players[playerIdx].deck.length > 0) {
            let drawn = this.G.players[playerIdx].deck.pop();
            this.G.players[playerIdx].hand.push(drawn);
            this.log(card.name + ':1枚ドロー');
          }
        }
        if (card.abilities.includes('etb_search_hero')) {
          let di = this.G.players[playerIdx].deck.findIndex(d => d.hero === true);
          if (di >= 0) { let found = this.G.players[playerIdx].deck.splice(di, 1)[0]; this.G.players[playerIdx].hand.push(found); this.log(card.name + ':' + found.name + '→手札'); }
        }
        if (card.abilities.includes('etb_search_shinigami')) {
          let di = this.G.players[playerIdx].deck.findIndex(d => d.id === 'shinigami');
          if (di >= 0) { let found = this.G.players[playerIdx].deck.splice(di, 1)[0]; this.G.players[playerIdx].hand.push(found); this.log('ジュン:死神少女→手札'); }
        }
        if (card.abilities.includes('etb_destroy_hero')) {
          let oppIdx = playerIdx === 0 ? 1 : 0;
          let heroes = this.G.players[oppIdx].field.map((f, i) => ({ f, i })).filter(x => x.f.hero === true && x.f.type === 'creature');
          if (heroes.length === 1) {
            this.destroyCreature(heroes[0].f, oppIdx);
            this.log('面接官ヒロイン:' + heroes[0].f.name + 'を破壊');
            this.sweepDeadCreatures();
          } else if (heroes.length > 1) {
            let targets = heroes.map(h => ({ name: h.f.name, idx: h.i, pi: oppIdx }));
            this.prompt(playerIdx, 'mensetsu_target', { targets });
          } else { this.log('面接官ヒロイン:対象なし'); }
        }
      }
    }
    this.broadcastState();
  },

  shuffle_confirm(playerIdx, response) {
    if (response.shuffle) {
      let dk = this.G.players[playerIdx].deck;
      for (let j = dk.length - 1; j > 0; j--) { let k = Math.floor(Math.random() * (j + 1)); [dk[j], dk[k]] = [dk[k], dk[j]]; }
      this.log('自分デッキシャッフル');
    }
    this.broadcastState();
  },

  asaki_peek(playerIdx, response, pending) {
    if (response.shuffle) {
      let opp = pending.data.oppPlayer, dk = this.G.players[opp].deck;
      for (let j = dk.length - 1; j > 0; j--) { let k = Math.floor(Math.random() * (j + 1)); [dk[j], dk[k]] = [dk[k], dk[j]]; }
      this.log('相手デッキシャッフル');
    }
    this.returnToChain(playerIdx);
  },

  nari_pick(playerIdx, response) {
    if (response.idx >= 0) {
      let dk = this.G.players[playerIdx].deck;
      let top5 = dk.slice(-5).reverse();
      let picked = top5[response.idx];
      if (picked) { let di = dk.indexOf(picked); if (di >= 0) { dk.splice(di, 1); this.G.players[playerIdx].hand.push(picked); this.log('NARI:' + picked.name + '→手札'); } }
    } else { this.log('NARI:選択なし→シャッフル'); }
    let dk = this.G.players[playerIdx].deck;
    for (let j = dk.length - 1; j > 0; j--) { let k = Math.floor(Math.random() * (j + 1)); [dk[j], dk[k]] = [dk[k], dk[j]]; }
    this.returnToChain(playerIdx);
  },

  free_play(playerIdx, response) {
    if (response.idx >= 0) {
      let c = this.G.players[playerIdx].hand[response.idx];
      if (c && (c.hero || c.heroine) && this.checkLeg(c, playerIdx)) {
        c.summonSick = true; c.tapped = false; c.damage = 0; c.enchantments = []; c.tempBuff = { power: 0, toughness: 0 };
        if (c.abilities.includes('haste')) c.summonSick = false;
        if (c.abilities.includes('etb_heal')) this.G.players[playerIdx].life += 2;
        this.G.players[playerIdx].field.push(c);
        this.G.players[playerIdx].hand.splice(response.idx, 1);
        this.log('青春詭弁:' + c.name + '無料投稿');
        this.emit('summonVoice', { cardId: c.id });
      }
    }
    this.broadcastState();
  },

  shinigami_destroy_target(playerIdx, response) {
    if (response.targetIdx >= 0 && response.pi >= 0 && response.pi < 2) {
      let target = this.G.players[response.pi].field[response.targetIdx];
      if (target) {
        // 蘇生不可: sweepをバイパスして直接破壊
        this._executeDestroy(target, response.pi);
        this.log('死神少女:' + target.name + '破壊(蘇生不可)');
        this.toast('死神少女 → ' + target.name + ' 破壊(蘇生不可)', 'destroy');
      }
    }
    this.returnToChain(playerIdx);
  },

  enchant_target(playerIdx, response) { this.handleEnchantTarget(playerIdx, response.fieldIdx); },

  debuff_target(playerIdx, response) {
    let opp = playerIdx === 0 ? 1 : 0;
    if (response.targetIdx >= 0) {
      let target = this.G.players[opp].field[response.targetIdx];
      if (target && target.type === 'creature') {
        target.tempBuff.power -= 3; target.tempBuff.toughness -= 3;
        this.log('動画編集:' + target.name + ' -' + DM*3 + '/-' + DM*3);
        this.toast('動画編集 → ' + target.name + ' -'+DM*3+'/-'+DM*3, 'destroy');
      }
    }
    this.broadcastState();
  },

  buff_target(playerIdx, response) {
    if (response.targetIdx >= 0) {
      let target = this.G.players[playerIdx].field[response.targetIdx];
      if (target && target.type === 'creature') {
        let self = this, tName = target.name, tUid = target.uid, p = playerIdx;
        this.G.effectStack.push({
          player: p, description: 'スーパーチャット → ' + tName + ' +'+DM*3+'/+'+DM*3,
          resolve() {
            let t = self.G.players[p].field.find(f => f.uid === tUid);
            if (t) { t.tempBuff.power += 3; t.tempBuff.toughness += 3; self.log('スーパーチャット:' + tName + ' +' + DM*3 + '/+' + DM*3); }
            else { self.log('スーパーチャット:対象消滅'); }
            return 'スーパーチャット: ' + tName + ' +' + DM*3 + '/+' + DM*3;
          }
        });
        if (this.G.chainContext === 'attack') { this.offerChainAttack(playerIdx === 0 ? 1 : 0); }
        else { this.offerChain('play', playerIdx === 0 ? 1 : 0); }
        return;
      }
    }
    this.returnToChain(playerIdx);
  },

  akapo_target(playerIdx, response) {
    if (response.targetIdx >= 0) {
      let target = this.G.players[playerIdx].field[response.targetIdx];
      if (target && target.type === 'creature') {
        let self = this, tName = target.name, tUid = target.uid, p = playerIdx;
        this.G.effectStack.push({
          player: p, description: 'あかぽ → ' + tName + ' +'+DM*5+'/+0',
          resolve() {
            let t = self.G.players[p].field.find(f => f.uid === tUid);
            if (t) { t.tempBuff.power += 5; self.log('あかぽ:' + tName + ' +' + DM*5 + '/+0'); }
            else { self.log('あかぽ:対象消滅'); }
            return 'あかぽ: ' + tName + ' +' + DM*5 + '/+0';
          }
        });
        if (this.G.chainContext === 'attack') { this.offerChainAttack(playerIdx === 0 ? 1 : 0); }
        else { this.offerChain('play', playerIdx === 0 ? 1 : 0); }
        return;
      }
    }
    this.returnToChain(playerIdx);
  },

  yarakashi_target(playerIdx, response) {
    if (response.targetIdx >= 0 && response.pi >= 0 && response.pi < 2) {
      let target = this.G.players[response.pi].field[response.targetIdx];
      if (target) {
        this._executeDestroy(target, response.pi);
        this.log('サルベド猫のやらかし:' + target.name + '破壊(蘇生不可)');
        this.toast('サルベド猫のやらかし → ' + target.name + ' 破壊(蘇生不可)', 'destroy');
      }
    }
    this.broadcastState();
  },

  destroy_target(playerIdx, response) {
    if (response.targetIdx >= 0 && response.pi >= 0 && response.pi < 2) {
      let target = this.G.players[response.pi].field[response.targetIdx];
      if (target) {
        this.destroyCreature(target, response.pi);
        this.log('企画ボツ:' + target.name + '破壊');
        this.toast('企画ボツ → ' + target.name + ' 破壊', 'destroy');
      }
    }
    this.broadcastState();
  },

  mensetsu_target(playerIdx, response) {
    if (response.targetIdx >= 0 && response.pi >= 0 && response.pi < 2) {
      let target = this.G.players[response.pi].field[response.targetIdx];
      if (target && target.hero) {
        this.destroyCreature(target, response.pi);
        this.log('面接官ヒロイン:' + target.name + '破壊');
        this.toast('面接官ヒロイン → ' + target.name + ' 破壊', 'destroy');
        this.sweepDeadCreatures();
      }
    }
    this.broadcastState();
  },

  reichen_heal_target(playerIdx, response) {
    if (response.targetIdx >= 0) {
      let target = this.G.players[playerIdx].field[response.targetIdx];
      if (target && target.type === 'creature') {
        target.damage = 0;
        this.log('レイチェン:' + target.name + 'のダメージ回復');
      }
    }
    if (this.G.chainDepth > 0) this.returnToChain(playerIdx); else this.broadcastState();
  },

  reichen_dmg_target(playerIdx, response) {
    let oppIdx = playerIdx === 0 ? 1 : 0;
    if (response.targetIdx >= 0) {
      let target = this.G.players[oppIdx].field[response.targetIdx];
      if (target && target.type === 'creature') {
        target.damage += 5;
        this.log('レイチェン:' + target.name + 'に' + DM*5 + 'ダメージ');
        this.toast('レイチェン → ' + target.name + ' ' + DM*5 + 'ダメージ', 'destroy');
        this.sweepDeadCreatures();
      }
    }
    if (this.G.chainDepth > 0) this.returnToChain(playerIdx); else this.broadcastState();
  },

  sagi_recover_pick(playerIdx, response) {
    if (response.idx >= 0) {
      let grave = this.G.players[playerIdx].grave;
      if (response.idx < grave.length) {
        let card = grave.splice(response.idx, 1)[0];
        this.G.players[playerIdx].hand.push(card);
        this.log('サギ:' + card.name + 'を墓地から手札へ');
      }
    }
    if (this.G.chainDepth > 0) this.returnToChain(playerIdx); else this.broadcastState();
  },

  sakamachi_pick(playerIdx, response) {
    if (response.idx >= 0) {
      let illustrators = this.G.players[playerIdx].deck.filter(d => d.subtype && d.subtype.some(s => s === 'イラストレーター'));
      let top3 = illustrators.slice(0, 3);
      let discarded = top3[response.idx];
      if (discarded) {
        let di = this.G.players[playerIdx].deck.indexOf(discarded);
        if (di >= 0) { this.G.players[playerIdx].deck.splice(di, 1); this.G.players[playerIdx].grave.push(discarded); this.log('坂街透:' + discarded.name + '→ゴミ箱'); }
        top3.forEach((c, i) => {
          if (i !== response.idx) {
            let di2 = this.G.players[playerIdx].deck.indexOf(c);
            if (di2 >= 0) { this.G.players[playerIdx].deck.splice(di2, 1); this.G.players[playerIdx].hand.push(c); this.log('坂街透:' + c.name + '→手札'); }
          }
        });
      }
    }
    let dk = this.G.players[playerIdx].deck;
    for (let j = dk.length - 1; j > 0; j--) { let k = Math.floor(Math.random() * (j + 1)); [dk[j], dk[k]] = [dk[k], dk[j]]; }
    this.broadcastState();
  },

  salvado_cat_pick(playerIdx, response) {
    // response.selected = 選んだ3枚のインデックス配列
    if (response.selected && response.selected.length > 0) {
      let creators = this.G.players[playerIdx].deck.filter(d => d.subtype && d.subtype.some(s => ['クリエイター','管理者','ディレクター','ライター','イラストレーター','声優'].includes(s)));
      let picked = response.selected.map(i => creators[i]).filter(Boolean);
      if (picked.length > 0) this._resolveSalvadoCatPicked(playerIdx, picked);
    }
    let dk = this.G.players[playerIdx].deck;
    for (let j = dk.length - 1; j > 0; j--) { let k = Math.floor(Math.random() * (j + 1)); [dk[j], dk[k]] = [dk[k], dk[j]]; }
    this.broadcastState();
  }
};

module.exports = GameState;
