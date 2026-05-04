// サルベドTCG AI対戦システム（socket-route版）
// AIはsocket.emit('action')で操作。人間と同じルートを通る。

const REMOVE_PRIORITY = ['miiko','shinigami','tomo','ark','milia','izuna','reichen','sagi','asaki','azusa','katorina','jk_a'];
const DRAW_CARDS = ['hikaru','oyuchi','nari','ai_tsubame','salvado_cat','sakamachi','gomo','nanase','yashiro'];
const INSTANT_IDS = ['douga_sakujo','kanwa_kyuudai','akapo','shueki_teishi'];
const VALUABLE = ['miiko','shinigami','tomo','ark','milia','izuna','reichen','sagi','asaki','azusa'];

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

    socket.on('resolveResults', ({ results }) => {
      this.waitingAck = true;
      console.log('[AI] resolveResults');
      setTimeout(() => {
        this.send('ackResolve');
        this.waitingAck = false;
        setTimeout(() => this.doMainPhase(), 600);
      }, 400);
    });
  }

  send(type, data) { this.socket.emit('action', Object.assign({ type }, data || {})); }
  me() { return this.gs.G.players[this.seat]; }
  opp() { return this.gs.G.players[1 - this.seat]; }
  avMana() { return this.gs.avMana(this.seat); }
  getP(c) { return this.gs.getP(c, this.seat); }
  getT(c) { return this.gs.getT(c, this.seat); }
  getOppP(c) { return this.gs.getP(c, 1 - this.seat); }
  getOppT(c) { return this.gs.getT(c, 1 - this.seat); }

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

  hasInstantInHand() {
    return this.me().hand.some(c => INSTANT_IDS.includes(c.id) || c.speed === 'instant');
  }

  // ====== メインフェイズ ======

  doMainPhase() {
    if (!this.isReady()) { console.log('[AI] doMainPhase skipped (not ready)'); return; }
    if (this.acting) return;
    this.acting = true;

    let hand = this.me().hand;
    let mana = this.avMana();
    let myField = this.me().field.filter(c => c.type === 'creature');
    let oppField = this.opp().field.filter(c => c.type === 'creature');
    let hasInstant = this.hasInstantInHand();
    console.log('[AI] doMainPhase mana=' + mana + ' hand=' + hand.length + ' myField=' + myField.length + ' oppField=' + oppField.length);

    // マナリザーブ計算
    let reserveMana = 0;
    if (hasInstant && myField.length >= 2) {
      if (hand.some(c => c.id === 'douga_sakujo')) reserveMana = 3;
      else if (hand.some(c => c.speed === 'instant')) reserveMana = 2;
    }
    if (this.me().field.some(c => c.id === 'miiko') || this.me().field.some(c => c.enchantments && c.enchantments.some(e => e.id === 'parasite')))
      reserveMana = Math.max(reserveMana, 2);
    let usableMana = mana - reserveMana;

    // マナ置き
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

    // 1: クリーチャー召喚（コスト高い順）
    //    ただし相手の場が空＆こっち既に2体以上→チャンネル削除ケアで温存
    let shouldHold = (oppField.length === 0 && myField.length >= 2 && this.opp().hand.length >= 3);
    if (!shouldHold) {
      let creatures = hand.map((c, i) => ({ c, i }))
        .filter(x => x.c.type === 'creature' && x.c.cost <= usableMana && this.canPlay(x.c))
        .sort((a, b) => b.c.cost - a.c.cost);
      if (creatures.length > 0) {
        this.send('playCard', { idx: creatures[0].i }); this.acting = false; return;
      }
    }

    // 2: 攻撃前の能力起動（ブロッカー除去）
    if (this.gs.G.phase === 'main' && oppField.length > 0) {
      if (this.tryOffensiveAbility(usableMana)) { this.acting = false; return; }
    }

    // 3: 除去カード
    if (oppField.length - myField.length >= 3) {
      let idx = hand.findIndex(c => c.id === 'channel_sakujo' && c.cost <= usableMana);
      if (idx >= 0) { this.send('playCard', { idx }); this.acting = false; return; }
    }
    if (oppField.length > 0) {
      let idx = hand.findIndex(c => (c.id === 'kikaku_botsu' || c.id === 'salvado_cat_yarakashi') && c.cost <= usableMana);
      if (idx >= 0 && oppField.some(c => REMOVE_PRIORITY.includes(c.id))) {
        this.send('playCard', { idx }); this.acting = false; return;
      }
    }
    if (this.me().life > 900 && oppField.length >= 3) {
      let idx = hand.findIndex(c => c.id === '99wari' && c.cost <= usableMana);
      if (idx >= 0) { this.send('playCard', { idx }); this.acting = false; return; }
    }

    // 4: サポートカード
    if (this.trySupportCard(usableMana)) { this.acting = false; return; }

    // 5: ユーティリティ能力起動（ハンデス・トークン・回復等）
    if (this.tryUtilityAbility(usableMana)) { this.acting = false; return; }

    // 6: ドローソース
    for (let did of DRAW_CARDS) {
      let idx = hand.findIndex(c => c.id === did && c.cost <= usableMana);
      if (idx >= 0) { this.send('playCard', { idx }); this.acting = false; return; }
    }

    // 7: エンチャント
    let eIdx = hand.findIndex(c => c.type === 'enchantment' && c.cost <= usableMana);
    if (eIdx >= 0 && myField.length > 0) {
      this.send('playCard', { idx: eIdx }); this.acting = false; return;
    }

    // 8: 残りのサポート
    let anySupport = hand.map((c, i) => ({ c, i }))
      .filter(x => x.c.type === 'support' && x.c.speed !== 'instant' && x.c.cost <= usableMana)
      .sort((a, b) => b.c.cost - a.c.cost);
    if (anySupport.length > 0) {
      this.send('playCard', { idx: anySupport[0].i }); this.acting = false; return;
    }

    // マナ置き（後回し）
    if (!this.gs.G.manaPlaced) {
      let idx = this.pickManaCard();
      if (idx >= 0) {
        console.log('[AI] マナ置き(後回し) idx=' + idx);
        this.send('placeMana', { idx });
      }
    }

    this.acting = false;

    if (this.gs.G.phase === 'main') {
      this.doAttack();
    } else {
      this.send('endTurn');
    }
  }

  // ====== 攻撃前の能力起動（ブロッカー除去・弱体化） ======
  tryOffensiveAbility(usableMana) {
    let field = this.me().field;
    let oppField = this.opp().field.filter(c => c.type === 'creature');
    if (oppField.length === 0) return false;

    for (let fi = 0; fi < field.length; fi++) {
      let c = field[fi];
      if (c.type !== 'creature') continue;

      // 死神確定除去: 相手に高価値ターゲットがいる時
      if (c.abilities.includes('activated_shinigami') && !c.tapped && this.me().life > 500) {
        if (oppField.some(o => VALUABLE.includes(o.id))) {
          this.send('activateAbility', { fi, aid: 'shinigami_destroy' }); return true;
        }
      }
      // レイチェン500ダメージ
      if (c.abilities.includes('activated_reichen_dmg') && !c.tapped && usableMana >= 4 && oppField.length > 0) {
        this.send('activateAbility', { fi, aid: 'activated_reichen_dmg' }); return true;
      }
      // イズナ200ダメージ
      if (c.abilities.includes('activated_izuna') && !c.tapped && usableMana >= 2 && oppField.length > 0) {
        this.send('activateAbility', { fi, aid: 'activated_izuna' }); return true;
      }
      // マオリアダメージ
      if (c.abilities.includes('activated_maoria') && !c.tapped && usableMana >= 3 && oppField.length > 0) {
        this.send('activateAbility', { fi, aid: 'activated_maoria' }); return true;
      }
    }
    return false;
  }

  // ====== ユーティリティ能力（ハンデス・トークン・回復・バフ・墓地回収） ======
  tryUtilityAbility(usableMana) {
    let field = this.me().field;

    for (let fi = 0; fi < field.length; fi++) {
      let c = field[fi];
      if (c.type !== 'creature') continue;

      // アズサハンデス
      if (c.abilities.includes('activated_azusa') && !c.tapped && usableMana >= 2 && this.opp().hand.length > 0) {
        this.send('activateAbility', { fi, aid: 'activated_azusa' }); return true;
      }
      // 死神ハンデス（相手フィールド空の時）
      if (c.abilities.includes('activated_shinigami') && !c.tapped && this.me().life > 300) {
        let oppCreatures = this.opp().field.filter(o => o.type === 'creature').length;
        if (oppCreatures === 0 && this.opp().hand.length > 0) {
          this.send('activateAbility', { fi, aid: 'shinigami_discard' }); return true;
        }
      }
      // JKトークン生成
      if (c.abilities.includes('create_token_jk') && usableMana >= 3) {
        this.send('activateAbility', { fi, aid: 'create_token_jk' }); return true;
      }
      // 男装バフ（味方2体以上）
      if (c.abilities.includes('activated_dansou_buff') && usableMana >= 3) {
        if (this.me().field.filter(x => x.type === 'creature').length >= 2) {
          this.send('activateAbility', { fi, aid: 'activated_dansou_buff' }); return true;
        }
      }
      // レイチェン回復
      if (c.abilities.includes('activated_reichen_heal') && usableMana >= 1) {
        let hasDamaged = this.me().field.some(f => f.type === 'creature' && (f.damage || 0) > 0);
        if (hasDamaged) { this.send('activateAbility', { fi, aid: 'activated_reichen_heal' }); return true; }
      }
      // サギ墓地回収
      if (c.abilities.includes('activated_sagi_recover') && !c.tapped && usableMana >= 4 && this.me().grave.length > 0) {
        this.send('activateAbility', { fi, aid: 'activated_sagi_recover' }); return true;
      }
    }
    return false;
  }

  // ====== サポートカード ======
  trySupportCard(usableMana) {
    let hand = this.me().hand;
    let myCreatures = this.me().field.filter(c => c.type === 'creature').length;
    let oppField = this.opp().field.filter(c => c.type === 'creature');

    // komi: ダメージあるクリーチャーがいる時
    if (myCreatures > 0 && this.me().field.some(f => f.type === 'creature' && (f.damage || 0) > 0)) {
      let idx = hand.findIndex(c => c.id === 'komi' && c.cost <= usableMana);
      if (idx >= 0) { this.send('playCard', { idx }); return true; }
    }
    // スーパーチャット: 味方クリーチャーいる時
    if (myCreatures > 0) {
      let idx = hand.findIndex(c => c.id === 'super_chat' && c.cost <= usableMana);
      if (idx >= 0) { this.send('playCard', { idx }); return true; }
    }
    // 動画編集: 相手クリーチャーいる時
    if (oppField.length > 0) {
      let idx = hand.findIndex(c => c.id === 'douga_henshuu' && c.cost <= usableMana);
      if (idx >= 0) { this.send('playCard', { idx }); return true; }
    }
    // まっきーに: 味方2体以上
    if (myCreatures >= 2) {
      let idx = hand.findIndex(c => c.id === 'makkinii' && c.cost <= usableMana);
      if (idx >= 0) { this.send('playCard', { idx }); return true; }
    }
    // いちこ
    let iIdx = hand.findIndex(c => c.id === 'ichiko' && c.cost <= usableMana);
    if (iIdx >= 0) { this.send('playCard', { idx: iIdx }); return true; }
    // 青春詭弁: 手札にヒーロー/ヒロインがいる
    if (hand.some(c => (c.hero || c.heroine) && c.type === 'creature')) {
      let idx = hand.findIndex(c => c.id === 'seishun_kiben' && c.cost <= usableMana);
      if (idx >= 0) { this.send('playCard', { idx }); return true; }
    }
    // 思考盗聴
    let stIdx = hand.findIndex(c => c.id === 'shiko_touchou' && c.cost <= usableMana);
    if (stIdx >= 0) { this.send('playCard', { idx: stIdx }); return true; }

    return false;
  }

  // ====== 攻撃判断 ======
  doAttack() {
    let myField = this.me().field;
    let oppBlockers = this.opp().field.filter(c =>
      c.type === 'creature' && !c.tapped &&
      (!c.abilities || !c.abilities.includes('cannot_attack'))
    );

    let attackable = [];
    myField.forEach((c, i) => {
      if (c.type !== 'creature' || c.tapped || c.summonSick) return;
      if (c.abilities && c.abilities.includes('cannot_attack')) return;
      attackable.push({ c, i, power: this.getP(c), tough: this.getT(c) });
    });

    if (attackable.length === 0) {
      console.log('[AI] 攻撃不可→endTurn');
      this.send('endTurn');
      return;
    }

    // ブロッカーがいない→全員攻撃
    if (oppBlockers.length === 0) {
      this.send('startCombat');
      attackable.forEach(a => this.send('toggleAttacker', { fi: a.i }));
      setTimeout(() => this.send('confirmAttack'), 400);
      return;
    }

    // ブロッカーの最大攻撃力と最大タフネスを計算
    let maxOppPower = 0;
    oppBlockers.forEach(b => {
      let p = this.getOppP(b);
      if (p > maxOppPower) maxOppPower = p;
    });

    let chosen = [];
    attackable.forEach(a => {
      // 相手のどのブロッカーに殴られても死なない→安全に攻撃
      if (a.tough > maxOppPower) {
        chosen.push(a);
        return;
      }
      // 攻撃者の数がブロッカー数より多い→溢れる分は通る
      // 価値の低いクリーチャーで数攻めする
      if (!VALUABLE.includes(a.c.id)) {
        chosen.push(a);
        return;
      }
    });

    // 攻撃者がブロッカーより多い場合、多い分は確実に通る→全員攻撃の方が得
    if (chosen.length > oppBlockers.length) {
      // 全attackableで攻撃
      chosen = attackable;
    }

    if (chosen.length === 0) {
      // 攻撃しても損するだけ→スキップ
      console.log('[AI] 攻撃不利→endTurn');
      this.send('endTurn');
      return;
    }

    this.send('startCombat');
    chosen.forEach(a => this.send('toggleAttacker', { fi: a.i }));
    setTimeout(() => this.send('confirmAttack'), 400);
  }

  // ====== ブロック判断 ======
  handleBlock(data) {
    let assignments = {};
    let attackers = data.attackers || [];
    let blockers = data.blockers || [];
    let usedBlockers = new Set();
    let myLife = this.me().life;

    // 総ダメージ計算
    let totalDamage = attackers.reduce((sum, a) => sum + (a.power || 0), 0);
    let lethal = totalDamage >= myLife;

    // 各ブロッカーの価値を計算
    let blockerValue = (b) => {
      let val = VALUABLE.indexOf(b.id);
      return val >= 0 ? (VALUABLE.length - val) : 0;
    };

    // レタルの場合は全力ブロック
    if (lethal) {
      // 飛行は飛行でブロック
      attackers.forEach((atk, ai) => {
        if (atk.flying) {
          let fb = blockers.find(b => b.flying && !usedBlockers.has(b.idx));
          if (fb) { assignments[ai] = fb.idx; usedBlockers.add(fb.idx); }
        }
      });
      // 残り: 攻撃力高い順にブロッカー割り当て
      let sorted = attackers.map((a, i) => ({ a, i }))
        .filter(x => assignments[x.i] === undefined && !x.a.flying)
        .sort((a, b) => (b.a.power || 0) - (a.a.power || 0));
      sorted.forEach(({ a, i }) => {
        let b = blockers.find(b => !usedBlockers.has(b.idx) && !b.flying);
        if (b) { assignments[i] = b.idx; usedBlockers.add(b.idx); }
      });
      this.respond({ assignments });
      return;
    }

    // 非レタル: 有利トレードのみブロック
    attackers.forEach((atk, ai) => {
      if (atk.flying) {
        let fb = blockers.find(b => b.flying && !usedBlockers.has(b.idx));
        if (fb) {
          // ブロッカーが生き残る or 相手が死ぬ場合のみ
          let bSurvives = (fb.toughness || 0) > (atk.power || 0);
          let atkDies = (fb.power || 0) >= (atk.toughness || 0);
          if (bSurvives || atkDies) { assignments[ai] = fb.idx; usedBlockers.add(fb.idx); }
        }
        return;
      }
      // 有利トレード: こっちが生き残る or 相手が死んでこっちの方が価値低い
      let bestBlock = null;
      blockers.forEach(b => {
        if (usedBlockers.has(b.idx) || b.flying) return;
        let bSurvives = (b.toughness || 0) > (atk.power || 0);
        let atkDies = (b.power || 0) >= (atk.toughness || 0);
        if (bSurvives) {
          // 一方的有利: ブロッカー生存＆ダメージ防ぐ
          if (!bestBlock || !bestBlock.survives) bestBlock = { b, survives: true };
        } else if (atkDies) {
          // 相打ち: 相手の方が価値高い場合のみ
          let atkVal = VALUABLE.indexOf(atk.id); if (atkVal < 0) atkVal = 99;
          let bVal = blockerValue(b);
          let atkValScore = atkVal < 99 ? (VALUABLE.length - atkVal) : 0;
          if (atkValScore > bVal && (!bestBlock || !bestBlock.survives)) {
            bestBlock = { b, survives: false };
          }
        }
      });
      if (bestBlock) { assignments[ai] = bestBlock.b.idx; usedBlockers.add(bestBlock.b.idx); }
    });

    this.respond({ assignments });
  }

  // ====== マナ置き ======
  pickManaCard() {
    let hand = this.me().hand;
    if (hand.length === 0) return -1;
    if (hand.length <= 3) return -1;
    let myCreatures = this.me().field.filter(c => c.type === 'creature').length;
    let creaturesInHand = hand.filter(c => c.type === 'creature').length;
    let protectCreatures = (myCreatures === 0 && creaturesInHand <= 2);
    const KEEP = { tomo:10, shinigami:9, ark:8, milia:8, izuna:7, jun:6, reichen:6, sagi:5, douga_sakujo:6, channel_sakujo:5, salvado_cat_yarakashi:5 };
    let candidates = hand.map((c, i) => ({ c, i }));
    if (protectCreatures) candidates = candidates.filter(x => x.c.type !== 'creature');
    if (candidates.length === 0) return -1;
    candidates.sort((a, b) => {
      let ak = KEEP[a.c.id] || 0;
      let bk = KEEP[b.c.id] || 0;
      if (ak !== bk) return ak - bk;
      return a.c.cost - b.c.cost;
    });
    return candidates[0].i;
  }

  // ====== プロンプト応答 ======
  respond(data) { this.send('promptResponse', data); }

  handlePrompt(type, data) {
    console.log('[AI] handlePrompt type=' + type);
    switch (type) {
      case 'chain':
      case 'chain_attack':
        this.handleChain(type, data); break;
      case 'block':
        this.handleBlock(data); break;
      case 'regen_confirm':
        this.respond({ accept: true }); break;
      case 'enchant_target':
        this.handleEnchantTarget(data); break;
      case 'akapo_target':
      case 'buff_target':
        if (data.targets && data.targets.length > 0) {
          // 最も攻撃力高いクリーチャーにバフ
          let best = data.targets.reduce((a, b) => (b.power || 0) > (a.power || 0) ? b : a);
          this.respond({ targetIdx: best.idx });
        } break;
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
          let worst = data.cards.reduce((a, b) => a.cost <= b.cost ? a : b);
          this.respond({ idx: worst.idx });
        } break;
      case 'seishun_kiben_target':
      case 'free_play':
        if (data.targets && data.targets.length > 0) {
          let best = data.targets.reduce((a, b) => a.cost >= b.cost ? a : b);
          this.respond({ idx: best.idx });
        } else { this.respond({ idx: -1 }); } break;
      case 'counterspell_target':
        if (data.targets && data.targets.length > 0)
          this.respond({ idx: 0 });
        break;
      case 'target_damage':
        this.handlePriorityTarget(data); break;
      case 'reichen_heal_target':
        if (data.targets && data.targets.length > 0) {
          let most = data.targets.reduce((a, b) => (b.damage || 0) > (a.damage || 0) ? b : a);
          this.respond({ targetIdx: most.idx });
        } break;
      case 'sagi_recover_pick':
        if (data.cards && data.cards.length > 0) {
          let best = data.cards.reduce((a, b) => a.cost >= b.cost ? a : b);
          this.respond({ idx: best.idx });
        } break;
      case 'mensetsu_target':
        if (data.targets && data.targets.length > 0) {
          this.respond({ targetIdx: data.targets[0].idx, pi: data.targets[0].pi });
        } break;
      case 'creator_discard':
        if (data.creators && data.creators.length >= 2) {
          this.respond({ selected: data.creators.slice(0, 2).map(c => c.idx) });
        } else { this.respond({ selected: [] }); } break;
      case 'waiting':
        break;
      default:
        this.respond({}); break;
    }
  }

  // ====== チェーン応答 ======
  handleChain(type, data) {
    let hand = this.me().hand;
    let mana = this.avMana();
    let desc = data.description || '';

    // 打ち消し: 高価値カードのみ
    let dIdx = hand.findIndex(c => c.id === 'douga_sakujo' && c.cost <= mana);
    if (dIdx >= 0) {
      let counterTargets = ['死神少女','ジュン','トモ','アーク','ミリア','イズナ','チャンネル削除','99割'];
      if (counterTargets.some(n => desc.includes(n))) {
        this.respond({ action: 'playSupport', idx: dIdx }); return;
      }
    }

    // 死神カウンター
    let shinigamiField = this.me().field.find(c => c.id === 'shinigami' && !c.tapped);
    if (shinigamiField && this.me().life >= 800) {
      let counterTargets2 = ['トモ','アーク','ミリア','死神少女','チャンネル削除','99割'];
      if (counterTargets2.some(n => desc.includes(n))) {
        let fi = this.me().field.indexOf(shinigamiField);
        this.respond({ action: 'activate', fi, aid: 'shinigami_counter' }); return;
      }
    }

    // 戦闘チェーン: バフ・デバフ・除去
    if (type === 'chain_attack') {
      // イズナでブロッカー除去
      let izunaField = this.me().field.find(c => c.id === 'izuna' && !c.tapped);
      if (izunaField && mana >= 2 && this.opp().field.some(c => c.type === 'creature')) {
        let fi = this.me().field.indexOf(izunaField);
        this.respond({ action: 'activate', fi, aid: 'activated_izuna' }); return;
      }

      let akapoIdx = hand.findIndex(c => c.id === 'akapo' && c.cost <= mana);
      if (akapoIdx >= 0) { this.respond({ action: 'playSupport', idx: akapoIdx }); return; }

      let kwIdx = hand.findIndex(c => c.id === 'kanwa_kyuudai' && c.cost <= mana);
      if (kwIdx >= 0) { this.respond({ action: 'playSupport', idx: kwIdx }); return; }

      let mkIdx = hand.findIndex(c => c.id === 'makkinii' && c.cost <= mana);
      if (mkIdx >= 0) { this.respond({ action: 'playSupport', idx: mkIdx }); return; }

      let scIdx = hand.findIndex(c => c.id === 'super_chat' && c.cost <= mana);
      if (scIdx >= 0) { this.respond({ action: 'playSupport', idx: scIdx }); return; }

      let iIdx = hand.findIndex(c => c.id === 'ichiko' && c.cost <= mana);
      if (iIdx >= 0) { this.respond({ action: 'playSupport', idx: iIdx }); return; }
    }

    // 収益停止
    let shIdx = hand.findIndex(c => c.id === 'shueki_teishi' && c.cost <= mana);
    if (shIdx >= 0) { this.respond({ action: 'playSupport', idx: shIdx }); return; }

    this.respond({ action: 'pass' });
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
    if (!data.cards || data.cards.length === 0) { this.respond({ idx: -1 }); return; }
    let best = data.cards.reduce((a, b) => a.cost >= b.cost ? a : b);
    this.respond({ idx: best.idx });
  }
}

module.exports = AIPlayer;
