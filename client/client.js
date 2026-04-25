// サルベドTCG オンラインクライアント
const socket = io();
let myState = null;
let mySeat = -1;

var DISPLAY_MULT = 100;
function dv(n) { return n * DISPLAY_MULT; }

// ==== カードボイス ====
var CARD_VOICES = { jun: 'img/jun_voice.wav', shinigami: 'img/shinigami_voice.wav', maoria: 'img/maoria_voice.wav', izuna: 'img/izuna_voice.wav', miiko: 'img/miiko_voice.wav', tomo: 'img/tomo_voice.wav', daria: 'img/daria_voice.wav', milia: 'img/milia_voice.wav', ark: 'img/ark_voice.wav' };
function playVoice(cardId) { var url = CARD_VOICES[cardId]; if(url){var a=new Audio(url);a.volume=0.7;a.play().catch(function(){});} }

// ==== ロビー ====
function getMyDeckDef() {
  let deckDef = [];
  Object.keys(myDeck).forEach(function(id) {
    if (myDeck[id] > 0) deckDef.push({ id: id, count: myDeck[id] });
  });
  return deckDef.length > 0 ? deckDef : undefined;
}
function quickMatch() {
  let name = document.getElementById('nameInput').value || 'ゲスト';
  socket.emit('quickMatch', { name: name, deck: getMyDeckDef() });
  document.getElementById('lobbyStatus').textContent = 'マッチング中...';
}
function aiMatch() {
  let name = document.getElementById('nameInput').value || 'ゲスト';
  socket.emit('aiMatch', { name: name, deck: getMyDeckDef() });
  document.getElementById('lobbyStatus').textContent = 'CPU対戦を開始します...';
}
function createRoom() {
  let name = document.getElementById('nameInput').value || 'ゲスト';
  socket.emit('createRoom', { name: name, deck: getMyDeckDef() });
}
function joinRoom() {
  let name = document.getElementById('nameInput').value || 'ゲスト';
  let roomId = document.getElementById('roomInput').value.toUpperCase();
  if (!roomId) return;
  socket.emit('joinRoom', { roomId, name, deck: getMyDeckDef() });
}

socket.on('waiting', ({ roomId }) => {
  document.getElementById('lobbyStatus').innerHTML = '待機中... ルームID: <b style="color:#f0e6d0;font-size:18px;">' + roomId + '</b><br>相手の参加を待っています';
});

socket.on('joined', ({ roomId, seat, names }) => {
  mySeat = seat;
  document.getElementById('lobbyStatus').textContent = 'ルーム ' + roomId + ' に参加 (Seat ' + (seat + 1) + ')';
});

socket.on('opponentJoined', ({ name }) => {
  document.getElementById('lobbyStatus').textContent = name + ' が参加。ゲーム開始...';
});

socket.on('error', ({ msg }) => {
  document.getElementById('lobbyStatus').textContent = 'エラー: ' + msg;
});

socket.on('opponentLeft', () => {
  showModal('<h3>相手が切断しました</h3><button onclick="location.reload()">ロビーに戻る</button>');
});

// ==== ターン画面 ====
socket.on('turnScreen', ({ currentPlayer, turn, isYourTurn }) => {
  console.log('[CLIENT] turnScreen received: turn=' + turn + ' isYourTurn=' + isYourTurn);
  showScreen('turnScreen');
  document.getElementById('turnTitle').textContent = (isYourTurn ? 'あなた' : '相手') + 'のターン (Turn ' + turn + ')';
  let btn = document.getElementById('turnBtn');
  if (isYourTurn) {
    btn.style.display = '';
    document.getElementById('turnMsg').textContent = '準備ができたらボタンを押してください';
  } else {
    btn.style.display = 'none';
    document.getElementById('turnMsg').textContent = '相手のターンを待っています...';
  }
});

function doStartTurn() {
  socket.emit('action', { type: 'startTurn' });
}

// ==== 状態更新 ====
socket.on('stateUpdate', (state) => {
  console.log('[CLIENT] stateUpdate phase=' + state.phase + ' cp=' + state.cp);
  myState = state;
  if (state.phase !== 'start') showScreen('gameScreen');
  render();
  if (window._waitingModal && !state.hasPendingPrompt) { closeModal(); window._waitingModal = false; }
  // promptモーダル表示中はstateUpdateで上書きしない（promptは再送される）
});

// ==== ログ ====
socket.on('log', (msg) => {
  document.getElementById('log').innerHTML = '<div class="entry">' + msg + '</div>' + document.getElementById('log').innerHTML;
});

// ==== トースト ====
socket.on('toast', ({ msg, type }) => {
  let t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), 2500);
});

// ==== ボイス ====
socket.on('summonVoice', function(data) { console.log('[CLIENT] summonVoice: ' + data.cardId); playVoice(data.cardId); });

// ==== デッキトップ確認 ====
socket.on('peekTop', function(data) {
  alert('デッキトップ: ' + data.name + ' (コスト:' + data.cost + ')');
});

// ==== 相手の手札確認 ====
socket.on('peekHand', function(data) {
  var peekHTML = '<h3>相手の手札</h3><div class="modal-cards">';
  data.cards.forEach(function(c) {
    peekHTML += '<div class="modal-card"><b>' + c + '</b></div>';
  });
  peekHTML += '</div><button onclick="closeModal()">閉じる</button>';
  setTimeout(function() { showModal(peekHTML); }, 2500);
});

// ==== プロンプト ====
socket.on('prompt', ({ type, data }) => {
  window._waitingModal = false;
  closeModal(); // 既存のモーダル（resolveResults等）を閉じてからプロンプト表示
  handlePrompt(type, data);
});

// ==== 解決結果 ====
socket.on('resolveResults', ({ results }) => {
  console.log('[CLIENT] resolveResults received: ' + (results ? results.length : 0) + ' results');
  if (!results || results.length === 0) {
    socket.emit('action', { type: 'ackResolve' });
    return;
  }
  let h = '<h3>効果解決結果</h3>';
  results.forEach(r => {
    h += '<div style="padding:6px 10px;margin:4px 0;background:#1a2a1a;border-radius:4px;border-left:3px solid #5a8a5a;color:#d0c8b0;">' + r + '</div>';
  });
  showModal(h);
  socket.emit('action', { type: 'ackResolve' });
  _autoCloseTimer = setTimeout(() => closeModal(), 2000);
});

// ==== ゲームオーバー ====
socket.on('gameOver', ({ youWin }) => {
  showModal('<h3>' + (youWin ? '勝利!' : '敗北...') + '</h3><button onclick="location.reload()">ロビーに戻る</button>');
});

// ==== 画面切替 ====
function showScreen(id) {
  ['lobbyScreen', 'turnScreen', 'gameScreen'].forEach(s => {
    document.getElementById(s).classList.toggle('active', s === id);
  });
}

// ==== モーダル ====
var _autoCloseTimer = null;
function showModal(h) {
  if (_autoCloseTimer) { clearTimeout(_autoCloseTimer); _autoCloseTimer = null; }
  document.getElementById('modal').classList.add('active');
  document.getElementById('modalContent').innerHTML = h;
}
function closeModal() {
  document.getElementById('modal').classList.remove('active');
}

// ==== カード描画 ====
var _cardRegistry = [];
function buildCardHTML(c, zone, idx, isOpp, oc) {
  var regIdx = _cardRegistry.length;
  _cardRegistry.push(c);
  let cls = 'mini-card';
  if (c.type === 'support') cls += ' type-support';
  if (c.type === 'enchantment') cls += ' type-enchant';
  if (c.subtype && c.subtype.includes('悪')) cls += ' type-evil';
  if (c.subtype && c.subtype.includes('規約')) cls += ' type-kiyaku';
  if (c.hero) cls += ' type-hero';
  if (c.heroine) cls += ' type-heroine';
  if (c.tapped && zone === 'field') cls += ' tapped';
  if (zone === 'mana') cls += ' mana-card' + (c.manaTapped ? ' mana-tapped' : '');

  let enchStr = '';
  if (c.enchantments && c.enchantments.length > 0) {
    enchStr = c.enchantments.map(e => '<span style="color:#c080e0;font-size:7px;">[' + (e.id || '?') + ']</span>').join('');
  }
  // art/artStyle support
  let artHTML = '';
  if (c.art) {

    artHTML = '<div style="position:relative;width:100%;height:60px;overflow:hidden;border-radius:4px;margin:2px 0;"><img src="' + c.art + '" style="width:100%;height:100%;object-fit:cover;' + (c.artStyle || '') + '"></div>';
  }

  let h = '<div class="' + cls + '" ' + (oc || '') + ' ' + (zone !== 'mana' ? 'onmouseenter="_popupShow(event,' + regIdx + ')" onmouseleave="hidePopup()" ontouchstart="_popupTouch(event,' + regIdx + ')"' : '') + '>';
  h += '<div class="mc-name">' + (zone === 'mana' ? 'マナ' : c.name) + '</div>';
  if (zone !== 'mana') h += '<div class="mc-cost">' + c.cost + '</div>';
  if (zone !== 'mana') {
    if (artHTML) {
      h += artHTML;
    } else {
      h += '<div class="mc-type">' + c.type + '</div>';
      h += '<div class="mc-text">' + (c.text || '') + '</div>';
    }
    h += enchStr;
  }
  if (c.power !== undefined && zone !== 'mana') {
    let dp = c.effP !== undefined ? c.effP : c.power;
    let dt = c.effT !== undefined ? c.effT : c.toughness;
    let changed = (dp !== c.power || dt !== c.toughness);
    let ptInner = '攻撃' + dv(dp) + ' HP' + dv(dt);
    if (zone === 'field' && c.damage > 0) ptInner += ' <span style="color:#ff4040;">DMG' + dv(c.damage) + '</span>';
    h += '<div class="mc-pt"' + (changed ? ' style="color:#e8c060;"' : '') + '>' + ptInner + '</div>';
  }
  h += '</div>';
  return h;
}

function renderCard(c, zone, idx, isOpp) {
  let oc = '';
  if (zone === 'hand' && !isOpp) oc = 'onclick="handleHandClick(' + idx + ')"';
  if (zone === 'field' && !isOpp) oc = 'onclick="handleFieldClick(' + idx + ')"';
  return buildCardHTML(c, zone, idx, isOpp, oc);
}

var CARD_FULL_TEXT = {
  'maoria': '<span class="cost-inline">3マナ + タップ：</span>対象のクリーチャー1体にこのクリーチャーのパワー+300点のダメージを与える。<br><br><span style="color:#888; font-size:10px; font-style:italic;">「退屈なんだよ、俺はさ」</span>',
  'tomo': '<span class="keyword">油断しない</span>（攻撃してもタップしない）<br><span class="keyword">俊足</span>（出たターンから攻撃可能）<br><br><span style="color:#888; font-size:10px; font-style:italic;">「会いたかったよ、マオリア」</span>',
  'izuna': '<span class="keyword">飛行</span><br><span class="cost-inline">2マナ：</span>対象のクリーチャー1体に200点のダメージを与える。<br><br><span style="color:#888; font-size:10px; font-style:italic;">「これでもこの世界で最強の魔法使いと言われてるのよ！」</span>',
  'miiko': 'ミーコを除くあなたがコントロールするクリーチャーが破壊されたとき、<span class="cost-inline">2マナ</span>を支払うことでそのクリーチャーを蘇生する。<br><br><span style="color:#888; font-size:10px; font-style:italic;">「もし死んでも蘇生しますから」</span>',
  'parasite': 'エンチャントされたクリーチャーの攻撃/HPを<span class="keyword">攻撃+200 HP+200</span>する。<br>エンチャントされたクリーチャーは<span class="cost-inline">1マナ：</span><span class="keyword">蘇生</span>を持つ。<br>あなたのアップキープ開始時、攻撃100 HP100の魔物トークンを1体生成する。<br>あなたがコントロールする魔物1体につき、ターン終了時にあなたは100点のライフを失う。<br>エンチャントされたクリーチャーが破壊されたとき、このカードをオーナーのデッキに加えシャッフルする。',
  'asaki': '<span class="cost-inline">2マナ + タップ：</span>相手のデッキの一番上のカードを確認する。その後、デッキをシャッフルしてもよい。<br><br><span style="color:#888; font-size:10px; font-style:italic;">「自由意志を持たない命は、死んでるも同じだ」</span>',
  'azusa': '<span class="cost-inline">4マナ + タップ：</span>相手のデッキの一番上のカードを墓地に送る。<br><br><span style="color:#888; font-size:10px; font-style:italic;">「掃除屋のわたしに目をつけられて、逃げられたやついないから」</span>',
  'salvado_cat': 'デッキからクリエイターカードを3枚選び手札に加える。その後無作為に手札から2枚選び墓地に捨てる。',
  'makkinii': '<span class="keyword">割り込み</span><br>手札からクリエイターカードを2枚捨てることでコストを支払わずに発動できる。<br>あなたがコントロールする全てのクリーチャーはターン終了時まで<span class="keyword">攻撃+300 HP+300</span>の修正を受ける。',
  'seishun_kiben': 'あなたの手札にある主人公またはヒロインカードを1枚、コストを支払わずにプレイしてもよい。',
  'sakamachi': 'デッキからイラストレーターのカードを3枚選択し、その内1枚を手札に加え、残り2枚を墓地に捨てる。',
  'kaera': '場に出た時、あなたのライフを200点回復する。<br><br><span class="card-flavor">「ありがとう、アサキ」</span>',
  'jk_a': '<span class="cost-inline">3マナ：</span>攻撃100 HP100の女子高生トークンを1体生成する。<br><br><span class="card-flavor">「ねー、あの子も呼んでいいー？」</span>',
  'iron_boss': 'あなたがコントロールする「悪」を持つクリーチャーは全て<span class="keyword">攻撃+100 HP+100</span>の修正を受ける。',
  'iron_chaser': '攻撃時、他の「悪」を持つクリーチャーがあなたの場にいる場合<span class="keyword">攻撃+100</span>の修正を受ける。',
  'hikaru': 'カードを2枚ドローする。その後、あなたがコントロールする全てのカードをタップする。',
  'oyuchi': 'カードを1枚ドローする。引いたカードがイラストレーターカードだった場合、さらに1枚ドローしてもよい。',
  'nari': 'デッキの上から5枚を確認し、好きなカードを1枚手札に加えてもよい。その後デッキをシャッフルする。',
  'ai_tsubame': 'カードを3枚ドローする。ドローしたカードを相手に公開し、相手が1枚選んで墓地に捨てる。',
  'ichiko': '<span class="keyword">割り込み</span><br>以下から1つ選んでプレイする：<br>・相手のライフに300点のダメージ<br>・自分のライフを500点回復<br>・自分のクリーチャー全てに<span class="keyword">攻撃+200</span><br>・相手のクリーチャー全てに<span class="keyword">攻撃-100</span>',
  'douga_sakujo': '<span class="keyword">割り込み</span><br>発動された効果1つを無効にする。<br><br><span class="card-flavor">「コミュニティガイドライン違反により削除されました」</span>',
  'shueki_teishi': '<span class="keyword">割り込み</span><br>相手がコントロールする全てのマナゾーンをタップする。<br><br><span class="card-flavor">「量産型のコンテンツです」</span>',
  'channel_sakujo': '全てのプレイヤーがコントロールするマナゾーン以外の全てのカードを破壊し、手札を全て捨てる。その後、お互いにカードを7枚引き直す。<br><br><span class="card-flavor">「チャンネルが見つかりません」</span>',
  'shinigami': '<span class="cost-inline">タップ + LP300：</span>クリーチャー1体を破壊する。それは蘇生できない。<br><span class="cost-inline">タップ + LP200：</span>相手の手札からランダムに1枚捨てさせる。<br><span class="cost-inline">タップ + LP500：</span>スタック上の効果1つを打ち消す。<br><br><span class="card-flavor">「寿命と引き換えに、願いを叶えてあげます」</span>',
  'jun': '場に出た時、デッキから「死神少女」を1枚サーチして手札に加える。<br><br><span class="card-flavor">「不審者がいる・・・」</span>',
  'mamachari': '<span class="keyword">俊足</span>（出たターンから攻撃可能）<br><br><span class="card-flavor">「ちゃりんちゃりん！！」</span>',
  'kyamakiri': '攻撃時、ターン終了時まで<span class="keyword">攻撃+200</span>の修正を受ける。<br><br><span class="card-flavor">「キャマキリィィィ！」</span>',
  'douga_henshuu': 'クリーチャー1体を選択し、ターン終了時まで<span class="keyword">攻撃-300 HP-300</span>の修正を受ける。<br><br><span class="card-flavor">「カットだらけで原型がない」</span>',
  'super_chat': '<span class="keyword">割り込み</span><br>クリーチャー1体を選択し、ターン終了時まで<span class="keyword">攻撃+300 HP+300</span>の修正を受ける。<br><br><span class="card-flavor">「赤スパきたーー！」</span>',
  'kikaku_botsu': 'フィールドのクリーチャー1体を破壊する。<br><br><span class="card-flavor">「この企画、なしで」</span>',
  'milia': 'あなたがコントロールするミリアを除く全てのクリーチャーは<span class="keyword">攻撃+100 HP+100</span>の修正を受ける。<br><br><span class="card-flavor">「死ぬまで戦い続けるんだからな？」</span>',
  'ark': '相手がコントロールする全てのクリーチャーは<span class="keyword">攻撃-100 HP-100</span>の修正を受ける。<br><br><span class="card-flavor">「どうして俺に剣を向けるんだ・・・？」</span>',
  'daria': '攻撃できない。<br>ブロック時、このクリーチャーは戦闘ダメージを受けない。<br><br><span class="card-flavor">「……寄るなよ」</span>',
  'shiko_touchou': '相手の手札を全て確認する。<br><br><span class="card-flavor">「頭にアルミホイル巻かなきゃ！」</span>',
  'kanwa_kyuudai': '<span class="keyword">割り込み</span><br>全てのクリーチャーをタップする。<br><br><span class="card-flavor">「――閑話休題」</span>',
  'seitokaichou': '<span class="keyword">油断しない</span>（攻撃してもタップしない）<br>場に出た時、カードを1枚ドローする。<br><br><span class="card-flavor">「規律は守ってもらいます」</span>',
  'osananajimi': '場に出た時、デッキから主人公カードを1枚サーチして手札に加える。<br><br><span class="card-flavor">「昔から、ずっと一緒だったでしょ」</span>',
  'onna_joushi': '<span class="keyword">油断しない</span>（攻撃してもタップしない）<br>場に出た時、自分のデッキの一番上を確認する。その後、デッキをシャッフルしてもよい。<br><br><span class="card-flavor">「仕事の後、少し付き合いなさい」</span>',
  'salvado_cat_yarakashi': 'このカードは打ち消されない。<br>クリーチャー1体を破壊する。それは蘇生できない。<br><br><span class="card-flavor">「あれ？消えちゃったにゃ」</span>'
};

function buildPopupHTML(c) {
  let cardClass = 'card card-creature';
  if (c.type === 'support') cardClass = 'card card-support';
  if (c.type === 'enchantment') cardClass = 'card card-enchant';
  if (c.subtype && c.subtype.includes('悪')) cardClass = 'card card-evil';
  if (c.subtype && c.subtype.includes('規約')) cardClass = 'card card-kiyaku';
  if (c.hero) cardClass += ' card-hero';
  if (c.heroine) cardClass += ' card-heroine';

  let h = '<div class="' + cardClass + '">';
  h += '<div class="card-header"><span class="card-name">' + c.name + '</span><span class="card-cost">' + c.cost + '</span></div>';

  // art
  if (c.art) {
    h += '<div class="card-art"><img src="' + c.art + '" style="width:100%;height:100%;object-fit:cover;' + (c.artStyle || '') + '"></div>';
  } else {
    h += '<div class="card-art">[ イラスト ]</div>';
  }

  // type tags
  h += '<div class="card-type">';
  if (c.subtype) {
    c.subtype.forEach(function(st) {
      let tagClass = 'tag tag-normal';
      if (st === '主人公') tagClass = 'tag tag-hero';
      if (st === 'ヒロイン' && c.heroine) tagClass = 'tag tag-heroine';
      if (st === '悪') tagClass = 'tag tag-evil';
      if (st === '規約') tagClass = 'tag tag-kiyaku';
      if (st === 'エンチャント') tagClass = 'tag tag-enchant';
      if (st === 'サポート' || st === 'クリエイター' || st === 'イラストレーター' || st === 'ディレクター' || st === '管理者' || st === '声優' || st === 'ライター') tagClass = 'tag tag-support';
      h += '<span class="' + tagClass + '">' + st + '</span>';
    });
  }
  h += '</div>';

  // text
  h += '<div class="card-text">' + (CARD_FULL_TEXT[c.id] || c.text || '') + '</div>';

  // P/T footer
  if (c.power !== undefined) {
    let dp = c.effP !== undefined ? c.effP : c.power;
    let dt = c.effT !== undefined ? c.effT : c.toughness;
    let changed = (dp !== c.power || dt !== c.toughness);
    h += '<div class="card-footer"><span class="card-pt' + (changed ? ' modified' : '') + '">攻撃' + dv(dp) + ' HP' + dv(dt) + '</span></div>';
  }

  h += '</div>';
  return h;
}

function showPopup(e, c) {
  let popup = document.getElementById('cardPopup');
  popup.innerHTML = buildPopupHTML(c);
  popup.classList.add('active');
  // position near cursor
  let x = e.clientX + 15;
  let y = e.clientY - 100;
  if (x + 290 > window.innerWidth) x = e.clientX - 295;
  if (y < 10) y = 10;
  if (y + 400 > window.innerHeight) y = window.innerHeight - 400;
  popup.style.left = x + 'px';
  popup.style.top = y + 'px';
}

function hidePopup() {
  let popup = document.getElementById('cardPopup');
  popup.classList.remove('active');
}

function _popupShow(e, idx) { if (_cardRegistry[idx]) showPopup(e, _cardRegistry[idx]); }
function _popupTouch(e, idx) {
  if (_cardRegistry[idx]) {
    let touch = e.touches ? e.touches[0] : e;
    showPopup(touch, _cardRegistry[idx]);
  }
}
document.addEventListener('touchstart', function(e) {
  if (!e.target.closest('.mini-card') && !e.target.closest('#cardPopup')) hidePopup();
}, { passive: true });

// ==== 描画 ====
function render() {
  if (!myState) return;
  _cardRegistry = [];
  let s = myState;

  // ライフ
  document.getElementById('myLife').textContent = 'LP:' + dv(s.me.life);
  document.getElementById('oppLife').textContent = 'LP:' + dv(s.opp.life);
  document.getElementById('myInfo').textContent = '墓' + s.me.grave.length + ' デッキ' + s.me.deckCount;
  document.getElementById('oppInfo').textContent = '墓' + s.opp.grave.length + ' デッキ' + s.opp.deckCount + ' 手札' + s.opp.handCount;

  // フェイズ
  let phaseNames = { start: '開始', main: 'メイン', attack: '攻撃', block: 'ブロック', main2: 'メイン2' };
  document.getElementById('phaseInfo').textContent = 'Turn' + s.turn + ' ' + (phaseNames[s.phase] || s.phase) + (s.isMyTurn ? ' [自分]' : ' [相手]');

  // 相手マナ
  let oppMH = '<span class="label">相手マナ(' + s.opp.mana.filter(m => !m.manaTapped).length + '/' + s.opp.mana.length + ')</span>';
  s.opp.mana.forEach((c, i) => { oppMH += renderCard(c, 'mana', i, true); });
  document.getElementById('oppMana').innerHTML = oppMH;

  // 相手フィールド
  let oppH = '';
  s.opp.field.forEach((c, i) => { oppH += renderCard(c, 'field', i, true); });
  document.getElementById('oppField').innerHTML = oppH;

  // 自分フィールド
  let myFH = '';
  s.me.field.forEach((c, i) => {
    let selected = s.phase === 'attack' && s.attackers.includes(i);
    let card = renderCard(c, 'field', i, false);
    if (selected) card = card.replace('class="mini-card', 'class="mini-card selected');
    myFH += card;
  });
  document.getElementById('myField').innerHTML = myFH;

  // マナ
  let manaH = '<span class="label">マナ(' + s.me.mana.filter(m => !m.manaTapped).length + '/' + s.me.mana.length + ')</span>';
  s.me.mana.forEach((c, i) => { manaH += renderCard(c, 'mana', i, false); });
  document.getElementById('myMana').innerHTML = manaH;

  // 手札
  let handH = '<span class="label">手札(' + s.me.hand.length + ')</span>';
  s.me.hand.forEach((c, i) => { handH += renderCard(c, 'hand', i, false); });
  document.getElementById('myHand').innerHTML = handH;

  // コントロール
  let ctrl = '';
  if (s.isMyTurn) {
    if ((s.phase === 'main' || s.phase === 'main2') && s.chainDepth === 0 && !s.waitingAction && !s.hasPendingPrompt) {
      ctrl += '<button onclick="showManaSelect()">マナセット</button>';
      ctrl += '<button onclick="showPlaySelect()">プレイ</button>';
      ctrl += '<button onclick="showAbilitySelect()">能力起動</button>';
      if (s.phase === 'main') ctrl += '<button class="primary" onclick="doStartCombat()">戦闘</button>';
      ctrl += '<button onclick="doEndTurn()">ターン終了</button>';
    }
    if (s.phase === 'attack' && s.chainDepth === 0 && !s.hasPendingPrompt) {
      ctrl += '<button class="primary" onclick="doConfirmAttack()">攻撃確定</button>';
      ctrl += '<button onclick="doCancelAttack()">キャンセル</button>';
    }
  } else {
    ctrl += '<span style="color:#888;">相手のターン</span>';
  }
  document.getElementById('controls').innerHTML = ctrl;
}

// ==== UI操作 ====
function handleHandClick(idx) {
  if (!myState || !myState.isMyTurn) return;
  // 手札クリックはプレイ選択から
}
function handleFieldClick(idx) {
  if (!myState) return;
  if (myState.phase === 'attack' && myState.isMyTurn) {
    socket.emit('action', { type: 'toggleAttacker', data: { fi: idx } });
  }
}

function showManaSelect() {
  if (!myState || myState.manaPlaced) { showModal('<h3>マナは既にセット済み</h3><button onclick="closeModal()">OK</button>'); return; }
  let h = '<h3>マナセット</h3><div class="modal-cards">';
  myState.me.hand.forEach((c, i) => {
    h += '<div class="modal-card" onclick="closeModal();doPlaceMana(' + i + ')"><b>' + c.name + '</b><br>コスト:' + c.cost + '</div>';
  });
  h += '</div><button onclick="closeModal()">戻る</button>';
  showModal(h);
}

function showPlaySelect() {
  let h = '<h3>プレイ</h3><div class="modal-cards">';
  let mana = myState.me.mana.filter(m => !m.manaTapped).length;
  myState.me.hand.forEach((c, i) => {
    let ok = mana >= c.cost;
    if (c.id === 'makkinii') ok = true;
    let s = ok ? 'border-color:#8a7d5a;cursor:pointer;' : 'border-color:#333;opacity:0.4;';
    h += '<div class="modal-card" style="' + s + '" ' + (ok ? 'onclick="closeModal();doPlayCard(' + i + ')"' : '') + '><b>' + c.name + '</b><br>コスト:' + c.cost + (c.power !== undefined ? '<br>攻撃' + dv(c.power) + ' HP' + dv(c.toughness) : '') + '</div>';
  });
  h += '</div><button onclick="closeModal()">戻る</button>';
  showModal(h);
}

function showAbilitySelect() {
  let h = '<h3>能力起動</h3><div class="modal-cards">';
  let mana = myState.me.mana.filter(m => !m.manaTapped).length;
  myState.me.field.forEach((c, i) => {
    let abilities = [];
    if (c.abilities) {
      if (c.abilities.includes('activated_izuna') && mana >= 2) abilities.push({ id: 'activated_izuna', label: 'ダメージ(2マナ)' });
      if (c.abilities.includes('create_token_jk') && mana >= 3) abilities.push({ id: 'create_token_jk', label: 'トークン(3マナ)' });
      if (!c.tapped) {
        if (c.abilities.includes('activated_shinigami')) {
          if (myState.me.life >= 3) abilities.push({ id: 'shinigami_destroy', label: '確定除去(T+LP' + dv(3) + ')' });
          if (myState.me.life >= 2) abilities.push({ id: 'shinigami_discard', label: 'ハンデス(T+LP' + dv(2) + ')' });
        }
        if (c.abilities.includes('activated_maoria') && mana >= 3) abilities.push({ id: 'activated_maoria', label: '火力(3マナ+T)' });
        if (c.abilities.includes('activated_asaki') && mana >= 2) abilities.push({ id: 'activated_asaki', label: 'トップ確認(2+T)' });
        if (c.abilities.includes('activated_azusa') && mana >= 4) abilities.push({ id: 'activated_azusa', label: 'トップ除去(4+T)' });
      }
    }
    if (abilities.length > 0) {
      h += '<div style="background:#2c2c3a;padding:8px;border:1px solid #8a7d5a;border-radius:6px;min-width:100px;text-align:center;"><b>' + c.name + '</b>';
      abilities.forEach(a => {
        h += '<br><button style="margin:2px;padding:2px 6px;font-size:10px;" onclick="closeModal();doActivate(' + i + ',\'' + a.id + '\')">' + a.label + '</button>';
      });
      h += '</div>';
    }
  });
  h += '</div><button onclick="closeModal()">戻る</button>';
  showModal(h);
}

// ==== サーバー送信 ====
function doPlaceMana(idx) { socket.emit('action', { type: 'placeMana', data: { idx } }); }
function doPlayCard(idx) { socket.emit('action', { type: 'playCard', data: { idx } }); }
function doActivate(fi, aid) { socket.emit('action', { type: 'activateAbility', data: { fi, aid } }); }
function doStartCombat() { socket.emit('action', { type: 'startCombat' }); }
function doConfirmAttack() { socket.emit('action', { type: 'confirmAttack' }); }
function doCancelAttack() { socket.emit('action', { type: 'cancelAttack' }); }
function doEndTurn() { socket.emit('action', { type: 'endTurn' }); }

// ==== プロンプト処理 ====
function handlePrompt(type, data) {
  switch (type) {
    case 'chain':
    case 'chain_attack': {
      let h = '<h3>割り込みますか？</h3>';
      h += '<div style="margin:8px 0;padding:10px;background:#2a1a1a;border:1px solid #8a3030;border-radius:6px;color:#f0e6d0;font-size:13px;">' + (data.lastAction || '') + '</div>';
      if (data.stack && data.stack.length > 0) {
        h += '<div style="margin:8px 0;padding:8px;background:#111;border-radius:6px;"><p style="color:#aaa;margin-bottom:4px;font-size:10px;">スタック:</p>';
        data.stack.forEach(e => {
          h += '<div style="background:#1a1a2e;padding:4px 8px;margin:2px;border-radius:4px;border-left:3px solid ' + (e.player === mySeat ? '#5a8a5a' : '#8a5a5a') + ';">' + (e.cancelled ? '【打消済】' : '') + 'P' + (e.player + 1) + ': ' + e.description + '</div>';
        });
        h += '</div>';
      }
      h += '<p style="color:#aaa;margin:8px 0;">チェーン ' + data.chainDepth + '/3</p>';
      if (data.supports.length > 0) {
        h += '<p style="color:#aaa;">サポート:</p><div class="modal-cards">';
        data.supports.forEach(s => {
          h += '<div class="modal-card" onclick="respondChain(\'playSupport\',' + s.idx + ')"><b>' + s.name + '</b><br>コスト:' + s.cost + '</div>';
        });
        h += '</div>';
      }
      if (data.abilities.length > 0) {
        h += '<p style="color:#aaa;">能力:</p><div class="modal-cards">';
        data.abilities.forEach(a => {
          h += '<div class="modal-card" onclick="respondChain(\'activate\',' + a.fi + ',\'' + a.ability.id + '\')"><b>' + a.cardName + '</b><br>' + a.ability.label + '</div>';
        });
        h += '</div>';
      }
      h += '<button onclick="respondChain(\'pass\')">パス</button>';
      showModal(h);
      break;
    }

    case 'block': {
      let h = '<h3>ブロック選択</h3><div class="modal-cards">';
      data.attackers.forEach((atk, i) => {
        h += '<div style="background:#3a2020;padding:8px;border-radius:6px;border:1px solid #8a3030;min-width:80px;text-align:center;">';
        h += '<b>' + atk.name + '</b><br>攻撃' + dv(atk.power) + ' HP' + dv(atk.toughness) + (atk.flying ? ' [飛行]' : '');
        h += '<br><select id="bl_' + i + '" data-atk="' + atk.idx + '" onchange="updateBlockSelects()"><option value="-1">ブロックなし</option>';
        data.blockers.forEach((blk, bi) => {
          if (atk.flying && !blk.flying) return;
          h += '<option value="' + bi + '">' + blk.name + '(攻撃' + dv(blk.power) + ' HP' + dv(blk.toughness) + ')</option>';
        });
        h += '</select></div>';
      });
      h += '</div><button onclick="submitBlocks()">確定</button>';
      showModal(h);
      break;
    }

    case 'makkinii_choice': {
      let h = '<h3>まっきーに: 支払い方法を選択</h3><div class="modal-cards">';
      h += '<div class="modal-card" style="min-width:120px;" onclick="respondPrompt({choice:\'mana\'})"><b>マナ5で支払う</b><br>残マナ:' + data.remainingMana + '</div>';
      h += '<div class="modal-card" style="min-width:120px;" onclick="respondPrompt({choice:\'alt\'})"><b>クリエイター2枚捨て</b><br>無料発動</div>';
      h += '</div><button onclick="respondPrompt({choice:\'cancel\'})">キャンセル</button>';
      showModal(h);
      break;
    }

    case 'ichiko_choice': {
      let h = '<h3>いちこ: 効果を選択</h3><div class="modal-cards">';
      h += '<div class="modal-card" onclick="respondPrompt({mode:1})"><b>' + dv(3) + '点ダメージ</b></div>';
      h += '<div class="modal-card" onclick="respondPrompt({mode:2})"><b>LP' + dv(5) + '回復</b></div>';
      h += '<div class="modal-card" onclick="respondPrompt({mode:3})"><b>味方攻撃+' + dv(2) + '</b></div>';
      h += '<div class="modal-card" onclick="respondPrompt({mode:4})"><b>相手攻撃-' + dv(1) + '</b></div>';
      h += '</div>';
      showModal(h);
      break;
    }

    case 'counterspell_target': {
      let h = '<h3>動画削除: 打ち消す効果を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" style="border-color:#cc3030;" onclick="respondPrompt({idx:' + t.idx + '})"><b>P' + (t.player + 1) + '</b><br>' + t.description + '</div>';
      });
      h += '</div>';
      showModal(h);
      break;
    }

    case 'regen_confirm': {
      let h = '<h3>' + data.source + '蘇生: ' + data.card.name + '</h3>';
      h += '<p>' + data.cost + 'マナで蘇生しますか？ (残り:' + data.manaLeft + ')</p>';
      h += '<button onclick="respondPrompt({accept:true})">蘇生する</button>';
      h += '<button onclick="respondPrompt({accept:false})">しない</button>';
      showModal(h);
      break;
    }

    case 'target_damage': {
      let h = '<h3>' + data.source + ': ダメージ対象を選択 (' + dv(data.damage) + '点)</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" style="border-color:#cc3030;" onclick="respondPrompt({targetIdx:' + t.idx + '})"><b>' + t.name + '</b><br>HP:' + dv(t.hp - t.damage) + '/' + dv(t.hp) + '</div>';
      });
      h += '</div><button onclick="respondPrompt({targetIdx:-1})">キャンセル</button>';
      showModal(h);
      break;
    }

    case 'asaki_peek': {
      let h = '<h3>アサキ: 相手のデッキトップ</h3>';
      h += '<div style="padding:12px;background:#2a2a3a;border-radius:8px;text-align:center;margin:12px 0;"><b style="font-size:16px;">' + data.topCard.name + ' (コスト' + data.topCard.cost + ')' + '</b></div>';
      h += '<button onclick="respondPrompt({shuffle:true})">シャッフルする</button>';
      h += '<button onclick="respondPrompt({shuffle:false})">そのまま</button>';
      showModal(h);
      break;
    }

    case 'nari_pick': {
      let h = '<h3>NARI: 手札に加える1枚を選択</h3><div class="modal-cards">';
      data.cards.forEach((c, i) => {
        h += '<div class="modal-card" onclick="respondPrompt({idx:' + i + '})"><b>' + c.name + '</b><br>コスト:' + c.cost + '</div>';
      });
      h += '</div><button onclick="respondPrompt({idx:-1})">選ばない</button>';
      showModal(h);
      break;
    }

    case 'free_play': {
      let h = '<h3>青春詭弁: 無料召喚</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" onclick="respondPrompt({idx:' + t.idx + '})"><b>' + t.name + '</b><br>攻撃' + dv(t.power) + ' HP' + dv(t.toughness) + '</div>';
      });
      h += '</div><button onclick="respondPrompt({idx:-1})">キャンセル</button>';
      showModal(h);
      break;
    }

    case 'creator_discard': {
      let h = '<h3>' + data.cardName + ': クリエイター2枚を選んで捨てる</h3>';
      h += '<p id="discardCount" style="color:#aaa;">選択: 0/2</p><div class="modal-cards">';
      data.creators.forEach(cr => {
        h += '<div class="modal-card" id="cd_' + cr.idx + '" onclick="toggleCreatorDiscard(' + cr.idx + ')"><b>' + cr.name + '</b></div>';
      });
      h += '</div><button id="discardConfirm" onclick="confirmCreatorDiscard()" disabled>確定</button>';
      showModal(h);
      window._discardSelected = [];
      break;
    }

    case 'discard_one': {
      let h = '<h3>愛つばめ: 相手の手札から1枚選んで捨てさせる</h3><div class="modal-cards">';
      data.cards.forEach(c => {
        h += '<div class="modal-card" onclick="respondPrompt({idx:' + c.idx + '})"><b>' + c.name + '</b></div>';
      });
      h += '</div>';
      showModal(h);
      break;
    }

    case 'enchant_target': {
      let h = '<h3>エンチャント先を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" onclick="respondPrompt({fieldIdx:' + t.idx + '});closeModal()"><b>' + t.name + '</b></div>';
      });
      h += '</div>';
      showModal(h);
      break;
    }

    case 'shuffle_confirm': {
      let h = '<h3>デッキトップ確認</h3>';
      h += '<div style="padding:12px;background:#2a2a3a;border-radius:8px;text-align:center;margin:12px 0;"><b style="font-size:16px;">' + data.topCard.name + ' (コスト' + data.topCard.cost + ')' + '</b></div>';
      h += '<button onclick="respondPrompt({shuffle:true})">シャッフルする</button>';
      h += '<button onclick="respondPrompt({shuffle:false})">そのまま</button>';
      showModal(h);
      break;
    }

    case 'seishun_kiben_target': {
      let h = '<h3>青春詭弁: 無料召喚する対象を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" onclick="respondPrompt({idx:' + t.idx + '})"><b>' + t.name + '</b><br>攻撃' + dv(t.power) + ' HP' + dv(t.toughness) + '</div>';
      });
      h += '</div><button onclick="respondPrompt({idx:-1})">キャンセル</button>';
      showModal(h);
      break;
    }


    case 'buff_target': {
      let h = '<h3>スーパーチャット: 対象を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" onclick="respondPrompt({targetIdx:' + t.idx + '})"><b>' + t.name + '</b></div>';
      });
      h += '</div>';
      showModal(h);
      break;
    }

    case 'debuff_target': {
      let h = '<h3>動画編集: 対象を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" style="border-color:#cc3030;" onclick="respondPrompt({targetIdx:' + t.idx + '})"><b>' + t.name + '</b></div>';
      });
      h += '</div>';
      showModal(h);
      break;
    }

    case 'destroy_target': {
      let h = '<h3>企画ボツ: 破壊する対象を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" style="border-color:#cc3030;" onclick="respondPrompt({targetIdx:' + t.idx + ',pi:' + t.pi + '})"><b>' + (t.pi !== myState.myIndex ? '[相手] ' : '[自分] ') + t.name + '</b></div>';
      });
      h += '</div>';
      showModal(h);
      break;
    }

    case 'shinigami_destroy_target': {
      let h = '<h3>死神少女: 破壊する対象を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" style="border-color:#cc3030;" onclick="respondPrompt({targetIdx:' + t.idx + ',pi:' + t.pi + '})"><b>' + (t.pi !== myState.myIndex ? '[相手] ' : '[自分] ') + t.name + '</b></div>';
      });
      h += '</div>';
      showModal(h);
      break;
    }

    case 'yarakashi_target': {
      let h = '<h3>サルベド猫のやらかし: 破壊する対象を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" style="border-color:#cc3030;" onclick="respondPrompt({targetIdx:' + t.idx + ',pi:' + t.pi + '})"><b>' + (t.pi !== myState.myIndex ? '[相手] ' : '[自分] ') + t.name + '</b></div>';
      });
      h += '</div>';
      showModal(h);
      break;
    }

    case 'sakamachi_pick': {
      let h = '<h3>坂街透: 手札に加える1枚を選択</h3><div class="modal-cards">';
      data.cards.forEach((c, i) => {
        h += '<div class="modal-card" onclick="respondPrompt({idx:' + i + '})"><b>' + c.name + '</b><br>コスト:' + c.cost + '</div>';
      });
      h += '</div><button onclick="respondPrompt({idx:-1})">選ばない</button>';
      showModal(h);
      break;
    }

    case 'salvado_cat_pick': {
      let need = data.needSelect || 3;
      let h = '<h3>サルベド猫: ' + need + '枚選択 → 1枚手札・残り墓地</h3><div class="modal-cards">';
      data.cards.forEach((c, i) => {
        h += '<div class="modal-card" id="scp_' + i + '" onclick="toggleSalvadoPick(' + i + ',' + need + ')"><b>' + c.name + '</b><br>コスト:' + c.cost + '</div>';
      });
      h += '</div><div id="scpCount" style="text-align:center;margin:8px 0;">選択: 0/' + need + '</div>';
      h += '<button id="scpConfirm" onclick="confirmSalvadoPick()" disabled>確定</button>';
      showModal(h);
      window._salvadoPicked = [];
      window._salvadoNeed = need;
      break;
    }
    case 'waiting': {
      let h = '<h3>' + (data.msg || '相手が選択中です...') + '</h3>';
      showModal(h);
      window._waitingModal = true;
      break;
    }
    default:
      console.log('未対応プロンプト:', type, data);
  }
}

// ==== プロンプト応答 ====
function respondPrompt(data) {
  closeModal();
  socket.emit('action', { type: 'promptResponse', data });
}
function respondChain(action, idx, aid) {
  closeModal();
  let data = { action };
  if (action === 'playSupport') data.idx = idx;
  if (action === 'activate') { data.fi = idx; data.aid = aid; }
  socket.emit('action', { type: 'promptResponse', data });
}

function updateBlockSelects() {
  let selects = document.querySelectorAll('[id^="bl_"]');
  let used = {};
  selects.forEach(sel => {
    let v = parseInt(sel.value);
    if (v >= 0) used[sel.id] = v;
  });
  let taken = new Set(Object.values(used));
  selects.forEach(sel => {
    let myVal = parseInt(sel.value);
    Array.from(sel.options).forEach(opt => {
      let ov = parseInt(opt.value);
      if (ov < 0) return;
      opt.disabled = (ov !== myVal && taken.has(ov));
    });
  });
}

function submitBlocks() {
  let assignments = {};
  let used = new Set();
  let selects = document.querySelectorAll('[id^="bl_"]');
  selects.forEach(sel => {
    let atkIdx = parseInt(sel.dataset.atk);
    let blkIdx = parseInt(sel.value);
    if (blkIdx >= 0 && !used.has(blkIdx)) { assignments[atkIdx] = blkIdx; used.add(blkIdx); }
  });
  closeModal();
  socket.emit('action', { type: 'promptResponse', data: { assignments } });
}

// クリエイター捨て選択
window._discardSelected = [];
function toggleCreatorDiscard(idx) {
  let sel = window._discardSelected;
  let pos = sel.indexOf(idx);
  if (pos >= 0) { sel.splice(pos, 1); document.getElementById('cd_' + idx).style.borderColor = '#8a7d5a'; }
  else if (sel.length < 2) { sel.push(idx); document.getElementById('cd_' + idx).style.borderColor = '#e8c060'; }
  document.getElementById('discardCount').textContent = '選択: ' + sel.length + '/2';
  document.getElementById('discardConfirm').disabled = sel.length < 2;
}
function confirmCreatorDiscard() {
  closeModal();
  socket.emit('action', { type: 'creatorDiscard', data: { selected: window._discardSelected } });
}


// サルベド猫選択
window._salvadoPicked = [];
function toggleSalvadoPick(idx, need) {
  let sel = window._salvadoPicked;
  let n = need || window._salvadoNeed || 3;
  let pos = sel.indexOf(idx);
  if (pos >= 0) { sel.splice(pos, 1); document.getElementById('scp_' + idx).style.borderColor = '#8a7d5a'; }
  else if (sel.length < n) { sel.push(idx); document.getElementById('scp_' + idx).style.borderColor = '#e8c060'; }
  document.getElementById('scpCount').textContent = '選択: ' + sel.length + '/' + n;
  document.getElementById('scpConfirm').disabled = sel.length !== n;
}
function confirmSalvadoPick() {
  closeModal();
  socket.emit('action', { type: 'promptResponse', data: { selected: window._salvadoPicked } });
}

// ==== デッキエディタ ====
var DECK_CARDS = [
  {id:'maoria',name:'のちの魔王 マオリア',cost:7,power:5,toughness:5,text:'3+T:攻撃力+' + (3*100) + '点ダメージ',max:2},
  {id:'tomo',name:'勇者 トモ',cost:8,power:8,toughness:8,text:'油断しない,俊足',max:2},
  {id:'izuna',name:'魔法使い イズナ',cost:3,power:3,toughness:1,text:'飛行/2マナ:' + (2*100) + '点ダメージ',max:4},
  {id:'miiko',name:'僧侶 ミーコ',cost:3,power:0,toughness:3,text:'味方破壊時2マナ蘇生',max:4},
  {id:'asaki',name:'元掃除屋 アサキ',cost:5,power:4,toughness:4,text:'2+T:相手トップ確認→シャッフル可',max:2},
  {id:'azusa',name:'掃除屋 アズサ',cost:5,power:4,toughness:3,text:'4+T:相手トップ墓地送り',max:2},
  {id:'kaera',name:'パン屋の娘 カエラ',cost:1,power:1,toughness:1,text:'登場時:LP' + (2*100) + '回復',max:4},
  {id:'milia',name:'勇者の血族 ミリア',cost:4,power:3,toughness:3,text:'他の味方攻撃+' + (1*100) + '/HP+' + (1*100),max:2},
  {id:'ark',name:'魔王の血族 アーク',cost:8,power:5,toughness:5,text:'相手全体攻撃-' + (1*100) + '/HP-' + (1*100),max:2},
  {id:'daria',name:'勇者の兄 ダリア',cost:3,power:0,toughness:5,text:'攻撃不可/ブロック時ダメージ無効',max:4},
  {id:'jun',name:'ジュン',cost:2,power:1,toughness:2,text:'登場時:死神少女サーチ',max:2},
  {id:'shinigami',name:'死神少女',cost:5,power:2,toughness:3,text:'T+LP' + (3*100) + ':確定除去/T+LP' + (2*100) + ':ハンデス/T+LP' + (5*100) + ':打ち消し',max:2},
  {id:'iron_boss',name:'Aレイスのボス',cost:4,power:2,toughness:3,text:'悪全体攻撃+' + (1*100) + '/HP+' + (1*100),max:4},
  {id:'iron_chaser',name:'Aレイスの追手',cost:2,power:1,toughness:2,text:'攻撃時他の悪で攻撃+' + (1*100) + '/HP+0',max:4},
  {id:'mamachari',name:'ママチャリ暴走族',cost:2,power:2,toughness:1,text:'俊足',max:4},
  {id:'seitokaichou',name:'生徒会長ヒロイン',cost:2,power:1,toughness:1,text:'油断しない/登場時:1枚ドロー',max:4},
  {id:'osananajimi',name:'幼馴染ヒロイン',cost:2,power:1,toughness:1,text:'登場時:主人公サーチ',max:4},
  {id:'onna_joushi',name:'女上司ヒロイン',cost:2,power:1,toughness:1,text:'油断しない/登場時:デッキトップ確認→シャッフル可',max:4},
  {id:'jk_a',name:'一般女子高生A',cost:2,power:1,toughness:1,text:'3マナ:攻撃' + (1*100) + ' HP' + (1*100) + 'トークン生成',max:4},
  {id:'kyamakiri',name:'キャマキリ',cost:1,power:1,toughness:1,text:'攻撃時攻撃+' + (2*100) + '/HP+0',max:4},
  {id:'parasite',name:'魔の寄生体',cost:4,text:'攻撃+' + (2*100) + '/HP+' + (2*100) + ',1マナ蘇生,魔物生成,ライフロス',max:4},
  {id:'salvado_cat',name:'サルベド猫',cost:5,text:'クリエイター3枚サーチ→2枚捨て',max:4},
  {id:'makkinii',name:'まっきーに',cost:5,text:'クリエイター2枚捨てで無料/全体攻撃+' + (3*100) + ' HP+' + (3*100),max:4},
  {id:'sakamachi',name:'坂街透',cost:3,text:'イラストレーター3枚→1枚手札,2枚墓地',max:4},
  {id:'hikaru',name:'ひかる',cost:2,text:'2枚ドロー→全タップ',max:4},
  {id:'oyuchi',name:'おゆち',cost:1,text:'1枚ドロー(イラストレーターなら+1)',max:4},
  {id:'nari',name:'NARI',cost:2,text:'デッキ上5枚から1枚手札に',max:4},
  {id:'ai_tsubame',name:'愛つばめ',cost:3,text:'3枚ドロー→相手が1枚選んで捨て',max:4},
  {id:'seishun_kiben',name:'青春詭弁',cost:5,text:'手札の主人公/ヒロインを無料召喚',max:4},
  {id:'ichiko',name:'いちこ',cost:4,text:'4択:' + (3*100) + '点/' + (5*100) + '回復/攻撃+' + (2*100) + '/相手攻撃-' + (1*100),max:4},
  {id:'douga_sakujo',name:'動画削除',cost:3,text:'効果1つを無効にする',max:4},
  {id:'shueki_teishi',name:'収益停止',cost:4,text:'相手マナ全タップ',max:4},
  {id:'channel_sakujo',name:'チャンネル削除',cost:6,text:'全場破壊+手札全捨て+7枚引き直し',max:2},
  {id:'douga_henshuu',name:'動画編集',cost:2,text:'対象攻撃-' + (3*100) + '/HP-' + (3*100) + '(ターン終了まで)',max:4},
  {id:'super_chat',name:'スーパーチャット',cost:1,text:'味方攻撃+' + (3*100) + '/HP+' + (3*100) + '(ターン終了まで)',max:4},
  {id:'kikaku_botsu',name:'企画ボツ',cost:4,text:'クリーチャー1体破壊',max:4},
  {id:'shiko_touchou',name:'思考盗聴された！',cost:2,text:'相手の手札を見る',max:4},
  {id:'kanwa_kyuudai',name:'閑話休題',cost:5,text:'割り込み/全クリーチャータップ',max:4},
  {id:'salvado_cat_yarakashi',name:'サルベド猫のやらかし',cost:6,text:'打ち消し不可/確定除去(蘇生不可)',max:2}
];

var myDeck = {};
function initDeckEditor() {
  myDeck = {};
  DECK_CARDS.forEach(function(c) { myDeck[c.id] = 0; });
  try {
    var saved = JSON.parse(localStorage.getItem('salvado_deck'));
    if (saved) saved.forEach(function(e) { if (myDeck.hasOwnProperty(e.id)) myDeck[e.id] = e.count; });
  } catch(e) {}
  renderDeckEditor();
}
function renderDeckEditor() {
  let el = document.getElementById('deckEditor');
  if (!el) return;
  let total = 0;
  Object.values(myDeck).forEach(function(v) { total += v; });
  let h = '<h3 style="position:sticky;top:0;background:#111;padding:8px 0;z-index:1;">デッキ編集 (' + total + '/60)</h3><div class="deck-cards">';
  DECK_CARDS.forEach(function(c) {
    let cnt = myDeck[c.id] || 0;
    let ptStr = c.power !== undefined ? ' 攻撃' + dv(c.power) + ' HP' + dv(c.toughness) : '';
    h += '<div class="deck-card' + (cnt > 0 ? ' in-deck' : '') + '">';
    h += '<b>' + c.name + '</b> コスト:' + c.cost + ptStr;
    h += '<br><span style="color:#aaa;font-size:10px;">' + c.text + '</span>';
    h += '<br><button onclick="deckChange(\'' + c.id + '\',1)">+</button> ' + cnt + '/' + c.max + ' <button onclick="deckChange(\'' + c.id + '\',-1)">-</button>';
    h += '</div>';
  });
  h += '</div>';
  h += '<button onclick="submitDeck()">デッキを保存</button>';
  el.innerHTML = h;
}
function deckChange(id, delta) {
  let el = document.getElementById('deckEditor');
  let scrollPos = el ? el.scrollTop : 0;
  let c = DECK_CARDS.find(function(x) { return x.id === id; });
  if (!c) return;
  let cur = myDeck[id] || 0;
  let next = cur + delta;
  if (next < 0) next = 0;
  if (next > c.max) next = c.max;
  myDeck[id] = next;
  renderDeckEditor();
  if (el) el.scrollTop = scrollPos;
}
function submitDeck() {
  let total = 0;
  Object.values(myDeck).forEach(function(v) { total += v; });
  if (total < 60) { alert('最低60枚必要です（現在' + total + '枚）'); return; }
  if (total > 60) { alert('最大60枚です（現在' + total + '枚）'); return; }
  let deckDef = [];
  Object.keys(myDeck).forEach(function(id) {
    if (myDeck[id] > 0) deckDef.push({ id: id, count: myDeck[id] });
  });
  localStorage.setItem('salvado_deck', JSON.stringify(deckDef));
  alert('デッキを保存しました（' + total + '枚）');
}

// ==== CARD_DETAILS (カードポップアップ用テキスト) ====
var CARD_DETAILS = {
  maoria: { name: 'のちの魔王 マオリア', desc: 'コスト7 攻撃' + dv(5) + ' HP' + dv(5) + '\n3マナ+タップ: 攻撃力+' + dv(3) + '点ダメージ' },
  tomo: { name: '勇者 トモ', desc: 'コスト8 攻撃' + dv(8) + ' HP' + dv(8) + '\n油断しない, 俊足' },
  izuna: { name: '魔法使い イズナ', desc: 'コスト3 攻撃' + dv(3) + ' HP' + dv(1) + '\n飛行 / 2マナ: ' + dv(2) + '点ダメージ' },
  miiko: { name: '僧侶 ミーコ', desc: 'コスト3 攻撃' + dv(0) + ' HP' + dv(3) + '\n味方破壊時2マナ蘇生' },
  parasite: { name: '魔の寄生体', desc: 'コスト4 エンチャント\n攻撃+' + dv(2) + ' HP+' + dv(2) + ', 1マナ蘇生, 魔物生成, ライフロス' },
  salvado_cat: { name: 'サルベド猫', desc: 'コスト5\nクリエイター3枚サーチ→2枚捨て' },
  makkinii: { name: 'まっきーに', desc: 'コスト5\nクリエイター2枚捨てで無料 / 全体攻撃+' + dv(3) + ' HP+' + dv(3) },
  sakamachi: { name: '坂街透', desc: 'コスト3\nイラストレーター3枚→1枚手札, 2枚墓地' },
  kaera: { name: 'パン屋の娘 カエラ', desc: 'コスト1 攻撃' + dv(1) + ' HP' + dv(1) + '\n登場時: LP' + dv(2) + '回復' },
  jk_a: { name: '一般女子高生A', desc: 'コスト2 攻撃' + dv(1) + ' HP' + dv(1) + '\n3マナ: 攻撃' + dv(1) + ' HP' + dv(1) + 'トークン生成' },
  iron_boss: { name: 'Aレイスのボス', desc: 'コスト4 攻撃' + dv(2) + ' HP' + dv(3) + '\n悪全体攻撃+' + dv(1) + ' HP+' + dv(1) },
  iron_chaser: { name: 'Aレイスの追手', desc: 'コスト2 攻撃' + dv(1) + ' HP' + dv(2) + '\n攻撃時他の悪で攻撃+' + dv(1) },
  asaki: { name: '元掃除屋 アサキ', desc: 'コスト5 攻撃' + dv(4) + ' HP' + dv(4) + '\n2+T: 相手トップ確認→シャッフル可' },
  azusa: { name: '掃除屋 アズサ', desc: 'コスト5 攻撃' + dv(4) + ' HP' + dv(3) + '\n4+T: 相手トップ墓地送り' },
  hikaru: { name: 'ひかる', desc: 'コスト2\n2枚ドロー→全タップ' },
  oyuchi: { name: 'おゆち', desc: 'コスト1\n1枚ドロー(イラストレーターなら+1)' },
  nari: { name: 'NARI', desc: 'コスト2\nデッキ上5枚から1枚手札に' },
  ai_tsubame: { name: '愛つばめ', desc: 'コスト3\n3枚ドロー→相手が1枚選んで捨て' },
  ichiko: { name: 'いちこ', desc: 'コスト4\n4択: ' + dv(3) + '点 / LP' + dv(5) + '回復 / 攻撃+' + dv(2) + ' / 相手攻撃-' + dv(1) },
  douga_sakujo: { name: '動画削除', desc: 'コスト3\n効果1つを無効にする' },
  shueki_teishi: { name: '収益停止', desc: 'コスト4\n相手マナ全タップ' },
  channel_sakujo: { name: 'チャンネル削除', desc: 'コスト6\n全場破壊+手札全捨て+7枚引き直し' },
  shinigami: { name: '死神少女', desc: 'コスト5 攻撃' + dv(2) + ' HP' + dv(3) + '\nT+LP' + dv(3) + ':確定除去 / T+LP' + dv(2) + ':ハンデス / T+LP' + dv(5) + ':打ち消し' },
  jun: { name: 'ジュン', desc: 'コスト2 攻撃' + dv(1) + ' HP' + dv(2) + '\n登場時: 死神少女サーチ' },
  mamachari: { name: 'ママチャリ暴走族', desc: 'コスト2 攻撃' + dv(2) + ' HP' + dv(1) + '\n俊足' },
  kyamakiri: { name: 'キャマキリ', desc: 'コスト1 攻撃' + dv(1) + ' HP' + dv(1) + '\n攻撃時攻撃+' + dv(2) },
  milia: { name: '勇者の血族 ミリア', desc: 'コスト4 攻撃' + dv(3) + ' HP' + dv(3) + '\n他の味方攻撃+' + dv(1) + ' HP+' + dv(1) },
  daria: { name: '勇者の兄 ダリア', desc: 'コスト3 攻撃' + dv(0) + ' HP' + dv(5) + '\n攻撃不可 / ブロック時ダメージ無効' },
  douga_henshuu: { name: '動画編集', desc: 'コスト2\n対象攻撃-' + dv(3) + ' HP-' + dv(3) + '(ターン終了まで)' },
  super_chat: { name: 'スーパーチャット', desc: 'コスト1\n味方攻撃+' + dv(3) + ' HP+' + dv(3) + '(ターン終了まで)' },
  kikaku_botsu: { name: '企画ボツ', desc: 'コスト4\nクリーチャー1体破壊' },
  seitokaichou: { name: '生徒会長ヒロイン', desc: 'コスト2 攻撃' + dv(1) + ' HP' + dv(1) + '\n油断しない / 登場時: 1枚ドロー' },
  osananajimi: { name: '幼馴染ヒロイン', desc: 'コスト2 攻撃' + dv(1) + ' HP' + dv(1) + '\n登場時: 主人公サーチ' },
  onna_joushi: { name: '女上司ヒロイン', desc: 'コスト2 攻撃' + dv(1) + ' HP' + dv(1) + '\n油断しない / 登場時: デッキトップ確認→シャッフル可' },
  shiko_touchou: { name: '思考盗聴された！', desc: 'コスト2\n相手の手札を見る' },
  seishun_kiben: { name: '青春詭弁', desc: 'コスト5\n手札の主人公/ヒロインを無料召喚' },
  kanwa_kyuudai: { name: '閑話休題', desc: 'コスト5\n割り込み / 全クリーチャータップ' },
  salvado_cat_yarakashi: { name: 'サルベド猫のやらかし', desc: 'コスト6\n打ち消し不可 / 確定除去(蘇生不可)' },
  ark: { name: '魔王の血族 アーク', desc: 'コスト8 攻撃' + dv(5) + ' HP' + dv(5) + '\n相手全体攻撃-' + dv(1) + ' HP-' + dv(1) },
};
