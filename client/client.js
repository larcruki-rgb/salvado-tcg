// サルベドTCG オンラインクライアント
const socket = io();
let myState = null;
let mySeat = -1;

function dv(n) { return n; }

// ==== カードボイス ====
var CARD_VOICES = { jun: 'img/jun_voice.wav', shinigami: 'img/shinigami_voice.wav', maoria: 'img/maoria_voice.wav', izuna: 'img/izuna_voice.wav', miiko: 'img/miiko_voice.wav', tomo: 'img/tomo_voice.wav', daria: 'img/daria_voice.wav', milia: 'img/milia_voice.wav', ark: 'img/ark_voice.wav', osananajimi: 'img/osananajimi_voice.wav', reichen: 'img/reichen_voice.mp3', sagi: 'img/sagi_voice.mp3', yuri: 'img/yuri_voice.mp3', lucia: 'img/lucia_voice.mp3' };
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
var isTutorial = false;
var tutorialStep = 0;
function tutorialMatch() {
  isTutorial = true;
  tutorialStep = 0;
  socket.emit('tutorialMatch');
  document.getElementById('lobbyStatus').textContent = 'チュートリアルを開始します...';
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
  if (isTutorial && turn === 1 && isYourTurn) {
    document.getElementById('turnMsg').textContent = 'チュートリアル開始！ボタンを押してください';
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
  if (isTutorial) { tutorialCheck(); tutorialStateCheck(); if (tutorialStep >= 7 && state.phase === 'main2') tutorialCombatResult(); render(); }
});

// ==== ターンタイマー ====
var _turnTimerInterval = null;
var _turnTimerEnd = 0;
socket.on('turnTimer', ({ remaining, total }) => {
  if (_turnTimerInterval) { clearInterval(_turnTimerInterval); _turnTimerInterval = null; }
  let el = document.getElementById('turnTimerDisplay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'turnTimerDisplay';
    el.style.cssText = 'position:fixed;top:10px;right:10px;background:rgba(0,0,0,0.7);color:#f0e6d0;padding:8px 16px;border-radius:8px;font-size:20px;font-weight:bold;z-index:1000;border:2px solid #8a7d5a;';
    document.body.appendChild(el);
  }
  if (remaining <= 0) { el.style.display = 'none'; return; }
  el.style.display = '';
  _turnTimerEnd = Date.now() + remaining * 1000;
  function tick() {
    let left = Math.max(0, Math.ceil((_turnTimerEnd - Date.now()) / 1000));
    el.textContent = '⏱ ' + left + 's';
    el.style.color = left <= 10 ? '#ff4444' : '#f0e6d0';
    if (left <= 0) { clearInterval(_turnTimerInterval); _turnTimerInterval = null; el.style.display = 'none'; }
  }
  tick();
  _turnTimerInterval = setInterval(tick, 1000);
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
  closeModal();
  if (isTutorial) tutorialPromptCheck(type, data);
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
  hidePopup();
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
    var _enchNames = {parasite:'寄生体',ki_no_sei:'木の精',alminium:'アルミホイル'};
    enchStr = '<div style="display:flex;flex-wrap:wrap;gap:2px;margin:2px 0;">' + c.enchantments.map(function(e){
      var n = _enchNames[e.id] || e.id;
      return '<span style="background:#7030a0;color:#fff;font-size:7px;padding:1px 3px;border-radius:3px;">⬡' + n + '</span>';
    }).join('') + '</div>';
  }
  // art/artStyle support
  let artHTML = '';
  if (c.art) {

    artHTML = '<div style="position:relative;width:100%;height:60px;overflow:hidden;border-radius:4px;margin:2px 0;"><img src="' + c.art + '" style="width:100%;height:100%;object-fit:cover;' + (c.artStyle || '') + '">' + (enchStr ? '<div style="position:absolute;top:0;left:0;right:0;display:flex;flex-wrap:wrap;gap:1px;padding:1px;background:rgba(80,0,120,0.7);">' + c.enchantments.map(function(e){ var _en={parasite:'寄生体',ki_no_sei:'木の精',alminium:'アルミホイル'}; return '<span style="color:#fff;font-size:7px;padding:1px 3px;">⬡'+(_en[e.id]||e.id)+'</span>';}).join('') + '</div>' : '') + '</div>';
  }

  let h = '<div class="' + cls + '" ' + (oc || '') + ' ' + (zone !== 'mana' ? 'onmouseenter="_popupShow(event,' + regIdx + ')" onmouseleave="hidePopup()" ontouchstart="_popupTouch(event,' + regIdx + ')"' : '') + '>';
  h += '<div class="mc-name">' + (zone === 'mana' ? '視聴者' : c.name) + '</div>';
  if (zone !== 'mana') h += '<div class="mc-cost">' + c.cost + '</div>';
  if (zone !== 'mana') {
    if (artHTML) {
      h += artHTML;
    } else {
      h += '<div class="mc-type">' + c.type + '</div>';
      h += '<div class="mc-text">' + (c.text || '') + '</div>';
      h += enchStr;
    }
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
  'maoria': '<span class="cost-inline">【応援3】+ タップ：</span>対象の投稿キャラ1体にこの投稿キャラのパワー+300点のダメージを与える。<br><br><span style="color:#888; font-size:10px; font-style:italic;">「退屈なんだよ、俺はさ」</span>',
  'tomo': '<span class="keyword">油断しない</span>（攻撃してもタップしない）<br><span class="keyword">俊足</span>（出たターンから攻撃可能）<br><br><span style="color:#888; font-size:10px; font-style:italic;">「会いたかったよ、マオリア」</span>',
  'izuna': '<span class="keyword">飛行</span><br><span class="cost-inline">【応援2】：</span>対象の投稿キャラ1体に200点のダメージを与える。<br><br><span style="color:#888; font-size:10px; font-style:italic;">「これでもこの世界で最強の魔法使いと言われてるのよ！」</span>',
  'miiko': 'ミーコを除くあなたの投稿キャラが破壊されたとき、<span class="cost-inline">【応援2】</span>を支払うことでその投稿キャラを蘇生する。<br><br><span style="color:#888; font-size:10px; font-style:italic;">「もし死んでも蘇生しますから」</span>',
  'parasite': 'エンチャントされた投稿キャラの攻撃/HPを<span class="keyword">攻撃+200 HP+200</span>する。<br>エンチャントされた投稿キャラは<span class="cost-inline">【応援1】：</span><span class="keyword">蘇生</span>を持つ。<br>あなたのアップキープ開始時、攻撃100 HP100の魔物トークンを1体生成する。<br>あなたの場の魔物1体につき、ターン終了時にあなたは100点のライフを失う。<br>エンチャントされた投稿キャラが破壊されたとき、このカードをオーナーのデッキに加えシャッフルする。',
  'asaki': '<span class="cost-inline">タップ：</span>相手の手札を全て確認する。<br><br><span style="color:#888; font-size:10px; font-style:italic;">「自由意志を持たない命は、死んでるも同じだ」</span>',
  'azusa': '<span class="cost-inline">【応援2】+ タップ：</span>相手の手札からランダムに1枚捨てさせる。<br><br><span style="color:#888; font-size:10px; font-style:italic;">「掃除屋のわたしに目をつけられて、逃げられたやついないから」</span>',
  'salvado_cat': 'デッキからクリエイターカードを3枚選び、ランダムで1枚をゴミ箱に捨て、残り2枚を手札に加える。',
  'makkinii': '<span class="keyword">割り込み</span><br>手札からクリエイターカードを2枚捨てることでコストを支払わずに発動できる。<br>あなたの全ての投稿キャラはターン終了時まで<span class="keyword">攻撃+300 HP+300</span>の修正を受ける。',
  'seishun_kiben': 'あなたの手札にある主人公またはヒロインカードを1枚、コストを支払わずにプレイしてもよい。',
  'sakamachi': 'デッキからイラストレーターのカードを3枚選択し、その内1枚を手札に加え、残り2枚をゴミ箱に捨てる。',
  'kaera': '場に出た時、あなたのライフを200点回復する。<br><br><span class="card-flavor">「ありがとう、アサキ」</span>',
  'jk_a': '<span class="cost-inline">【応援3】：</span>攻撃100 HP100の女子高生トークンを1体生成する。<br><br><span class="card-flavor">「ねー、あの子も呼んでいいー？」</span>',
  'iron_boss': 'あなたの「悪」を持つ投稿キャラは全て<span class="keyword">攻撃+100 HP+100</span>の修正を受ける。',
  'iron_chaser': '攻撃時、他の「悪」を持つ投稿キャラがあなたの場にいる場合<span class="keyword">攻撃+100</span>の修正を受ける。',
  'hikaru': 'カードを2枚ドローする。その後、あなたの全てのカードをタップする。',
  'oyuchi': 'カードを1枚ドローする。引いたカードがイラストレーターカードだった場合、さらに1枚ドローしてもよい。',
  'nari': 'デッキの上から5枚を確認し、好きなカードを1枚手札に加えてもよい。その後デッキをシャッフルする。',
  'ai_tsubame': 'カードを3枚ドローする。ドローしたカードを相手に公開し、相手が1枚選んでゴミ箱に捨てる。<br><br><span class="card-flavor">「ハッハッハッハッ　へっへっへっへっ　ワンッ！」</span>',
  'ichiko': '<span class="keyword">割り込み</span><br>以下から1つ選んでプレイする：<br>・相手のライフに300点のダメージ<br>・自分のライフを500点回復<br>・自分の投稿キャラ全てに<span class="keyword">攻撃+200</span><br>・相手の投稿キャラ全てに<span class="keyword">攻撃-100</span>',
  'douga_sakujo': '<span class="keyword">割り込み</span><br>発動された効果1つを無効にする。<br><br><span class="card-flavor">「コミュニティガイドライン違反により削除されました」</span>',
  'shueki_teishi': '<span class="keyword">割り込み</span><br>相手の視聴者を全員応援済みにする。<br><br><span class="card-flavor">「量産型のコンテンツです」</span>',
  'channel_sakujo': '両運営者の視聴者以外の全てのカードを破壊し、手札を全て捨てる。その後、お互いにカードを7枚引き直す。<br><br><span class="card-flavor">「チャンネルが見つかりません」</span>',
  'shinigami': '<span class="cost-inline">タップ + LP300：</span>投稿キャラ1体を破壊する。それは蘇生できない。<br><span class="cost-inline">タップ + LP200：</span>相手の手札からランダムに1枚捨てさせる。<br><span class="cost-inline">タップ + LP500：</span>スタック上の効果1つを打ち消す。<br><br><span class="card-flavor">「寿命と引き換えに、願いを叶えてあげます」</span>',
  'jun': '場に出た時、デッキから「死神少女」を1枚サーチして手札に加える。<br><br><span class="card-flavor">「不審者がいる・・・」</span>',
  'mamachari': '<span class="keyword">俊足</span>（出たターンから攻撃可能）<br><br><span class="card-flavor">「ちゃりんちゃりん！！」</span>',
  'kyamakiri': '攻撃時、ターン終了時まで<span class="keyword">攻撃+200</span>の修正を受ける。<br><br><span class="card-flavor">「キャマキリィィィ！」</span>',
  'douga_henshuu': '投稿キャラ1体を選択し、ターン終了時まで<span class="keyword">攻撃-300 HP-300</span>の修正を受ける。<br><br><span class="card-flavor">「カットだらけで原型がない」</span>',
  'super_chat': '<span class="keyword">割り込み</span><br>投稿キャラ1体を選択し、ターン終了時まで<span class="keyword">攻撃+300 HP+300</span>の修正を受ける。<br><br><span class="card-flavor">「赤スパきたーー！」</span>',
  'kikaku_botsu': 'フィールドの投稿キャラ1体を破壊する。<br><br><span class="card-flavor">「この企画、なしで」</span>',
  'milia': 'あなたのミリアを除く全ての投稿キャラは<span class="keyword">攻撃+100 HP+100</span>の修正を受ける。<br><br><span class="card-flavor">「死ぬまで戦い続けるんだからな？」</span>',
  'ark': '相手の全ての投稿キャラは<span class="keyword">攻撃-100 HP-100</span>の修正を受ける。<br><br><span class="card-flavor">「どうして俺に剣を向けるんだ・・・？」</span>',
  'daria': '攻撃できない。<br>ブロック時、この投稿キャラは戦闘ダメージを受けない。<br><br><span class="card-flavor">「……寄るなよ」</span>',
  'shiko_touchou': '相手の手札を全て確認する。<br><br><span class="card-flavor">「頭にアルミホイル巻かなきゃ！」</span>',
  'kanwa_kyuudai': '<span class="keyword">割り込み</span><br>全ての投稿キャラをタップする。<br><br><span class="card-flavor">「――閑話休題」</span>',
  'seitokaichou': '<span class="keyword">油断しない</span>（攻撃してもタップしない）<br>場に出た時、カードを1枚ドローする。<br><br><span class="card-flavor">「規律は守ってもらいます」</span>',
  'kanaria': '【応援3】+T: デッキの一番上のカードを1枚、あなたの視聴者に加える。<br><br><span class="card-flavor">「アイドル辞めて烏丸さんと結婚しますっ！」</span>',
  'osananajimi': '場に出た時、デッキから主人公カードを1枚サーチして手札に加える。<br><br><span class="card-flavor">「昔から、ずっと一緒だったでしょ」</span>',
  'onna_joushi': '<span class="keyword">油断しない</span>（攻撃してもタップしない）<br>場に出た時、自分のデッキの一番上を確認する。その後、デッキをシャッフルしてもよい。<br><br><span class="card-flavor">「仕事の後、少し付き合いなさい」</span>',
  'salvado_cat_yarakashi': 'このカードは打ち消されない。<br>投稿キャラ1体を破壊する。それは蘇生できない。<br><br><span class="card-flavor">「あれ？消えちゃったにゃ」</span>',
  '99wari': 'LP900を支払う。<br>相手の全ての投稿キャラを破壊し、相手の手札を全て捨てさせる。<br><br><span class="card-flavor">「9割の間違いじゃなくて…？」</span>',
  'katorina': '攻撃200 HP200のVトークンを2体投稿する。<br><br><span class="card-flavor">「おつりーな、ごきげんよう！ばいばーい！」</span>',
  'akapo': '<span class="keyword">割り込み</span><br>味方の投稿キャラ1体を選択し、ターン終了時まで<span class="keyword">攻撃+500</span>の修正を受ける。',
  'komi': '自分の全ての投稿キャラの蓄積ダメージを0にする。自分のLPを<span class="keyword">300回復</span>する。<br><br><span class="card-flavor">「肉まん食べたい」</span>',
  'ki_no_sei': 'エンチャントされた投稿キャラはブロック時、戦闘ダメージを受けない。<br><br><span class="card-flavor">「気のせい　木の精　ウッドエレメンタル」</span>',
  'alminium': 'エンチャントされた投稿キャラは効果の対象にならない。<br>（全体効果・戦闘ダメージは通常通り受ける）<br><br><span class="card-flavor">「これで電波は遮断できる……！」</span>',
  'mensetsu_kan': '場に出た時、相手の場の<span class="keyword">主人公</span>カードを1体選んで破壊する。<br><br><span class="card-flavor">「私をフった理由を答えなさい」</span>',
  'reichen': '<span class="cost-inline">【応援1】：</span>味方の投稿キャラ1体の蓄積ダメージを0にする。<br><span class="cost-inline">【応援4】+T：</span>相手の投稿キャラ1体に<span class="keyword">500ダメージ</span>を与える。',
  'sagi': '<span class="keyword">俊足</span>（出たターンから攻撃可能）<br><span class="keyword">油断しない</span>（攻撃してもタップしない）<br><span class="cost-inline">【応援3】+T：</span>スタック上の効果1つを打ち消す。<br><span class="cost-inline">【応援4】：</span>ゴミ箱からカード1枚を手札に加える。',
  'nanase': '手札が4枚になるようにカードをドローする。',
  'dansou': '<span class="cost-inline">【応援3】：</span>このカードの攻撃をターン終了時まで<span class="keyword">+200</span>にする。<br><br><span class="card-flavor">「まぁ僕は女だけどね？」</span>',
  'gomo': 'デッキから<span class="keyword">ヒロイン</span>カードを2枚選び、手札に加える。',
  'yashiro': 'LP500を支払い、カードを3枚ドローする。',
  'yuri': 'このカードの攻撃とHPは、このカードにつけられたエンチャントの数だけ<span class="keyword">+100</span>される。<br><br><span class="card-flavor">「ほら見てください。手首の関節を回転させられるんです」</span>',
  'smasher': 'エンチャントされた投稿キャラは<span class="keyword">俊足</span>を持ち、攻撃とHPが<span class="keyword">+100</span>される。<br>エンチャントされたカードが<span class="keyword">アンドロイド ユリ</span>の場合、代わりに<span class="keyword">俊足</span>と<span class="keyword">飛行</span>を持ち、攻撃とHPが<span class="keyword">+200</span>される。<br><br><span class="card-flavor">「私専用に作られた戦闘用外部ユニット――識別名はスマッシャー」</span>',
  'rena': 'エンチャントされた投稿キャラは<span class="keyword">飛行</span>を持ち、<span class="cost-inline">【応援3】：</span><span class="keyword">蘇生</span>を持つ。',
  'lucia': '<span class="cost-inline">【応援5】：</span>ターン終了時まで攻撃とHPが<span class="keyword">+300</span>され、<span class="keyword">飛行</span>を得る。<br><span class="cost-inline">【応援5】+タップ：</span>自身を除くフィールド上の全ての投稿キャラに<span class="keyword">200ダメージ</span>を与える。<br><br><span class="card-flavor">「なあ、アルス。こいつ食べていい？」</span>',
  'douga_fukugen': '<span class="keyword">割り込み</span><br>ゴミ箱から投稿キャラを1体選び、コストを支払わずに投稿する。<br><br><span class="card-flavor">「復元されたコンテンツは元の評価を引き継ぎません」</span>',
  'impression_seigen': '<span class="keyword">割り込み</span><br>お互いの場にいる全ての投稿キャラはターン終了時まで<span class="keyword">攻撃-500 HP-500</span>の修正を受ける。<br><br><span class="card-flavor">「そういえばしばらくおすすめ欄で見てないな…」</span>'
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

  // enchantments
  if (c.enchantments && c.enchantments.length > 0) {
    h += '<div class="card-enchant-info"><div class="enchant-label">装備中:</div>';
    c.enchantments.forEach(function(e) {
      var db = DECK_CARDS.find(function(d) { return d.id === e.id; });
      var eName = db ? db.name : e.id;
      var eText = db ? db.text : '';
      h += '<div class="enchant-item">・' + eName + (eText ? ' <span class="enchant-desc">(' + eText + ')</span>' : '') + '</div>';
    });
    h += '</div>';
  }

  h += '</div>';
  return h;
}

function showPopup(e, c) {
  let popup = document.getElementById('cardPopup');
  popup.innerHTML = buildPopupHTML(c);
  popup.classList.add('active');
  let x = e.clientX + 15;
  if (x + 290 > window.innerWidth) x = e.clientX - 295;
  if (x < 5) x = 5;
  popup.style.left = x + 'px';
  popup.style.top = '10px';
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
  let oppMH = '<span class="label">相手の視聴者(' + s.opp.mana.filter(m => !m.manaTapped).length + '/' + s.opp.mana.length + ')</span>';
  s.opp.mana.forEach((c, i) => { oppMH += renderCard(c, 'mana', i, true); });
  document.getElementById('oppMana').innerHTML = oppMH;

  // 相手フィールド
  let oppH = '';
  s.opp.field.forEach((c, i) => { oppH += renderCard(c, 'field', i, true); });
  document.getElementById('oppField').innerHTML = oppH;

  // 自分フィールド
  let myFH = '';
  s.me.field.forEach((c, i) => {
    let selected = s.phase === 'attack' && s.isMyTurn && s.attackers.includes(i);
    let card = renderCard(c, 'field', i, false);
    if (selected) card = card.replace('class="mini-card', 'class="mini-card selected');
    myFH += card;
  });
  document.getElementById('myField').innerHTML = myFH;

  // マナ
  let manaH = '<span class="label">視聴者(' + s.me.mana.filter(m => !m.manaTapped).length + '/' + s.me.mana.length + ')</span>';
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
      if (isTutorial) {
        if (tutorialStep === 1 && !s.manaPlaced) {
          ctrl += '<button onclick="showManaSelect()">フォロー</button>';
        } else if (tutorialStep === 2) {
          ctrl += '<button onclick="showPlaySelect()">プレイ</button>';
        } else if (tutorialStep === 3) {
          ctrl += '<button onclick="doEndTurn()">ターン終了</button>';
        } else if (tutorialStep === 6 && !s.manaPlaced) {
          ctrl += '<button onclick="showManaSelect()">フォロー</button>';
        } else if (tutorialStep === 6 && s.manaPlaced) {
          ctrl += '<button onclick="showPlaySelect()">プレイ</button>';
        } else if (tutorialStep === 7) {
          if (s.phase === 'main') ctrl += '<button class="primary" onclick="doStartCombat()">戦闘</button>';
        }
      } else {
        ctrl += '<button onclick="showManaSelect()">フォロー</button>';
        ctrl += '<button onclick="showPlaySelect()">プレイ</button>';
        ctrl += '<button onclick="showAbilitySelect()">能力起動</button>';
        if (s.phase === 'main') ctrl += '<button class="primary" onclick="doStartCombat()">戦闘</button>';
        ctrl += '<button onclick="doEndTurn()">ターン終了</button>';
      }
    }
    if (s.phase === 'attack' && s.chainDepth === 0 && !s.hasPendingPrompt) {
      ctrl += '<button class="primary" onclick="doConfirmAttack()">攻撃確定</button>';
      if (!(isTutorial && tutorialStep >= 7)) ctrl += '<button onclick="doCancelAttack()">キャンセル</button>';
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
  if (!myState || myState.manaPlaced) { showModal('<h3>フォロー済みです</h3><button onclick="closeModal()">OK</button>'); return; }
  let h = '<h3>フォロー</h3><div class="modal-cards">';
  const tutorialKeep = ['kyamakiri', 'douga_sakujo', 'imouto'];
  myState.me.hand.forEach((c, i) => {
    let blocked = isTutorial && tutorialKeep.includes(c.id);
    let s = blocked ? 'border-color:#333;opacity:0.4;' : '';
    h += '<div class="modal-card" style="' + s + '" ' + (blocked ? '' : 'onclick="closeModal();doPlaceMana(' + i + ')"') + '><b>' + c.name + '</b><br>コスト:' + c.cost + '</div>';
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
    if (isTutorial && tutorialStep === 2 && c.id !== 'kyamakiri') ok = false;
    if (isTutorial && tutorialStep === 6 && c.id !== 'imouto') ok = false;
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
      if (c.abilities.includes('create_token_jk') && mana >= 3) abilities.push({ id: 'create_token_jk', label: 'トークン(【応援3】)' });
      if (c.abilities.includes('activated_reichen_heal') && mana >= 1) abilities.push({ id: 'activated_reichen_heal', label: '回復(【応援1】)' });
      if (c.abilities.includes('activated_sagi_recover') && mana >= 4) abilities.push({ id: 'activated_sagi_recover', label: '墓地回収(【応援4】)' });
      if (c.abilities.includes('activated_dansou_buff') && mana >= 3) abilities.push({ id: 'activated_dansou_buff', label: '攻撃+200(【応援3】)' });
      if (c.abilities.includes('activated_lucia_dragon') && mana >= 5) abilities.push({ id: 'activated_lucia_dragon', label: '竜化(【応援5】)' });
      if (!c.tapped) {
        if (c.abilities.includes('activated_lucia_breath') && mana >= 5) abilities.push({ id: 'activated_lucia_breath', label: '全体200(【応援5】+T)' });
        if (c.abilities.includes('activated_izuna') && mana >= 2) abilities.push({ id: 'activated_izuna', label: 'ダメージ(【応援2】+T)' });
        if (c.abilities.includes('activated_reichen_dmg') && mana >= 4) abilities.push({ id: 'activated_reichen_dmg', label: '500ダメージ(【応援4】+T)' });
        if (c.abilities.includes('activated_shinigami')) {
          if (myState.me.life >= 3) abilities.push({ id: 'shinigami_destroy', label: '確定除去(T+LP' + 300 + ')' });
          if (myState.me.life >= 2) abilities.push({ id: 'shinigami_discard', label: 'ハンデス(T+LP' + 200 + ')' });
        }
        if (c.abilities.includes('activated_maoria') && mana >= 3) abilities.push({ id: 'activated_maoria', label: '火力(【応援3】+T)' });
        if (c.abilities.includes('activated_asaki')) abilities.push({ id: 'activated_asaki', label: '手札を見る(T)' });
        if (c.abilities.includes('activated_azusa') && mana >= 2) abilities.push({ id: 'activated_azusa', label: 'ハンデス(2+T)' });
        if (c.abilities.includes('activated_kanaria_mana') && mana >= 3) abilities.push({ id: 'activated_kanaria_mana', label: '視聴者追加(【応援3】+T)' });
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
function doConfirmAttack() {
  if (isTutorial && tutorialStep >= 7 && myState && myState.attackers && myState.attackers.length < 2) {
    showGuide('⚠️ <b>2体とも選択してください！</b><br>キャマキリと妹系ヒロインの両方をタップして攻撃しましょう。');
    return;
  }
  socket.emit('action', { type: 'confirmAttack' });
}
function doCancelAttack() { socket.emit('action', { type: 'cancelAttack' }); }
function doEndTurn() { socket.emit('action', { type: 'endTurn' }); }

// ==== プロンプト処理 ====
function handlePrompt(type, data) {
  switch (type) {
    case 'chain':
    case 'chain_attack': {
      let h = '<h3>割り込みますか？</h3>';
      h += '<div style="margin:8px 0;padding:10px;background:#2a1a1a;border:1px solid #8a3030;border-radius:6px;color:#f0e6d0;font-size:13px;">' + (data.lastAction || '') + '</div>';
      if (data.blockInfo && data.blockInfo.length > 0) {
        h += '<div style="margin:8px 0;padding:8px;background:#1a1a2e;border:1px solid #5a5a8a;border-radius:6px;">';
        h += '<p style="color:#aaa;margin-bottom:4px;font-size:10px;">ブロック状況:</p>';
        data.blockInfo.forEach(b => {
          h += '<div style="padding:3px 8px;margin:2px 0;font-size:12px;color:#f0e6d0;">' + b.attacker + ' ← <span style="color:' + (b.blocked ? '#5a8a5a' : '#8a5a5a') + ';">' + (b.blocker || 'ブロックなし') + '</span></div>';
        });
        h += '</div>';
      }
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
      if (!(isTutorial && tutorialStep === 4)) h += '<button onclick="respondChain(\'pass\')">パス</button>';
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
      h += '<div class="modal-card" style="min-width:120px;" onclick="respondPrompt({choice:\'mana\'})"><b>【応援5】で支払う</b><br>残り:' + data.remainingMana + '</div>';
      h += '<div class="modal-card" style="min-width:120px;" onclick="respondPrompt({choice:\'alt\'})"><b>クリエイター2枚捨て</b><br>無料発動</div>';
      h += '</div><button onclick="respondPrompt({choice:\'cancel\'})">キャンセル</button>';
      showModal(h);
      break;
    }

    case 'ichiko_choice': {
      let h = '<h3>いちこ: 効果を選択</h3><div class="modal-cards">';
      h += '<div class="modal-card" onclick="respondPrompt({mode:1})"><b>' + 300 + '点ダメージ</b></div>';
      h += '<div class="modal-card" onclick="respondPrompt({mode:2})"><b>LP' + 500 + '回復</b></div>';
      h += '<div class="modal-card" onclick="respondPrompt({mode:3})"><b>味方攻撃+' + 200 + '</b></div>';
      h += '<div class="modal-card" onclick="respondPrompt({mode:4})"><b>相手攻撃-' + 100 + '</b></div>';
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
      h += '<p>【応援' + data.cost + '】で蘇生しますか？ (残り:' + data.manaLeft + ')</p>';
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
      let h = '<h3>青春詭弁: 無料投稿</h3><div class="modal-cards">';
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
      let h = '<h3>青春詭弁: 無料投稿する対象を選択</h3><div class="modal-cards">';
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

    case 'akapo_target': {
      let h = '<h3>あかぽ: 攻撃+500する対象を選択</h3><div class="modal-cards">';
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
      let h = '<h3>坂街透: ゴミ箱に捨てる1枚を選択</h3><div class="modal-cards">';
      data.cards.forEach((c, i) => {
        h += '<div class="modal-card" onclick="respondPrompt({idx:' + i + '})"><b>' + c.name + '</b><br>コスト:' + c.cost + '</div>';
      });
      h += '</div><button onclick="respondPrompt({idx:-1})">選ばない</button>';
      showModal(h);
      break;
    }

    case 'salvado_cat_pick': {
      let need = data.needSelect || 3;
      let h = '<h3>サルベド猫: ' + need + '枚選択 → 2枚手札・1枚ゴミ箱</h3><div class="modal-cards">';
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
    case 'gomo_pick': {
      let h = '<h3>ごも: 手札に加えるヒロイン2枚を選択</h3><div class="modal-cards">';
      data.cards.forEach((c, i) => {
        h += '<div class="modal-card" id="gp_' + i + '" onclick="toggleGomoPick(' + i + ')"><b>' + c.name + '</b><br>コスト:' + c.cost + '</div>';
      });
      h += '</div><div id="gpCount" style="text-align:center;margin:8px 0;">選択: 0/2</div>';
      h += '<button id="gpConfirm" onclick="confirmGomoPick()" disabled>確定</button>';
      showModal(h);
      window._gomoPicked = [];
      break;
    }
    case 'mensetsu_target': {
      let h = '<h3>面接官ヒロイン: 破壊する主人公を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" style="border-color:#cc3030;" onclick="respondPrompt({targetIdx:' + t.idx + ',pi:' + t.pi + '})"><b>' + t.name + '</b></div>';
      });
      h += '</div>';
      showModal(h);
      break;
    }

    case 'reichen_heal_target': {
      let h = '<h3>レイチェン: 回復する味方を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" onclick="respondPrompt({targetIdx:' + t.idx + '})"><b>' + t.name + '</b></div>';
      });
      h += '</div>';
      showModal(h);
      break;
    }

    case 'reichen_dmg_target': {
      let h = '<h3>レイチェン: 500ダメージを与える相手を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" style="border-color:#cc3030;" onclick="respondPrompt({targetIdx:' + t.idx + '})"><b>' + t.name + '</b></div>';
      });
      h += '</div>';
      showModal(h);
      break;
    }

    case 'sagi_recover_pick': {
      let h = '<h3>サギ: ゴミ箱から手札に戻すカードを選択</h3><div class="modal-cards">';
      data.cards.forEach((c, i) => {
        h += '<div class="modal-card" onclick="respondPrompt({idx:' + i + '})"><b>' + c.name + '</b><br>コスト:' + c.cost + '</div>';
      });
      h += '</div><button onclick="respondPrompt({idx:-1})">選ばない</button>';
      showModal(h);
      break;
    }

    case 'douga_fukugen_pick': {
      let h = '<h3>動画復元: ゴミ箱から投稿する投稿キャラを選択</h3><div class="modal-cards">';
      data.cards.forEach(function(c, i) {
        h += '<div class="modal-card" onclick="respondPrompt({idx:' + c.idx + '})"><b>' + c.name + '</b><br>コスト:' + c.cost + '</div>';
      });
      h += '</div><button onclick="respondPrompt({idx:-1})">選ばない</button>';
      showModal(h);
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

function toggleGomoPick(idx) {
  let sel = window._gomoPicked;
  let pos = sel.indexOf(idx);
  if (pos >= 0) { sel.splice(pos, 1); document.getElementById('gp_' + idx).style.borderColor = '#8a7d5a'; }
  else if (sel.length < 2) { sel.push(idx); document.getElementById('gp_' + idx).style.borderColor = '#e8c060'; }
  document.getElementById('gpCount').textContent = '選択: ' + sel.length + '/2';
  document.getElementById('gpConfirm').disabled = sel.length !== 2;
}
function confirmGomoPick() {
  closeModal();
  socket.emit('action', { type: 'promptResponse', data: { selected: window._gomoPicked } });
}

// ==== デッキエディタ ====
var DECK_CARDS = [
  // --- サルベドラブコメ ---
  {id:'seitokaichou',name:'生徒会長ヒロイン',cost:2,power:100,toughness:100,text:'油断しない/登場時:1枚ドロー',max:4},
  {id:'kanaria',name:'アイドル カナリア',cost:3,power:100,toughness:100,text:'【応援3】+T:デッキトップを視聴者に追加',max:2},
  {id:'osananajimi',name:'幼馴染ヒロイン',cost:2,power:100,toughness:100,text:'登場時:主人公サーチ',max:4},
  {id:'onna_joushi',name:'女上司ヒロイン',cost:2,power:100,toughness:100,text:'油断しない/登場時:デッキトップ確認→シャッフル可',max:4},
  {id:'imouto',name:'妹系ヒロイン',cost:1,power:100,toughness:100,text:'俊足',max:4},
  {id:'mensetsu_kan',name:'面接官ヒロイン',cost:3,power:100,toughness:200,text:'登場時:相手の主人公1体破壊',max:4},
  {id:'dansou',name:'男装系ヒロイン',cost:3,power:100,toughness:300,text:'【応援3】:攻撃+200',max:4},
  {id:'ki_no_sei',name:'木の精',cost:2,text:'ブロック時ダメージ無効',max:4},
  {id:'alminium',name:'頭にアルミホイルを巻く',cost:4,text:'効果の対象にならない',max:2},
  {id:'jk_a',name:'一般女子高生A',cost:2,power:100,toughness:100,text:'【応援3】:攻撃' + 100 + ' HP' + 100 + 'トークン生成',max:4},
  {id:'mamachari',name:'ママチャリ暴走族',cost:2,power:200,toughness:100,text:'俊足',max:4},
  {id:'kyamakiri',name:'キャマキリ',cost:1,power:100,toughness:100,text:'攻撃時攻撃+' + 200 + '/HP+0',max:4},
  {id:'shiko_touchou',name:'思考盗聴された！',cost:2,text:'相手の手札を見る',max:4},
  {id:'kanwa_kyuudai',name:'閑話休題',cost:5,text:'割り込み/全投稿キャラタップ',max:4},
  {id:'99wari',name:'99割間違いない',cost:9,text:'LP900支払い/相手全破壊+全ハンデス',max:1},
  // --- サルベドファンタジー：マオリア ---
  {id:'maoria',name:'のちの魔王 マオリア',cost:7,power:500,toughness:500,text:'3+T:攻撃力+' + 300 + '点ダメージ',max:2},
  {id:'tomo',name:'勇者 トモ',cost:8,power:800,toughness:800,text:'油断しない,俊足',max:2},
  {id:'izuna',name:'魔法使い イズナ',cost:3,power:300,toughness:100,text:'飛行/【応援2】+T:' + 200 + '点ダメージ',max:4},
  {id:'miiko',name:'僧侶 ミーコ',cost:3,power:0,toughness:300,text:'味方破壊時【応援2】蘇生',max:4},
  {id:'parasite',name:'魔の寄生体',cost:4,text:'攻撃+' + 200 + '/HP+' + 200 + ',【応援1】蘇生,魔物生成,ライフロス',max:4},
  // --- サルベドファンタジー：掃除屋 ---
  {id:'asaki',name:'元掃除屋 アサキ',cost:5,power:400,toughness:400,text:'T:相手の手札を見る',max:2},
  {id:'azusa',name:'掃除屋 アズサ',cost:5,power:400,toughness:300,text:'2+T:相手の手札からランダム1枚捨て',max:2},
  {id:'kaera',name:'パン屋の娘 カエラ',cost:1,power:100,toughness:100,text:'登場時:LP' + 200 + '回復',max:4},
  {id:'iron_chaser',name:'Aレイスの追手',cost:2,power:100,toughness:200,text:'攻撃時他の悪で攻撃+' + 100 + '/HP+0',max:4},
  {id:'iron_boss',name:'Aレイスのボス',cost:4,power:200,toughness:300,text:'悪全体攻撃+' + 100 + '/HP+' + 100,max:4},
  // --- サルベドファンタジー：死神少女 ---
  {id:'shinigami',name:'死神少女',cost:5,power:200,toughness:300,text:'T+LP' + 300 + ':確定除去/T+LP' + 200 + ':ハンデス/T+LP' + 500 + ':打ち消し',max:2},
  {id:'jun',name:'ジュン',cost:2,power:100,toughness:200,text:'登場時:死神少女サーチ',max:2},
  // --- サルベドファンタジー：アーク ---
  {id:'ark',name:'魔王の血族 アーク',cost:8,power:500,toughness:500,text:'相手全体攻撃-' + 100 + '/HP-' + 100,max:2},
  {id:'milia',name:'勇者の血族 ミリア',cost:4,power:300,toughness:300,text:'他の味方攻撃+' + 100 + '/HP+' + 100,max:2},
  {id:'daria',name:'勇者の兄 ダリア',cost:3,power:0,toughness:500,text:'攻撃不可/ブロック時ダメージ無効',max:4},
  // --- サルベドファンタジー：レイチェン ---
  {id:'reichen',name:'賢者 レイチェン',cost:4,power:200,toughness:300,text:'【応援1】味方1体全回復/【応援4】相手1体に500ダメージ',max:2},
  {id:'sagi',name:'盗賊 サギ',cost:4,power:200,toughness:200,text:'俊足,油断しない/【応援3】+T:打ち消し/【応援4】墓地回収',max:2},
  // --- 漫画 アンドロイド ユリ ---
  {id:'yuri',name:'アンドロイド ユリ',cost:3,power:200,toughness:200,text:'エンチャント1つにつき+100/+100',max:2},
  {id:'smasher',name:'戦術兵器スマッシャー',cost:3,text:'+100/+100,俊足/ユリ装備時:+200/+200,俊足,飛行',max:2},
  {id:'rena',name:'地縛霊 レナ',cost:3,text:'飛行/【応援3】蘇生',max:4},
  {id:'lucia',name:'ドラゴン娘 ルシア',cost:4,power:200,toughness:200,text:'【応援5】:+300/+300飛行/【応援5】+T:全体200ダメージ',max:2},
  // --- クリエイターチーム ---
  {id:'salvado_cat',name:'サルベド猫',cost:5,text:'クリエイター3枚サーチ→1枚捨て',max:4},
  {id:'makkinii',name:'まっきーに',cost:5,text:'クリエイター2枚捨てで無料/全体攻撃+' + 300 + ' HP+' + 300,max:2},
  {id:'sakamachi',name:'坂街透',cost:3,text:'イラストレーター3枚→2枚手札,1枚ゴミ箱',max:4},
  {id:'hikaru',name:'ひかる',cost:2,text:'2枚ドロー→全タップ',max:4},
  {id:'oyuchi',name:'おゆち',cost:1,text:'1枚ドロー(イラストレーターなら+1)',max:4},
  {id:'nari',name:'NARI',cost:2,text:'デッキ上5枚から1枚手札に',max:2},
  {id:'ai_tsubame',name:'愛つばめ',cost:3,text:'3枚ドロー→相手が1枚選んで捨て',max:2},
  {id:'gomo',name:'ごも',cost:4,text:'ヒロイン2枚サーチ',max:4},
  {id:'katorina',name:'かとりーな',cost:4,text:'Vトークン2体生成',max:4},
  {id:'nanase',name:'ななせ',cost:2,text:'手札が4枚になるようにドロー',max:4},
  {id:'yashiro',name:'山岩ヤシロ',cost:4,text:'LP500支払い/3枚ドロー',max:4},
  {id:'akapo',name:'あかぽ',cost:2,text:'割り込み/味方1体+500/+0',max:4},
  {id:'komi',name:'komi',cost:1,text:'味方全回復/LP300回復',max:4},
  {id:'ichiko',name:'いちこ',cost:4,text:'4択:' + 300 + '点/' + 500 + '回復/攻撃+' + 200 + '/相手攻撃-' + 100,max:4},
  {id:'seishun_kiben',name:'青春詭弁',cost:5,text:'手札の主人公/ヒロインを無料投稿',max:4},
  {id:'salvado_cat_yarakashi',name:'サルベド猫のやらかし',cost:6,text:'打ち消し不可/確定除去(蘇生不可)',max:2},
  // --- YOUTUBE ---
  {id:'douga_sakujo',name:'動画削除',cost:3,text:'効果1つを無効にする',max:4},
  {id:'shueki_teishi',name:'収益停止',cost:4,text:'相手の視聴者全タップ',max:4},
  {id:'kikaku_botsu',name:'企画ボツ',cost:4,text:'投稿キャラ1体破壊',max:4},
  {id:'channel_sakujo',name:'チャンネル削除',cost:6,text:'全場破壊+手札全捨て+7枚引き直し',max:2},
  {id:'douga_henshuu',name:'動画編集',cost:2,text:'対象攻撃-' + 300 + '/HP-' + 300 + '(ターン終了まで)',max:4},
  {id:'super_chat',name:'スーパーチャット',cost:1,text:'味方攻撃+' + 300 + '/HP+' + 300 + '(ターン終了まで)',max:4},
  {id:'douga_fukugen',name:'動画復元',cost:5,text:'割り込み/ゴミ箱から投稿キャラ1体無料投稿',max:4},
  {id:'impression_seigen',name:'インプレッション制限',cost:8,text:'割り込み/全キャラ-500/-500(ターン終了まで)',max:2}
];

var THEME_DECKS = {
  lovecome: [
    // ラブコメ自陣フル 30枚
    {id:'seitokaichou',count:3},{id:'osananajimi',count:3},{id:'onna_joushi',count:3},{id:'imouto',count:3},
    {id:'mensetsu_kan',count:3},{id:'dansou',count:3},{id:'jk_a',count:2},{id:'mamachari',count:2},
    {id:'kyamakiri',count:2},{id:'ki_no_sei',count:2},{id:'alminium',count:2},{id:'kanwa_kyuudai',count:2},
    {id:'shiko_touchou',count:1},{id:'99wari',count:1},
    // ファンタジーから主力 10枚
    {id:'milia',count:2},{id:'reichen',count:2},{id:'izuna',count:2},
    {id:'ark',count:1},{id:'maoria',count:1},{id:'sagi',count:1},{id:'daria',count:1},
    // クリエイターからサポート 18枚
    {id:'hikaru',count:2},{id:'oyuchi',count:2},{id:'nanase',count:2},{id:'komi',count:2},
    {id:'akapo',count:2},{id:'gomo',count:2},{id:'super_chat',count:2},{id:'kikaku_botsu',count:2},
    {id:'seishun_kiben',count:1},{id:'katorina',count:1},
  ],
  fantasy: [
    // ファンタジー自陣フル 34枚
    {id:'maoria',count:2},{id:'tomo',count:2},{id:'izuna',count:2},{id:'miiko',count:2},{id:'parasite',count:1},
    {id:'asaki',count:2},{id:'azusa',count:2},{id:'kaera',count:2},{id:'iron_chaser',count:2},{id:'iron_boss',count:1},
    {id:'shinigami',count:2},{id:'jun',count:2},{id:'ark',count:2},{id:'milia',count:2},{id:'daria',count:2},
    {id:'reichen',count:2},{id:'sagi',count:2},{id:'mamachari',count:2},
    {id:'yuri',count:1},{id:'smasher',count:1},{id:'lucia',count:2},{id:'rena',count:1},
    // ラブコメから軽量 6枚
    {id:'seitokaichou',count:2},{id:'osananajimi',count:2},{id:'imouto',count:2},
    // クリエイターからサポート 15枚
    {id:'hikaru',count:2},{id:'oyuchi',count:2},{id:'nanase',count:2},{id:'komi',count:2},
    {id:'akapo',count:2},{id:'gomo',count:1},{id:'kikaku_botsu',count:2},{id:'super_chat',count:2},
  ],
  creator: [
    // クリエイター自陣 35枚
    {id:'salvado_cat',count:1},{id:'makkinii',count:1},{id:'akapo',count:2},{id:'nanase',count:2},{id:'gomo',count:2},
    {id:'komi',count:2},{id:'yashiro',count:2},{id:'katorina',count:2},{id:'sakamachi',count:1},{id:'hikaru',count:2},
    {id:'oyuchi',count:2},{id:'nari',count:1},{id:'ai_tsubame',count:1},{id:'ichiko',count:2},{id:'seishun_kiben',count:1},
    {id:'salvado_cat_yarakashi',count:1},{id:'douga_sakujo',count:2},{id:'shueki_teishi',count:1},
    {id:'kikaku_botsu',count:2},{id:'douga_henshuu',count:2},{id:'super_chat',count:2},
    {id:'impression_seigen',count:1},{id:'douga_fukugen',count:2},
    // ラブコメからクリーチャー 12枚
    {id:'seitokaichou',count:2},{id:'osananajimi',count:2},{id:'mensetsu_kan',count:2},{id:'dansou',count:2},
    {id:'jk_a',count:2},{id:'imouto',count:2},
    // ファンタジーからクリーチャー 11枚
    {id:'milia',count:1},{id:'reichen',count:1},{id:'shinigami',count:1},{id:'jun',count:1},
    {id:'maoria',count:1},{id:'izuna',count:1},{id:'tomo',count:1},{id:'ark',count:1},
    {id:'sagi',count:1},{id:'azusa',count:1},{id:'mamachari',count:1},
  ]
};
function applyThemeDeck(key) {
  var theme = THEME_DECKS[key];
  if (!theme) return;
  DECK_CARDS.forEach(function(c) { myDeck[c.id] = 0; });
  theme.forEach(function(e) { if (myDeck.hasOwnProperty(e.id)) myDeck[e.id] = e.count; });
  renderDeckEditor();
}

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
var _deckSlotNames = ['スロット1','スロット2','スロット3','スロット4','スロット5'];
function _loadSlotNames() {
  try { let n = JSON.parse(localStorage.getItem('salvado_deck_names')); if (n && n.length === 5) _deckSlotNames = n; } catch(e) {}
}
function _saveSlotNames() { localStorage.setItem('salvado_deck_names', JSON.stringify(_deckSlotNames)); }
_loadSlotNames();

function saveDeckToSlot(slot) {
  let total = 0;
  Object.values(myDeck).forEach(function(v) { total += v; });
  if (total < 60) { alert('最低60枚必要です（現在' + total + '枚）'); return; }
  if (total > 60) { alert('最大60枚です（現在' + total + '枚）'); return; }
  let name = prompt('デッキ名を入力', _deckSlotNames[slot]);
  if (name === null) return;
  _deckSlotNames[slot] = name || ('スロット' + (slot + 1));
  _saveSlotNames();
  let deckDef = [];
  Object.keys(myDeck).forEach(function(id) { if (myDeck[id] > 0) deckDef.push({ id: id, count: myDeck[id] }); });
  localStorage.setItem('salvado_deck_slot' + slot, JSON.stringify(deckDef));
  localStorage.setItem('salvado_deck', JSON.stringify(deckDef));
  alert(_deckSlotNames[slot] + ' に保存しました（' + total + '枚）');
  renderDeckEditor();
}
function loadDeckFromSlot(slot) {
  let data = localStorage.getItem('salvado_deck_slot' + slot);
  if (!data) { alert(_deckSlotNames[slot] + ' は空です'); return; }
  try {
    let saved = JSON.parse(data);
    myDeck = {};
    DECK_CARDS.forEach(function(c) { myDeck[c.id] = 0; });
    saved.forEach(function(e) { if (myDeck.hasOwnProperty(e.id)) myDeck[e.id] = e.count; });
    localStorage.setItem('salvado_deck', JSON.stringify(saved));
    renderDeckEditor();
  } catch(e) { alert('読み込みエラー'); }
}
function deleteDeckSlot(slot) {
  if (!confirm(_deckSlotNames[slot] + ' を削除しますか？')) return;
  localStorage.removeItem('salvado_deck_slot' + slot);
  _deckSlotNames[slot] = 'スロット' + (slot + 1);
  _saveSlotNames();
  renderDeckEditor();
}

function renderDeckEditor() {
  let el = document.getElementById('deckEditor');
  if (!el) return;
  let total = 0;
  Object.values(myDeck).forEach(function(v) { total += v; });
  let h = '<h3 style="position:sticky;top:0;background:#111;padding:8px 0;z-index:1;">デッキ編集 (' + total + '/60)</h3>';
  h += '<div style="margin-bottom:12px;padding:10px;border:1px solid #8a7d5a;border-radius:8px;background:rgba(90,74,42,0.15);">';
  h += '<div style="color:#f0e6d0;font-size:13px;font-weight:bold;margin-bottom:8px;">デッキスロット</div>';
  for (let i = 0; i < 5; i++) {
    let has = !!localStorage.getItem('salvado_deck_slot' + i);
    h += '<div style="display:flex;align-items:center;gap:6px;margin:4px 0;">';
    h += '<span style="color:' + (has ? '#f0e6d0' : '#666') + ';font-size:12px;min-width:100px;">' + _deckSlotNames[i] + (has ? '' : '（空）') + '</span>';
    h += '<button onclick="saveDeckToSlot(' + i + ')" style="font-size:11px;padding:2px 8px;">保存</button>';
    if (has) {
      h += '<button onclick="loadDeckFromSlot(' + i + ')" style="font-size:11px;padding:2px 8px;">読込</button>';
      h += '<button onclick="deleteDeckSlot(' + i + ')" style="font-size:11px;padding:2px 8px;color:#f44;">削除</button>';
    }
    h += '</div>';
  }
  h += '</div>';
  h += '<div class="deck-cards">';
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
  h += '<div class="deck-save-bar"><button onclick="submitDeck()">現在のデッキとして適用</button></div>';
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
  maoria: { name: 'のちの魔王 マオリア', desc: 'コスト7 攻撃' + 500 + ' HP' + 500 + '\n【応援3】+タップ: 攻撃力+' + 300 + '点ダメージ' },
  tomo: { name: '勇者 トモ', desc: 'コスト8 攻撃' + 800 + ' HP' + 800 + '\n油断しない, 俊足' },
  izuna: { name: '魔法使い イズナ', desc: 'コスト3 攻撃' + 300 + ' HP' + 100 + '\n飛行 / 【応援2】+T: ' + 200 + '点ダメージ' },
  miiko: { name: '僧侶 ミーコ', desc: 'コスト3 攻撃' + 0 + ' HP' + 300 + '\n味方破壊時【応援2】蘇生' },
  parasite: { name: '魔の寄生体', desc: 'コスト4 エンチャント\n攻撃+' + 200 + ' HP+' + 200 + ', 【応援1】蘇生, 魔物生成, ライフロス' },
  akapo: { name: 'あかぽ', desc: 'コスト2\n割り込み / 味方1体 攻撃+' + 500 + '/+0' },
  komi: { name: 'komi', desc: 'コスト1\n味方全回復 / LP300回復' },
  ki_no_sei: { name: '木の精', desc: 'コスト2 エンチャント\nブロック時ダメージ無効' },
  alminium: { name: '頭にアルミホイルを巻く', desc: 'コスト4 エンチャント\n効果の対象にならない' },
  yashiro: { name: '山岩ヤシロ', desc: 'コスト4\nLP500支払い / 3枚ドロー' },
  salvado_cat: { name: 'サルベド猫', desc: 'コスト5\nクリエイター3枚サーチ→1枚捨て' },
  makkinii: { name: 'まっきーに', desc: 'コスト5\nクリエイター2枚捨てで無料 / 全体攻撃+' + 300 + ' HP+' + 300 },
  sakamachi: { name: '坂街透', desc: 'コスト3\nイラストレーター3枚→2枚手札, 1枚ゴミ箱' },
  kaera: { name: 'パン屋の娘 カエラ', desc: 'コスト1 攻撃' + 100 + ' HP' + 100 + '\n登場時: LP' + 200 + '回復' },
  jk_a: { name: '一般女子高生A', desc: 'コスト2 攻撃' + 100 + ' HP' + 100 + '\n【応援3】: 攻撃' + 100 + ' HP' + 100 + 'トークン生成' },
  iron_boss: { name: 'Aレイスのボス', desc: 'コスト4 攻撃' + 200 + ' HP' + 300 + '\n悪全体攻撃+' + 100 + ' HP+' + 100 },
  iron_chaser: { name: 'Aレイスの追手', desc: 'コスト2 攻撃' + 100 + ' HP' + 200 + '\n攻撃時他の悪で攻撃+' + 100 },
  asaki: { name: '元掃除屋 アサキ', desc: 'コスト5 攻撃' + 400 + ' HP' + 400 + '\nT: 相手の手札を見る' },
  azusa: { name: '掃除屋 アズサ', desc: 'コスト5 攻撃' + 400 + ' HP' + 300 + '\n2+T: 相手の手札からランダムに1枚捨てさせる' },
  hikaru: { name: 'ひかる', desc: 'コスト2\n2枚ドロー→全タップ' },
  oyuchi: { name: 'おゆち', desc: 'コスト1\n1枚ドロー(イラストレーターなら+1)' },
  nari: { name: 'NARI', desc: 'コスト2\nデッキ上5枚から1枚手札に' },
  ai_tsubame: { name: '愛つばめ', desc: 'コスト3\n3枚ドロー→相手が1枚選んで捨て' },
  ichiko: { name: 'いちこ', desc: 'コスト4\n4択: ' + 300 + '点 / LP' + 500 + '回復 / 攻撃+' + 200 + ' / 相手攻撃-' + 100 },
  douga_sakujo: { name: '動画削除', desc: 'コスト3\n効果1つを無効にする' },
  shueki_teishi: { name: '収益停止', desc: 'コスト4\n相手の視聴者全タップ' },
  channel_sakujo: { name: 'チャンネル削除', desc: 'コスト6\n全場破壊+手札全捨て+7枚引き直し' },
  shinigami: { name: '死神少女', desc: 'コスト5 攻撃' + 200 + ' HP' + 300 + '\nT+LP' + 300 + ':確定除去 / T+LP' + 200 + ':ハンデス / T+LP' + 500 + ':打ち消し' },
  jun: { name: 'ジュン', desc: 'コスト2 攻撃' + 100 + ' HP' + 200 + '\n登場時: 死神少女サーチ' },
  mamachari: { name: 'ママチャリ暴走族', desc: 'コスト2 攻撃' + 200 + ' HP' + 100 + '\n俊足' },
  kyamakiri: { name: 'キャマキリ', desc: 'コスト1 攻撃' + 100 + ' HP' + 100 + '\n攻撃時攻撃+' + 200 },
  milia: { name: '勇者の血族 ミリア', desc: 'コスト4 攻撃' + 300 + ' HP' + 300 + '\n他の味方攻撃+' + 100 + ' HP+' + 100 },
  daria: { name: '勇者の兄 ダリア', desc: 'コスト3 攻撃' + 0 + ' HP' + 500 + '\n攻撃不可 / ブロック時ダメージ無効' },
  douga_henshuu: { name: '動画編集', desc: 'コスト2\n対象攻撃-' + 300 + ' HP-' + 300 + '(ターン終了まで)' },
  super_chat: { name: 'スーパーチャット', desc: 'コスト1\n味方攻撃+' + 300 + ' HP+' + 300 + '(ターン終了まで)' },
  kikaku_botsu: { name: '企画ボツ', desc: 'コスト4\n投稿キャラ1体破壊' },
  seitokaichou: { name: '生徒会長ヒロイン', desc: 'コスト2 攻撃' + 100 + ' HP' + 100 + '\n油断しない / 登場時: 1枚ドロー' },
  kanaria: { name: 'アイドル カナリア', desc: 'コスト3 攻撃' + 100 + ' HP' + 100 + '\n【応援3】+T: デッキトップを視聴者に追加' },
  osananajimi: { name: '幼馴染ヒロイン', desc: 'コスト2 攻撃' + 100 + ' HP' + 100 + '\n登場時: 主人公サーチ' },
  onna_joushi: { name: '女上司ヒロイン', desc: 'コスト2 攻撃' + 100 + ' HP' + 100 + '\n油断しない / 登場時: デッキトップ確認→シャッフル可' },
  shiko_touchou: { name: '思考盗聴された！', desc: 'コスト2\n相手の手札を見る' },
  seishun_kiben: { name: '青春詭弁', desc: 'コスト5\n手札の主人公/ヒロインを無料投稿' },
  kanwa_kyuudai: { name: '閑話休題', desc: 'コスト5\n割り込み / 全投稿キャラタップ' },
  salvado_cat_yarakashi: { name: 'サルベド猫のやらかし', desc: 'コスト6\n打ち消し不可 / 確定除去(蘇生不可)' },
  '99wari': { name: '99割間違いない', desc: 'コスト9\nLP900支払い / 相手全破壊+全ハンデス' },
  imouto: { name: '妹系ヒロイン', desc: 'コスト1 攻撃' + 100 + ' HP' + 100 + '\n俊足' },
  katorina: { name: 'かとりーな', desc: 'コスト4\nVトークン(攻撃' + 200 + ' HP' + 200 + ')を2体生成' },
  ark: { name: '魔王の血族 アーク', desc: 'コスト8 攻撃' + 500 + ' HP' + 500 + '\n相手全体攻撃-' + 100 + ' HP-' + 100 },
  mensetsu_kan: { name: '面接官ヒロイン', desc: 'コスト3 攻撃' + 100 + ' HP' + 200 + '\n登場時: 相手の主人公1体を破壊\n「私をフった理由を答えなさい」' },
  reichen: { name: '賢者 レイチェン', desc: 'コスト4 攻撃' + 200 + ' HP' + 300 + '\n【応援1】味方1体のダメージ全回復\n【応援4】+T: 相手1体に' + 500 + 'ダメージ' },
  sagi: { name: '盗賊 サギ', desc: 'コスト4 攻撃' + 200 + ' HP' + 200 + '\n俊足, 油断しない\n【応援3】+T: 打ち消し\n【応援4】ゴミ箱からカード1枚回収' },
  yuri: { name: 'アンドロイド ユリ', desc: 'コスト3 攻撃' + 200 + ' HP' + 200 + '\nエンチャント1つにつき攻撃+100/HP+100\n「ほら見てください。手首の関節を回転させられるんです」' },
  smasher: { name: '戦術兵器スマッシャー', desc: 'コスト3 エンチャント\n装備キャラに俊足と+100/+100\nユリ装備時: 俊足, 飛行, +200/+200\n「私専用に作られた戦闘用外部ユニット――識別名はスマッシャー」' },
  rena: { name: '地縛霊 レナ', desc: 'コスト3 エンチャント\n飛行/【応援3】蘇生' },
  lucia: { name: 'ドラゴン娘 ルシア', desc: 'コスト4 攻撃200 HP200\n【応援5】: ターン終了時まで+300/+300, 飛行\n【応援5】+T: 自身以外の全キャラに200ダメージ\n「なあ、アルス。こいつ食べていい？」' },
  dansou: { name: '男装系ヒロイン', desc: 'コスト3 攻撃' + 100 + ' HP' + 300 + '\n【応援3】攻撃+200\n「まぁ僕は女だけどね？」' },
  gomo: { name: 'ごも', desc: 'コスト4\nデッキからヒロイン2枚サーチ' },
  nanase: { name: 'ななせ', desc: 'コスト2\n手札が4枚になるようにドロー' },
  douga_fukugen: { name: '動画復元', desc: 'コスト5\n割り込み / ゴミ箱から投稿キャラ1体無料投稿' },
  impression_seigen: { name: 'インプレッション制限', desc: 'コスト8\n割り込み / 全キャラ攻撃-500 HP-500(ターン終了まで)' },
};

// ==== チュートリアルガイドシステム ====
function showGuide(text) {
  let el = document.getElementById('tutorialGuide');
  if (!el) return;
  el.innerHTML = text;
  el.style.display = 'block';
}
function hideGuide() {
  let el = document.getElementById('tutorialGuide');
  if (el) el.style.display = 'none';
}
function tutorialCheck() {
  if (!isTutorial || !myState) return;
  let turn = myState.turn;
  let isMyTurn = myState.isMyTurn;
  let phase = myState.phase;
  let hand = myState.me ? myState.me.hand : [];
  let field = myState.me ? myState.me.field : [];
  let mana = myState.me ? myState.me.mana : [];

  if (turn === 1 && isMyTurn && phase === 'main') {
    if (tutorialStep === 0) {
      tutorialStep = 1;
      showGuide('🎮 <b>サルベドTCGへようこそ！</b><br><br>あなたはサルベド漫画チャンネルの運営者です。<br>視聴者の【応援】を力に変えて、漫画キャラクターを投稿し、相手を倒しましょう！<br><br>まず下の「視聴者ゾーン」を見てください。最初から<b>3人の視聴者</b>がいます。<br>手札のカードを1枚視聴者にして、応援の力を増やしましょう。<br><br>👉 <b>画面下の「フォロー」ボタンを押して、「パン屋の娘 カエラ」を視聴者にしましょう</b>');
    } else if (tutorialStep === 1 && mana.length >= 4) {
      tutorialStep = 2;
      showGuide('✅ 視聴者が増えました！<br><br>視聴者は毎ターン【応援】としてカードを使うためのコストを支払ってくれます。<br>ターン開始時に全員の応援が回復します。<br><br>次は投稿キャラクターを場に出してみましょう！<br>手札の<b>「キャマキリ」（コスト1）</b>をタップして投稿してください。<br><br>👉 <b>「プレイ」ボタンを押して「キャマキリ」を選択</b>');
    } else if (tutorialStep === 2 && field.some(c => c.id === 'kyamakiri')) {
      tutorialStep = 3;
      showGuide('✅ キャマキリを投稿しました！<br><br>投稿したターンは攻撃できません（「俊足」を持つキャラは例外）。<br>キャラクターにはそれぞれ固有の能力があります。キャマキリは攻撃時に攻撃力+200されます！<br><br>また、戦闘ダメージは<b>蓄積</b>します。HPが0になると破壊されてゴミ箱行きです。<br>例えばHP300のキャラに100ダメージを与えると、残りHP200の状態で場に残ります。<br><br>今は他にやることがないので、ターンを終了しましょう。<br><br>👉 <b>「ターン終了」ボタンを押す</b>');
    }
  }
}

function tutorialPromptCheck(type, data) {
  if (!isTutorial) return;
  if (type === 'chain' && tutorialStep === 3) {
    tutorialStep = 4;
    setTimeout(() => {
      showGuide('⚠️ <b>相手が「動画編集」を発動！</b><br><br>キャマキリに-300/-300の効果です。HP100のキャマキリはこのままだとやられてしまいます！<br><br>しかし、手札に<b>「動画削除」（割り込みカード）</b>があります。<br>相手の効果を無効にして、キャマキリを守りましょう！<br><br>👉 <b>「動画削除」を選んで割り込み</b>');
    }, 500);
  }
  if (type === 'chain' && tutorialStep === 4 && myState && myState.turn === 2) {
    tutorialStep = 5;
  }
  if (type === 'block') {
    // ブロック側は相手AI
  }
}

function tutorialStateCheck() {
  if (!isTutorial || !myState) return;
  let turn = myState.turn;
  let isMyTurn = myState.isMyTurn;
  let field = myState.me ? myState.me.field : [];
  let oppField = myState.opp ? myState.opp.field : [];

  if (turn === 2 && isMyTurn && myState.phase === 'main') {
    if (tutorialStep === 4 || tutorialStep === 5) {
      tutorialStep = 6;
      showGuide('✅ 相手のターンが終わりました。<br><br>相手は<b>パン屋の娘 カエラ</b>（攻撃100/HP100）を投稿しました。<br><br>まず視聴者を1人追加し、次に手札の<b>「妹系ヒロイン」（コスト1）</b>を投稿しましょう。<br>妹系ヒロインは<b>「俊足」</b>を持っているので、出したターンからすぐに攻撃できます！<br><br>👉 <b>視聴者を追加して、妹系ヒロインを投稿</b>');
    } else if (tutorialStep === 6 && field.some(c => c.id === 'imouto')) {
      tutorialStep = 7;
      showGuide('✅ 妹系ヒロインを投稿しました！<br><br>さあ、攻撃しましょう！<b>「戦闘」ボタン</b>を押して攻撃フェイズに入り、<br>キャマキリと妹系ヒロインの両方を選択して攻撃してください。<br><br>👉 <b>「戦闘」→ 2体を選択 →「攻撃確定」</b>');
    }
  }

  if (tutorialStep === 7 && myState.phase === 'combat') {
    // 攻撃中
  }
}

function tutorialCombatResult() {
  if (!isTutorial || !myState) return;
  if (tutorialStep >= 7) {
    tutorialStep = 8;
    setTimeout(() => {
      let oppLife = myState && myState.opp ? dv(myState.opp.life) : '?';
      showGuide('⚔️ <b>戦闘結果：</b><br><br>相手はカエラでキャマキリをブロックしました。<br>キャマキリ（攻撃300）vs カエラ（HP100）→ カエラ破壊！<br>カエラ（攻撃100）vs キャマキリ（HP100）→ キャマキリも破壊！<br><br>ブロックされなかった妹系ヒロインの攻撃100は<b>相手のLPに直接ダメージ</b>！<br><br>相手のLP: 2000 → ' + oppLife + '<br><br>これを繰り返して、相手のLPを<b>0</b>にすれば<b>あなたの勝利</b>です！<br><br><button onclick="tutorialEnd()" style="padding:10px 24px;font-size:15px;background:#5a4a2a;color:#f0e6d0;border:2px solid #8a7d5a;border-radius:8px;cursor:pointer;margin:4px;">ロビーに戻る</button> <button onclick="tutorialReplay()" style="padding:10px 24px;font-size:15px;background:#2a5a2a;color:#d0f0d0;border:2px solid #5a9a5a;border-radius:8px;cursor:pointer;margin:4px;">もう一回</button>');
    }, 2500);
  }
}

function tutorialEnd() {
  isTutorial = false;
  tutorialStep = 0;
  hideGuide();
  location.reload();
}
function tutorialReplay() {
  isTutorial = false;
  tutorialStep = 0;
  hideGuide();
  sessionStorage.setItem('tutorialReplay', '1');
  location.reload();
}
