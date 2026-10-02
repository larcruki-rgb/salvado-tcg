// サルベドTCG AI対戦システム（socket-route版）
// AIはsocket.emit('action')で操作。人間と同じルートを通る。

const REMOVE_PRIORITY = ['miiko','shinigami','tomo','ark','milia','izuna','reichen','sagi','asaki','azusa','katorina','jk_a'];
const DRAW_CARDS = ['hikaru','oyuchi','nari','ai_tsubame','salvado_cat','sakamachi','gomo','nanase','yashiro'];
const INSTANT_IDS = ['douga_sakujo','kanwa_kyuudai','akapo','shueki_teishi','impression_seigen','douga_fukugen'];
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
      if (this.waitingAck) { this._updateWhileAck = true; return; } // ack待ち中に来た盤面は、ack後に必ず見直す
      this._scheduleMain();
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
      this._updateWhileAck = false;
      console.log('[AI] resolveResults');
      setTimeout(() => {
        // 先にフラグを下ろす。send は同期的にサーバーを動かし、その場で次の盤面(stateUpdate)が届くことがある。
        // 以前は send の後に下ろしていたため、AIのackが2つ目だった時にその盤面を無視して永久に止まっていた(CPU戦の固まり)
        this.waitingAck = false;
        this.send('ackResolve');
        if (this._updateWhileAck) { this._updateWhileAck = false; this._scheduleMain(); }
      }, 400);
    });
  }

  _scheduleMain() {
    setTimeout(() => {
      if (!this.waitingAck && this.isReady()) {
        console.log('[AI] stateUpdate → doMainPhase');
        this.doMainPhase();
      }
    }, 800);
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
    if (this.waitingAck) return false;
    if (this.gs._resolveQueue || this.gs._combatQueue) return false;
    if (this.gs.ackResolve) return false;
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
      if (did === 'yashiro' && this.me().life <= 500) continue;
      if (did === 'nanase' && hand.length >= 4) continue;
      let idx = hand.findIndex(c => c.id === did && c.cost <= usableMana);
      if (idx >= 0) { this.send('playCard', { idx }); this.acting = false; return; }
    }

    // 7: エンチャント
    let eIdx = hand.findIndex(c => {
      if (c.type !== 'enchantment' || c.cost > usableMana) return false;
      let validTargets = myField.filter(f => f.type === 'creature' && !(f.enchantments && f.enchantments.some(e => e.id === 'alminium')));
      return validTargets.length > 0;
    });
    if (eIdx >= 0) {
      this.send('playCard', { idx: eIdx }); this.acting = false; return;
    }

    // 8: 残りのサポート（条件付きカードは除外）
    const CONDITIONAL_SUPPORT = ['douga_henshuu','yashiro','nanase','seishun_kiben'];
    let anySupport = hand.map((c, i) => ({ c, i }))
      .filter(x => x.c.type === 'support' && x.c.speed !== 'instant' && x.c.cost <= usableMana && !CONDITIONAL_SUPPORT.includes(x.c.id))
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
      if (c.abilities.includes('activated_reichen_dmg') && !c.tapped && usableMana >= 4 && oppField.some(o => !(o.enchantments && o.enchantments.some(e => e.id === 'alminium')))) {
        this.send('activateAbility', { fi, aid: 'activated_reichen_dmg' }); return true;
      }
      // イズナ200ダメージ
      if (c.abilities.includes('activated_izuna') && !c.tapped && usableMana >= 2 && oppField.some(o => !(o.enchantments && o.enchantments.some(e => e.id === 'alminium')))) {
        this.send('activateAbility', { fi, aid: 'activated_izuna' }); return true;
      }
      // マオリアダメージ
      if (c.abilities.includes('activated_maoria') && !c.tapped && usableMana >= 3 && oppField.some(o => !(o.enchantments && o.enchantments.some(e => e.id === 'alminium')))) {
        this.send('activateAbility', { fi, aid: 'activated_maoria' }); return true;
      }
      // ルシア竜化（攻撃前バフ）: タップ済みだと飛行もバフも活きないのでアンタップ時のみ
      if (c.abilities.includes('activated_lucia_dragon') && !c.tapped && usableMana >= 5) {
        this.send('activateAbility', { fi, aid: 'activated_lucia_dragon' }); return true;
      }
      // マオリア飛行（攻撃前バフ）: タップ済みだと飛行が活きないのでアンタップ時のみ
      if (c.abilities.includes('activated_maoria_flying') && !c.tapped && usableMana >= 4) {
        this.send('activateAbility', { fi, aid: 'activated_maoria_flying' }); return true;
      }
      // ルシアブレス（盤面不利時のリセット）
      if (c.abilities.includes('activated_lucia_breath') && !c.tapped && usableMana >= 5) {
        let myCreatures = this.me().field.filter(x => x.type === 'creature').length;
        let killable = oppField.filter(o => (this.getOppT(o) - (o.damage || 0)) <= 200).length; // 実効HP(エンチャント・カウンター・全体強化込み)で数える
        if (oppField.length > myCreatures && killable >= 2) {
          this.send('activateAbility', { fi, aid: 'activated_lucia_breath' }); return true;
        }
      }
    }
    return false;
  }

  // ====== ユーティリティ能力（ハンデス・トークン・回復・バフ・墓地回収） ======
  // ゼラチネの捕食で食べる相手を選ぶ(自分の場の番号。食べたい相手がいなければ -1)。
  // 優先: トークン → 手札に同じ名前がある主人公/ヒロイン(食べると同名制限が空いて出し直せる) → 場が3体以上の時の弱いキャラ
  pickZeratineFood(zeratine, forced) {
    const field = this.me().field;
    const hand = this.me().hand;
    const cands = field.map((f, i) => ({ f, i })).filter(x => x.f !== zeratine && x.f.type === 'creature');
    if (cands.length === 0) return -1;
    const val = f => (f.power || 0) + (f.toughness || 0);
    const tokens = cands.filter(x => x.f.isToken).sort((a, b) => val(a.f) - val(b.f));
    if (tokens.length > 0) return tokens[0].i;
    const dup = cands.filter(x => (x.f.hero || x.f.heroine) && hand.some(h => h.id === x.f.id));
    if (dup.length > 0) return dup[0].i;
    const weak = cands.filter(x => !VALUABLE.includes(x.f.id) && val(x.f) <= 300).sort((a, b) => val(a.f) - val(b.f));
    if (weak.length > 0 && cands.length >= 2) return weak[0].i;
    // 選択を求められてしまった後(forced)は、いちばん価値の低い相手を返す(空の回答で能力を空振りさせない)
    if (forced) return cands.slice().sort((a, b) => val(a.f) - val(b.f))[0].i;
    return -1;
  }

  tryUtilityAbility(usableMana) {
    let field = this.me().field;

    for (let fi = 0; fi < field.length; fi++) {
      let c = field[fi];
      if (c.type !== 'creature') continue;

      // ゼラチネ: 捕食で育てる → 育ったら分裂。分裂も捕食もタップが要るので、1ターンにどちらか1つ。
      // 育っていれば分裂を先に選ぶ(育つ前に即分裂しない)。手札にもう1枚あれば残りHP400から(分裂すると同名制限が空いて出し直せる)、無ければ600から
      if (c.abilities.includes('activated_zeratine_split') && !c.tapped) {
        let remain = this.getT(c) - (c.damage || 0);
        let hasCopy = this.me().hand.some(h => h.id === c.id);
        if (remain >= (hasCopy ? 400 : 600)) {
          this.send('activateAbility', { fi, aid: 'activated_zeratine_split' }); return true;
        }
      }
      if (c.abilities.includes('activated_zeratine_eat') && !c.tapped && this.pickZeratineFood(c, false) >= 0) {
        this.send('activateAbility', { fi, aid: 'activated_zeratine_eat' }); return true;
      }
      // リード: 手札が少なく、応援に余裕がある時にサーチ
      if (c.abilities.includes('activated_lead_search') && !c.tapped && usableMana >= 3 && this.me().hand.length <= 3 && this.me().deck.some(d => d.type === 'creature')) {
        this.send('activateAbility', { fi, aid: 'activated_lead_search' }); return true;
      }

      // アズサハンデス
      if (c.abilities.includes('activated_azusa') && !c.tapped && usableMana >= 2 && this.opp().hand.length > 0) {
        this.send('activateAbility', { fi, aid: 'activated_azusa' }); return true;
      }
      if (c.abilities.includes('activated_kanaria_mana') && !c.tapped && usableMana >= 3 && this.me().deck.length > 0) {
        this.send('activateAbility', { fi, aid: 'activated_kanaria_mana' }); return true;
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
    // 投げ銭: 味方クリーチャーいる時
    if (myCreatures > 0) {
      let idx = hand.findIndex(c => c.id === 'super_chat' && c.cost <= usableMana);
      if (idx >= 0) { this.send('playCard', { idx }); return true; }
    }
    // 動画編集: 相手にHP300以下がいる時のみ
    if (oppField.some(c => this.getOppT(c) <= 300)) {
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
    // 動画復元: ゴミ箱に高価値カードがある時
    if (this.me().grave.some(g => VALUABLE.includes(g.id))) {
      let idx = hand.findIndex(c => c.id === 'douga_fukugen' && c.cost <= usableMana);
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
      attackers.forEach(atk => {
        if (atk.flying) {
          let fb = blockers.find(b => b.flying && !usedBlockers.has(b.idx));
          if (fb) { assignments[atk.idx] = fb.idx; usedBlockers.add(fb.idx); }
        }
      });
      let sorted = [...attackers]
        .filter(a => assignments[a.idx] === undefined && !a.flying)
        .sort((a, b) => (b.power || 0) - (a.power || 0));
      sorted.forEach(atk => {
        let b = blockers.find(b => !usedBlockers.has(b.idx) && !b.flying);
        if (b) { assignments[atk.idx] = b.idx; usedBlockers.add(b.idx); }
      });
      this.respond({ assignments });
      return;
    }

    // ライフが危険域ならブロック積極化（残り1000以下 or 総ダメージがライフの40%以上）
    let defensive = myLife <= 1000 || totalDamage >= myLife * 0.4;

    // 非レタル: 有利トレード＋防御モード時はダメージ軽減ブロック
    attackers.forEach(atk => {
      if (atk.flying) {
        let fb = blockers.find(b => b.flying && !usedBlockers.has(b.idx));
        if (fb) {
          let bSurvives = (fb.toughness || 0) > (atk.power || 0);
          let atkDies = (fb.power || 0) >= (atk.toughness || 0);
          if (bSurvives || atkDies || defensive) { assignments[atk.idx] = fb.idx; usedBlockers.add(fb.idx); }
        }
        return;
      }
      let bestBlock = null;
      blockers.forEach(b => {
        if (usedBlockers.has(b.idx) || b.flying) return;
        let bSurvives = (b.toughness || 0) > (atk.power || 0);
        let atkDies = (b.power || 0) >= (atk.toughness || 0);
        if (bSurvives) {
          if (!bestBlock || !bestBlock.survives) bestBlock = { b, survives: true, score: 100 };
        } else if (atkDies) {
          let atkVal = VALUABLE.indexOf(atk.id); if (atkVal < 0) atkVal = 99;
          let bVal = blockerValue(b);
          let atkValScore = atkVal < 99 ? (VALUABLE.length - atkVal) : 0;
          if (atkValScore > bVal && (!bestBlock || !bestBlock.survives)) {
            bestBlock = { b, survives: false, score: 50 };
          }
        } else if (defensive && (atk.power || 0) >= 2) {
          let bVal = blockerValue(b);
          if (bVal === 0 && !bestBlock) {
            bestBlock = { b, survives: false, score: 10 };
          }
        }
      });
      if (bestBlock) { assignments[atk.idx] = bestBlock.b.idx; usedBlockers.add(bestBlock.b.idx); }
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
    const KEEP = { tomo:10, shinigami:9, ark:8, milia:8, izuna:7, jun:6, reichen:6, sagi:5, douga_sakujo:6, channel_sakujo:5, salvado_cat_yarakashi:5, zeratine:8, daisuke_dare:7, lead:5 };
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
      case 'zeratine_eat_target': {
        // 必ず具体的な対象を返す(CPU席には質問の時間切れが無いので、止まると人間側から進められない)
        let z = this.me().field.find(f => f.uid === data.srcUid);
        let fi = z ? this.pickZeratineFood(z, true) : -1;
        if (fi < 0 || !(data.targets || []).some(t => t.idx === fi)) fi = (data.targets && data.targets.length > 0) ? data.targets[0].idx : -1;
        this.respond({ targetIdx: fi });
        break;
      }
      case 'akapo_target':
      case 'buff_target':
        if (data.targets && data.targets.length > 0) {
          // 候補は {id,name,idx} だけなので、idx から自分の場の実体を取って判定する(戦闘参加は uid で持っている)
          const g = this.gs.G;
          const cardOf = t => this.me().field[t.idx] || null;
          let combatants = data.targets.filter(t => {
            const card = cardOf(t);
            if (!card) return false;
            let isAttacker = g.cp === this.seat && g.attackers && g.attackers.includes(card.uid);
            let isBlocker = g.blockAssignments && Object.values(g.blockAssignments).includes(card.uid);
            return isAttacker || isBlocker;
          });
          let pool = combatants.length > 0 ? combatants : data.targets;
          const pw = t => { const card = cardOf(t); return card ? this.gs.getP(card, this.seat) : 0; };
          let best = pool.reduce((a, b) => pw(b) > pw(a) ? b : a);
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
      case 'counterspell_target': {
        if (data.targets && data.targets.length > 0) {
          // 高価値カード名を含む効果を最新側から探す。無ければスタック最上段(直近に積まれた効果=配列末尾)
          let CT = ['マオリア','トモ','イズナ','寄生体','サルベド猫','まっきーに','坂街透','アサキ','アズサ','NARI','愛つばめ','収益停止','チャンネル削除','死神少女','ジュン','ミリア','青春詭弁','サルベド猫のやらかし','アーク','99割','レイチェン','サギ','ユリ','スマッシャー','企画ボツ','インプレッション制限','水素水でナンパする男'];
          let pick = null;
          for (let ti = data.targets.length - 1; ti >= 0; ti--) {
            let d = data.targets[ti].description || '';
            if (CT.some(n => d.indexOf(n) >= 0)) { pick = data.targets[ti]; break; }
          }
          if (!pick) pick = data.targets[data.targets.length - 1];
          this.respond({ idx: pick.idx });
        }
        break;
      }
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
      case 'douga_fukugen_pick':
        if (data.cards && data.cards.length > 0) {
          let best = data.cards.reduce((a, b) => b.cost > a.cost ? b : a);
          this.respond({ idx: best.idx });
        } else { this.respond({ idx: -1 }); } break;
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
    // 打ち消し判断のdescは「スタック上で無効化されていない効果」のみから組み立てる。
    // cancelled済みの効果や、起動打ち消し（lastActionを更新しない）後の古い情報に反応して
    // 打ち消しを空撃ちするのを防ぐ。
    let desc = '';
    if (data.stack && data.stack.length > 0) {
      desc = data.stack.filter(e => !e.cancelled).map(e => e.description || '').join(' ');
    } else {
      desc = data.description || data.lastAction || '';
    }

    // ゼラチネ: 破壊されそうな時は割り込んで分裂する(簡易な判定。相手の効果の説明文に、ゼラチネへの除去・ダメージや全体除去が含まれるか)
    {
      let oppDesc = (data.stack || []).filter(e => !e.cancelled && e.player !== this.seat).map(e => e.description || '').join(' ');
      let zi = this.me().field.findIndex(c => c.abilities && c.abilities.includes('activated_zeratine_split'));
      if (zi >= 0 && oppDesc) {
        let z = this.me().field[zi];
        // 分裂して得なのは「ゼラチネ1体だけを狙った、実際に致死の効果」の時だけ。
        // 全体除去(チャンネル削除・99割・インプレッション制限・ルシアの全体200)は、出した子供(100/100)も巻き込まれるので分裂しない(打ち消しの判断へ進む)
        let remainZ = this.getT(z) - (z.damage || 0);
        let threatened = false;
        (data.stack || []).filter(e => !e.cancelled && e.player !== this.seat).forEach(e => {
          let d = e.description || '';
          if (!d.includes(z.name)) return;
          if (d.includes('破壊') || d.includes('除去')) { threatened = true; return; }
          let m = /に(\d+)ダメージ/.exec(d); if (m && parseInt(m[1], 10) >= remainZ) { threatened = true; return; }
          if (d.includes('-300/-300') && remainZ <= 300) threatened = true;
        });
        if (threatened && remainZ >= 100 && (data.abilities || []).some(a => a.fi === zi && a.ability.id === 'activated_zeratine_split')) {
          this.respond({ action: 'activate', fi: zi, aid: 'activated_zeratine_split' }); return;
        }
      }
    }

    // ダイスケ誰その男: 相手の主人公が複数いる、または強い主人公がいる時に撃つ。自分の主人公も巻き込まれるので、差し引きで得な時だけ
    {
      let dkIdx = hand.findIndex(c => c.id === 'daisuke_dare' && c.cost <= mana);
      // 同じチェーンに、自分のダイスケ誰その男がもう積まれている時は重ねない(解決すれば主人公はもういないので、2枚目は空振りになる)
      let alreadyQueued = (data.stack || []).some(e => !e.cancelled && e.player === this.seat && (e.description || '').includes('ダイスケ誰その男'));
      if (dkIdx >= 0 && !alreadyQueued && (data.supports || []).some(s => s.idx === dkIdx)) {
        const loss = (f, seat) => Math.max(0, (this.gs.getP(f, seat) + this.gs.getT(f, seat)) - 200); // 100/100 に変わることで失う強さ
        let oppHeroes = this.opp().field.filter(f => f.type === 'creature' && f.hero === true);
        let myHeroes = this.me().field.filter(f => f.type === 'creature' && f.hero === true);
        let gain = oppHeroes.reduce((s, f) => s + loss(f, 1 - this.seat), 0) - myHeroes.reduce((s, f) => s + loss(f, this.seat), 0);
        let strong = oppHeroes.some(f => this.gs.getP(f, 1 - this.seat) >= 400);
        if (oppHeroes.length > 0 && gain >= 200 && (oppHeroes.length >= 2 || strong)) {
          this.respond({ action: 'playSupport', idx: dkIdx }); return;
        }
      }
    }

    // 打ち消し: 高価値カードのみ
    let dIdx = hand.findIndex(c => c.id === 'douga_sakujo' && c.cost <= mana);
    if (dIdx >= 0) {
      let counterTargets = ['マオリア','トモ','イズナ','寄生体','サルベド猫','まっきーに','坂街透','アサキ','アズサ','NARI','愛つばめ','収益停止','チャンネル削除','死神少女','ジュン','ミリア','青春詭弁','サルベド猫のやらかし','アーク','99割','レイチェン','サギ','ユリ','スマッシャー','企画ボツ','インプレッション制限','水素水でナンパする男'];
      if (counterTargets.some(n => desc.includes(n))) {
        this.respond({ action: 'playSupport', idx: dIdx }); return;
      }
    }

    // サギカウンター
    let sagiField = this.me().field.find(c => c.abilities && c.abilities.includes('activated_sagi_counter') && !c.tapped);
    if (sagiField && mana >= 3 && this.me().hand.length > 0) {
      let counterTargets3 = ['マオリア','トモ','イズナ','寄生体','サルベド猫','まっきーに','坂街透','アサキ','アズサ','NARI','愛つばめ','収益停止','チャンネル削除','死神少女','ジュン','ミリア','青春詭弁','サルベド猫のやらかし','アーク','99割','レイチェン','サギ','ユリ','スマッシャー','企画ボツ','インプレッション制限','水素水でナンパする男'];
      if (counterTargets3.some(n => desc.includes(n))) {
        let fi = this.me().field.indexOf(sagiField);
        this.respond({ action: 'activate', fi, aid: 'activated_sagi_counter' }); return;
      }
    }

    // 死神カウンター（キャラ召喚にはLP効率で確定除去の方が良いのでスキップ）
    let shinigamiField = this.me().field.find(c => c.id === 'shinigami' && !c.tapped);
    if (shinigamiField && this.me().life >= 800 && !desc.includes('投稿宣言')) {
      let counterTargets2 = ['寄生体','サルベド猫','まっきーに','坂街透','NARI','愛つばめ','収益停止','チャンネル削除','青春詭弁','サルベド猫のやらかし','99割','企画ボツ','インプレッション制限','動画復元','閑話休題'];
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
      if (akapoIdx >= 0) {
        let phase = this.gs.G.phase;
        let hasAttacker = this.gs.G.attackers && this.gs.G.attackers.length > 0;
        let hasBlocker = this.gs.G.blockAssignments && Object.keys(this.gs.G.blockAssignments).length > 0;
        let myHasCreature = this.me().field.some(c => c.type === 'creature');
        let oppHasCreature = this.opp().field.some(c => c.type === 'creature');
        if ((hasAttacker || hasBlocker) && myHasCreature && oppHasCreature) { this.respond({ action: 'playSupport', idx: akapoIdx }); return; }
      }

      let mkIdx = hand.findIndex(c => c.id === 'makkinii' && c.cost <= mana);
      if (mkIdx >= 0 && this.me().field.filter(c => c.type === 'creature').length >= 2) {
        this.respond({ action: 'playSupport', idx: mkIdx }); return;
      }

      let scIdx = hand.findIndex(c => c.id === 'super_chat' && c.cost <= mana);
      if (scIdx >= 0) {
        let hasAtk = this.gs.G.attackers && this.gs.G.attackers.length > 0;
        let hasBlk = this.gs.G.blockAssignments && Object.keys(this.gs.G.blockAssignments).length > 0;
        let myHasC = this.me().field.some(c => c.type === 'creature');
        let oppHasC = this.opp().field.some(c => c.type === 'creature');
        if ((hasAtk || hasBlk) && myHasC && oppHasC) { this.respond({ action: 'playSupport', idx: scIdx }); return; }
      }

      let iIdx = hand.findIndex(c => c.id === 'ichiko' && c.cost <= mana);
      if (iIdx >= 0) { this.respond({ action: 'playSupport', idx: iIdx }); return; }
    }

    // 緩和休題: 戦闘チェーン以外で使用
    if (type !== 'chain_attack') {
      let kwIdx = hand.findIndex(c => c.id === 'kanwa_kyuudai' && c.cost <= mana);
      if (kwIdx >= 0) { this.respond({ action: 'playSupport', idx: kwIdx }); return; }
    }

    // 収益停止: 戦闘チェーン以外で使用
    if (type !== 'chain_attack') {
      let shIdx = hand.findIndex(c => c.id === 'shueki_teishi' && c.cost <= mana);
      if (shIdx >= 0) { this.respond({ action: 'playSupport', idx: shIdx }); return; }
    }

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
    let oppField = this.opp().field;
    let oppTargets = data.targets.filter(t => t.pi !== this.seat && oppField.some(f => f.id === t.id));
    if (oppTargets.length === 0) { this.respond({ targetIdx: -1 }); return; }
    let pool = oppTargets;
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
