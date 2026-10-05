// サルベドTCG オンラインクライアント
// 初回起動かどうかは、プレイヤーIDが作られる前(この行)で見る。ID無し＝一度も遊んだことがない人
var _firstRun = (function() { try { return !localStorage.getItem('salvado_player_id') && !localStorage.getItem('tutorialDone'); } catch (e) { return false; } })();
(function() {
  var b = document.body;
  var isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  function updateLayout() {
    // バンドルアプリはモバイルWebと同じレイアウト(清書デザイン)を使う。
    // is-appは旧アプリ用レイアウトで清書と競合するため付けない。向きでis-mobile/is-landscapeを切替。
    if (window.Capacitor) {
      b.classList.remove('is-app');
      if (window.innerWidth > window.innerHeight) {
        b.classList.remove('is-mobile'); b.classList.add('is-desktop','is-landscape');
      } else {
        b.classList.remove('is-desktop','is-landscape'); b.classList.add('is-mobile');
      }
      return;
    }
    if (!isMobileDevice) { b.classList.remove('is-mobile'); b.classList.add('is-desktop'); return; }
    if (window.innerWidth > window.innerHeight) {
      b.classList.remove('is-mobile'); b.classList.add('is-desktop','is-landscape');
    } else {
      b.classList.remove('is-desktop','is-landscape'); b.classList.add('is-mobile');
    }
  }
  updateLayout();
  window.addEventListener('orientationchange', function() { setTimeout(updateLayout, 100); setTimeout(updateLayout, 300); setTimeout(updateLayout, 600); });
  window.addEventListener('resize', updateLayout);
})();
// バンドル型アプリ(Capacitorネイティブ)の時だけ本番サーバーへ絶対URLで接続。
// Web/localhostは window.Capacitor が無いので API_BASE='' ＝従来通りの同一オリジン。
var API_BASE = (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ? 'https://game.sarubedo.jp' : '';
// account.js がログイン中ならトークンを載せる(サーバー側でアカウントIDの裏取りに使う)
// 端末ごとの識別子(インストール単位)。同じアカウントを2台で開いた時に、他方の対戦へ引き込まれたり席を横取りしたりしないための鍵。
// 起動時の自動復帰は「同じ端末」からだけ許可される
var _deviceKeyMem = null; // 保存に失敗する環境でも、この画面の中では同じ鍵を使う(接続時と、解除状況の読み込みで同じ値にする)
function getDeviceKey() {
  if (_deviceKeyMem) return _deviceKeyMem;
  var k = null; try { k = localStorage.getItem('salvado_device_key'); } catch (e) {}
  if (!k) { k = 'd_' + Math.random().toString(36).substr(2, 12) + Date.now().toString(36); try { localStorage.setItem('salvado_device_key', k); } catch (e) {} }
  _deviceKeyMem = k;
  return k;
}
// 同梱している client.js の版。index.html の client.js?v=NNN と必ず同じ番号にする(強制更新の判定に使う。tests/app_gate.test.js が照合)
var CLIENT_V = 139;
const _sockAuth = Object.assign({}, window.SALVADO_SOCKET_AUTH || {}, { deviceKey: getDeviceKey(), clientV: CLIENT_V, native: !!API_BASE });
const socket = API_BASE ? io(API_BASE, { auth: _sockAuth }) : io({ auth: _sockAuth });
let myState = null;
let mySeat = -1;

// ダイレクトアタック演出用: 試合ごとに自分・相手へ1〜4Pにゃんこを重複なし割り当て(試合中固定)
var _nyankoMe = null, _nyankoOpp = null;
function _assignNyanko() {
  var pool = [1, 2, 3, 4];
  for (var i = pool.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
  _nyankoMe = pool[0]; _nyankoOpp = pool[1];
}

socket.on('connect', function() {
  if (mySeat >= 0) {
    console.log('[CLIENT] reconnect → rejoin');
    socket.emit('rejoin', { playerId: getPlayerId() });
  } else {
    // アプリを完全に終了して開き直した場合も、サーバーに「自分の対戦中の部屋」が残っていれば(猶予30秒以内)自動で戻る。
    // 無ければ rejoinFailed が返るだけでロビーのまま
    console.log('[CLIENT] startup → rejoin check');
    // 募集に相手が来て呼び戻された直後(recruitJoin)は、自分で joinRoom するので自動復帰の確認は送らない
    setTimeout(function() { if (mySeat < 0 && !window._recruitJoining) socket.emit('rejoin', { playerId: getPlayerId(), startup: true }); }, 300);
  }
});
// ==== 募集の保持(掲示板の募集を出したまま、CPU対戦やクエストで待てる) ====
// サーバーの recruit hold(server/index.js)と対。相手が来たら recruitCall が届く → 今の対戦を抜けて、その部屋に入り直す
var _recruitHold = null;
function renderRecruitPill() {
  var el = document.getElementById('recruitPill');
  if (!_recruitHold) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'recruitPill'; document.body.appendChild(el); }
  el.textContent = '📣 募集中（相手が来たら自動で対戦に切り替わります）';
}
socket.on('recruitHolding', function(d) {
  _recruitHold = d && d.roomId; renderRecruitPill();
  var st = document.getElementById('lobbyStatus');
  if (st && mySeat < 0) st.innerHTML = '📣 募集中です。相手が来たら<b>自動で対戦が始まります</b>。CPU対戦やクエストをしながら待てます';
});
socket.on('recruitHoldEnded', function(d) {
  _recruitHold = null; renderRecruitPill();
  _recruitCallClear(); // 呼び出しの途中で募集が閉じた: 切り替えの予定を取り消す(サーバーがもう今の対戦を抜けさせた後は除く)
  if (d && d.reason === 'expired') { var st = document.getElementById('lobbyStatus'); if (st && mySeat < 0) st.textContent = '募集の時間（30分）が過ぎたので、募集を閉じました'; }
});
// 自分の募集に相手が来た。流れ: recruitCall(相手が来た) → recruitAccept(移ってよいかサーバーに確かめる) → recruitGo(サーバーが今の1人用の対戦を抜けさせた)
// → 再読込して joinRoom。クライアントが自分で対戦を抜けることはしない(呼び出しが取り消された後や対人戦の最中に抜けると敗北が付くため)
var _recruitCallRid = null, _recruitGoTimer = null, _recruitGone = false;
function _recruitCallClear() {
  if (_recruitGone) return; // サーバーがもう今の対戦を抜けさせた後は、取り消さずに最後まで進む(止めると動かない画面に取り残される)
  _recruitCallRid = null;
  if (_recruitGoTimer) { clearTimeout(_recruitGoTimer); _recruitGoTimer = null; }
  var ov = document.getElementById('recruitCallOverlay'); if (ov) ov.remove();
}
socket.on('recruitCall', function(d) {
  if (!d || !d.roomId || _recruitCallRid === d.roomId || _recruitGone) return;
  _recruitCallRid = d.roomId;
  var old = document.getElementById('recruitCallOverlay'); if (old) old.remove();
  var ov = document.createElement('div'); ov.id = 'recruitCallOverlay';
  ov.innerHTML = '<div class="rc-box"><div class="rc-t">📣 募集に相手が来ました！</div><div class="rc-n">' + String(d.name || '').replace(/[<>&]/g, '') + ' さん</div><div class="rc-s">対戦に切り替えます…</div></div>';
  document.body.appendChild(ov);
  socket.emit('recruitAccept', { roomId: d.roomId, playerId: getPlayerId() });
  // サーバーから返事が来ないまま表示が残らないように
  setTimeout(function() { if (_recruitCallRid === d.roomId && !_recruitGone) _recruitCallClear(); }, 8000);
});
socket.on('recruitCallCancelled', function() { _recruitCallClear(); });
socket.on('recruitGo', function(d) {
  if (!d || !d.roomId || d.roomId !== _recruitCallRid || _recruitGone) return;
  _recruitGone = true;
  // 入る部屋は URL に付けて渡す(sessionStorage が使えない環境でも再読込の後に分かるように)
  _recruitGoTimer = setTimeout(function() {
    var u = location.pathname + '?recruitJoin=' + encodeURIComponent(d.roomId) + '&rjn=' + encodeURIComponent(d.name || '');
    try { location.replace(u); } catch (e) { location.href = u; }
  }, 1100);
});
// 再読込の後: 呼ばれていた募集の部屋に入る(index.html の末尾から呼ぶ)
function recruitJoinAfterReload() {
  var rid = null, nm = '';
  try {
    var m = /[?&]recruitJoin=([^&]+)/.exec(location.search), n = /[?&]rjn=([^&]*)/.exec(location.search);
    if (m) rid = decodeURIComponent(m[1]); if (n) nm = decodeURIComponent(n[1]);
    if (m && window.history && history.replaceState) history.replaceState(null, '', location.pathname); // 手動の再読込でもう一度入ろうとしないように消す
  } catch (e) {}
  if (!rid || !/^[A-Za-z0-9_]{3,40}$/.test(rid)) return false;
  window._recruitJoining = true;
  var done = false;
  var finish = function(ok) {
    if (done) return; done = true; window._recruitJoining = false;
    socket.off('joined', onOk); socket.off('waiting', onOk); socket.off('error', onNg);
    // 入れなかった時は、止めていた「対戦中の部屋があれば戻る」確認をここで送る
    if (!ok && mySeat < 0) socket.emit('rejoin', { playerId: getPlayerId(), startup: true });
  };
  var onOk = function() { finish(true); }, onNg = function() { finish(false); };
  socket.on('joined', onOk); socket.on('waiting', onOk); socket.on('error', onNg);
  var st = document.getElementById('lobbyStatus'); if (st) st.textContent = '📣 ' + (nm ? nm + ' さんとの' : '') + '対戦を始めます...';
  socket.emit('joinRoom', { roomId: rid, name: getDisplayName(), deck: getMyDeckDef(), playerId: getPlayerId() });
  setTimeout(function() { finish(mySeat >= 0); }, 6000);
  return true;
}
// 参加した側: 募集主が別の対戦から戻ってくるのを待っている
socket.on('recruitCalling', function(d) {
  var st = document.getElementById('lobbyStatus');
  if (st) st.innerHTML = '📣 ' + String((d && d.name) || '相手').replace(/[<>&]/g, '') + ' さんを呼び出しています…（別の対戦から戻ってくるまで、最大' + Math.round(((d && d.waitMs) || 20000) / 1000) + '秒）';
});
socket.on('recruitCallFailed', function() {
  mySeat = -1; _waitSeat = -1;
  var st = document.getElementById('lobbyStatus'); if (st) st.textContent = '相手が戻ってこなかったため、対戦は始まりませんでした';
});
socket.on('deckRejected', function(d) {
  var msg = 'デッキが不正なため対戦を開始できませんでした' + (d && d.reason ? '（' + d.reason + '）' : '');
  var st = document.getElementById('lobbyStatus');
  if (st) st.textContent = msg;
  alert(msg);
});
socket.on('rejoinFailed', function() {
  console.log('[CLIENT] rejoin failed');
});

// 段階別の計測(到達→チュートリアル→初戦→対人→再訪)。端末キー単位。失敗しても何もしない
function track(event, meta) {
  try {
    var body = { device: getDeviceKey(), pid: localStorage.getItem('salvado_player_id') || undefined, event: event, meta: Object.assign({ native: !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()), clientV: String(typeof CLIENT_V !== 'undefined' ? CLIENT_V : '') }, meta || {}) };
    fetch((typeof API_BASE !== 'undefined' && API_BASE ? API_BASE : '') + '/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(function() {});
  } catch (e) {}
}
// 起動(open)は1日1回だけ送る(再訪の計測用)
(function() {
  try {
    var day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    if (localStorage.getItem('salvado_track_open_day') === day) return;
    localStorage.setItem('salvado_track_open_day', day);
  } catch (e) {}
  var q = {}; try { location.search.replace(/^\?/, '').split('&').forEach(function(kv) { var a = kv.split('='); if (a[0]) q[decodeURIComponent(a[0])] = decodeURIComponent(a[1] || ''); }); } catch (e) {}
  setTimeout(function() { track('open', { first: _firstRun, from: q.from || '', ref: (document.referrer || '').slice(0, 80) }); }, 1500);
})();
function getPlayerId() {
  let pid = localStorage.getItem('salvado_player_id');
  if (!pid) { pid = 'p_' + Math.random().toString(36).substr(2, 12) + Date.now().toString(36); localStorage.setItem('salvado_player_id', pid); }
  return pid;
}

function dv(n) { return n; }

// ==== プロフィール管理 ====
function getPlayerName() {
  return localStorage.getItem('salvado_player_name') || '';
}
function setPlayerName(name) {
  localStorage.setItem('salvado_player_name', name);
}
var _nameSyncing = false; // 名前変更をサーバーへ送っている間は、サーバーの古い名前で上書きしない
function initProfile() {
  var name = getPlayerName();
  if (name) {
    document.getElementById('profileNew').style.display = 'none';
    document.getElementById('profileRegistered').style.display = 'block';
    document.getElementById('profileGreeting').textContent = 'おかえり、' + name;
    fetch(API_BASE + '/api/user/' + getPlayerId()).then(function(r) { return r.json(); }).then(function(u) {
      if (_nameSyncing) return;
      if (u && u.display_name) {
        setPlayerName(u.display_name);
        document.getElementById('profileGreeting').textContent = 'おかえり、' + u.display_name;
      }
    }).catch(function() {});
  } else {
    document.getElementById('profileNew').style.display = 'block';
    document.getElementById('profileRegistered').style.display = 'none';
  }
}
function registerName() {
  var name = document.getElementById('nameInput').value.trim();
  if (!name) return;
  var btn = document.getElementById('registerBtn');
  if (btn) btn.disabled = true;
  // アカウント登録している人の名前はゲストでは使えない
  fetch(API_BASE + '/auth/name-check?name=' + encodeURIComponent(name)).then(function(r) { return r.json(); }).catch(function() { return { available: true }; }).then(function(j) {
    if (btn) btn.disabled = false;
    if (j && j.available === false) { alert(j.error || 'この名前は使えません'); return; }
    setPlayerName(name);
    // サーバー側の名前も今すぐ更新(以前は対戦参加時にしか更新されず、直後の再読込で古い名前に戻っていた)
    _nameSyncing = true;
    fetch(API_BASE + '/api/user/' + getPlayerId() + '/name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name }) })
      .then(function(r) { return r.json().catch(function() { return {}; }); })
      .then(function(j2) { if (j2 && j2.error && !j2.ok) alert(j2.error); })
      .catch(function() {})
      .then(function() { _nameSyncing = false; initProfile(); });
    initProfile();
  });
}
function showNameEdit() {
  document.getElementById('profileRegistered').style.display = 'none';
  document.getElementById('profileNew').style.display = 'block';
  document.getElementById('nameInput').value = getPlayerName();
  document.getElementById('registerBtn').textContent = '変更';
}
function getDisplayName() {
  return getPlayerName() || document.getElementById('nameInput').value || 'ゲスト';
}
initProfile();

// ==== レアリティ判定 ====
var CREATOR_IDS = ['salvado_cat','makkinii','sakamachi','hikaru','oyuchi','nari','ai_tsubame','ichiko','seishun_kiben','katorina','akapo','komi','nanase','gomo','yashiro'];
function getCardRarity(cardId) {
  var dc = DECK_CARDS.find(function(d) { return d.id === cardId; });
  if (!dc) return 0;
  if (dc.max === 1) return 2; // 最高レア
  if (dc.max === 2) {
    if (CREATOR_IDS.includes(cardId)) return 0; // クリエイターはノーマル
    if (cardId === 'salvado_cat_yarakashi') return 1; // 猫やらかしだけレア
    return 1; // レア
  }
  return 0;
}

// ==== カードDB参照ヘルパー ====
function getCardDB(cardId) {
  if (typeof CARD_DB !== 'undefined') return CARD_DB.find(function(c) { return c.id === cardId; });
  return null;
}

// ==== カットイン ====
function _buildCardFrameHTML(c, opts) {
  opts = opts || {};
  var cardClass = 'card';
  if (c.type === 'enchantment') cardClass += ' card-enchant';
  else if (c.type === 'support') cardClass += ' card-support';
  else cardClass += ' card-creature';
  if (c.subtype && c.subtype.includes('悪')) cardClass = 'card card-evil';
  if (c.subtype && c.subtype.includes('規約')) cardClass = 'card card-kiyaku';
  if (c.hero) cardClass += ' card-hero';
  if (c.heroine) cardClass += ' card-heroine';
  var pr = getCardRarity(c.id);
  if (pr === 2) cardClass += ' rarity-ur';
  else if (pr === 1) cardClass += ' rarity-r';

  var isKiyaku = c.subtype && c.subtype.includes('規約');
  var isCreator = c.subtype && c.subtype.includes('クリエイター');
  var frameImg = 'img/card_frame.png';
  if (c.type === 'enchantment' && pr >= 1) frameImg = 'img/card_frame_enchant_rare.png';
  else if (c.type === 'enchantment') frameImg = 'img/card_frame_enchant.png';
  else if (c.type === 'creature' && pr >= 1) frameImg = 'img/card_frame_creature_rare.png';
  else if (isKiyaku && pr >= 1) frameImg = 'img/card_frame_kiyaku_rare.png';
  else if (isKiyaku) frameImg = 'img/card_frame_kiyaku.png';
  else if (isCreator && pr >= 1) frameImg = 'img/card_frame_creator_rare.png';
  else if (isCreator) frameImg = 'img/card_frame_creator.png';
  else if (c.type === 'support' && pr === 2) frameImg = 'img/card_frame_support_ur.png';
  else if (c.type === 'support' && pr >= 1) frameImg = 'img/card_frame_support_rare.png';
  else if (c.type === 'support') frameImg = 'img/card_frame_support.png';
  var h = '<div class="' + cardClass + ' card-framed">';
  h += '<img class="card-frame-img" src="' + frameImg + '">';
  h += '<div class="card-frame-name"><img src="img/cardname/' + c.id + '.png" alt="' + c.name + '" data-nm="' + c.name + '" onerror="cnFallback(this)"></div>';
  h += '<div class="card-frame-subtype"></div>';
  h += '<div class="card-frame-cost">' + c.cost + '</div>';
  if (c.art) {
    h += '<div class="card-frame-art"><img src="' + c.art + '" style="width:100%;height:100%;object-fit:cover;' + (c.artStyle || '') + '"></div>';
  } else {
    h += '<div class="card-frame-art"></div>';
  }
  h += '<div class="card-frame-textbox">';
  if (c.subtype && c.subtype.length) {
    h += '<div class="card-frame-tags">';
    c.subtype.forEach(function(st) {
      var cls = 'tag';
      if (st === '主人公' || st === 'ヒロイン') cls += ' tag-hero';
      else if (st === '悪') cls += ' tag-evil';
      else if (st === '規約') cls += ' tag-kiyaku';
      else if (st === 'サポート') cls += ' tag-support';
      else if (st === 'エンチャント') cls += ' tag-enchant';
      else if (st === 'クリエイター' || st === 'イラストレーター' || st === 'ライター' || st === 'ディレクター' || st === '声優') cls += ' tag-creator';
      h += '<span class="' + cls + '">' + st + '</span>';
    });
    h += '</div>';
  }
  var descText = CARD_FULL_TEXT[c.id] || c.text || '';
  if (c.enchantments && c.enchantments.length > 0) {
    descText += '<div class="card-frame-ench">';
    c.enchantments.forEach(function(e) {
      var db = DECK_CARDS.find(function(d) { return d.id === e.id; });
      var eName = db ? db.name : e.id;
      var eText = db ? db.text : '';
      descText += '<div>⬡' + eName + (eText ? ' <span class="enchant-desc">(' + eText + ')</span>' : '') + '</div>';
    });
    descText += '</div>';
  }
  if (c.counters && c.counters.length > 0) {
    var cp = 0, ct = 0; c.counters.forEach(function(k) { cp += (k.power || 0); ct += (k.toughness || 0); });
    descText += '<div class="card-frame-ench"><div>◆カウンター ' + (cp >= 0 ? '+' : '') + cp + ' / ' + (ct >= 0 ? '+' : '') + ct + ' <span class="enchant-desc">(場にいる間。場を離れると消える)</span></div></div>';
  }
  h += '<div class="card-frame-desc">' + descText + '</div>';
  h += '</div>';
  if (c.power !== undefined) {
    var atk = opts.useEff ? (c.effP !== undefined ? c.effP : c.power) : c.power;
    var hp = opts.useEff ? (c.effT !== undefined ? c.effT : c.toughness) : c.toughness;
    var changed = opts.useEff && (atk !== c.power || hp !== c.toughness);
    h += '<div class="card-frame-footer' + (changed ? ' modified' : '') + '"><span class="card-frame-atk"><span class="stat-label">ATK</span><span class="stat-num">' + dv(atk) + '</span></span><span class="card-frame-hp"><span class="stat-label">HP</span><span class="stat-num">' + dv(hp) + '</span></span></div>';
  }
  h += '</div>';
  return h;
}

function _buildCutinHTML(cardId, label) {
  var db = getCardDB(cardId);
  var dc = DECK_CARDS.find(function(d) { return d.id === cardId; });
  var c = db || dc;
  if (!c) return null;
  var h = '<div class="cutin-bg"></div><div class="cutin-card" style="position:relative;">';
  h += _buildCardFrameHTML(c);
  h += '<div class="cutin-label">' + label + '</div></div>';
  return h;
}

var _cutinDoneCallback = null;
function _showCutinAnim(cardId, label, onDone) {
  var h = _buildCutinHTML(cardId, label);
  if (!h) { onDone(); return; }

  var overlay = document.getElementById('cutinOverlay');
  overlay.innerHTML = h;
  overlay.classList.remove('leaving');
  overlay.classList.add('active');
  var tb = overlay.querySelector('.card-frame-textbox');
  if (tb) {
    var desc = tb.querySelector('.card-frame-desc');
    if (desc) {
      var sizes = [11, 10, 9, 8, 7];
      var lineHeights = [1.5, 1.45, 1.4, 1.35, 1.3];
      for (var i = 0; i < sizes.length; i++) {
        desc.style.fontSize = sizes[i] + 'px';
        desc.style.lineHeight = lineHeights[i];
        if (tb.scrollHeight <= tb.clientHeight) break;
      }
    }
  }
  _cutinDoneCallback = onDone;

  setTimeout(function() {
    if (_cutinDoneCallback !== onDone) return;
    overlay.classList.add('leaving');
    setTimeout(function() {
      if (_cutinDoneCallback !== onDone) return;
      overlay.classList.remove('active', 'leaving');
      _cutinDoneCallback = null;
      onDone();
    }, 350);
  }, 1200);
}

function dismissCutin() {
  var overlay = document.getElementById('cutinOverlay');
  if (!overlay.classList.contains('active')) return;
  overlay.classList.remove('active', 'leaving');
  if (_cutinDoneCallback) { var cb = _cutinDoneCallback; _cutinDoneCallback = null; cb(); }
}

// ==== カードボイス ====
var CARD_VOICES = { zeratine: 'img/zeratine_voice.mp3', lead: 'img/lead_voice.mp3', daisuke_dare: 'img/daisuke_dare_voice.mp3', jun: 'img/jun_voice.wav', shinigami: 'img/shinigami_voice.wav', maoria: 'img/maoria_voice.wav', izuna: 'img/izuna_voice.wav', miiko: 'img/miiko_voice.wav', tomo: 'img/tomo_voice.wav', daria: 'img/daria_voice.wav', milia: 'img/milia_voice.wav', ark: 'img/ark_voice.wav', osananajimi: 'img/osananajimi_voice.wav', reichen: 'img/reichen_voice.mp3', sagi: 'img/sagi_voice.mp3', yuri: 'img/yuri_voice.mp3', lucia: 'img/lucia_voice.mp3', '99wari': 'img/99wari_voice.mp3', kanaria: 'img/kanaria_voice.mp3', impression_seigen: 'img/impression_seigen_voice.mp3', kyamakiri: 'img/kyamakiri_voice.mp3', salvado_cat_yarakashi: 'img/salvado_cat_yarakashi_voice.mp3', channel_sakujo: 'img/channel_sakujo_voice.mp3', kaera: 'img/kaera_voice.mp3', mamachari: 'img/mamachari_voice.mp3', jk_a: 'img/jk_a_voice.mp3', kanwa_kyuudai: 'img/kanwa_kyuudai_voice.mp3', kikaku_botsu: 'img/kikaku_botsu_voice.mp3', asaki: 'img/asaki_voice.mp3', shiko_touchou: 'img/shiko_touchou_voice.mp3', shueki_teishi: 'img/shueki_teishi_voice.mp3', onna_joushi: 'img/onna_joushi_voice.mp3', suisosui: 'img/suisosui_voice.mp3', seitokaichou: 'img/seitokaichou_voice.mp3', azusa: 'img/azusa_voice.mp3', dansou: 'img/dansou_voice.mp3', rena: 'img/rena_voice.mp3', super_chat: 'img/super_chat_voice.mp3', douga_sakujo: 'img/douga_sakujo_voice.mp3', douga_fukugen: 'img/douga_fukugen_voice.mp3', douga_henshuu: 'img/douga_henshuu_voice.mp3', imouto: 'img/imouto_voice.mp3', mensetsu_kan: 'img/mensetsu_kan_voice.mp3', katorina: 'img/katorina_voice.mp3' };
var _audioCtx = null;
var _bgmGain = null;
function _getAudioCtx() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}
// モバイル(Android/iOS WebView)は最初のユーザー操作でAudioContextをresumeしないと音が鳴らない。
// BGMはsocketコールバック(非同期)から始まるため、最初のタップで先にアンロックしておく。
var _audioUnlocked = false;
function _unlockAudio() {
  try {
    var ctx = _getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume().then(function(){ _audioUnlocked = true; }).catch(function(){});
    else _audioUnlocked = true;
  } catch (e) {}
}
document.addEventListener('touchend', _unlockAudio, true);
document.addEventListener('click', _unlockAudio, true);
document.addEventListener('pointerdown', _unlockAudio, true);
function _playWithGain(url, volume, onEnded) {
  var ctx = _getAudioCtx();
  var a = new Audio(url);
  var src = ctx.createMediaElementSource(a);
  var gain = ctx.createGain();
  gain.gain.value = volume;
  src.connect(gain);
  gain.connect(ctx.destination);
  if (onEnded) a.addEventListener('ended', onEnded);
  a.play().catch(function() {});
  return { audio: a, gain: gain };
}
var CARD_ABILITY_VOICES = { lead: 'img/lead_ability_voice.mp3', kanaria: 'img/kanaria_ability_voice.mp3', lucia: 'img/lucia_ability_voice.mp3', maoria: 'img/maoria_ability_voice.mp3', jk_a: 'img/jk_a_ability_voice.mp3', asaki: 'img/asaki_ability_voice.mp3', shinigami: 'img/shinigami_ability_voice.mp3', azusa: 'img/azusa_ability_voice.mp3', dansou: 'img/dansou_ability_voice.mp3', sagi: 'img/sagi_ability_voice.mp3', izuna: 'img/izuna_ability_voice.mp3', reichen: 'img/reichen_ability_voice.mp3' };
var VOICE_VOLUME = { izuna: 0.45 };
var _currentVoice = null;
// 能力のボイス。ゼラチネは能力が2つあるので、効果の説明文(分裂/捕食)で鳴らし分ける
var ZERATINE_ABILITY_VOICES = { split: 'img/zeratine_split_voice.mp3', eat: 'img/zeratine_eat_voice.mp3' };
function abilityVoiceFor(data) {
  if (!data || !data.cardId) return null;
  if (data.cardId === 'zeratine') {
    // サーバーが付ける能力の印(abilityId)で選ぶ。無い時だけ説明文で判定(古いサーバーとの組み合わせ用)
    if (data.abilityId === 'zeratine_split') return ZERATINE_ABILITY_VOICES.split;
    if (data.abilityId === 'zeratine_eat') return ZERATINE_ABILITY_VOICES.eat;
    var t = String(data.text || '');
    if (t.indexOf('分裂') >= 0) return ZERATINE_ABILITY_VOICES.split;
    if (t.indexOf('捕食') >= 0) return ZERATINE_ABILITY_VOICES.eat;
  }
  return CARD_ABILITY_VOICES[data.cardId] || null;
}
function playVoice(cardId, overrideUrl) {
  var url = overrideUrl || CARD_VOICES[cardId]; if (!url) return;
  if (_currentVoice) {
    _currentVoice.audio.pause();
    _currentVoice.audio.currentTime = 0;
    if (_currentVoice.restore) _currentVoice.restore();
  }
  var vol = VOICE_VOLUME[cardId] || 0.7;
  if (_bgmGain) {
    var origVol = _bgmGain.gain.value;
    _bgmGain.gain.value = origVol * 0.15;
    var restore = function() { if (_bgmGain) _bgmGain.gain.value = origVol; };
    var r = _playWithGain(url, vol, function() { _currentVoice = null; restore(); });
    _currentVoice = { audio: r.audio, restore: restore };
  } else {
    var r = _playWithGain(url, vol, function() { _currentVoice = null; });
    _currentVoice = { audio: r.audio, restore: null };
  }
}

// ==== ランキング ====
function loadRanking() {
  var el = document.getElementById('rankingBody');
  if (!el) return;
  var period = document.getElementById('rankingPeriod');
  var days = period ? period.value : '7';
  var url = API_BASE + '/ranking' + (days ? '?days=' + days : '');
  fetch(url).then(function(r) { return r.json(); }).then(function(data) {
    if (!data || data.length === 0) { el.innerHTML = 'まだ対戦記録がありません'; return; }
    var myPid = getPlayerId();
    var top = data.slice(0, 10);
    var h = '';
    for (var i = 0; i < top.length; i++) {
      var r = top[i];
      var isMe = r.playerId === myPid;
      var bc = i === 0 ? 'b1' : i === 1 ? 'b2' : i === 2 ? 'b3' : 'bn';
      h += '<div class="lb-rrow' + (isMe ? ' me' : '') + '">';
      h += '<div class="lb-badge ' + bc + '">' + (i + 1) + '</div>';
      h += '<div class="lb-rname">' + (r.name || '???') + (isMe ? ' <span style="font-size:11px;color:#2a9aa5;">(あなた)</span>' : '') + '</div>';
      h += '<div class="lb-rval">' + r.wins + '<small> 勝</small> <span style="color:#b89a72;font-size:12px;">' + r.rate + '%</span></div>';
      h += '</div>';
    }
    el.innerHTML = h;
  }).catch(function() { el.innerHTML = '読み込みエラー'; });
}
function loadEndlessRanking() {
  var el = document.getElementById('endlessRankingBody');
  if (!el) return;
  var period = document.getElementById('endlessRankingPeriod');
  var days = period ? period.value : '7';
  var url = API_BASE + '/endless-ranking' + (days ? '?days=' + days : '');
  fetch(url).then(function(r) { return r.json(); }).then(function(data) {
    if (!data || data.length === 0) { el.innerHTML = 'まだ記録がありません'; return; }
    var myPid = getPlayerId();
    var top = data.slice(0, 10);
    var h = '';
    for (var i = 0; i < top.length; i++) {
      var r = top[i];
      var isMe = r.playerId === myPid;
      var bc = i === 0 ? 'b1' : i === 1 ? 'b2' : i === 2 ? 'b3' : 'bn';
      h += '<div class="lb-rrow' + (isMe ? ' me' : '') + '">';
      h += '<div class="lb-badge ' + bc + '">' + (i + 1) + '</div>';
      h += '<div class="lb-rname">' + (r.name || '???') + (isMe ? ' <span style="font-size:11px;color:#2a9aa5;">(あなた)</span>' : '') + '</div>';
      h += '<div class="lb-rval">WAVE ' + (r.stage + 1) + '</div>';
      h += '</div>';
    }
    el.innerHTML = h;
  }).catch(function() { el.innerHTML = '読み込みエラー'; });
}
setTimeout(loadRanking, 500);
setTimeout(loadEndlessRanking, 600);

// ==== お問い合わせ ====
var INQUIRY_MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;

function onInquiryCategoryChange() {
  var categoryEl = document.getElementById('inquiryCategory');
  var extra = document.getElementById('inquiryBugExtra');
  var isBug = categoryEl.value === '不具合について';
  extra.style.display = isBug ? 'flex' : 'none';
  if (isBug) {
    var deviceEl = document.getElementById('inquiryDevice');
    if (deviceEl && !deviceEl.value) deviceEl.value = navigator.userAgent;
  }
}

(function initInquiryPlayerId() {
  var pidEl = document.getElementById('inquiryPlayerId');
  if (pidEl) pidEl.value = getPlayerId();
})();

function readInquiryScreenshot() {
  var fileEl = document.getElementById('inquiryScreenshot');
  var file = fileEl && fileEl.files && fileEl.files[0];
  if (!file) return Promise.resolve(null);
  if (file.size > INQUIRY_MAX_SCREENSHOT_BYTES) {
    return Promise.reject(new Error('スクリーンショットは4MB以内にしてください'));
  }
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() { resolve({ dataUrl: reader.result, mime: file.type, name: file.name }); };
    reader.onerror = function() { reject(new Error('スクリーンショットの読み込みに失敗しました')); };
    reader.readAsDataURL(file);
  });
}

function submitInquiry() {
  var categoryEl = document.getElementById('inquiryCategory');
  var nameEl = document.getElementById('inquiryName');
  var contactEl = document.getElementById('inquiryContact');
  var textEl = document.getElementById('inquiryText');
  var contactConfirmEl = document.getElementById('inquiryContactConfirm');
  var msgEl = document.getElementById('inquiryMsg');
  var name = (nameEl.value || '').trim();
  var contact = (contactEl.value || '').trim();
  var contactConfirm = (contactConfirmEl.value || '').trim();
  var text = (textEl.value || '').trim();
  if (!name) {
    msgEl.textContent = 'お名前を入力してください';
    msgEl.className = 'lb-inquiry-msg err';
    return;
  }
  if (!contact) {
    msgEl.textContent = '連絡先を入力してください';
    msgEl.className = 'lb-inquiry-msg err';
    return;
  }
  if (contact !== contactConfirm) {
    msgEl.textContent = '連絡先（確認用）が一致しません';
    msgEl.className = 'lb-inquiry-msg err';
    return;
  }
  if (!text) {
    msgEl.textContent = '内容を入力してください';
    msgEl.className = 'lb-inquiry-msg err';
    return;
  }
  var isBug = categoryEl.value === '不具合について';
  var payload = { category: categoryEl.value, name: name, contact: contact, playerId: document.getElementById('inquiryPlayerId').value, text: text };
  if (isBug) {
    var screenEl = document.getElementById('inquiryScreen');
    if (!screenEl.value) {
      msgEl.textContent = '発生した画面を選択してください';
      msgEl.className = 'lb-inquiry-msg err';
      return;
    }
    var networks = Array.prototype.slice.call(document.querySelectorAll('.inquiry-network:checked')).map(function(c) { return c.value; });
    payload.bug = {
      occurredAt: document.getElementById('inquiryOccurredAt').value,
      screen: screenEl.value,
      action: document.getElementById('inquiryAction').value,
      errorMsg: document.getElementById('inquiryErrorMsg').value,
      device: document.getElementById('inquiryDevice').value,
      network: networks.join(', ')
    };
  }
  msgEl.textContent = '送信中...';
  msgEl.className = 'lb-inquiry-msg';
  (isBug ? readInquiryScreenshot() : Promise.resolve(null)).then(function(shot) {
    if (shot) {
      payload.bug.screenshotDataUrl = shot.dataUrl;
      payload.bug.screenshotName = shot.name;
    }
    return fetch(API_BASE + '/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data && data.ok) {
      msgEl.textContent = '送信しました。ありがとうございます！';
      msgEl.className = 'lb-inquiry-msg ok';
      nameEl.value = '';
      contactEl.value = '';
      contactConfirmEl.value = '';
      textEl.value = '';
      document.getElementById('inquiryOccurredAt').value = '';
      document.getElementById('inquiryScreen').value = '';
      document.getElementById('inquiryAction').value = '';
      document.getElementById('inquiryErrorMsg').value = '';
      document.getElementById('inquiryScreenshot').value = '';
      Array.prototype.slice.call(document.querySelectorAll('.inquiry-network:checked')).forEach(function(c) { c.checked = false; });
    } else {
      msgEl.textContent = (data && data.error) || '送信に失敗しました';
      msgEl.className = 'lb-inquiry-msg err';
    }
  }).catch(function(e) {
    msgEl.textContent = (e && e.message) || '送信に失敗しました';
    msgEl.className = 'lb-inquiry-msg err';
  });
}

function switchRankTab(which) {
  var n = document.getElementById('rankNormalWrap'), b = document.getElementById('rankBossWrap');
  var tn = document.getElementById('rtabNormal'), tb = document.getElementById('rtabBoss');
  if (!n || !b) return;
  if (which === 'boss') {
    n.style.display = 'none'; b.style.display = '';
    if (tn) tn.classList.remove('on'); if (tb) tb.classList.add('on');
    loadEndlessRanking();
  } else {
    n.style.display = ''; b.style.display = 'none';
    if (tb) tb.classList.remove('on'); if (tn) tn.classList.add('on');
    loadRanking();
  }
}
function setRankPeriod(selId, val, btn, fn) {
  var sel = document.getElementById(selId);
  if (sel) sel.value = val;
  var bs = btn.parentNode.querySelectorAll('button');
  for (var i = 0; i < bs.length; i++) bs[i].classList.remove('on');
  btn.classList.add('on');
  if (fn) fn();
}

// ==== ロビー ====
function getMyDeckDef() {
  let deckDef = [];
  Object.keys(myDeck).forEach(function(id) {
    if (myDeck[id] > 0) deckDef.push({ id: id, count: myDeck[id] });
  });
  return deckDef.length > 0 ? deckDef : undefined;
}
var _qmWaiting = false;
function _setQuickMatchUI(waiting) {
  _qmWaiting = waiting;
  var btn = document.querySelector('#lobbyScreen button[onclick="quickMatch()"]');
  if (!btn) return;
  btn.classList.toggle('qm-waiting', waiting);
  var tag = btn.querySelector('.qm-cancel-tag');
  if (waiting && !tag) { tag = document.createElement('span'); tag.className = 'qm-cancel-tag'; tag.textContent = 'マッチング中… もう一度押すと解除'; btn.appendChild(tag); }
  if (!waiting && tag) tag.remove();
}
function quickMatch() {
  let name = getDisplayName();
  if (!_qmWaiting) track('quickmatch_press');
  socket.emit('quickMatch', { name: name, deck: getMyDeckDef(), playerId: getPlayerId() });
  document.getElementById('lobbyStatus').textContent = _qmWaiting ? '解除中...' : 'マッチング中...';
}
socket.on('matchCancelled', function() {
  _setQuickMatchUI(false);
  document.getElementById('lobbyStatus').textContent = 'クイックマッチを解除しました';
});
// 掲示板の募集を自分で消した → サーバーが待機中の部屋を閉じた
socket.on('recruitCancelled', function() {
  _recruitHold = null; renderRecruitPill();
  _recruitCallClear();
  _setQuickMatchUI(false);
  document.getElementById('lobbyStatus').textContent = '募集を取り消しました';
});
function aiMatch() {
  let name = getDisplayName();
  socket.emit('aiMatch', { name: name, deck: getMyDeckDef(), playerId: getPlayerId() });
  document.getElementById('lobbyStatus').textContent = 'CPU対戦を開始します...';
}
var isTutorial = false;
var tutorialStep = 0;
// 初めての人にだけ「まず1戦」としてチュートリアルをすすめる(すでに遊んでいる人には出さない)
function maybeFirstRun() {
  if (!_firstRun) return;
  _firstRun = false;
  if (sessionStorage.getItem('tutorialReplay') || sessionStorage.getItem('afterTutorial')) return;
  track('first_match_prompt');
  showModal('<h3>はじめまして！</h3><p style="color:#f0e6d0;font-size:13px;line-height:1.6;margin:6px 0 12px;">まず<b>3分のチュートリアル</b>で、1戦の流れをつかもう。<br>フォロー → 投稿 → 攻撃、の3つだけ。</p>'
    + '<button onclick="closeModal();tutorialMatch()">チュートリアルを始める</button> <button onclick="closeModal()" style="background:#444;">あとで</button>');
}
function tutorialMatch() {
  isTutorial = true;
  tutorialStep = 0;
  track('tutorial_start');
  socket.emit('tutorialMatch');
  document.getElementById('lobbyStatus').textContent = 'チュートリアルを開始します...';
}
var QUESTS = [
  { id: 'quest_01', name: '雑魚軍団を突破せよ', description: 'モブキャラ4体が立ちはだかる。蹴散らせ！（自LP2000/応援5 | 敵LP300）', difficulty: 1 },
  { id: 'quest_04', name: '戦闘用外部ユニット スマッシャー', description: 'スマッシャーを装備したアンドロイド ユリが立ちはだかる。突破せよ！（自LP1500/応援3 | 敵LP1000）', difficulty: 2 },
  { id: 'quest_02', name: '魔王マオリアを討伐せよ', description: '寄生体に蝕まれた魔王が立ちはだかる。倒せるか？（自LP1000/応援5 | 敵LP1000）', difficulty: 3 },
  { id: 'quest_03', name: 'モルティス軍団を潜り抜けろ', description: 'イズナ・マオリア・レイチェンが待ち構える。突破口を見つけろ！（自LP2000/応援5 | 敵LP1000）', difficulty: 3 },
  { id: 'quest_07', name: '破られた同名制限', description: 'アーク2体・ミリア2体が同時に立ちはだかる。同名制限を超えた軍勢を打ち破れ！（自LP3000/応援3 | 敵LP2000）', difficulty: 5 },
  { id: 'quest_06', name: '死神の鎌', description: 'アルミホイルで守られた死神少女3体が待ち受ける。突破口はあるか？（自LP1000/応援3 | 敵LP3000）', difficulty: 5 },
  { id: 'quest_05', name: '最強の勇者パーティ', description: '勇者トモ・魔法使いイズナ・僧侶ミーコの最強パーティに挑め！（自LP2000/応援3 | 敵LP2000）', difficulty: 4 },
  { id: 'quest_08', name: '大食冠ゼラチネを撃破せよ', description: '分裂と捕食をくり返すゼラチネと、店主リードが待ち受ける。主人公は「ダイスケ」に変えられる！（自LP1000/応援6 | 敵LP1000）', difficulty: 3, reward: ['zeratine', 'lead', 'daisuke_dare'], rewardText: 'クリア報酬: 新カード3枚が使えるようになる（大食冠 ゼラチネ / 店主 リード / ダイスケ誰その男）' }
];
var PUZZLES = [
  { id: 'puzzle_01', name: 'はじめての詰め', description: 'このターンで相手のLPを0にせよ！' },
  { id: 'puzzle_02', name: '飛行の抜け道', description: 'ブロッカーの壁を飛行で突破せよ！' },
  { id: 'puzzle_03', name: '魔王の血族', description: '寄生体に蝕まれた盤面を打ち破れ！' }
];
var BOSS_COURSES = [
  { id: 'boss_normal', name: 'ノーマル', difficulty: 2, description: '3連戦を勝ち抜け！' },
  { id: 'boss_hard', name: 'ハード', difficulty: 3, description: '強敵3連戦を勝ち抜け！' }
];
function startBossRush(courseId) {
  closeModal();
  var name = getDisplayName();
  socket.emit('bossRush', { name: name, deck: getMyDeckDef(), courseId: courseId, playerId: getPlayerId() });
  document.getElementById('lobbyStatus').textContent = 'ボスラッシュ開始...';
}
function startEndlessBoss() {
  closeModal();
  var name = getDisplayName();
  socket.emit('endlessBoss', { name: name, deck: getMyDeckDef(), playerId: getPlayerId() });
  document.getElementById('lobbyStatus').textContent = '無限ボスラッシュ開始...';
}
function startPuzzle(puzzleId) {
  closeModal();
  var name = getDisplayName();
  socket.emit('puzzleMatch', { name: name, puzzleId: puzzleId });
  document.getElementById('lobbyStatus').textContent = 'パズル開始...';
}
function showQuestSelect() {
  var html = '<div class="qm-title">🎮 クエストモード</div>';
  var hasReward = newCardsVisible() && QUESTS.some(function(q) { return q.reward; });
  html += '<div class="qm-menu' + (hasReward ? ' qm-menu-grid2' : '') + '">';
  html += '<button class="qm-btn cyan" onclick="showQuestList()"><img class="qm-ic" src="img/lobby_icon_quest_normal.png" alt=""> 通常クエスト</button>';
  html += '<button class="qm-btn red" onclick="showBossRush()"><img class="qm-ic" src="img/lobby_icon_bossrush.png" alt=""> ボスラッシュ</button>';
  html += '<button class="qm-btn purple" onclick="showPuzzleQuest()"><img class="qm-ic" src="img/lobby_icon_puzzle.png" alt=""> パズル</button>';
  if (hasReward) html += '<button class="qm-btn gold" onclick="showRewardQuests()">🎁 報酬クエスト</button>';
  html += '</div>';
  html += '<div><button class="qm-back" onclick="closeModal()">閉じる</button></div>';
  showModal(html, 'pop');
}
// 報酬クエスト: クリアすると新カードの使用権がもらえるクエスト(通常クエストとは別の入口)
function showRewardQuests() {
  loadUnlocks();
  var html = '<div class="qm-title">🎁 報酬クエスト</div>';
  html += '<div class="qd" style="margin-bottom:10px;">クリアすると新カードが使えるようになる。ゲストでもOK（この端末で解除）</div>';
  QUESTS.forEach(function(q) {
    if (!q.reward) return;
    var stars = ''; for (var i = 0; i < q.difficulty; i++) stars += '★';
    html += '<div class="qm-card" onclick="startQuest(\'' + q.id + '\')">';
    html += '<div class="qn">' + q.name + ' <span class="st">' + stars + '</span></div>';
    html += '<div class="qd">' + q.description + '</div>';
    if (q.rewardText) html += '<div class="qd" style="color:#c08a20;font-weight:700;">🎁 ' + q.rewardText + (_questRewardOwned(q) ? '（解除済み）' : '') + '</div>';
    html += '</div>';
  });
  html += '<div><button class="qm-back" onclick="showQuestSelect()">戻る</button></div>';
  showModal(html, 'pop');
}
function showQuestList() {
  loadUnlocks(); // 公開状況・解除状況を読み直しておく(開いている間に公開/非公開が切り替わっても、次に開いた時に反映される)
  var diffs = [];
  QUESTS.forEach(function(q) { if (q.reward) return; if (diffs.indexOf(q.difficulty) === -1) diffs.push(q.difficulty); }); // 報酬つきは「報酬クエスト」の入口に
  diffs.sort(function(a, b) { return a - b; });
  var html = '<div class="qm-title">通常クエスト <span class="st">難易度選択</span></div>';
  html += '<div class="qm-menu">';
  diffs.forEach(function(d) {
    var stars = '';
    for (var i = 0; i < d; i++) stars += '★';
    html += '<button class="qm-btn cyan" onclick="showQuestByDifficulty(' + d + ')">' + stars + '</button>';
  });
  html += '</div>';
  html += '<div><button class="qm-back" onclick="showQuestSelect()">戻る</button></div>';
  showModal(html, 'pop');
}
function showQuestByDifficulty(diff) {
  var stars = '';
  for (var i = 0; i < diff; i++) stars += '★';
  var html = '<div class="qm-title">通常クエスト <span class="st">' + stars + '</span></div>';
  QUESTS.forEach(function(q) {
    if (q.difficulty !== diff) return;
    if (q.reward) return; // 報酬つきは「報酬クエスト」の入口に
    html += '<div class="qm-card" onclick="startQuest(\'' + q.id + '\')">';
    html += '<div class="qn">' + q.name + '</div>';
    html += '<div class="qd">' + q.description + '</div>';
    if (q.rewardText) html += '<div class="qd" style="color:#c08a20;font-weight:700;">🎁 ' + q.rewardText + (_questRewardOwned(q) ? '（解除済み）' : '') + '</div>';
    html += '</div>';
  });
  html += '<div><button class="qm-back" onclick="showQuestList()">戻る</button></div>';
  showModal(html, 'pop');
}
function showBossRush() {
  var html = '<div class="qm-title">👹 ボスラッシュ</div>';
  html += '<div class="qd" style="margin-bottom:12px;">3連戦でボスを倒せ！ LP・盤面引き継ぎで挑む。</div>';
  BOSS_COURSES.forEach(function(c) {
    var stars = '';
    for (var i = 0; i < c.difficulty; i++) stars += '★';
    html += '<div class="qm-card boss" onclick="startBossRush(\'' + c.id + '\')">';
    html += '<div class="qn">' + c.name + ' <span class="st">' + stars + '</span></div>';
    html += '<div class="qd">' + c.description + '</div>';
    html += '</div>';
  });
  html += '<div class="qm-card endless" onclick="startEndlessBoss()">';
  html += '<div class="qn">∞ 無限 <span class="st">★★★★★</span></div>';
  html += '<div class="qd">無限に迫る強敵を倒し、ランキングに挑戦！</div>';
  html += '<div class="qd">※ラウンド間でゴミ箱は山札に戻ります</div>';
  html += '<div class="qd" style="color:#cc6a6a;">※WAVE6以降: LP2000/場4体/手札7枚/マナ10に制限</div>';
  html += '</div>';
  html += '<div><button class="qm-back" onclick="showQuestSelect()">戻る</button></div>';
  showModal(html, 'pop');
}
function showPuzzleQuest() {
  var html = '<div class="qm-title">🧩 パズル</div>';
  html += '<div class="qd" style="margin-bottom:12px;">決められた盤面から1ターンで勝利せよ！</div>';
  PUZZLES.forEach(function(p, i) {
    html += '<div class="qm-card" onclick="startPuzzle(\'' + p.id + '\')">';
    html += '<div class="qn">' + p.name + '</div>';
    html += '<div class="qd">' + p.description + '</div>';
    html += '</div>';
  });
  if (typeof PUZZLES === 'undefined' || PUZZLES.length === 0) {
    html += '<div class="qd">準備中...</div>';
  }
  html += '<div><button class="qm-back" onclick="showQuestSelect()">戻る</button></div>';
  showModal(html, 'pop');
}
// ==== カードの使用権の解除(クエスト報酬) ====
// サーバーから「解除済みのカード」を読み込む。null=まだ読めていない(その間は未解除として表示する)
var _unlocked = null;
var _unlockLoading = false;
function loadUnlocks(cb) {
  if (_unlockLoading) { if (cb) cb(); return; }
  _unlockLoading = true;
  var headers = {};
  var tk = (window.SALVADO_SOCKET_AUTH && window.SALVADO_SOCKET_AUTH.token) || '';
  if (tk) headers['Authorization'] = 'Bearer ' + tk;
  headers['x-device-key'] = getDeviceKey(); // ゲストの解除は「クリアした端末」でだけ有効(サーバーが端末の鍵で確かめる)
  fetch(API_BASE + '/api/user/' + encodeURIComponent(getPlayerId()) + '/unlocks', { headers: headers })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(j) { _unlockLoading = false; if (j && Array.isArray(j.cards)) { _unlocked = { cards: j.cards, all: !!j.all, visible: !!j.visible }; if (document.getElementById('deckEditor')) renderDeckEditor(); } if (cb) cb(); })
    .catch(function() { _unlockLoading = false; if (cb) cb(); });
}
function isQuestCard(id) { var c = getCardDB(id); return !!(c && c.acquire === 'quest'); }
// 新カードとその入手クエストを、この人に見せてよいか。サーバーの公開スイッチ(または先行テストのアカウント)で決まる。
// 読み込めていない間・公開前は false ＝ クエスト一覧にもデッキ編集にも出さない(全員同時に公開するため)
function newCardsVisible() { return !!(_unlocked && (_unlocked.visible || _unlocked.all)); }
function isCardLocked(id) {
  if (!isQuestCard(id)) return false;
  if (!_unlocked) return true;
  return !(_unlocked.all || _unlocked.cards.indexOf(id) >= 0);
}
function _questRewardOwned(q) { return !!(q.reward && q.reward.every(function(id) { return !isCardLocked(id); })); }
setTimeout(function() { loadUnlocks(); }, 400);

function startQuest(questId, confirmed) {
  var q = QUESTS.find(function(x) { return x.id === questId; });
  if (q && q.reward && !newCardsVisible()) return; // 公開前(サーバー側でも始められない)
  var loggedIn = !!(window.SalvadoAccount && window.SalvadoAccount.isLoggedIn && window.SalvadoAccount.isLoggedIn());
  // 報酬つきクエストをゲストのまま始める前に、保存先を知らせる(ゲストで解除した分は、後からログインしても引き継がれない)
  if (q && q.reward && !confirmed && !loggedIn && !_questRewardOwned(q)) {
    var h = '<div class="qm-title">' + q.name + '</div>';
    h += '<div class="qd" style="margin:8px 0 12px;line-height:1.7;">ゲストのままクリアすると、報酬は<b>この端末のゲスト</b>にだけ付きます。<br>あとからログインしても引き継がれません。<br><b>ログインしてからの挑戦がおすすめです。</b></div>';
    h += '<div class="qm-menu">';
    if (window.SalvadoAccount && window.SalvadoAccount.openLogin) h += '<button class="qm-btn cyan" onclick="closeModal();SalvadoAccount.openLogin()">ログインする</button>';
    h += '<button class="qm-btn red" onclick="startQuest(\'' + questId + '\', true)">ゲストのまま挑戦する</button>';
    h += '</div><div><button class="qm-back" onclick="showQuestByDifficulty(' + q.difficulty + ')">戻る</button></div>';
    showModal(h, 'pop');
    return;
  }
  closeModal();
  var name = getDisplayName();
  socket.emit('questMatch', { name: name, deck: getMyDeckDef(), questId: questId, playerId: getPlayerId() });
  document.getElementById('lobbyStatus').textContent = 'クエストを開始します...';
}
function createRoom() {
  let name = getDisplayName();
  socket.emit('createRoom', { name: name, deck: getMyDeckDef(), playerId: getPlayerId() });
}
function joinRoom() {
  let name = getDisplayName();
  let roomId = document.getElementById('roomInput').value.toUpperCase();
  if (!roomId) return;
  socket.emit('joinRoom', { roomId, name, deck: getMyDeckDef(), playerId: getPlayerId() });
}

socket.on('waiting', ({ roomId, kind, seat, names }) => {
  _waitSeat = (typeof seat === 'number') ? seat : 0; // 部屋を作った側は常に席0
  if (Array.isArray(names)) _playerNames = names.slice(0, 2); else _playerNames = [getDisplayName(), null];
  document.getElementById('lobbyStatus').innerHTML = '待機中... ルームID: <b style="color:#0e7d74;font-size:18px;">' + roomId + '</b><br>相手の参加を待っています';
  _setQuickMatchUI(kind === 'quick'); // ルーム作成や掲示板の募集の待機では「もう一度押すと解除」を出さない
});

var _isEndless = false;
// ==== 対戦中の名前表示(LPボックスの「相手/自分」ラベルを名前に) ====
var _playerNames = [null, null];
var _waitSeat = -1; // 部屋を作って待つ側は joined が来ない(waiting だけ)ので、待機時の席をここに持つ
function applyPlayerNames() {
  var seat = mySeat >= 0 ? mySeat : _waitSeat; // 待つ側は waiting で受けた席
  var opp = document.querySelector('#gameScreen .top-bar .life-opp .life-label');
  var me = document.querySelector('#gameScreen .top-bar .life-box:not(.life-opp) .life-label');
  // 名前未設定(「ゲスト」やサーバー既定の P1/P2)は名前として出さず「相手/自分」のまま(ゲスト同士で同じ表示になるのを防ぐ)
  var isDefault = function(n){ return !n || /^(ゲスト|ゲスト\(ゲスト\)|P[12]|名無し)$/.test(n); };
  var on = (seat >= 0 && !isDefault(_playerNames[1 - seat]) && _playerNames[1 - seat]) || '相手';
  var mn = (seat >= 0 && !isDefault(_playerNames[seat]) && _playerNames[seat]) || '自分';
  // 長い名前はCSSで「…」に切る(LPの数字は縮めない)。タップで全文
  if (opp) { opp.textContent = on; opp.title = on; opp.onclick = function(){ if (typeof showToast === 'function') showToast('相手: ' + on); }; }
  if (me) { me.textContent = mn; me.title = mn; me.onclick = function(){ if (typeof showToast === 'function') showToast('自分: ' + mn); }; }
}
socket.on('joined', ({ roomId, seat, names, isEndless }) => {
  _setQuickMatchUI(false);
  _matchOver = false;
  mySeat = seat;
  _isEndless = !!isEndless;
  _playerNames = Array.isArray(names) ? names.slice(0, 2) : [null, null];
  _waitSeat = -1;
  applyPlayerNames();
  document.getElementById('lobbyStatus').textContent = 'ルーム ' + roomId + ' に参加 (Seat ' + (seat + 1) + ')';
});

socket.on('opponentJoined', ({ name }) => {
  document.getElementById('lobbyStatus').textContent = name + ' が参加。ゲーム開始...';
  var s = mySeat >= 0 ? mySeat : (_waitSeat >= 0 ? _waitSeat : 0);
  _playerNames[1 - s] = name;
  applyPlayerNames();
});

socket.on('error', ({ msg }) => {
  document.getElementById('lobbyStatus').textContent = 'エラー: ' + msg;
});

socket.on('opponentLeft', () => {
  showModal('<h3>相手が切断しました</h3><button onclick="location.reload()">ロビーに戻る</button>');
});

// ==== ターン画面 ====
socket.on('turnScreen', ({ currentPlayer, turn, isYourTurn }) => {
  if (turn === 1) _assignNyanko(); // 試合開始でにゃんこ割り当て(試合中固定)
  console.log('[CLIENT] turnScreen received: turn=' + turn + ' isYourTurn=' + isYourTurn);
  showScreen('gameScreen');
  applyPlayerNames();
  let banner = document.getElementById('turnBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'turnBanner';
    document.body.appendChild(banner);
  }
  banner.innerHTML = '<img class="turn-banner-img" src="img/board_f/' + (isYourTurn ? 'turn_my.png' : 'turn_opp.png') + '" alt="' + (isYourTurn ? '自分のターン' : '相手のターン') + '"><div class="turn-banner-turn">Turn ' + turn + '</div>';
  banner.classList.remove('turn-banner-fade');
  banner.style.display = '';
  setTimeout(() => { banner.classList.add('turn-banner-fade'); }, 1200);
  setTimeout(() => { banner.style.display = 'none'; }, 1700);
  if (isYourTurn) {
    setTimeout(() => { socket.emit('action', { type: 'startTurn' }); }, 800);
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
  _checkTimerFreeze();
  if (window._waitingModal && !state.hasPendingPrompt) { closeModal(); window._waitingModal = false; }
  // 何かの表示がプロンプトのモーダルを消してしまった場合の自己回復（進行不能の保険）
  if (state.hasPendingPrompt && !window._waitingModal && !document.getElementById('modal').classList.contains('active')) {
    if (!window._promptResendAt || Date.now() - window._promptResendAt > 2000) {
      window._promptResendAt = Date.now();
      setTimeout(function() {
        if (!document.getElementById('modal').classList.contains('active')) socket.emit('action', { type: 'resendPrompt' });
      }, 800);
    }
  }
  if (isTutorial) { tutorialCheck(); tutorialStateCheck(); if (tutorialStep >= 9 && tutorialStep < 10 && state.isMyTurn && state.phase === 'main2') tutorialCombatResult(); if (tutorialStep === 11) tutorialBlockResult(); render(); }
});

// ==== ターンタイマー ====
var _turnTimerInterval = null;
var _turnTimerEnd = 0;
var _turnTimerFrozen = null;
socket.on('turnTimer', ({ remaining, total }) => {
  if (_turnTimerInterval) { clearInterval(_turnTimerInterval); _turnTimerInterval = null; }
  _turnTimerFrozen = null;
  let el = document.getElementById('turnTimerDisplay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'turnTimerDisplay';
    el.style.cssText = 'position:fixed;right:8px;bottom:160px;background:rgba(0,0,0,0.8);color:#f0e6d0;padding:4px 10px;border-radius:6px;font-size:13px;font-weight:bold;border:1px solid #8a7d5a;z-index:101;';
    document.body.appendChild(el);
  }
  // スマホでは自分のLPボックスの中に置く(固定座標だとLPボックスと重なる端末がある)。PC/横向きは従来の固定表示
  (function placeTimer() {
    var box = document.querySelector('#gameScreen .top-bar .life-box:not(.life-opp)');
    var mobile = document.body.classList.contains('is-mobile');
    // LPの行の右端に並べる(3行にすると箱が上に伸びて手札に被る端末があるため、2行のまま)
    var row = box && box.querySelector('.life-row');
    if (mobile && row) { if (el.parentNode !== row) row.appendChild(el); el.classList.add('in-lifebox'); }
    else if (!mobile && el.parentNode !== document.body) { document.body.appendChild(el); el.classList.remove('in-lifebox'); }
  })();
  if (remaining <= 0) { el.style.display = 'none'; return; }
  el.style.display = '';
  _turnTimerEnd = Date.now() + remaining * 1000;
  function tick() {
    if (_turnTimerFrozen !== null) return;
    let left = Math.max(0, Math.ceil((_turnTimerEnd - Date.now()) / 1000));
    el.textContent = '⏱ ' + left + 's';
    el.style.color = left <= 10 ? '#ff4444' : '#f0e6d0';
    if (left <= 0) { clearInterval(_turnTimerInterval); _turnTimerInterval = null; el.style.display = 'none'; }
  }
  tick();
  _turnTimerInterval = setInterval(tick, 1000);
});
function _checkTimerFreeze() {
  if (!myState) return;
  var inChain = myState.chainDepth > 0 || myState.effectStack.length > 0 || myState.hasPendingPrompt;
  var el = document.getElementById('turnTimerDisplay');
  if (inChain && _turnTimerFrozen === null) {
    _turnTimerFrozen = Math.max(0, Math.ceil((_turnTimerEnd - Date.now()) / 1000));
    if (el) el.textContent = '⏱ ' + _turnTimerFrozen + 's';
  } else if (!inChain && _turnTimerFrozen !== null) {
    _turnTimerFrozen = null;
  }
}

// ==== ログ ====
socket.on('log', (msg) => {
  document.getElementById('log').innerHTML = '<div class="entry">' + msg + '</div>' + document.getElementById('log').innerHTML;
});

// ==== トースト ====
socket.on('toast', ({ msg, type, cardId, isActivated }) => {
  let t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), 5000);
  if (cardId && isActivated) {
    enqueueAnimations([{ type: 'effect', text: msg, cardId: cardId, isActivated: true }]);
  } else if (cardId && (type === 'summon' || type === 'effect' || type === 'info' || type === 'destroy')) {
    if (_chainCutinCardId === cardId) { _chainCutinCardId = null; }
    else { enqueueAnimations([{ type: 'cutin', text: msg, cardId: cardId, voiceType: type }]); }
  } else if (type === 'destroy') {
    enqueueAnimations([{ type: 'destroy', text: msg }]);
  }
});

// ==== チェーン宣言 ====
socket.on('chainDeclare', ({ isMe, cardId }) => {
  enqueueAnimations([{ type: 'chain', text: (isMe ? '' : '相手の') + 'チェーン宣言！', cardId: cardId || null }]);
  if (cardId) _chainCutinCardId = cardId;
});
var _chainCutinCardId = null;

// ==== LP変動 ====
socket.on('lifeChange', ({ player, amount, newLife, source, isMe }) => {
  var el = document.getElementById(isMe ? 'myLife' : 'oppLife');
  if (el) el.textContent = 'LP:' + newLife;
  if (source === '戦闘ダメージ') {
    enqueueAnimations([{ type: 'destroy', text: (source ? source + ': ' : '') + 'LP ' + amount }]);
  }
});

// ==== ボイス ====

// ==== デッキトップ確認 ====
socket.on('peekTop', function(data) {
  alert('デッキトップ: ' + data.name + ' (コスト:' + data.cost + ')');
});

// ==== 相手の手札確認 ====
// 手札覗きは #modal を使わない独立パネルに出す。
// #modal を共用すると、遅延表示がブロック選択/チェーン応答のモーダルを上書きして
// 回答不能(進行不能)になるため（アサキを相手の攻撃中に発動した時の報告）。
function showPeekPanel(html) {
  var p = document.getElementById('peekPanel');
  if (!p) {
    p = document.createElement('div');
    p.id = 'peekPanel';
    p.style.cssText = 'position:fixed;left:50%;top:14%;transform:translateX(-50%);z-index:9000;max-width:92vw;background:#1a1a2e;color:#d0c8b0;border:2px solid #c0a860;border-radius:12px;padding:14px 16px;box-shadow:0 8px 24px rgba(0,0,0,0.5);max-height:80vh;overflow-y:auto;';
    document.body.appendChild(p);
  }
  p.innerHTML = html;
  enrichModalTips(p);
  p.style.display = 'block';
}
function closePeekPanel() { var p = document.getElementById('peekPanel'); if (p) p.style.display = 'none'; }
socket.on('peekHand', function(data) {
  var peekHTML = '<h3 style="margin:0 0 8px;">相手の手札</h3><div class="modal-cards">';
  data.cards.forEach(function(c) {
    peekHTML += '<div class="modal-card"><b>' + c + '</b></div>';
  });
  peekHTML += '</div><button onclick="closePeekPanel()">閉じる</button>';
  setTimeout(function() { showPeekPanel(peekHTML); }, 2500);
});

// ==== プロンプト ====
var _matchOver = false;
socket.on('prompt', ({ type, data }) => {
  if (_matchOver) return; // 勝敗確定後のプロンプトで勝敗モーダルを消さない(保険)
  window._waitingModal = false;
  closeModal();
  if (isTutorial) tutorialPromptCheck(type, data);
  handlePrompt(type, data);
});

// ==== アニメーションキュー ====
var _animQueue = [];
var _animPlaying = false;

function enqueueAnimations(items, onComplete) {
  _animQueue.push({ items: items.slice(), onComplete: onComplete });
  if (!_animPlaying) _playNextGroup();
}

function _playNextGroup() {
  if (_animQueue.length === 0) { _animPlaying = false; return; }
  _animPlaying = true;
  var group = _animQueue.shift();
  _playSequence(group.items, 0, function() {
    if (group.onComplete) group.onComplete();
    _playNextGroup();
  });
}

function _playSequence(items, idx, onDone) {
  if (idx >= items.length) { onDone(); return; }
  var item = items[idx];
  _showAnimEntry(item, function() {
    _playSequence(items, idx + 1, onDone);
  });
}

var SILHOUETTE_SVG = '<svg viewBox="0 0 64 96"><circle cx="32" cy="20" r="14"/><ellipse cx="32" cy="68" rx="24" ry="28"/></svg>';

function _showCombatAnim(data, onDone) {
  var overlay = document.getElementById('animOverlay');
  var box = document.getElementById('animBox');
  if (!overlay || !box) { onDone(); return; }
  var d = data.data || data;
  var flipped = !d.isMyAttack;
  var atkImg = d.attackerArt ? '<img src="' + d.attackerArt + '" style="width:100%;height:100%;object-fit:cover;' + (d.attackerArtStyle || '') + '">' : '<div style="width:100%;height:100%;background:#4a4a8a;display:flex;align-items:center;justify-content:center;font-size:20px;">' + (d.attacker || '?').charAt(0) + '</div>';
  var defImg;
  if (data.type === 'combat_direct') {
    if (!_nyankoMe) _assignNyanko(); // 未割り当てなら保険
    // 殴られる側のにゃんこ: 自分の攻撃なら相手、相手の攻撃なら自分
    var _np = d.isMyAttack ? _nyankoOpp : _nyankoMe;
    defImg = '<img src="img/nyanko/p' + _np + '.png" style="width:100%;height:100%;object-fit:cover;">';
  } else {
    defImg = d.blockerArt ? '<img src="' + d.blockerArt + '" style="width:100%;height:100%;object-fit:cover;' + (d.blockerArtStyle || '') + '">' : '<div style="width:100%;height:100%;background:#4a6741;display:flex;align-items:center;justify-content:center;font-size:20px;">' + (d.blocker || '?').charAt(0) + '</div>';
  }
  var defLabel = data.type === 'combat_direct' ? (d.isMyAttack ? '相手運営者' : '運営者') : (d.blocker || '');
  var resultText = data.type === 'combat_direct' ? d.damage + ' ダメージ' : d.attacker + '(' + d.atkP + ') vs ' + d.blocker + '(' + d.blkP + ')';

  var atkCard = '<div class="combat-card ' + (flipped ? 'combat-right' : 'combat-left') + '"><div class="combat-card-img">' + atkImg + '</div><div class="combat-card-name">' + (d.attacker || '') + '</div></div>';
  var defCard = '<div class="combat-card ' + (flipped ? 'combat-left' : 'combat-right') + '"><div class="combat-card-img">' + defImg + '</div><div class="combat-card-name' + (data.type === 'combat_direct' ? ' combat-player-label' : '') + '">' + defLabel + '</div></div>';

  box.innerHTML = '<div class="combat-stage">' + atkCard + defCard + '<div class="combat-result-text">' + resultText + '</div></div>';
  overlay.classList.add('active');

  var atkEl = box.querySelector(flipped ? '.combat-right' : '.combat-left');
  var defEl = box.querySelector(flipped ? '.combat-left' : '.combat-right');
  setTimeout(function() {
    atkEl.classList.add(flipped ? 'anim-slam-left' : 'anim-slam-right');
    defEl.classList.add('anim-shake');
    box.querySelector('.combat-result-text').classList.add('anim-result-show');
  }, 200);

  setTimeout(function() {
    overlay.style.transition = 'opacity 0.4s';
    overlay.style.opacity = '0';
    setTimeout(function() {
      overlay.classList.remove('active');
      overlay.style.transition = '';
      overlay.style.opacity = '';
      onDone();
    }, 400);
  }, 1800);
}

function _showAnimEntry(item, onDone) {
  var overlay = document.getElementById('animOverlay');
  var box = document.getElementById('animBox');
  if (!overlay || !box) { onDone(); return; }
  var data = (typeof item === 'string') ? { type: 'default', text: item } : item;
  if (data.type === 'combat' || data.type === 'combat_direct') {
    _showCombatAnim(data, onDone);
    return;
  }
  if (data.type === 'cutin' && data.cardId) {
    var abilityVoice = data.voiceType === 'effect' && abilityVoiceFor(data);
    playVoice(data.cardId, abilityVoice || null);
    _showCutinAnim(data.cardId, data.text, onDone);
    return;
  }
  if (data.type === 'chain' && data.cardId) {
    playVoice(data.cardId);
    var done1 = false, done2 = false;
    var bothDone = function() { if (done1 && done2) onDone(); };
    overlay.classList.add('active');
    box.innerHTML = '<div class="anim-entry anim-chain">' + (data.text || '') + '</div>';
    var entry = box.firstChild;
    requestAnimationFrame(function() { requestAnimationFrame(function() { entry.classList.add('anim-in'); }); });
    setTimeout(function() {
      if (entry) entry.classList.add('anim-out');
      setTimeout(function() { overlay.classList.remove('active'); done1 = true; bothDone(); }, 300);
    }, 1200);
    _showCutinAnim(data.cardId, data.text, function() { done2 = true; bothDone(); });
    return;
  }
  if (data.isActivated && data.cardId) {
    var abilityVoice = abilityVoiceFor(data);
    playVoice(data.cardId, abilityVoice || null);
    var c = CARD_DB ? CARD_DB.find(function(x) { return x.id === data.cardId; }) : null;
    var bgHtml = '';
    if (c && c.art) {
      bgHtml = '<div class="anim-cutin-bg"><img src="' + c.art + '" style="' + (c.artStyle || '') + '"></div>';
    }
    var cssClass = 'anim-entry anim-with-cutin';
    if (data.type === 'cancel') cssClass += ' anim-destroy';
    else if (data.sub && data.sub.some(function(s) { return s.type === 'damage' || s.type === 'destroy'; })) cssClass += ' anim-destroy';
    else if (data.sub && data.sub.some(function(s) { return s.type === 'heal'; })) cssClass += ' anim-heal';
    overlay.classList.add('active');
    box.innerHTML = '<div class="' + cssClass + '">' + bgHtml + '<span class="anim-cutin-text">' + (data.text || '') + '</span></div>';
    var entry = box.firstChild;
    requestAnimationFrame(function() { requestAnimationFrame(function() { entry.classList.add('anim-in'); }); });
    setTimeout(function() {
      if (entry) entry.classList.add('anim-out');
      setTimeout(function() { overlay.classList.remove('active'); onDone(); }, 300);
    }, 1800);
    return;
  }
  var cssClass = 'anim-entry';
  if (data.type === 'chain') cssClass = 'anim-entry anim-chain';
  else if (data.type === 'cancel') cssClass = 'anim-entry anim-destroy';
  else if (data.sub && data.sub.some(function(s) { return s.type === 'damage' || s.type === 'destroy'; })) cssClass = 'anim-entry anim-destroy';
  else if (data.sub && data.sub.some(function(s) { return s.type === 'heal'; })) cssClass = 'anim-entry anim-heal';
  overlay.classList.add('active');
  box.innerHTML = '<div class="' + cssClass + '">' + (data.text || '') + '</div>';
  var entry = box.firstChild;
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      entry.classList.add('anim-in');
    });
  });
  setTimeout(function() {
    if (entry) entry.classList.add('anim-out');
    setTimeout(function() {
      overlay.classList.remove('active');
      onDone();
    }, 300);
  }, 1200);
}

// ==== 解決結果 ====
socket.on('resolveResults', ({ results }) => {
  console.log('[CLIENT] resolveResults received:', JSON.stringify(results));
  if (!results || results.length === 0) {
    socket.emit('action', { type: 'ackResolve' });
    return;
  }
  var items = results.map(function(r) {
    if (r.type === 'combat') {
      return { type: 'combat', text: r.attacker + '(' + r.atkP + ') vs ' + r.blocker + '(' + r.blkP + ')', cardId: r.attackerId, data: r };
    }
    if (r.type === 'combat_direct') {
      return { type: 'combat_direct', text: r.attacker + ' → ' + r.damage + ' ダメージ', cardId: r.attackerId, data: r };
    }
    if (r.type === 'cancel') {
      return { type: 'cancel', text: '【打ち消し】' + r.desc, cardId: r.cardId };
    }
    // effect type
    return { type: 'effect', text: r.desc, cardId: r.cardId, sub: r.sub, isSummon: r.isSummon || false, isActivated: r.isActivated || false, abilityId: r.abilityId || null };
  });
  var tutCancel = isTutorial && tutorialStep === 4 && results.some(function(r) { return r.type === 'cancel'; });
  enqueueAnimations(items, function() {
    socket.emit('action', { type: 'ackResolve' });
    if (tutCancel) tutorialCancelResolved();
  });
});

// ==== ゲームオーバー ====
// 勝敗の理由(サーバーから reason が来る): 降参/放置/無回答は結果画面に一言出す(「勝てる状況なのに負けた」がバグか降参か分かるように)
var END_REASON_TEXT = {
  surrender: ['相手が降参しました', 'あなたが降参しました'],
  afk: ['相手が時間切れ（操作なし）が続いたため、あなたの勝ちです', '時間切れ（操作なし）が続いたため敗北しました'],
  prompt_timeout: ['相手が選択に応答しなかったため、あなたの勝ちです', '選択に応答しなかったため敗北しました'],
};
socket.on('gameOver', ({ youWin, endlessStage, reason }) => {
  _matchOver = true;
  if (isTutorial) { _tourClearSpot(); hideGuide(); } // チュートリアル中に降参した時、ツアーの枠や案内が結果画面に残らないように
  var img = youWin ? 'img/win.png' : 'img/lose.png';
  var bg = youWin ? '#ffe9c4' : '#ffffff';
  var h = '<div style="text-align:center;">'
    + '<img src="' + img + '" style="width:100%;max-width:460px;display:block;margin:0 auto 6px;border-radius:12px;background:' + bg + ';">';
  var rt = reason && END_REASON_TEXT[reason]; if (rt) h += '<div style="font-size:14px;color:#c0a860;margin:0 0 8px;">' + rt[youWin ? 0 : 1] + '</div>';
  if (endlessStage !== undefined) {
    h += '<div style="font-size:18px;color:#c0a860;margin-bottom:8px;">WAVE ' + (endlessStage + 1) + ' で敗北 / 到達ステージ: ' + (endlessStage + 1) + '</div>';
  }
  h += '<button onclick="returnToLobbyAfterMatch()">ロビーに戻る</button></div>';
  showModal(h);
});

// クエスト報酬(カードの使用権の解除)。サーバーが保存を済ませてから届くので、結果画面の後に来る
socket.on('questReward', function(d) {
  var msg = '';
  if (d && d.ok && d.cards && d.cards.length > 0) {
    msg = '<b>🎁 新カードが使えるようになりました！</b><br>' + (d.names || d.cards).join(' / ') + '<br><span style="font-size:11px;">デッキ編集の「クエスト報酬」から入れられます' + (d.guest ? '。ゲストのため、この端末のゲストにだけ保存されています' : '') + '</span>';
    if (!_unlocked) _unlocked = { cards: [], all: false };
    (d.all || d.cards).forEach(function(id) { if (_unlocked.cards.indexOf(id) < 0) _unlocked.cards.push(id); });
  } else if (d && d.ok) {
    // 既に解除済み(再クリア)。表示は出さないが、手元の解除状態は合わせておく(最初の読み込みに失敗していた場合に備える)
    if (!_unlocked) _unlocked = { cards: [], all: false };
    (d.all || []).forEach(function(id) { if (_unlocked.cards.indexOf(id) < 0) _unlocked.cards.push(id); });
    return;
  } else if (d && (d.reason === 'noid' || d.reason === 'nodevice')) {
    msg = '報酬を保存できませんでした（プレイヤー情報がありません）。アプリを開き直して、もう一度クリアしてください';
  } else {
    msg = '報酬の保存に失敗しました。通信の良い場所で、もう一度クリアすると受け取れます';
  }
  var box = '<div style="margin:8px auto;padding:10px 12px;max-width:440px;border:2px solid #e0b040;border-radius:10px;background:#fff8e0;color:#5a4410;font-size:13px;line-height:1.6;text-align:center;">' + msg + '</div>';
  var mcEl = document.getElementById('modalContent');
  var modalEl = document.getElementById('modal');
  var btn = mcEl && mcEl.querySelector('button');
  if (modalEl && modalEl.classList.contains('active') && btn) { btn.insertAdjacentHTML('beforebegin', box); }
  else { showModal(box + '<div style="text-align:center;"><button onclick="closeModal()">OK</button></div>'); }
});

// 勝敗後のロビー復帰。アプリ版は全画面広告を挟む(Web版はwindow.Adsが無いので素通り)
function returnToLobbyAfterMatch() {
  if (window.Ads && window.Ads.maybeShowMatchEndAd) {
    window.Ads.maybeShowMatchEndAd(function () { location.reload(); });
  } else {
    location.reload();
  }
}

socket.on('bossRushNext', ({ stage, life }) => {
  var label = _isEndless ? 'WAVE' : 'ROUND';
  showModal('<h3 style="color:#ff6644;">' + label + ' ' + (stage + 1) + '</h3><div style="color:#aaa;margin-bottom:12px;">残りLP: ' + life + '</div><div style="color:#888;">次のボスが現れる...</div>');
  setTimeout(function() { closeModal(); }, 2500);
});

// ==== 画面切替 ====
var _bgmStarted = false;
var _bgm = null;
var _bgmPinch = false;
var BGM_TRACKS = ['bgm/Planetoid.mp3', 'bgm/speedy.mp3', 'bgm/バレンタインアタック！.mp3'];
var BGM_PINCH = 'bgm/Kurba.mp3';
function startBGM() {
  if (_bgmStarted) return;
  _bgmStarted = true;
  var track = BGM_TRACKS[Math.floor(Math.random() * BGM_TRACKS.length)];
  _playBGMTrack(track);
}
function _playBGMTrack(track) {
  if (_bgm) { _bgm.pause(); _bgm = null; }
  var ctx = _getAudioCtx();
  _bgm = new Audio(track);
  _bgm.loop = true;
  var src = ctx.createMediaElementSource(_bgm);
  _bgmGain = ctx.createGain();
  _bgmGain.gain.value = 0.015;
  src.connect(_bgmGain);
  _bgmGain.connect(ctx.destination);
  _bgm.play().catch(function() {});
}
function checkPinchBGM(life) {
  if (life <= 500 && !_bgmPinch && _bgmStarted) {
    _bgmPinch = true;
    _playBGMTrack(BGM_PINCH);
  } else if (life > 500 && _bgmPinch && _bgmStarted) {
    _bgmPinch = false;
    var track = BGM_TRACKS[Math.floor(Math.random() * BGM_TRACKS.length)];
    _playBGMTrack(track);
  }
}
function stopBGM() {
  if (_bgm) { _bgm.pause(); _bgm = null; }
  _bgmGain = null;
  _bgmStarted = false;
}
function showScreen(id) {
  ['lobbyScreen', 'turnScreen', 'gameScreen'].forEach(s => {
    document.getElementById(s).classList.toggle('active', s === id);
  });
  if (id === 'gameScreen') startBGM();
  if (id === 'lobbyScreen') stopBGM();
}

// ==== モーダル ====
var _autoCloseTimer = null;
function showModal(h, mode) {
  if (_autoCloseTimer) { clearTimeout(_autoCloseTimer); _autoCloseTimer = null; }
  hidePopup();
  var mc = document.getElementById('modalContent');
  mc.removeAttribute('data-mode');
  if (mode) mc.setAttribute('data-mode', mode);
  document.getElementById('modal').classList.add('active');
  mc.innerHTML = h;
  enrichModalTips(mc);
  guideModalOpen();
}

// モーダル内のカード名を自動検出して効果ツールチップ(PC=ホバー/スマホ=ⓘ)を付与
var _cardIdByName = null;
function enrichModalTips(root) {
  try {
    if (!_cardIdByName) {
      _cardIdByName = {};
      DECK_CARDS.forEach(function(c) { _cardIdByName[c.name] = c.id; });
    }
    root.querySelectorAll('.modal-card:not(.has-tip)').forEach(function(el) {
      var b = el.querySelector('b');
      if (!b) return;
      var nm = (b.textContent || '').replace(/^\[(相手|自分)\]\s*/, '').trim();
      var id = _cardIdByName[nm];
      if (!id) return;
      el.classList.add('has-tip');
      el.dataset.cid = id;
      var i = document.createElement('span');
      i.className = 'tip-i';
      i.textContent = 'i';
      i.addEventListener('click', function(ev) { ev.stopPropagation(); stackTip(ev, id); });
      el.appendChild(i);
    });
  } catch (e) {}
}
function closeModal() {
  document.getElementById('modal').classList.remove('active');
  guideModalClose();
}

// ==== カード描画 ====
var _cardRegistry = [];
function buildCardHTML(c, zone, idx, isOpp, oc, fieldNum) {
  var regIdx = _cardRegistry.length;
  _cardRegistry.push(c);
  let cls = 'mini-card';
  var isKiyaku = c.subtype && c.subtype.includes('規約');
  var isCreator = c.subtype && c.subtype.includes('クリエイター');
  if (c.type === 'creature') cls += ' type-creature';
  if (c.type === 'support' && !isKiyaku && !isCreator) cls += ' type-support';
  if (c.type === 'enchantment') cls += ' type-enchant';
  if (c.subtype && c.subtype.includes('悪')) cls += ' type-evil';
  if (isKiyaku) cls += ' type-kiyaku';
  if (isCreator) cls += ' type-creator';
  if (c.hero) cls += ' type-hero';
  if (c.heroine) cls += ' type-heroine';
  if (c.tapped && zone === 'field') cls += ' tapped';
  if (zone === 'mana') cls += ' mana-card' + (c.manaTapped ? ' mana-tapped' : '');

  // カウンター(場にいる間だけ残る永続強化)。合計を金色のバッジで出す
  let counterBadge = '';
  if (zone === 'field' && c.counters && c.counters.length > 0) {
    var _cp = 0, _ct = 0; c.counters.forEach(function(k) { _cp += (k.power || 0); _ct += (k.toughness || 0); });
    var _cn = 'カウンター ' + (_cp >= 0 ? '+' : '') + _cp + ' / ' + (_ct >= 0 ? '+' : '') + _ct + '（場にいる間）';
    counterBadge = '<span class="enchant-badge ench-counter" title="' + _cn + '" data-name="' + _cn + '">＋</span>';
  }
  let enchStr = '';
  if (counterBadge && !(c.enchantments && c.enchantments.length > 0)) enchStr = '<div class="mc-enchants">' + counterBadge + '</div>';
  if (c.enchantments && c.enchantments.length > 0) {
    var _enchNames = {parasite:'魔の寄生体',ki_no_sei:'木の精',alminium:'頭にアルミホイルを巻く',healthy_sleep:'夜しか眠れない健康的な生活',smasher:'戦術兵器スマッシャー',rena:'地縛霊 レナ'};
    var _enchIcon = {parasite:'寄',ki_no_sei:'木',alminium:'銀',healthy_sleep:'健',smasher:'剣',rena:'霊'};
    enchStr = '<div class="mc-enchants">' + c.enchantments.map(function(e){
      var n = _enchNames[e.id] || e.id;
      var ic = _enchIcon[e.id] || e.id.substr(0,1);
      return '<span class="enchant-badge ench-' + e.id + '" title="' + n + '" data-name="' + n + '">' + ic + '</span>';
    }).join('') + counterBadge + '</div>';
  }
  // art/artStyle support
  let artHTML = '';
  if (c.art) {

    artHTML = '<div class="mc-art" style="position:relative;width:100%;overflow:hidden;border-radius:4px;margin:2px 0;"><img src="' + c.art + '" style="width:100%;height:100%;object-fit:cover;' + (c.artStyle || '') + '"></div>';
  }

  let h = '<div class="' + cls + '" ' + (oc || '') + ' ' + (zone !== 'mana' ? 'onmouseenter="_popupShow(event,' + regIdx + ')" onmouseleave="hidePopup()" ontouchstart="_popupTouch(event,' + regIdx + ')"' : '') + '>';
  h += '<div class="mc-name">' + (zone === 'mana' ? '視聴者' : c.name) + (fieldNum ? '<span style="color:#c0a860;font-size:8px;margin-left:2px;">#' + fieldNum + '</span>' : '') + '</div>';
  if (zone !== 'mana') h += '<div class="mc-cost">' + c.cost + '</div>';
  if (zone !== 'mana') {
    if (artHTML) {
      h += artHTML;
      h += enchStr;
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
    if (zone === 'field' && c.damage > 0) ptInner += '<br><span style="color:#ff4040;">DMG' + dv(c.damage) + '</span>';
    h += '<div class="mc-pt"' + (changed ? ' style="color:#e8c060;"' : '') + '>' + ptInner + '</div>';
  }
  h += '</div>';
  return h;
}

function renderCard(c, zone, idx, isOpp, fieldNum) {
  let oc = '';
  if (zone === 'hand' && !isOpp) oc = 'onclick="handleHandClick(' + idx + ')"';
  if (zone === 'field' && !isOpp) oc = 'onclick="handleFieldClick(' + idx + ')"';
  return buildCardHTML(c, zone, idx, isOpp, oc, fieldNum);
}

var CARD_FULL_TEXT = {
  'zeratine': '<span class="cost-inline">【分裂】応援3＋タップ：</span>このカードを生贄に捧げる。残りHP÷100体の「ゼラチネ子供」(100/100)を出す(最大10体)。<br><span class="cost-inline">【捕食】タップ：</span>自分の他のキャラ1体を生贄に捧げる。その<span class="keyword">元の</span>攻撃・HP分、このカードを強化する(場にいる間)。<br><br><span class="card-flavor">「私はスライムだぞ？」</span>',
  'lead': '<span class="cost-inline">【応援3】+T：</span>山札からキャラクターカードをランダムに1枚、手札に加える。<br><br><span class="card-flavor">「はいどうぞ。サンドイッチだ」</span>',
  'daisuke_dare': '<span class="keyword">割り込み</span><br>場にいる全ての主人公(お互い)を、「ダイスケ」トークン(攻撃100/HP100)に変える。攻撃・ブロック中ならそのまま続く。',
  'seitokaichou': '<span class="keyword">油断しない</span>（攻撃してもタップしない）<br>登場時、カードを1枚ドローする。<br><br><span class="card-flavor">「規律は守ってもらいます」</span>',
  'osananajimi': '登場時、デッキから主人公カードを1枚サーチして手札に加える。<br><br><span class="card-flavor">「昔から、ずっと一緒だったでしょ」</span>',
  'kanaria': '【応援3】+T: デッキの一番上のカードを1枚、あなたの視聴者に加える。<br><br><span class="card-flavor">「アイドル辞めて烏丸さんと結婚しますっ！」</span>',
  'onna_joushi': '<span class="keyword">油断しない</span>（攻撃してもタップしない）<br>登場時、自分のデッキの一番上を確認する。その後、デッキをシャッフルしてもよい。<br><br><span class="card-flavor">「仕事の後、少し付き合いなさい」</span>',
  'imouto': '<span class="keyword">俊足</span>（出たターンから攻撃可能）<br><br><span class="card-flavor">「兄やん、来たよーーー！！」</span>',
  'ki_no_sei': 'エンチャントされた投稿キャラはブロック時、戦闘ダメージを受けない。<br><br><span class="card-flavor">「気のせい　木の精　ウッドエレメンタル」</span>',
  'mensetsu_kan': '登場時、相手の場の<span class="keyword">主人公</span>カードを1体選んで破壊する。<br><br><span class="card-flavor">「私をフった理由を答えなさい」</span>',
  'dansou': '<span class="cost-inline">【応援3】：</span>ターン終了時まで、このカードの攻撃を<span class="keyword">+200</span>する。<br><br><span class="card-flavor">「まぁ僕は女だけどね？」</span>',
  'jk_a': '<span class="cost-inline">【応援3】：</span>攻撃100 HP100の女子高生トークンを1体生成する。<br><br><span class="card-flavor">「ねー、あの子も呼んでいいー？」</span>',
  'mamachari': '<span class="keyword">俊足</span>（出たターンから攻撃可能）<br><br><span class="card-flavor">「ちゃりんちゃりん！！」</span>',
  'kyamakiri': '攻撃時、ターン終了時まで攻撃を<span class="keyword">+200</span>する。<br><br><span class="card-flavor">「キャマキリィィィ！」</span>',
  'shiko_touchou': '相手の手札を全て確認する。<br><br><span class="card-flavor">「頭にアルミホイル巻かなきゃ！」</span>',
  'kanwa_kyuudai': '<span class="keyword">割り込み</span><br>全ての投稿キャラをタップする。<br><br><span class="card-flavor">「――閑話休題」</span>',
  '99wari': 'LP900を支払う。相手の全ての投稿キャラを破壊し、相手の手札を全て捨てさせる。<br><br><span class="card-flavor">「9割の間違いじゃなくて…？」</span>',
  'alminium': 'エンチャントされた投稿キャラは効果の対象にならない。<br><br><span class="card-flavor">「これで電波は遮断できる……！」</span>',
  'healthy_sleep': 'エンチャントされた投稿キャラのHPを<span class="keyword">+300</span>する。<br><br><span class="card-flavor">「すごく健康的だ…」</span>',
  'suisosui': '登場時:自分と相手の場にいる全ての<span class="keyword">ヒロイン</span>カードを持ち主の手札に戻す。（エンチャントは破壊される）<br><br><span class="card-flavor">「水素水の美味しいお店行かない？」</span>',
  'maoria': '<span class="cost-inline">【応援4】：</span>ターン終了時まで<span class="keyword">飛行</span>を得る。<br><span class="cost-inline">【応援3】+T：</span>投稿キャラ1体に、このカードのATK+300点のダメージを与える。<br><br><span class="card-flavor">「退屈なんだよ、俺はさ」</span>',
  'tomo': '<span class="keyword">油断しない</span>（攻撃してもタップしない）<br><span class="keyword">俊足</span>（出たターンから攻撃可能）<br><br><span class="card-flavor">「会いたかったよ、マオリア」</span>',
  'izuna': '<span class="keyword">飛行</span><br><span class="cost-inline">【応援2】+T：</span>対象の投稿キャラ1体に200点のダメージを与える。<br><br><span class="card-flavor">「これでもこの世界で最強の魔法使いと言われてるのよ！」</span>',
  'miiko': 'ミーコを除くあなたの投稿キャラが破壊されたとき、<span class="cost-inline">【応援2】</span>を支払うことでその投稿キャラを蘇生する。<br><br><span class="card-flavor">「もし死んでも蘇生しますから」</span>',
  'parasite': 'エンチャントされた投稿キャラの攻撃とHPを<span class="keyword">+200</span>する。<br>エンチャントされた投稿キャラに<span class="cost-inline">【応援1】：</span><span class="keyword">蘇生</span>を付与する。<br>あなたのターン開始時、攻撃100 HP100の魔物トークンを1体生成する。<br>あなたの場の魔物1体につき、ターン終了時に100点のライフを失う。<br>エンチャントされた投稿キャラが破壊されたとき、このカードをデッキに戻しシャッフルする。',
  'asaki': '<span class="keyword">油断しない</span>（攻撃してもタップしない）<br><span class="cost-inline">+T：</span>相手の手札を見る。<br><br><span class="card-flavor">「自由意志を持たない命は、死んでるも同じだ」</span>',
  'azusa': '<span class="cost-inline">【応援2】+T：</span>相手の手札からランダムに1枚捨てさせる。<br><br><span class="card-flavor">「掃除屋のわたしに目をつけられて、逃げられたやついないから」</span>',
  'kaera': '登場時、あなたのライフを200点回復する。<br><br><span class="card-flavor">「ありがとう、アサキ」</span>',
  'iron_chaser': '攻撃時、他の「悪」を持つ投稿キャラがあなたの場にいる場合、攻撃を<span class="keyword">+100</span>する。',
  'iron_boss': 'あなたの「悪」を持つ全ての投稿キャラの攻撃とHPを<span class="keyword">+100</span>する。',
  'shinigami': '<span class="cost-inline">+T + LP300：</span>投稿キャラ1体を破壊する。それは蘇生できない。<br><span class="cost-inline">+T + LP200：</span>相手の手札からランダムに1枚捨てさせる。<br><span class="cost-inline">+T + LP500：</span>相手の発動した効果を1つ打ち消す。<br><br><span class="card-flavor">「寿命と引き換えに、願いを叶えてあげます」</span>',
  'jun': '登場時、デッキから「死神少女」を1枚サーチして手札に加える。<br><br><span class="card-flavor">「不審者がいる・・・」</span>',
  'ark': '相手の全ての投稿キャラの攻撃とHPを<span class="keyword">-100</span>する。<br><br><span class="card-flavor">「どうして俺に剣を向けるんだ・・・？」</span>',
  'milia': 'ミリアを除く、あなたの全ての投稿キャラの攻撃とHPを<span class="keyword">+100</span>する。<br><br><span class="card-flavor">「死ぬまで戦い続けるんだからな？」</span>',
  'daria': '攻撃できない。<br>ブロック時、この投稿キャラは戦闘ダメージを受けない。<br><br><span class="card-flavor">「……寄るなよ」</span>',
  'reichen': '<span class="cost-inline">【応援1】：</span>味方の投稿キャラ1体の蓄積ダメージを0にする。<br><span class="cost-inline">【応援4】+T：</span>相手の投稿キャラ1体に<span class="keyword">500ダメージ</span>を与える。<br><br><span class="card-flavor">「私、箱入り娘。迷惑、かけるかも」</span>',
  'sagi': '<span class="keyword">俊足</span>, <span class="keyword">油断しない</span><br><span class="cost-inline">【応援3】+T+手札1枚：</span>相手の発動した効果を1つ打ち消す（自分の手札からランダムに1枚捨てる）。<br><span class="cost-inline">【応援4】：</span>自分のゴミ箱からカードを1枚選び、手札に加える。<br><br><span class="card-flavor">「だから、俺と一緒に逃げよう」</span>',
  'yuri': 'このカードの攻撃とHPは、このカードにつけられたエンチャントの数だけ<span class="keyword">+100</span>する。<br><br><span class="card-flavor">「ほら見てください。手首の関節を回転させられるんです」</span>',
  'smasher': 'エンチャントされた投稿キャラは<span class="keyword">俊足</span>を持ち、攻撃とHPを<span class="keyword">+100</span>する。<br>エンチャントされたカードが<span class="keyword">アンドロイド ユリ</span>の場合、代わりに<span class="keyword">俊足</span>と<span class="keyword">飛行</span>を持ち、攻撃とHPを<span class="keyword">+200</span>する。<br><br><span class="card-flavor">「私専用に作られた戦闘用外部ユニット――識別名はスマッシャー」</span>',
  'lucia': '<span class="cost-inline">【応援3】(1ターンに1度)：</span>ターン終了時まで攻撃とHPを<span class="keyword">+300</span>し、<span class="keyword">飛行</span>を得る。<br><span class="cost-inline">【応援5】+T：</span>自身を除くフィールド上の全ての投稿キャラに<span class="keyword">200ダメージ</span>を与える。<br><br><span class="card-flavor">「なあ、アルス。こいつ食べていい？」</span>',
  'rena': 'エンチャントされた投稿キャラは<span class="keyword">飛行</span>を持ち、<span class="cost-inline">【応援3】：</span><span class="keyword">蘇生</span>を持つ。',
  'salvado_cat': 'このカードは打ち消されない。<br>デッキからクリエイターカードを3枚選び、ランダムで1枚をゴミ箱に捨て、残り2枚を手札に加える。',
  'makkinii': '<span class="keyword">割り込み</span><br>手札からクリエイターカードを2枚捨てることでコストを支払わずに発動できる。<br>あなたの全ての投稿キャラの攻撃とHPをターン終了時まで<span class="keyword">+300</span>する。',
  'akapo': '<span class="keyword">割り込み</span><br>味方の投稿キャラ1体を選択し、ターン終了時まで攻撃を<span class="keyword">+500</span>する。',
  'nanase': '手札が4枚になるようにカードをドローする。すでに4枚以上の場合はドローしない。',
  'gomo': 'デッキから<span class="keyword">ヒロイン</span>カードを2枚選び、手札に加える。',
  'komi': '<span class="keyword">割り込み</span><br>自分の全ての投稿キャラの蓄積ダメージを0にする。自分のLPを300回復する。<br><br><span class="card-flavor">「肉まん食べたい」</span>',
  'yashiro': 'LP500を支払い、カードを3枚ドローする。',
  'katorina': '攻撃200 HP200のVトークンを2体投稿する。<br><br><span class="card-flavor">「おつりーな、ごきげんよう！ばいばーい！」</span>',
  'sakamachi': 'デッキからイラストレーターのカードを3枚選択し、その内2枚を手札に加え、残り1枚をゴミ箱に捨てる。',
  'hikaru': 'カードを2枚ドローする。その後、あなたの全てのカードをタップする。',
  'oyuchi': 'カードを1枚ドローする。引いたカードがイラストレーターカードだった場合、さらに1枚ドローしてもよい。',
  'nari': 'デッキの上から5枚を確認し、好きなカードを1枚手札に加えてもよい。その後デッキをシャッフルする。',
  'ai_tsubame': 'カードを3枚ドローする。ドローしたカードを相手に公開し、相手が1枚選んでゴミ箱に捨てる。<br><br><span class="card-flavor">「ハッハッハッハッ　へっへっへっへっ　ワンッ！」</span>',
  'ichiko': '<span class="keyword">割り込み</span><br>以下から1つ選んでプレイする：<br>・相手のライフに300点のダメージ<br>・自分のライフを500点回復<br>・自分の全ての投稿キャラの攻撃をターン終了時まで<span class="keyword">+200</span>する<br>・相手の全ての投稿キャラの攻撃をターン終了時まで<span class="keyword">-100</span>する',
  'seishun_kiben': '<span class="keyword">割り込み</span><br>あなたの手札にある主人公またはヒロインカードを1枚、コストを支払わずにプレイしてもよい。',
  'salvado_cat_yarakashi': 'このカードは打ち消されない。<br>投稿キャラ1体を破壊する。それは蘇生できない。<br><br><span class="card-flavor">「あれ？消えちゃったにゃ」</span>',
  'douga_sakujo': '<span class="keyword">割り込み</span><br>発動された効果1つを打ち消す。<br><br><span class="card-flavor">「コミュニティガイドライン違反により削除されました」</span>',
  'shueki_teishi': '<span class="keyword">割り込み</span><br>相手をフォローしている全ての視聴者をタップする。<br><br><span class="card-flavor">「量産型のコンテンツです」</span>',
  'kikaku_botsu': 'フィールドの投稿キャラ1体を破壊する。<br><br><span class="card-flavor">「この企画、なしで」</span>',
  'channel_sakujo': '両運営者の視聴者以外の全てのカードを破壊し、手札を全て捨てる。その後、お互いにカードを7枚引き直す。<br><br><span class="card-flavor">「チャンネルが見つかりません」</span>',
  'douga_henshuu': '投稿キャラ1体を選択し、ターン終了時まで攻撃とHPを<span class="keyword">-300</span>する。<br><br><span class="card-flavor">「カットだらけで原型がない」</span>',
  'super_chat': '<span class="keyword">割り込み</span><br>投稿キャラ1体を選択し、ターン終了時まで攻撃とHPを<span class="keyword">+300</span>する。<br><br><span class="card-flavor">「赤スパきたーー！」</span>',
  'douga_fukugen': '<span class="keyword">割り込み</span><br>ゴミ箱から投稿キャラを1体選び、コストを支払わずに投稿する。',
  'impression_seigen': '<span class="keyword">割り込み</span><br>お互いの場にいる全ての投稿キャラの攻撃とHPをターン終了時まで<span class="keyword">-500</span>する。<br><br><span class="card-flavor">「そういえばしばらくおすすめ欄で見てないな…」</span>'
};

// カード名画像が無い(トークン等)場合はテキストにフォールバック
function cnFallback(im){ if(im&&im.parentNode){ im.parentNode.textContent = im.dataset.nm || ''; } }
function buildPopupHTML(c) {
  var h = _buildCardFrameHTML(c, { useEff: true });
  return h;
}

function showPopup(e, c) {
  let popup = document.getElementById('cardPopup');
  popup.innerHTML = buildPopupHTML(c);
  popup.classList.add('active');
  popup.style.transform = '';
  let x = e.clientX + 15;
  var vw = window.innerWidth;
  if (x + 290 > vw) x = vw - 295;
  if (x < 5) x = 5;
  popup.style.left = x + 'px';
  popup.style.top = '10px';
  var tb = popup.querySelector('.card-frame-textbox');
  if (tb) {
    var desc = tb.querySelector('.card-frame-desc');
    if (desc) {
      var sizes = [11, 10, 9, 8, 7];
      var lineHeights = [1.5, 1.45, 1.4, 1.35, 1.3];
      for (var i = 0; i < sizes.length; i++) {
        desc.style.fontSize = sizes[i] + 'px';
        desc.style.lineHeight = lineHeights[i];
        if (tb.scrollHeight <= tb.clientHeight) break;
      }
    }
  }
}

function hidePopup() {
  let popup = document.getElementById('cardPopup');
  popup.classList.remove('active');
}

function _popupShow(e, idx) { if (myState && myState.phase === 'attack' && myState.isMyTurn) return; if (_cardRegistry[idx]) showPopup(e, _cardRegistry[idx]); }
function _popupTouch(e, idx) {
  if (myState && myState.phase === 'attack' && myState.isMyTurn) return;
  if (_cardRegistry[idx]) {
    let touch = e.touches ? e.touches[0] : e;
    showPopup(touch, _cardRegistry[idx]);
  }
}
document.addEventListener('touchstart', function(e) {
  if (!e.target.closest('.mini-card') && !e.target.closest('#cardPopup')) hidePopup();
}, { passive: true });

// ==== スタックモーダル用コンパクトツールチップ ====
function stackTip(ev, id) {
  var tip = document.getElementById('stackTip');
  if (!tip) { tip = document.createElement('div'); tip.id = 'stackTip'; document.body.appendChild(tip); }
  var name = '', txt = '';
  if (id) {
    var c = DECK_CARDS.find(function(x){ return x.id === id; });
    if (c) { name = c.name; if (c.power !== undefined) name += '（攻撃' + dv(c.power) + ' HP' + dv(c.toughness) + '）'; }
    txt = (typeof CARD_FULL_TEXT !== 'undefined' && CARD_FULL_TEXT[id]) ? CARD_FULL_TEXT[id] : (c ? (c.text || '') : '');
  }
  if (!name) return;
  tip.innerHTML = '<div class="st-name">' + name + '</div>' + (txt ? '<div class="st-txt">' + txt + '</div>' : '');
  tip.style.display = 'block';
  var tw = tip.offsetWidth, th = tip.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
  var cx = (ev.clientX != null ? ev.clientX : vw / 2), cy = (ev.clientY != null ? ev.clientY : 40);
  var x = cx + 14, y = cy + 14;
  if (x + tw > vw - 6) x = cx - tw - 14;
  if (x < 6) x = 6;
  if (y + th > vh - 6) y = vh - th - 6;
  if (y < 6) y = 6;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function hideStackTip() { var t = document.getElementById('stackTip'); if (t) t.style.display = 'none'; }
document.addEventListener('mouseover', function(ev) { var t = ev.target.closest && ev.target.closest('.has-tip'); if (t && t.dataset.cid) stackTip(ev, t.dataset.cid); });
document.addEventListener('mouseout', function(ev) { var t = ev.target.closest && ev.target.closest('.has-tip'); if (t) hideStackTip(); });
document.addEventListener('click', function(ev) { var t = ev.target.closest && ev.target.closest('.stack-ent'); if (t && t.dataset.cid) { stackTip(ev, t.dataset.cid); } else { hideStackTip(); } }, true);

// ==== 描画 ====
function render() {
  if (!myState) return;
  _cardRegistry = [];
  let s = myState;

  // 降参ボタン: チュートリアル以外で常時表示
  var _sb = document.getElementById('surrenderBtn');
  if (_sb) _sb.style.display = isTutorial ? 'none' : 'block';

  // ライフ
  document.getElementById('myLife').textContent = 'LP:' + dv(s.me.life);
  document.getElementById('oppLife').textContent = 'LP:' + dv(s.opp.life);
  checkPinchBGM(s.me.life);
  document.getElementById('myInfo').textContent = 'ゴミ箱' + s.me.grave.length + ' デッキ' + s.me.deckCount;
  document.getElementById('oppInfo').textContent = 'ゴミ箱' + s.opp.grave.length + ' デッキ' + s.opp.deckCount + ' 手札' + s.opp.handCount;

  // フェイズ
  let phaseNames = { start: '開始', main: 'メイン', attack: '攻撃', block: 'ブロック', main2: 'メイン2' };
  document.getElementById('phaseInfo').textContent = 'Turn' + s.turn + ' ' + (phaseNames[s.phase] || s.phase) + (s.isMyTurn ? ' [自分]' : ' [相手]');

  // 相手マナ
  let oppMH = '<span class="label">相手の視聴者(' + s.opp.mana.filter(m => !m.manaTapped).length + '/' + s.opp.mana.length + ')</span>';
  s.opp.mana.forEach((c, i) => { oppMH += renderCard(c, 'mana', i, true); });
  document.getElementById('oppMana').innerHTML = oppMH;

  // フィールド番号（同名カードがいる場合のみ付与）
  function fieldNums(field) {
    var counts = {}, nums = {};
    field.forEach(function(c) { counts[c.name] = (counts[c.name] || 0) + 1; });
    var counters = {};
    return field.map(function(c) {
      if (counts[c.name] <= 1) return 0;
      counters[c.name] = (counters[c.name] || 0) + 1;
      return counters[c.name];
    });
  }

  // 相手フィールド
  let oppH = '';
  let oppNums = fieldNums(s.opp.field);
  s.opp.field.forEach((c, i) => { oppH += renderCard(c, 'field', i, true, oppNums[i]); });
  document.getElementById('oppField').innerHTML = oppH;

  // 自分フィールド
  let myFH = '';
  let myNums = fieldNums(s.me.field);
  s.me.field.forEach((c, i) => {
    let selected = s.phase === 'attack' && s.isMyTurn && s.attackers.includes(i);
    let card = renderCard(c, 'field', i, false, myNums[i]);
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
  var mobileHand = document.getElementById('myHandMobile');
  if (mobileHand) mobileHand.innerHTML = handH;

  // コントロール（丸型メニュー）
  let center = '';
  let orbits = '';
  if (s.isMyTurn) {
    if ((s.phase === 'main' || s.phase === 'main2') && s.chainDepth === 0 && !s.waitingAction && !s.hasPendingPrompt) {
      if (isTutorial && tutorialStep < TUT_FREE_STEP) {
        // 段階ごとに「今やること」のボタンだけを出す(迷わないように)
        if ((tutorialStep === 1 || tutorialStep === 6) && !s.manaPlaced) {
          center = '<div class="ctrl-center btn-endturn btn-tut-follow" onclick="showManaSelect()">フォロー</div>';
        } else if (TUT_PLAY_ALLOW[tutorialStep]) {
          center = '<div class="ctrl-center btn-endturn btn-tut-play" onclick="showPlaySelect()">プレイ</div>';
        } else if (tutorialStep === 3 || tutorialStep === 10) {
          center = '<div class="ctrl-center btn-endturn" onclick="doEndTurn()">ターン<br>終了</div>';
        } else if (tutorialStep >= 9 && tutorialStep < 10) {
          if (s.phase === 'main') center = '<div class="ctrl-center btn-battle" onclick="doStartCombat()">戦闘</div>';
        }
      } else {
        if (s.phase === 'main') {
          center = '<div class="ctrl-center btn-battle" onclick="doStartCombat()">戦闘</div>';
        } else {
          center = '<div class="ctrl-center btn-endturn" onclick="doEndTurn()">ターン<br>終了</div>';
        }
        orbits += '<div class="ctrl-orbit btn-mana" onclick="showManaSelect()">フォロー</div>';
        orbits += '<div class="ctrl-orbit btn-play" onclick="showPlaySelect()">プレイ</div>';
        orbits += '<div class="ctrl-orbit btn-ability" onclick="showAbilitySelect()">能力</div>';
        if (s.phase === 'main') {
          orbits += '<div class="ctrl-orbit btn-cancel small-endturn" onclick="doEndTurn()">ターン<br>終了</div>';
        }
      }
    }
    if (s.phase === 'attack' && s.chainDepth === 0 && !s.hasPendingPrompt) {
      center = '<div class="ctrl-center btn-confirm" onclick="doConfirmAttack()">攻撃<br>確定</div>';
      if (!(isTutorial && tutorialStep < TUT_FREE_STEP)) orbits += '<div class="ctrl-orbit btn-cancel" onclick="doCancelAttack()">戻る</div>';
    }
  } else {
    center = '<div class="ctrl-center btn-wait">相手の<br>ターン</div>';
  }
  document.getElementById('controls').innerHTML = '<div class="ctrl-ring">' + orbits + center + '</div>';

  // スマホ用: 下中央の上半円メニュー
  var arcEl = document.getElementById('ctrlArc');
  if (arcEl) {
    var arcCenter = center.replace('ctrl-center', 'arc-center');
    var arcBtns = '';
    // PC: btn-mana=1, btn-play=2, btn-ability=3, btn-cancel=4 → 左から順
    var orbitArr = orbits.match(/<div class="ctrl-orbit[^"]*"[^>]*>[^<]*(?:<br>)?[^<]*<\/div>/g) || [];
    orbitArr.forEach(function(o, i) {
      arcBtns += o.replace(/ctrl-orbit(\s*[^"]*)/, 'arc-btn arc-' + (i + 1) + '$1');
    });
    arcEl.innerHTML = arcBtns + arcCenter;
  }
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
    let blocked = isTutorial && tutorialStep < TUT_FREE_STEP && tutorialKeep.includes(c.id);
    let s = blocked ? 'border-color:#333;opacity:0.4;' : '';
    h += '<div class="modal-card" style="' + s + '" ' + (blocked ? '' : 'onclick="closeModal();doPlaceMana(' + i + ')"') + '><b>' + c.name + '</b><br>コスト:' + c.cost + '</div>';
  });
  h += '</div><button onclick="closeModal()">戻る</button>';
  showModal(h, 'mana');
}

function showPlaySelect() {
  let h = '<h3>プレイ</h3><div class="modal-cards">';
  let mana = myState.me.mana.filter(m => !m.manaTapped).length;
  myState.me.hand.forEach((c, i) => {
    let ok = mana >= c.cost;
    if (c.id === 'makkinii') ok = true;
    if (isTutorial && tutorialStep < TUT_FREE_STEP && TUT_PLAY_ALLOW[tutorialStep] !== c.id) ok = false;
    let s = ok ? 'border-color:#8a7d5a;cursor:pointer;' : 'border-color:#333;opacity:0.4;';
    h += '<div class="modal-card" style="' + s + '" ' + (ok ? 'onclick="closeModal();doPlayCard(' + i + ')"' : '') + '><b>' + c.name + '</b><br>コスト:' + c.cost + (c.power !== undefined ? '<br>攻撃' + dv(c.power) + ' HP' + dv(c.toughness) : '') + '</div>';
  });
  h += '</div><button onclick="closeModal()">戻る</button>';
  showModal(h, 'play');
}

function showAbilitySelect() {
  let h = '<h3>能力起動</h3><div class="modal-cards">';
  let mana = myState.me.mana.filter(m => !m.manaTapped).length;
  myState.me.field.forEach((c, i) => {
    let abilities = [];
    if (c.abilities) {
      if (c.abilities.includes('create_token_jk') && mana >= 3) abilities.push({ id: 'create_token_jk', label: 'トークン(【応援3】)' });
      if (c.abilities.includes('activated_reichen_heal') && mana >= 1) abilities.push({ id: 'activated_reichen_heal', label: '回復(【応援1】)' });
      if (c.abilities.includes('activated_sagi_recover') && mana >= 4) abilities.push({ id: 'activated_sagi_recover', label: 'ゴミ箱回収(【応援4】)' });
      if (c.abilities.includes('activated_dansou_buff') && mana >= 3) abilities.push({ id: 'activated_dansou_buff', label: '攻撃+200(【応援3】)' });
      if (c.abilities.includes('activated_lucia_dragon') && mana >= 3 && !(c.onceUsed && c.onceUsed.indexOf('activated_lucia_dragon') >= 0)) abilities.push({ id: 'activated_lucia_dragon', label: '竜化(【応援3】・1ターンに1度)' });
      if (c.abilities.includes('activated_maoria_flying') && mana >= 4) abilities.push({ id: 'activated_maoria_flying', label: '飛行(【応援4】)' });
      if (!c.tapped) {
        if (c.abilities.includes('activated_zeratine_split') && mana >= 3) abilities.push({ id: 'activated_zeratine_split', label: '【分裂】応援3＋タップ＋自身を生贄' });
        if (c.abilities.includes('activated_lead_search') && mana >= 3) abilities.push({ id: 'activated_lead_search', label: 'キャラサーチ(【応援3】+T)' });
        if (c.abilities.includes('activated_zeratine_eat') && myState.me.field.some(function(f) { return f.uid !== c.uid && f.type === 'creature'; })) abilities.push({ id: 'activated_zeratine_eat', label: '【捕食】タップ＋味方1体を生贄' });
        if (c.abilities.includes('activated_lucia_breath') && mana >= 5) abilities.push({ id: 'activated_lucia_breath', label: '全体200(【応援5】+T)' });
        if (c.abilities.includes('activated_izuna') && mana >= 2) abilities.push({ id: 'activated_izuna', label: 'ダメージ(【応援2】+T)' });
        if (c.abilities.includes('activated_reichen_dmg') && mana >= 4) abilities.push({ id: 'activated_reichen_dmg', label: '500ダメージ(【応援4】+T)' });
        if (c.abilities.includes('activated_shinigami')) {
          if (myState.me.life >= 300) abilities.push({ id: 'shinigami_destroy', label: '確定除去(T+LP300)' });
          if (myState.me.life >= 200) abilities.push({ id: 'shinigami_discard', label: 'ハンデス(T+LP200)' });
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
  showModal(h, 'ability');
}

// ==== サーバー送信 ====
function doPlaceMana(idx) { socket.emit('action', { type: 'placeMana', data: { idx } }); }
function doPlayCard(idx) { socket.emit('action', { type: 'playCard', data: { idx } }); }
function doActivate(fi, aid) { socket.emit('action', { type: 'activateAbility', data: { fi, aid } }); }
function doStartCombat() { socket.emit('action', { type: 'startCombat' }); }
function doConfirmAttack() {
  if (isTutorial && tutorialStep < TUT_FREE_STEP && myState && myState.attackers) {
    // 台本どおりならキャマキリと妹系ヒロインの2体。どちらかが居なくなっていても(想定外の経路)、居る分だけ選べば進める
    var want = (myState.me ? myState.me.field : []).filter(function(c) { return c.id === 'kyamakiri' || c.id === 'imouto'; }).length;
    var need = Math.max(1, Math.min(2, want));
    if (myState.attackers.length < need) {
      showGuide('<p>⚠️ ' + (need === 2 ? '<b>2体とも選んでね。</b>' : '<b>攻撃するキャラを選んでね。</b>') + '</p>', (need === 2 ? 'キャマキリと妹系ヒロインの<b>両方</b>を押してから' : '攻撃できるキャラを押してから') + '「攻撃確定」');
      return;
    }
    doConfirmAttack._tutAttackers = myState.attackers.map(function(i) { return myState.me.field[i] && myState.me.field[i].id; });
  }
  socket.emit('action', { type: 'confirmAttack' });
}
function doCancelAttack() { socket.emit('action', { type: 'cancelAttack' }); }
function doEndTurn() { socket.emit('action', { type: 'endTurn' }); }
function doSurrender() {
  showModal('<h3>降参しますか？</h3><div style="color:#aaa;font-size:13px;margin-bottom:14px;">この試合を負けとして終了します。</div><button onclick="confirmSurrender()" style="background:#7a3030;color:#fff;">降参する</button><button onclick="closeModal()">やめる</button>');
}
function confirmSurrender() {
  closeModal();
  socket.emit('action', { type: 'surrender' });
}

// ==== プロンプト処理 ====
function handlePrompt(type, data) {
  if (data && data.targets && data.targets.length) {
    var _counts = {};
    data.targets.forEach(function(t) { _counts[t.name] = (_counts[t.name] || 0) + 1; });
    var _counters = {};
    data.targets.forEach(function(t) {
      if (_counts[t.name] <= 1) { t.displayName = t.name; return; }
      _counters[t.name] = (_counters[t.name] || 0) + 1;
      t.displayName = t.name + ' #' + _counters[t.name];
    });
  }
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
          h += '<div class="stack-ent has-tip" data-cid="' + (e.cardId || '') + '" style="background:#1a1a2e;padding:4px 8px;margin:2px;border-radius:4px;border-left:3px solid ' + (e.player === mySeat ? '#5a8a5a' : '#8a5a5a') + ';cursor:pointer;">' + (e.cancelled ? '【打消済】' : '') + 'P' + (e.player + 1) + ': ' + e.description + '</div>';
        });
        h += '</div>';
      }
      h += '<p style="color:#aaa;margin:8px 0;">チェーン ' + data.chainDepth + '/3</p>';
      if (data.supports.length > 0) {
        h += '<p style="color:#aaa;">サポート:</p><div class="modal-cards">';
        data.supports.forEach(s => {
          h += '<div class="modal-card has-tip" data-cid="' + (s.id || '') + '" onclick="respondChain(\'playSupport\',' + s.idx + ')"><b>' + s.name + '</b>' + (s.id ? '<span class="tip-i" onclick="event.stopPropagation();stackTip(event,\'' + s.id + '\')">i</span>' : '') + '<br>コスト:' + s.cost + '</div>';
        });
        h += '</div>';
      }
      if (data.abilities.length > 0) {
        h += '<p style="color:#aaa;">能力:</p><div class="modal-cards">';
        data.abilities.forEach(a => {
          h += '<div class="modal-card has-tip" data-cid="' + (a.cardId || '') + '" onclick="respondChain(\'activate\',' + a.fi + ',\'' + a.ability.id + '\')"><b>' + a.cardName + '</b>' + (a.cardId ? '<span class="tip-i" onclick="event.stopPropagation();stackTip(event,\'' + a.cardId + '\')">i</span>' : '') + '<br>' + a.ability.label + '</div>';
        });
        h += '</div>';
      }
      if (!(isTutorial && tutorialStep === 4)) h += '<button onclick="respondChain(\'pass\')">パス</button>';
      if (isTutorial && tutorialStep === 4) h = tutNote('相手の<b>「動画編集」</b>で、キャマキリが-300/-300にされそう(HP100なので破壊される)。<br>手札の<b>「動画削除」(コスト3)</b>は相手の効果を1つ打ち消せる割り込みカード。視聴者4人のうちキャマキリで1人使ったので、残り3人。ちょうど使える。これを選ぼう。') + h;
      showModal(h, 'chain');
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
      if (isTutorial && tutorialStep === 11) h = tutNote('相手の<b>「ママチャリ暴走族」(攻撃200)</b>が攻撃してきた。横向きでないキャラを選ぶと、そのキャラが代わりに受ける(キャラ同士で戦う)。選ばなければLPが減る。<br>ママチャリ暴走族の欄で<b>「パン屋の娘 カエラ」</b>を選んで「確定」。') + h;
      showModal(h, 'block');
      break;
    }

    case 'makkinii_choice': {
      let h = '<h3>まっきーに: 支払い方法を選択</h3><div class="modal-cards">';
      h += '<div class="modal-card" style="min-width:120px;" onclick="respondPrompt({choice:\'mana\'})"><b>【応援5】で支払う</b><br>残り:' + data.remainingMana + '</div>';
      h += '<div class="modal-card" style="min-width:120px;" onclick="respondPrompt({choice:\'alt\'})"><b>クリエイター2枚捨て</b><br>無料発動</div>';
      h += '</div><button onclick="respondPrompt({choice:\'cancel\'})">キャンセル</button>';
      showModal(h, 'pick');
      break;
    }

    case 'ichiko_choice': {
      let h = '<h3>いちこ: 効果を選択</h3><div class="modal-cards">';
      h += '<div class="modal-card" onclick="respondPrompt({mode:1})"><b>' + 300 + '点ダメージ</b></div>';
      h += '<div class="modal-card" onclick="respondPrompt({mode:2})"><b>LP' + 500 + '回復</b></div>';
      h += '<div class="modal-card" onclick="respondPrompt({mode:3})"><b>味方攻撃+' + 200 + '</b></div>';
      h += '<div class="modal-card" onclick="respondPrompt({mode:4})"><b>相手攻撃-' + 100 + '</b></div>';
      h += '</div>';
      showModal(h, 'pick');
      break;
    }

    case 'counterspell_target': {
      let h = '<h3>動画削除: 打ち消す効果を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" style="border-color:#cc3030;" onclick="respondPrompt({idx:' + t.idx + '})"><b>P' + (t.player + 1) + '</b><br>' + t.description + '</div>';
      });
      h += '</div>';
      if (isTutorial && tutorialStep === 4) h = tutNote('打ち消す効果を選ぶ。今は相手の<b>「動画編集」</b>1つだけ。') + h;
      showModal(h, 'target-attack');
      break;
    }

    case 'regen_confirm': {
      let h = '<h3>' + data.source + '蘇生: ' + data.card.name + '</h3>';
      h += '<p>【応援' + data.cost + '】で蘇生しますか？ (いま使える応援: ' + data.manaLeft + ')</p>';
      h += '<button onclick="respondPrompt({accept:true})">蘇生する</button>';
      h += '<button onclick="respondPrompt({accept:false})">しない</button>';
      showModal(h, 'target-ally');
      break;
    }

    case 'target_damage': {
      let h = '<h3>' + data.source + ': ダメージ対象を選択 (' + dv(data.damage) + '点)</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" style="border-color:#cc3030;" onclick="respondPrompt({targetIdx:' + t.idx + '})"><b>' + t.displayName + '</b><br>HP:' + dv(t.hp - t.damage) + '/' + dv(t.hp) + '</div>';
      });
      h += '</div><button onclick="respondPrompt({targetIdx:-1})">キャンセル</button>';
      showModal(h, 'target-attack');
      break;
    }

    case 'asaki_peek': {
      let h = '<h3>アサキ: 相手のデッキトップ</h3>';
      h += '<div style="padding:12px;background:#2a2a3a;border-radius:8px;text-align:center;margin:12px 0;"><b style="font-size:16px;">' + data.topCard.name + ' (コスト' + data.topCard.cost + ')' + '</b></div>';
      h += '<button onclick="respondPrompt({shuffle:true})">シャッフルする</button>';
      h += '<button onclick="respondPrompt({shuffle:false})">そのまま</button>';
      showModal(h, 'pick');
      break;
    }

    case 'nari_pick': {
      let h = '<h3>NARI: 手札に加える1枚を選択</h3><div class="modal-cards">';
      data.cards.forEach((c, i) => {
        h += '<div class="modal-card" onclick="respondPrompt({idx:' + i + '})"><b>' + c.name + '</b><br>コスト:' + c.cost + '</div>';
      });
      h += '</div><button onclick="respondPrompt({idx:-1})">選ばない</button>';
      showModal(h, 'pick');
      break;
    }

    case 'free_play': {
      let h = '<h3>青春詭弁: 無料投稿</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" onclick="respondPrompt({idx:' + t.idx + '})"><b>' + t.displayName + '</b><br>攻撃' + dv(t.power) + ' HP' + dv(t.toughness) + '</div>';
      });
      h += '</div><button onclick="respondPrompt({idx:-1})">キャンセル</button>';
      showModal(h, 'play');
      break;
    }

    case 'creator_discard': {
      let h = '<h3>' + data.cardName + ': クリエイター2枚を選んで捨てる</h3>';
      h += '<p id="discardCount" style="color:#aaa;">選択: 0/2</p><div class="modal-cards">';
      data.creators.forEach(cr => {
        h += '<div class="modal-card" id="cd_' + cr.idx + '" onclick="toggleCreatorDiscard(' + cr.idx + ')"><b>' + cr.name + '</b></div>';
      });
      h += '</div><button id="discardConfirm" onclick="confirmCreatorDiscard()" disabled>確定</button>';
      showModal(h, 'pick');
      window._discardSelected = [];
      break;
    }

    case 'discard_one': {
      let h = '<h3>愛つばめ: 相手の手札から1枚選んで捨てさせる</h3><div class="modal-cards">';
      data.cards.forEach(c => {
        h += '<div class="modal-card" onclick="respondPrompt({idx:' + c.idx + '})"><b>' + c.name + '</b></div>';
      });
      h += '</div>';
      showModal(h, 'target-attack');
      break;
    }

    case 'enchant_target': {
      let h = '<h3>エンチャント先を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" onclick="respondPrompt({fieldIdx:' + t.idx + '});closeModal()"><b>' + t.displayName + '</b></div>';
      });
      h += '</div>';
      showModal(h, 'target-ally');
      break;
    }

    case 'zeratine_eat_target': {
      let h = '<h3>捕食: 生贄にする味方を選択</h3><div style="color:#aaa;font-size:12px;margin-bottom:8px;">選んだカードの<b>元の</b>攻撃・HP分、ゼラチネが強くなります（強化やエンチャントの分は入りません）</div><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" onclick="respondPrompt({targetIdx:' + t.idx + '})"><b>' + t.displayName + '</b><br>+' + dv(t.power || 0) + ' / +' + dv(t.toughness || 0) + '</div>';
      });
      h += '</div><button onclick="respondPrompt({targetIdx:-1})">キャンセル</button>';
      showModal(h, 'target-ally');
      break;
    }

    case 'shuffle_confirm': {
      let h = '<h3>デッキトップ確認</h3>';
      h += '<div style="padding:12px;background:#2a2a3a;border-radius:8px;text-align:center;margin:12px 0;"><b style="font-size:16px;">' + data.topCard.name + ' (コスト' + data.topCard.cost + ')' + '</b></div>';
      h += '<button onclick="respondPrompt({shuffle:true})">シャッフルする</button>';
      h += '<button onclick="respondPrompt({shuffle:false})">そのまま</button>';
      showModal(h, 'pick');
      break;
    }

    case 'seishun_kiben_target': {
      let h = '<h3>青春詭弁: 無料投稿する対象を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" onclick="respondPrompt({idx:' + t.idx + '})"><b>' + t.displayName + '</b><br>攻撃' + dv(t.power) + ' HP' + dv(t.toughness) + '</div>';
      });
      h += '</div><button onclick="respondPrompt({idx:-1})">キャンセル</button>';
      showModal(h, 'play');
      break;
    }


    case 'buff_target': {
      let h = '<h3>投げ銭: 対象を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" onclick="respondPrompt({targetIdx:' + t.idx + '})"><b>' + t.displayName + '</b></div>';
      });
      h += '</div>';
      showModal(h, 'target-ally');
      break;
    }

    case 'akapo_target': {
      let h = '<h3>あかぽ: 攻撃+500する対象を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" onclick="respondPrompt({targetIdx:' + t.idx + '})"><b>' + t.displayName + '</b></div>';
      });
      h += '</div>';
      showModal(h, 'target-ally');
      break;
    }

    case 'debuff_target': {
      let h = '<h3>動画編集: 対象を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" style="border-color:#cc3030;" onclick="respondPrompt({targetIdx:' + t.idx + '})"><b>' + t.displayName + '</b></div>';
      });
      h += '</div>';
      showModal(h, 'target-attack');
      break;
    }

    case 'destroy_target': {
      let h = '<h3>企画ボツ: 破壊する対象を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" style="border-color:#cc3030;" onclick="respondPrompt({targetIdx:' + t.idx + ',pi:' + t.pi + '})"><b>' + (t.pi !== myState.myIndex ? '[相手] ' : '[自分] ') + t.displayName + '</b></div>';
      });
      h += '</div>';
      showModal(h, 'target-attack');
      break;
    }

    case 'shinigami_destroy_target': {
      let h = '<h3>死神少女: 破壊する対象を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" style="border-color:#cc3030;" onclick="respondPrompt({targetIdx:' + t.idx + ',pi:' + t.pi + '})"><b>' + (t.pi !== myState.myIndex ? '[相手] ' : '[自分] ') + t.displayName + '</b></div>';
      });
      h += '</div>';
      showModal(h, 'target-attack');
      break;
    }

    case 'yarakashi_target': {
      let h = '<h3>サルベド猫のやらかし: 破壊する対象を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" style="border-color:#cc3030;" onclick="respondPrompt({targetIdx:' + t.idx + ',pi:' + t.pi + '})"><b>' + (t.pi !== myState.myIndex ? '[相手] ' : '[自分] ') + t.displayName + '</b></div>';
      });
      h += '</div>';
      showModal(h, 'target-attack');
      break;
    }

    case 'sakamachi_pick': {
      let h = '<h3>坂街透: ゴミ箱に捨てる1枚を選択</h3><div class="modal-cards">';
      data.cards.forEach((c, i) => {
        h += '<div class="modal-card" onclick="respondPrompt({idx:' + i + '})"><b>' + c.name + '</b><br>コスト:' + c.cost + '</div>';
      });
      h += '</div><button onclick="respondPrompt({idx:-1})">選ばない</button>';
      showModal(h, 'pick');
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
      showModal(h, 'pick');
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
      showModal(h, 'pick');
      window._gomoPicked = [];
      break;
    }
    case 'mensetsu_target': {
      let h = '<h3>面接官ヒロイン: 破壊する主人公を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" style="border-color:#cc3030;" onclick="respondPrompt({targetIdx:' + t.idx + ',pi:' + t.pi + '})"><b>' + t.displayName + '</b></div>';
      });
      h += '</div>';
      showModal(h, 'target-attack');
      break;
    }

    case 'reichen_heal_target': {
      let h = '<h3>レイチェン: 回復する味方を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" onclick="respondPrompt({targetIdx:' + t.idx + '})"><b>' + t.displayName + '</b></div>';
      });
      h += '</div>';
      showModal(h, 'target-ally');
      break;
    }

    case 'reichen_dmg_target': {
      let h = '<h3>レイチェン: 500ダメージを与える相手を選択</h3><div class="modal-cards">';
      data.targets.forEach(t => {
        h += '<div class="modal-card" style="border-color:#cc3030;" onclick="respondPrompt({targetIdx:' + t.idx + '})"><b>' + t.displayName + '</b></div>';
      });
      h += '</div>';
      showModal(h, 'target-attack');
      break;
    }

    case 'sagi_recover_pick': {
      let h = '<h3>サギ: ゴミ箱から手札に戻すカードを選択</h3><div class="modal-cards">';
      data.cards.forEach((c, i) => {
        h += '<div class="modal-card" onclick="respondPrompt({idx:' + i + '})"><b>' + c.name + '</b><br>コスト:' + c.cost + '</div>';
      });
      h += '</div><button onclick="respondPrompt({idx:-1})">選ばない</button>';
      showModal(h, 'pick');
      break;
    }

    case 'douga_fukugen_pick': {
      let h = '<h3>動画復元: ゴミ箱から投稿する投稿キャラを選択</h3><div class="modal-cards">';
      data.cards.forEach(function(c, i) {
        h += '<div class="modal-card" onclick="respondPrompt({idx:' + c.idx + '})"><b>' + c.name + '</b><br>コスト:' + c.cost + '</div>';
      });
      h += '</div><button onclick="respondPrompt({idx:-1})">選ばない</button>';
      showModal(h, 'pick');
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
  if (isTutorial && tutorialStep === 11 && Object.keys(assignments).length === 0 && !submitBlocks._tutWarned) {
    // 練習なので1回だけ止める(2回目はそのまま通す=ブロックしない結果も見せる)
    submitBlocks._tutWarned = true;
    var note = document.querySelector('#modalContent .tut-note');
    if (note) { note.innerHTML = '📘 ⚠️ <b>まだブロックを選んでいないよ。</b><br>ママチャリ暴走族の欄のプルダウンで<b>「パン屋の娘 カエラ」</b>を選んでから「確定」。'; note.classList.add('tut-note-warn'); }
    else showGuide('<p>⚠️ まだブロックを選んでいないよ。</p>', 'ママチャリ暴走族の欄のプルダウンで<b>「パン屋の娘 カエラ」</b>を選んでから<b>「確定」</b>');
    return;
  }
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
var ENCHANT_IDS = ['ki_no_sei','alminium','healthy_sleep','parasite','smasher','rena'];
var DECK_SECTIONS = [
  {start:'seitokaichou',label:'サルベドラブコメ'},
  {start:'maoria',label:'サルベドファンタジー'},
  {start:'salvado_cat',label:'クリエイターチーム'},
  {start:'douga_sakujo',label:'チャンネル運営'},
  {start:'zeratine',label:'クエスト報酬'}
];
function getDeckCardType(c) {
  if (ENCHANT_IDS.includes(c.id)) return 'enchantment';
  if (c.power !== undefined) return 'creature';
  return 'support';
}
var DECK_CARDS = [
  // --- サルベドラブコメ ---
  {id:'seitokaichou',name:'生徒会長ヒロイン',cost:2,power:100,toughness:100,text:'油断しない/登場時:1枚ドロー',max:4},
  {id:'kanaria',name:'アイドル カナリア',cost:2,power:100,toughness:100,text:'【応援3】+T:デッキトップを視聴者に追加',max:2},
  {id:'osananajimi',name:'幼馴染ヒロイン',cost:2,power:100,toughness:100,text:'登場時:主人公サーチ',max:4},
  {id:'onna_joushi',name:'女上司ヒロイン',cost:2,power:100,toughness:100,text:'油断しない/登場時:デッキトップ確認→シャッフル可',max:4},
  {id:'imouto',name:'妹系ヒロイン',cost:1,power:100,toughness:100,text:'俊足',max:4},
  {id:'mensetsu_kan',name:'面接官ヒロイン',cost:3,power:100,toughness:200,text:'登場時:相手の主人公1体破壊',max:4},
  {id:'dansou',name:'男装系ヒロイン',cost:3,power:100,toughness:300,text:'【応援3】:攻撃+200',max:4},
  {id:'ki_no_sei',name:'木の精',cost:2,text:'ブロック時ダメージ無効',max:4},
  {id:'alminium',name:'頭にアルミホイルを巻く',cost:4,text:'効果の対象にならない',max:2},
  {id:'healthy_sleep',name:'夜しか眠れない健康的な生活',cost:1,text:'HP+300',max:4},
  {id:'suisosui',name:'水素水でナンパする男',cost:2,power:100,toughness:100,text:'登場時:全ヒロインを手札に戻す',max:2},
  {id:'jk_a',name:'一般女子高生A',cost:2,power:100,toughness:100,text:'【応援3】:攻撃' + 100 + ' HP' + 100 + 'トークン生成',max:4},
  {id:'mamachari',name:'ママチャリ暴走族',cost:2,power:200,toughness:100,text:'俊足',max:4},
  {id:'kyamakiri',name:'キャマキリ',cost:1,power:100,toughness:100,text:'攻撃時攻撃+' + 200 + '/HP+0',max:4},
  {id:'shiko_touchou',name:'思考盗聴された！',cost:0,text:'相手の手札を見る',max:4},
  {id:'kanwa_kyuudai',name:'閑話休題',cost:5,text:'割り込み/全投稿キャラタップ',max:4},
  {id:'99wari',name:'99割間違いない',cost:9,text:'LP900支払い/相手全破壊+全ハンデス',max:1},
  // --- サルベドファンタジー：マオリア ---
  {id:'maoria',name:'のちの魔王 マオリア',cost:7,power:500,toughness:500,text:'【応援4】:ターン終了時まで飛行/【応援3】+T:ATK+' + 300 + '点ダメージ',max:2},
  {id:'tomo',name:'勇者 トモ',cost:8,power:800,toughness:800,text:'油断しない,俊足',max:2},
  {id:'izuna',name:'魔法使い イズナ',cost:3,power:300,toughness:100,text:'飛行/【応援2】+T:' + 200 + '点ダメージ',max:4},
  {id:'miiko',name:'僧侶 ミーコ',cost:3,power:0,toughness:300,text:'味方破壊時【応援2】蘇生',max:4},
  {id:'parasite',name:'魔の寄生体',cost:4,text:'攻撃+' + 200 + '/HP+' + 200 + ',【応援1】蘇生,魔物生成,ライフロス',max:4},
  // --- サルベドファンタジー：掃除屋 ---
  {id:'asaki',name:'元掃除屋 アサキ',cost:5,power:400,toughness:400,text:'油断しない/T:相手の手札を見る',max:2},
  {id:'azusa',name:'掃除屋 アズサ',cost:5,power:400,toughness:300,text:'2+T:相手の手札からランダム1枚捨て',max:2},
  {id:'kaera',name:'パン屋の娘 カエラ',cost:1,power:100,toughness:100,text:'登場時:LP' + 200 + '回復',max:4},
  {id:'iron_chaser',name:'Aレイスの追手',cost:2,power:100,toughness:200,text:'攻撃時他の悪で攻撃+' + 100 + '/HP+0',max:4},
  {id:'iron_boss',name:'Aレイスのボス',cost:4,power:200,toughness:300,text:'悪全体攻撃+' + 100 + '/HP+' + 100,max:4},
  // --- サルベドファンタジー：死神少女 ---
  {id:'shinigami',name:'死神少女',cost:5,power:200,toughness:300,text:'T+LP300:確定除去/T+LP200:ハンデス/T+LP500:打ち消し',max:2},
  {id:'jun',name:'ジュン',cost:2,power:100,toughness:200,text:'登場時:死神少女サーチ',max:2},
  // --- サルベドファンタジー：アーク ---
  {id:'ark',name:'魔王の血族 アーク',cost:8,power:500,toughness:500,text:'相手全体攻撃-' + 100 + '/HP-' + 100,max:2},
  {id:'milia',name:'勇者の血族 ミリア',cost:4,power:300,toughness:300,text:'他の味方攻撃+' + 100 + '/HP+' + 100,max:2},
  {id:'daria',name:'勇者の兄 ダリア',cost:3,power:0,toughness:500,text:'攻撃不可/ブロック時ダメージ無効',max:4},
  // --- サルベドファンタジー：レイチェン ---
  {id:'reichen',name:'賢者 レイチェン',cost:4,power:200,toughness:300,text:'【応援1】味方1体全回復/【応援4】相手1体に500ダメージ',max:2},
  {id:'sagi',name:'盗賊 サギ',cost:4,power:200,toughness:200,text:'俊足,油断しない/【応援3】+T+手札1枚:打ち消し/【応援4】ゴミ箱回収',max:2},
  // --- 漫画 アンドロイド ユリ ---
  {id:'yuri',name:'アンドロイド ユリ',cost:3,power:200,toughness:200,text:'エンチャント1つにつき+100/+100',max:2},
  {id:'smasher',name:'戦術兵器スマッシャー',cost:3,text:'+100/+100,俊足/ユリ装備時:+200/+200,俊足,飛行',max:2},
  {id:'rena',name:'地縛霊 レナ',cost:3,text:'飛行/【応援3】蘇生',max:4},
  {id:'lucia',name:'ドラゴン娘 ルシア',cost:4,power:200,toughness:200,text:'【応援3】(1ターンに1度):+300/+300飛行/【応援5】+T:全体200ダメージ',max:2},
  // --- クリエイターチーム ---
  {id:'salvado_cat',name:'サルベド猫',cost:5,text:'打ち消し不可/クリエイター3枚サーチ→1枚捨て',max:4},
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
  {id:'komi',name:'komi',cost:1,text:'割り込み/味方全回復/LP300回復',max:4},
  {id:'ichiko',name:'いちこ',cost:4,text:'4択:' + 300 + '点/' + 500 + '回復/攻撃+' + 200 + '/相手攻撃-' + 100,max:4},
  {id:'seishun_kiben',name:'青春詭弁',cost:5,text:'割り込み/手札の主人公/ヒロインを無料投稿',max:4},
  {id:'salvado_cat_yarakashi',name:'サルベド猫のやらかし',cost:6,text:'打ち消し不可/確定除去(蘇生不可)',max:2},
  // --- チャンネル運営 ---
  {id:'douga_sakujo',name:'動画削除',cost:3,text:'効果1つを打ち消す',max:4},
  {id:'shueki_teishi',name:'収益停止',cost:4,text:'相手の視聴者全タップ',max:4},
  {id:'kikaku_botsu',name:'企画ボツ',cost:4,text:'投稿キャラ1体破壊',max:4},
  {id:'channel_sakujo',name:'チャンネル削除',cost:6,text:'全場破壊+手札全捨て+7枚引き直し',max:2},
  {id:'douga_henshuu',name:'動画編集',cost:2,text:'対象攻撃-' + 300 + '/HP-' + 300 + '(ターン終了まで)',max:4},
  {id:'super_chat',name:'投げ銭',cost:1,text:'味方攻撃+' + 300 + '/HP+' + 300 + '(ターン終了まで)',max:4},
  {id:'douga_fukugen',name:'動画復元',cost:5,text:'割り込み/ゴミ箱から投稿キャラ1体無料投稿',max:4},
  {id:'impression_seigen',name:'インプレッション制限',cost:7,text:'割り込み/全キャラ-500/-500(ターン終了まで)',max:2},
  // --- クエスト報酬(クエスト「大食冠ゼラチネを撃破せよ」クリアで解除) ---
  {id:'zeratine',name:'大食冠 ゼラチネ',cost:6,power:300,toughness:300,text:'【分裂】応援3+T+自身を生贄:残りHP÷100体の子供(100/100)(最大10)/【捕食】T+味方1体を生贄:その元の攻撃・HP分 永続強化',max:2},
  {id:'lead',name:'店主 リード',cost:2,power:100,toughness:100,text:'【応援3】+T:山札からキャラをランダムに1枚手札に',max:2},
  {id:'daisuke_dare',name:'ダイスケ誰その男',cost:2,text:'割り込み/場の全ての主人公をダイスケ(100/100)に変える',max:4}
];

var THEME_DECKS = {
  lovecome: [
    // ラブコメ自陣フル 30枚
    {id:'seitokaichou',count:3},{id:'osananajimi',count:3},{id:'onna_joushi',count:3},{id:'imouto',count:3},
    {id:'mensetsu_kan',count:3},{id:'dansou',count:3},{id:'jk_a',count:2},{id:'mamachari',count:2},
    {id:'kyamakiri',count:2},{id:'ki_no_sei',count:2},{id:'alminium',count:2},{id:'kanwa_kyuudai',count:2},
    {id:'shiko_touchou',count:1},{id:'99wari',count:1},{id:'healthy_sleep',count:2},
    // ファンタジーから主力 10枚
    {id:'milia',count:2},{id:'reichen',count:2},{id:'izuna',count:2},
    {id:'ark',count:1},{id:'maoria',count:1},{id:'sagi',count:1},{id:'tomo',count:1},
    // クリエイターからサポート 18枚
    {id:'oyuchi',count:2},{id:'nanase',count:2},{id:'komi',count:1},
    {id:'akapo',count:1},{id:'gomo',count:2},{id:'super_chat',count:2},{id:'kikaku_botsu',count:2},
    {id:'katorina',count:2},{id:'kanaria',count:2},
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
    {id:'oyuchi',count:2},{id:'nari',count:1},{id:'ai_tsubame',count:1},{id:'ichiko',count:1},{id:'seishun_kiben',count:1},{id:'channel_sakujo',count:1},
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
  loadUnlocks(); // 公開状況・解除状況を読み直す(読めたらデッキ編集が描き直される)
  myDeck = {};
  DECK_CARDS.forEach(function(c) { myDeck[c.id] = 0; });
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem('salvado_deck')); } catch(e) {}
  if (saved && saved.length) {
    saved.forEach(function(e) { if (myDeck.hasOwnProperty(e.id)) myDeck[e.id] = e.count; });
  } else {
    // デッキを一度も組んでいない人には初期デッキ(60枚)を入れる。以前は全カード98枚で戦っていて最初の1戦が歪んでいた。
    // 種類はサーバーの設定(/board/lobby の starterDeck)。まだ読めていなければファンタジー
    var key = 'fantasy'; try { key = localStorage.getItem('salvado_starter_deck') || 'fantasy'; } catch(e) {}
    var theme = THEME_DECKS[key] || THEME_DECKS.fantasy;
    theme.forEach(function(e) { if (myDeck.hasOwnProperty(e.id)) myDeck[e.id] = e.count; });
    try { localStorage.setItem('salvado_deck', JSON.stringify(theme.map(function(e) { return { id: e.id, count: e.count }; }))); } catch(e) {}
  }
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
  if (!_unlocked && !_unlockLoading) loadUnlocks(); // 最初の読み込みに失敗していたら、デッキ編集を描くたびに読み直す(読めたらもう一度描かれる)
  let total = 0;
  Object.values(myDeck).forEach(function(v) { total += v; });
  let h = '<div style="position:sticky;top:0;background:#fffdf8;padding:6px 0 8px;z-index:1;border-bottom:2px solid #ffe6c4;">';
  h += '<h3 style="margin:0 0 6px 0;">デッキ編集 (' + total + '/60)</h3>';
  h += '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;">';
  for (let i = 0; i < 5; i++) {
    let has = !!localStorage.getItem('salvado_deck_slot' + i);
    let label = _deckSlotNames[i];
    h += '<div style="display:flex;flex-direction:column;align-items:center;gap:2px;min-width:60px;">';
    h += '<span style="color:' + (has ? '#a07434' : '#c0b0a0') + ';font-size:10px;white-space:nowrap;font-weight:700;">' + (has ? label : '空') + '</span>';
    h += '<div style="display:flex;gap:2px;">';
    h += '<button onclick="saveDeckToSlot(' + i + ')" class="deck-slot-btn">保存</button>';
    if (has) {
      h += '<button onclick="loadDeckFromSlot(' + i + ')" class="deck-slot-btn load">読込</button>';
      h += '<button onclick="deleteDeckSlot(' + i + ')" class="deck-slot-btn del">×</button>';
    }
    h += '</div></div>';
  }
  h += '</div>';
  h += '</div>';
  h += '<div class="deck-cards">';
  var sectionIdx = 0;
  DECK_CARDS.forEach(function(c) {
    let cnt = myDeck[c.id] || 0;
    var hiddenNew = isQuestCard(c.id) && !newCardsVisible(); // 公開前の新カード
    if (sectionIdx < DECK_SECTIONS.length && DECK_SECTIONS[sectionIdx].start === c.id) {
      if (!hiddenNew) h += '<div class="deck-section-header">' + DECK_SECTIONS[sectionIdx].label + '</div>';
      sectionIdx++;
    }
    if (hiddenNew && cnt === 0) return; // 欄ごと出さない(すでにデッキに入っている分だけは、外せるように出す)
    let ptStr = c.power !== undefined ? ' 攻撃' + dv(c.power) + ' HP' + dv(c.toughness) : '';
    let cardType = getDeckCardType(c);
    h += '<div class="deck-card deck-' + cardType + (cnt > 0 ? ' in-deck' : '') + '">';
    h += '<b>' + c.name + '</b> コスト:' + c.cost + ptStr;
    h += '<br><span style="color:#9a8666;font-size:10px;">' + c.text + '</span>';
    if (hiddenNew) {
      h += '<br><span style="color:#b06a20;font-size:10px;font-weight:700;">まだ公開されていないカードです。外してください</span>';
      h += '<br>' + cnt + '/' + c.max + ' <button onclick="deckChange(\'' + c.id + '\',-1)">-</button>';
    } else if (isCardLocked(c.id)) {
      // 未解除: 入れられない。既に入っている分は外せる
      h += '<br><span style="color:#b06a20;font-size:10px;font-weight:700;">🔒 クエスト「大食冠ゼラチネを撃破せよ」クリアで解除</span>';
      if (cnt > 0) h += '<br>' + cnt + '/' + c.max + ' <button onclick="deckChange(\'' + c.id + '\',-1)">-</button>';
    } else {
      h += '<br><button onclick="deckChange(\'' + c.id + '\',1)">+</button> ' + cnt + '/' + c.max + ' <button onclick="deckChange(\'' + c.id + '\',-1)">-</button>';
    }
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
  if (delta > 0 && (isCardLocked(id) || (isQuestCard(id) && !newCardsVisible()))) return; // 未解除・公開前のカードは増やせない
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
  maoria: { name: 'のちの魔王 マオリア', desc: 'コスト7 ATK' + 500 + ' HP' + 500 + '\n【応援4】: ターン終了時まで飛行\n【応援3】+T: ATK+' + 300 + '点ダメージ' },
  tomo: { name: '勇者 トモ', desc: 'コスト8 攻撃' + 800 + ' HP' + 800 + '\n油断しない, 俊足' },
  izuna: { name: '魔法使い イズナ', desc: 'コスト3 攻撃' + 300 + ' HP' + 100 + '\n飛行 / 【応援2】+T: ' + 200 + '点ダメージ' },
  miiko: { name: '僧侶 ミーコ', desc: 'コスト3 攻撃' + 0 + ' HP' + 300 + '\n味方破壊時【応援2】蘇生' },
  parasite: { name: '魔の寄生体', desc: 'コスト4 エンチャント\n攻撃+' + 200 + ' HP+' + 200 + ', 【応援1】蘇生, 魔物生成, ライフロス' },
  akapo: { name: 'あかぽ', desc: 'コスト2\n割り込み / 味方1体 攻撃+' + 500 + '/+0' },
  komi: { name: 'komi', desc: 'コスト1\n割り込み\n味方全回復 / LP300回復' },
  ki_no_sei: { name: '木の精', desc: 'コスト2 エンチャント\nブロック時ダメージ無効' },
  alminium: { name: '頭にアルミホイルを巻く', desc: 'コスト4 エンチャント\n効果の対象にならない' },
  healthy_sleep: { name: '夜しか眠れない健康的な生活', desc: 'コスト1 エンチャント\nHP+300' },
  suisosui: { name: '水素水でナンパする男', desc: 'コスト2 攻撃100 HP100\n登場時:全ヒロインを手札に戻す' },
  yashiro: { name: '山岩ヤシロ', desc: 'コスト4\nLP500支払い / 3枚ドロー' },
  salvado_cat: { name: 'サルベド猫', desc: 'コスト5\n打ち消し不可\nクリエイター3枚サーチ→1枚捨て' },
  makkinii: { name: 'まっきーに', desc: 'コスト5\nクリエイター2枚捨てで無料 / 全体攻撃+' + 300 + ' HP+' + 300 },
  sakamachi: { name: '坂街透', desc: 'コスト3\nイラストレーター3枚→2枚手札, 1枚ゴミ箱' },
  kaera: { name: 'パン屋の娘 カエラ', desc: 'コスト1 攻撃' + 100 + ' HP' + 100 + '\n登場時: LP' + 200 + '回復' },
  jk_a: { name: '一般女子高生A', desc: 'コスト2 攻撃' + 100 + ' HP' + 100 + '\n【応援3】: 攻撃' + 100 + ' HP' + 100 + 'トークン生成' },
  iron_boss: { name: 'Aレイスのボス', desc: 'コスト4 攻撃' + 200 + ' HP' + 300 + '\n悪全体攻撃+' + 100 + ' HP+' + 100 },
  iron_chaser: { name: 'Aレイスの追手', desc: 'コスト2 攻撃' + 100 + ' HP' + 200 + '\n攻撃時他の悪で攻撃+' + 100 },
  asaki: { name: '元掃除屋 アサキ', desc: 'コスト5 攻撃' + 400 + ' HP' + 400 + '\n油断しない\nT: 相手の手札を見る' },
  azusa: { name: '掃除屋 アズサ', desc: 'コスト5 攻撃' + 400 + ' HP' + 300 + '\n2+T: 相手の手札からランダムに1枚捨てさせる' },
  hikaru: { name: 'ひかる', desc: 'コスト2\n2枚ドロー→全タップ' },
  oyuchi: { name: 'おゆち', desc: 'コスト1\n1枚ドロー(イラストレーターなら+1)' },
  nari: { name: 'NARI', desc: 'コスト2\nデッキ上5枚から1枚手札に' },
  ai_tsubame: { name: '愛つばめ', desc: 'コスト3\n3枚ドロー→相手が1枚選んで捨て' },
  ichiko: { name: 'いちこ', desc: 'コスト4\n4択: ' + 300 + '点 / LP' + 500 + '回復 / 攻撃+' + 200 + ' / 相手攻撃-' + 100 },
  douga_sakujo: { name: '動画削除', desc: 'コスト3\n効果1つを打ち消す' },
  shueki_teishi: { name: '収益停止', desc: 'コスト4\n相手の視聴者全タップ' },
  channel_sakujo: { name: 'チャンネル削除', desc: 'コスト6\n全場破壊+手札全捨て+7枚引き直し' },
  shinigami: { name: '死神少女', desc: 'コスト5 攻撃200 HP300\nT+LP300:確定除去 / T+LP200:ハンデス / T+LP500:打ち消し' },
  jun: { name: 'ジュン', desc: 'コスト2 攻撃' + 100 + ' HP' + 200 + '\n登場時: 死神少女サーチ' },
  mamachari: { name: 'ママチャリ暴走族', desc: 'コスト2 攻撃' + 200 + ' HP' + 100 + '\n俊足' },
  kyamakiri: { name: 'キャマキリ', desc: 'コスト1 攻撃' + 100 + ' HP' + 100 + '\n攻撃時攻撃+' + 200 },
  milia: { name: '勇者の血族 ミリア', desc: 'コスト4 攻撃' + 300 + ' HP' + 300 + '\n他の味方攻撃+' + 100 + ' HP+' + 100 },
  daria: { name: '勇者の兄 ダリア', desc: 'コスト3 攻撃' + 0 + ' HP' + 500 + '\n攻撃不可 / ブロック時ダメージ無効' },
  douga_henshuu: { name: '動画編集', desc: 'コスト2\n対象攻撃-' + 300 + ' HP-' + 300 + '(ターン終了まで)' },
  super_chat: { name: '投げ銭', desc: 'コスト1\n味方攻撃+' + 300 + ' HP+' + 300 + '(ターン終了まで)' },
  kikaku_botsu: { name: '企画ボツ', desc: 'コスト4\n投稿キャラ1体破壊' },
  seitokaichou: { name: '生徒会長ヒロイン', desc: 'コスト2 攻撃' + 100 + ' HP' + 100 + '\n油断しない / 登場時: 1枚ドロー' },
  kanaria: { name: 'アイドル カナリア', desc: 'コスト2 攻撃' + 100 + ' HP' + 100 + '\n【応援3】+T: デッキトップを視聴者に追加' },
  osananajimi: { name: '幼馴染ヒロイン', desc: 'コスト2 攻撃' + 100 + ' HP' + 100 + '\n登場時: 主人公サーチ' },
  onna_joushi: { name: '女上司ヒロイン', desc: 'コスト2 攻撃' + 100 + ' HP' + 100 + '\n油断しない / 登場時: デッキトップ確認→シャッフル可' },
  shiko_touchou: { name: '思考盗聴された！', desc: 'コスト0\n相手の手札を見る' },
  seishun_kiben: { name: '青春詭弁', desc: 'コスト5\n割り込み\n手札の主人公/ヒロインを無料投稿' },
  kanwa_kyuudai: { name: '閑話休題', desc: 'コスト5\n割り込み / 全投稿キャラタップ' },
  salvado_cat_yarakashi: { name: 'サルベド猫のやらかし', desc: 'コスト6\n打ち消し不可 / 確定除去(蘇生不可)' },
  '99wari': { name: '99割間違いない', desc: 'コスト9\nLP900支払い / 相手全破壊+全ハンデス' },
  imouto: { name: '妹系ヒロイン', desc: 'コスト1 攻撃100 HP100\n俊足' },
  katorina: { name: 'かとりーな', desc: 'コスト4\nVトークン(攻撃' + 200 + ' HP' + 200 + ')を2体生成' },
  ark: { name: '魔王の血族 アーク', desc: 'コスト8 攻撃' + 500 + ' HP' + 500 + '\n相手全体攻撃-' + 100 + ' HP-' + 100 },
  mensetsu_kan: { name: '面接官ヒロイン', desc: 'コスト3 攻撃' + 100 + ' HP' + 200 + '\n登場時: 相手の主人公1体を破壊\n「私をフった理由を答えなさい」' },
  reichen: { name: '賢者 レイチェン', desc: 'コスト4 攻撃' + 200 + ' HP' + 300 + '\n【応援1】味方1体のダメージ全回復\n【応援4】+T: 相手1体に' + 500 + 'ダメージ' },
  sagi: { name: '盗賊 サギ', desc: 'コスト4 攻撃200 HP200\n俊足, 油断しない\n【応援3】+T+手札1枚: 打ち消し\n【応援4】ゴミ箱からカード1枚回収' },
  yuri: { name: 'アンドロイド ユリ', desc: 'コスト3 攻撃' + 200 + ' HP' + 200 + '\nエンチャント1つにつき攻撃+100/HP+100\n「ほら見てください。手首の関節を回転させられるんです」' },
  smasher: { name: '戦術兵器スマッシャー', desc: 'コスト3 エンチャント\n装備キャラに俊足と+100/+100\nユリ装備時: 俊足, 飛行, +200/+200\n「私専用に作られた戦闘用外部ユニット――識別名はスマッシャー」' },
  rena: { name: '地縛霊 レナ', desc: 'コスト3 エンチャント\n飛行/【応援3】蘇生' },
  zeratine: { name: '大食冠 ゼラチネ', desc: 'コスト6 攻撃300 HP300\n【分裂】応援3+タップ: 自身を生贄。残りHP÷100体のゼラチネ子供(100/100)を出す(最大10体)\n【捕食】タップ: 味方1体を生贄。その元の攻撃・HP分 強化(場にいる間)\n「私はスライムだぞ？」' },
  lead: { name: '店主 リード', desc: 'コスト2 攻撃100 HP100\n【応援3】+T: 山札からキャラをランダムに1枚手札に\n「はいどうぞ。サンドイッチだ」' },
  daisuke_dare: { name: 'ダイスケ誰その男', desc: 'コスト2\n割り込み / 場の全ての主人公をダイスケ(100/100)に変える' },
  lucia: { name: 'ドラゴン娘 ルシア', desc: 'コスト4 攻撃200 HP200\n【応援3】(1ターンに1度): ターン終了時まで+300/+300, 飛行\n【応援5】+T: 自身以外の全キャラに200ダメージ\n「なあ、アルス。こいつ食べていい？」' },
  dansou: { name: '男装系ヒロイン', desc: 'コスト3 攻撃' + 100 + ' HP' + 300 + '\n【応援3】攻撃+200\n「まぁ僕は女だけどね？」' },
  gomo: { name: 'ごも', desc: 'コスト4\nデッキからヒロイン2枚サーチ' },
  nanase: { name: 'ななせ', desc: 'コスト2\n手札が4枚になるようにドロー' },
  douga_fukugen: { name: '動画復元', desc: 'コスト5\n割り込み / ゴミ箱から投稿キャラ1体無料投稿' },
  impression_seigen: { name: 'インプレッション制限', desc: 'コスト7\n割り込み / 全キャラ攻撃-500 HP-500(ターン終了まで)' },
};

// ==== チュートリアルガイドシステム ====
// 案内の箱は画面上部に横長で置き、モーダル(選択画面)が開いている間は自動で👉の1行だけにする(選択肢を隠さない)。
// 「たたむ」は手動、モーダル中は自動、と別に持つ(モーダルを閉じたら自動の分だけ元に戻す)。
var _guideCur = null, _guideManual = false, _guideAuto = false;
function showGuide(body, act, opts) {
  opts = opts || {};
  if (opts.buttons && opts.buttons.length) {
    body = (body || '') + '<div class="tg-btns tg-btns-sm">' + opts.buttons.map(function(b) { return '<button type="button" class="' + (b.dim ? 'tg-dim' : '') + '" onclick="' + b.fn + '">' + b.label + '</button>'; }).join('') + '</div>';
  }
  _guideCur = { body: body || '', act: act || '', low: !!opts.low };
  _guideManual = false;
  renderGuide();
}
function hideGuide() {
  _guideCur = null;
  let el = document.getElementById('tutorialGuide');
  if (el) el.style.display = 'none';
}
function renderGuide() {
  let el = document.getElementById('tutorialGuide');
  if (!el) return;
  if (!_guideCur || !isTutorial) { el.style.display = 'none'; return; }
  // 選択画面の中に説明(.tut-note)を出している間は、案内の箱は消す(二重に出さない・選択肢を隠さない)
  if (_guideAuto && document.getElementById('modal').classList.contains('active') && document.querySelector('#modalContent .tut-note')) { el.style.display = 'none'; return; }
  var compact = _guideManual || _guideAuto;
  var h = '<div class="tg-head"><span class="tg-title">📘 チュートリアル</span><button type="button" class="tg-btn" onclick="toggleGuide(event)">' + (compact ? 'ひらく ▼' : 'たたむ ▲') + '</button></div>';
  if (!compact) h += '<div class="tg-body">' + _guideCur.body + '</div>';
  if (_guideCur.act) h += '<div class="tg-act">👉 ' + _guideCur.act + '</div>';
  else if (compact) h += '<div class="tg-act tg-act-dim">(説明をひらく)</div>';
  el.innerHTML = h;
  el.classList.toggle('tg-compact', compact);
  el.classList.toggle('tg-low', !!_guideCur.low); // 上のバー(LP・メニュー)を説明する時は箱を下げて隠さない
  el.style.display = 'block';
}
function toggleGuide(e) {
  if (e) e.stopPropagation();
  if (_guideManual || _guideAuto) { _guideManual = false; _guideAuto = false; } else { _guideManual = true; }
  renderGuide();
}
function guideModalOpen() { if (isTutorial && _guideCur) { _guideAuto = true; renderGuide(); } }
function guideModalClose() { if (isTutorial && _guideAuto) { _guideAuto = false; renderGuide(); } }

// 進行(tutorialStep):
//  1 ターン1: フォロー  2 キャマキリを投稿  3 ターン終了  4 相手の動画編集に割り込み(動画削除)  5 打ち消し成功(相手の番を待つ)
//  6 ターン2: フォロー  7 妹系ヒロインを投稿  8 カエラを投稿  9 戦闘(2体で攻撃)  10 戦闘結果→ターン終了
//  11 相手の攻撃をカエラでブロック  12 まとめ(以降は自由に操作できる)
var TUT_FREE_STEP = 12;
function tutNote(t) { return '<div class="tut-note">📘 ' + t + '</div>'; }
// 各段階で「プレイ」から出せるカード(それ以外は薄く表示)
var TUT_PLAY_ALLOW = { 2: 'kyamakiri', 7: 'imouto', 8: 'kaera' };
// 最初の「画面の見方」ツアー(各場所を光らせながら1つずつ)。終わったら手順1(フォロー)へ
var TUT_TOUR = [
  { sel: '#myHandMobile,#myHand', body: '光っているのが<b>手札</b>。今は練習用に5枚。実戦では最初に<b>7枚</b>配られて、自分の番のはじめに1枚引く(先攻の最初の番だけ引かない)。' },
  { sel: '#myMana,.top-bar .mana-tb.my', body: '光っているのが<b>視聴者ゾーン</b>。視聴者の数が、1ターンに使える<b>【応援】</b>(カードを出すためのコスト)。<b>1ターンに1回</b>、手札から1枚を視聴者にできる(フォロー)。使った分は薄い表示になり、自分の番が来ると<b>復活</b>する。' },
  { sel: '#controls,#ctrlBottom', body: '画面下の<b>肉球ボタン</b>が操作ボタン。フォロー／プレイ(投稿)／能力／戦闘／ターン終了。チュートリアル中は「今やること」のボタンだけが出る。' },
  { sel: '.top-bar .life-opp', body: '光っている枠が<b>相手</b>。LP(ライフ)と、ゴミ箱・デッキ・手札の枚数。相手の手札の中身は見えない。' },
  { sel: '.top-bar .life-box:not(.life-opp)', body: '光っている枠が<b>自分</b>のLPと、ゴミ箱・デッキの枚数。対人戦では<b>残り時間</b>も表示される。' },
  { sel: '.hamburger-btn', body: '光っている<b>☰</b>がメニュー。<b>降参</b>やエンチャントの早見表はここ。' },
];
var _tourIdx = -1;
function _tourBtns() { return [{ label: '次へ ▶', fn: 'tutorialTourNext()' }, { label: '説明をとばす', fn: 'tutorialTourEnd()', dim: true }]; }
function _tourPick(sel) {
  var els = document.querySelectorAll(sel);
  for (var i = 0; i < els.length; i++) { var r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) return els[i]; }
  return null;
}
// 説明している場所の上に枠を重ねる(要素自身に枠を付けると、はみ出し禁止や重なり順で見えないことがある)
function _tourClearSpot() {
  document.querySelectorAll('.tut-spot').forEach(function(e) { e.classList.remove('tut-spot'); });
  var ring = document.getElementById('tutSpotRing'); if (ring) ring.style.display = 'none';
  var svg = document.getElementById('tutSpotSvg'); if (svg) svg.style.display = 'none';
  if (_tourClearSpot._timer) { clearInterval(_tourClearSpot._timer); _tourClearSpot._timer = null; }
}
// 周りを少し暗くして対象だけ明るく残し、案内の箱から対象まで線を引く(どこの話か一目で分かるように)
function _tourOverlay(r, pad) {
  var svg = document.getElementById('tutSpotSvg');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.id = 'tutSpotSvg';
    svg.innerHTML = '<defs><mask id="tutSpotMask"><rect x="0" y="0" width="100%" height="100%" fill="white"/><rect id="tutSpotHole" rx="14" ry="14" fill="black"/></mask></defs>'
      + '<rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.38)" mask="url(#tutSpotMask)"/>'
      + '<line id="tutSpotLine" stroke="#ffcc33" stroke-width="4" stroke-dasharray="8 6" stroke-linecap="round"/>'
      + '<circle id="tutSpotDot" r="7" fill="#ffcc33" stroke="#fff" stroke-width="2"/>';
    document.body.appendChild(svg);
  }
  svg.setAttribute('width', window.innerWidth); svg.setAttribute('height', window.innerHeight);
  var hole = svg.querySelector('#tutSpotHole');
  hole.setAttribute('x', r.left - pad); hole.setAttribute('y', r.top - pad); hole.setAttribute('width', r.width + pad * 2); hole.setAttribute('height', r.height + pad * 2);
  // 線: 案内の箱の下辺(または上辺)の中央 → 対象の一番近い辺の中央
  var g = document.getElementById('tutorialGuide'); var gr = g ? g.getBoundingClientRect() : null;
  var line = svg.querySelector('#tutSpotLine'), dot = svg.querySelector('#tutSpotDot');
  if (gr && gr.width > 0) {
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var below = cy > gr.bottom; var above = cy < gr.top;
    var x1 = Math.max(gr.left + 20, Math.min(gr.right - 20, cx)), y1 = below ? gr.bottom : (above ? gr.top : (gr.top + gr.bottom) / 2);
    var x2 = cx, y2 = below ? (r.top - pad) : (above ? (r.bottom + pad) : cy);
    if (!below && !above) { x2 = cx < gr.left ? r.right + pad : r.left - pad; x1 = cx < gr.left ? gr.left : gr.right; }
    line.setAttribute('x1', x1); line.setAttribute('y1', y1); line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    dot.setAttribute('cx', x2); dot.setAttribute('cy', y2);
    line.style.display = ''; dot.style.display = '';
  } else { line.style.display = 'none'; dot.style.display = 'none'; }
  svg.style.display = 'block';
}
function _tourSpot(sel) {
  var ring = document.getElementById('tutSpotRing');
  if (!ring) { ring = document.createElement('div'); ring.id = 'tutSpotRing'; document.body.appendChild(ring); }
  var place = function() {
    // 毎回選び直す(画面の回転で見える要素が入れ替わる・メニューのボタンが後から作られる、に追従)
    var el = _tourPick(sel);
    if (!el) { ring.style.display = 'none'; var sv = document.getElementById('tutSpotSvg'); if (sv) sv.style.display = 'none'; return; }
    var r = el.getBoundingClientRect();
    var pad = 8;
    ring.style.left = (r.left - pad) + 'px'; ring.style.top = (r.top - pad) + 'px';
    ring.style.width = (r.width + pad * 2) + 'px'; ring.style.height = (r.height + pad * 2) + 'px';
    ring.style.display = 'block';
    // 対象が画面の上の方(LPの帯など)なら、案内の箱を下げて隠さない
    var low = r.top < 130;
    if (_guideCur && _guideCur.low !== low) { _guideCur.low = low; renderGuide(); }
    _tourOverlay(r, pad);
  };
  place();
  _tourClearSpot._timer = setInterval(place, 300);
}
function tutorialTourStart() {
  tutorialStep = 0.5; _tourIdx = -1;
  showGuide('<p><b>ようこそ！</b> 相手のLP(ライフ)<b>2000</b>を先に0以下にした方の勝ち。</p><p>まず画面の見方を、順番に見ていこう。</p>', '', { buttons: _tourBtns() });
}
function tutorialTourNext() {
  _tourClearSpot();
  _tourIdx++;
  if (_tourIdx >= TUT_TOUR.length) { tutorialTourEnd(); return; }
  var t = TUT_TOUR[_tourIdx];
  showGuide('<p>' + t.body + '</p>', '', { buttons: _tourBtns() });
  _tourSpot(t.sel);
}
function tutorialTourEnd() {
  _tourClearSpot();
  if (tutorialStep !== 0.5) return;
  tutorialStep = 1;
  showGuide('<p>それでは始めよう。自分の番にできることは3つ。<b>①視聴者を増やす ②キャラを投稿する ③攻撃する</b>。順番にやってみよう。</p>',
    '下の<b>「フォロー」</b>を押して、「パン屋の娘 カエラ」を視聴者にする');
  if (typeof render === 'function') render();
}
var TUT_S4_BODY = '<p>✅ <b>動画編集を打ち消した！</b> 相手が何かした直後に出せるカードが<b>「割り込み」</b>。「割り込みますか？」が出た時、出すものが無ければ<b>「パス」</b>でいいよ。</p><p>割り込みで積んだ効果は、<b>後に出したものから順</b>に解決される(この並びが「スタック」)。</p>';

function tutorialCheck() {
  if (!isTutorial || !myState) return;
  let turn = myState.turn;
  let isMyTurn = myState.isMyTurn;
  let phase = myState.phase;
  let field = myState.me ? myState.me.field : [];
  let mana = myState.me ? myState.me.mana : [];

  if (turn === 1 && isMyTurn && phase === 'main') {
    if (tutorialStep === 0) {
      tutorialTourStart();
    } else if (tutorialStep === 1 && mana.length >= 4) {
      tutorialStep = 2;
      showGuide('<p>視聴者が<b>4人</b>になった。カードを出すと、コストの分だけ視聴者が<b>薄い表示(使用済み)</b>になる。自分の番が来るたびに復活するよ。</p>',
        '<b>「プレイ」</b>を押して、「キャマキリ」(コスト1)を投稿');
    } else if (tutorialStep === 2 && field.some(c => c.id === 'kyamakiri')) {
      tutorialStep = 3;
      showGuide('<p>投稿したキャラは、その番は攻撃できない(<b>「俊足」</b>持ちは例外)。キャマキリは<b>攻撃する時だけ攻撃+200</b>になる。</p><p>受けたダメージは残り続けて、HPが0になると破壊されてゴミ箱へ(回復効果でだけ戻る)。</p>',
        '<b>「ターン終了」</b>を押す');
    }
  }
}

function tutorialPromptCheck(type, data) {
  if (!isTutorial) return;
  if (type === 'chain' && tutorialStep === 3) {
    tutorialStep = 4;
    showGuide('<p>⚠️ 相手の<b>「動画編集」</b>で、キャマキリが-300/-300にされそう(HP100なので破壊される)。</p><p>手札の<b>「動画削除」</b>は相手の効果を1つ打ち消せる割り込みカード。</p>',
      '<b>「動画削除」</b>を選ぶ');
  }
  if (type === 'counterspell_target' && tutorialStep === 4) {
    showGuide('<p>打ち消す効果を選ぶ。今は相手の「動画編集」1つだけ。</p>', '<b>「動画編集」</b>を選ぶ');
  }
  if (type === 'block' && tutorialStep === 10) {
    tutorialStep = 11;
    showGuide('<p>⚠️ 相手が<b>「ママチャリ暴走族」(攻撃200)</b>で攻撃してきた！ 相手の攻撃が来ると、この<b>「ブロック選択」</b>が出る。</p><p>横向きでないキャラを選ぶと、そのキャラが代わりに受ける(キャラ同士で戦う)。選ばなければLPが減る。</p>',
      'ママチャリ暴走族の欄で<b>「パン屋の娘 カエラ」</b>を選んで<b>「確定」</b>');
  }
}

// 打ち消しが解決した時(解決演出の後に呼ばれる)
function tutorialCancelResolved() {
  if (!isTutorial || tutorialStep !== 4) return;
  tutorialStep = 5;
  // 読み終わるまで相手役を待たせる(以前は相手がすぐ次のカードを出してターンを終え、読み切れなかった)
  socket.emit('action', { type: 'tutorialHold' });
  tutorialCancelResolved._waiting = true;
  showGuide(TUT_S4_BODY, '読めたら<b>「次へ」</b>を押そう(20秒たつと自動で進むよ)', { buttons: [{ label: '次へ ▶', fn: 'tutorialReadOk()' }] });
  // 「次へ」が出るのはここだけなので、気づかず止まったままにならないよう20秒で自動で進める
  if (tutorialCancelResolved._timer) clearTimeout(tutorialCancelResolved._timer);
  tutorialCancelResolved._timer = setTimeout(function() { tutorialCancelResolved._timer = null; if (isTutorial && tutorialCancelResolved._waiting) tutorialReadOk(); }, 20000);
}
function tutorialReadOk() {
  if (!isTutorial) return;
  if (tutorialCancelResolved._timer) { clearTimeout(tutorialCancelResolved._timer); tutorialCancelResolved._timer = null; }
  if (!tutorialCancelResolved._waiting) return; // 二重に送らない
  tutorialCancelResolved._waiting = false;
  socket.emit('action', { type: 'tutorialContinue' });
  showGuide('<p>相手の番が続くよ。</p>', '相手の番が終わるまで待とう');
}

function tutorialStateCheck() {
  if (!isTutorial || !myState) return;
  let turn = myState.turn;
  let isMyTurn = myState.isMyTurn;
  let field = myState.me ? myState.me.field : [];
  let mana = myState.me ? myState.me.mana : [];
  let oppField = myState.opp ? myState.opp.field : [];

  if (tutorialStep === 5 && !isMyTurn && oppField.some(c => c.id === 'jk_a') && !tutorialStateCheck._jkShown) {
    tutorialStateCheck._jkShown = true;
    tutorialCancelResolved._waiting = false;
    showGuide('<p>相手は<b>「一般女子高生A」(攻撃100/HP100)</b>を投稿した。</p>', '相手の番が終わるまで待とう');
  }

  if (turn === 2 && isMyTurn && myState.phase === 'main') {
    if (tutorialStep === 4 || tutorialStep === 5) {
      tutorialStep = 6;
      showGuide('<p>あなたの番。視聴者が復活した。キャマキリは出した次の番になったので、今度は攻撃できる。まず視聴者を1人増やそう。</p>',
        '<b>「フォロー」</b>でカエラを視聴者に');
    } else if (tutorialStep === 6 && mana.length >= 5) {
      tutorialStep = 7;
      showGuide('<p>応援が5になった。次は<b>「妹系ヒロイン」(コスト1)</b>を出そう。<b>「俊足」</b>持ちなので、出した番からすぐ攻撃できる。</p>',
        '<b>「プレイ」</b>で「妹系ヒロイン」を投稿');
    } else if (tutorialStep === 7 && field.some(c => c.id === 'imouto')) {
      tutorialStep = 8;
      showGuide('<p>もう1枚、<b>「パン屋の娘 カエラ」(コスト1)</b>も投稿しよう。カエラには<b>登場時効果</b>(LP200回復)がある。「登場時」の効果は、場に出た瞬間に自動で働く。</p>',
        '<b>「プレイ」</b>で「パン屋の娘 カエラ」を投稿');
    } else if (tutorialStep === 8 && field.some(c => c.id === 'kaera')) {
      tutorialStep = 9;
      showGuide('<p>LPが200回復した。さあ攻撃。攻撃したキャラは<b>横向き(タップ)</b>になり、次の自分の番まで相手の攻撃を<b>ブロックできない</b>。</p><p>カエラは出したばかりで攻撃できないので、守りに残しておく。</p>',
        '<b>「戦闘」</b>→ キャマキリと妹系ヒロインの<b>両方</b>を押す →<b>「攻撃確定」</b>');
    }
  }
  if (tutorialStep === 9 && isMyTurn && myState.phase === 'attack') {
    showGuide('<p>攻撃するキャラを押して選ぶ。もう一度押すと外れる。</p>', 'キャマキリと妹系ヒロインの<b>両方</b>を押してから<b>「攻撃確定」</b>');
    tutorialStep = 9.5;
  }
  if (tutorialStep === 9.5 && isMyTurn && myState.phase === 'block') {
    showGuide('<p>相手がブロックするか選んでいる…</p>', '少し待とう');
    tutorialStep = 9.6;
  }
}

// 自分の攻撃が終わった(ターン2の main2)
function tutorialCombatResult() {
  if (!isTutorial || !myState) return;
  if (tutorialStep >= 9 && tutorialStep < 10) {
    tutorialStep = 10;
    setTimeout(() => {
      let oppLife = myState && myState.opp ? dv(myState.opp.life) : '?';
      var atk = doConfirmAttack._tutAttackers || [];
      var body = (atk.indexOf('kyamakiri') >= 0 && atk.indexOf('imouto') >= 0)
        ? '<p>⚔️ 相手は一般女子高生Aで<b>キャマキリをブロック</b>した。ブロックされた攻撃は<b>キャラ同士で戦い</b>、されなかった攻撃は<b>相手のLPに直接</b>入る。</p>'
          + '<p>キャマキリ(攻撃300) vs 女子高生A(HP100) → 女子高生A 破壊。女子高生A(攻撃100) vs キャマキリ(HP100) → キャマキリも破壊(相打ち)。</p>'
          + '<p>妹系ヒロインの100は直撃。相手のLP 2000 → <b>' + oppLife + '</b>。これを繰り返して0以下にすれば勝ち。</p>'
        : '<p>⚔️ 戦闘が終わった。ブロックされた攻撃は<b>キャラ同士で戦い</b>、されなかった攻撃は<b>相手のLPに直接</b>入る。相手のLPは <b>' + oppLife + '</b>。これを繰り返して0以下にすれば勝ち。</p>';
      showGuide(body,
        '<b>「ターン終了」</b>を押す(次は相手が攻撃してくる)');
    }, 2500);
  }
}

// 相手の攻撃(ブロック練習)が終わった
function tutorialBlockResult() {
  if (!isTutorial || !myState || tutorialStep !== 11) return;
  // 戦闘が終わった合図: 相手が main2 に進んだ(または自分のターン3が来た)
  if (myState.hasPendingPrompt) return;
  if (!(myState.phase === 'main2' || myState.isMyTurn)) return;
  tutorialStep = TUT_FREE_STEP;
  let blocked = !(myState.me && myState.me.field.some(c => c.id === 'kaera'));
  setTimeout(() => {
    if (!isTutorial) return;
    let head = blocked
      ? '<p>✅ <b>ブロック成功！</b> カエラがママチャリ暴走族を止めた(相打ち)。ブロックしなければLPが200減っていた。</p>'
      : '<p>ブロックしなかったので、LPが200減った。次は横向きでないキャラでブロックしてみよう。</p>';
    showGuide(head
      + '<p><b>これで基本はぜんぶ。</b>覚えておくこと3つ。</p>'
      + '<p>・対人戦は<b>1ターン90秒</b>(残り時間が表示される)。割り込み・ブロックの選択は<b>30秒以内に選ばないと自動でパス</b>(ブロックなし)になる。</p>'
      + '<p>・困ったら<b>☰</b>のメニュー。降参もここ。</p>'
      + '<p>・手札や場のカードをタップ(PCはマウスを乗せる)すると、詳しい説明が出る。</p>'
      + '<div class="tg-btns"><button type="button" onclick="tutorialEnd(\'cpu\')">CPUと対戦してみる</button><button type="button" onclick="tutorialReplay()">もう一回</button><button type="button" onclick="tutorialEnd()">ロビーに戻る</button></div>',
      '');
  }, 3500);
}

// 明示的に対戦を離れて再読込する時は、先にサーバーの席を離れる(離れないと起動時の自動復帰で同じ部屋に戻されてしまう)
function leaveRoomAndReload() {
  try { socket.emit('leaveRoom'); } catch (e) {}
  setTimeout(function() { location.reload(); }, 150);
}
function tutorialEnd(next) {
  var done = tutorialStep >= TUT_FREE_STEP;
  _tourClearSpot();
  isTutorial = false;
  tutorialStep = 0;
  hideGuide();
  try { localStorage.setItem('tutorialDone', '1'); } catch (e) {}
  track('tutorial_end', { result: done ? 'done' : 'quit' });
  if (next === 'cpu') { try { sessionStorage.setItem('afterTutorial', 'cpu'); } catch (e) {} }
  leaveRoomAndReload();
}
function tutorialReplay() {
  isTutorial = false;
  tutorialStep = 0;
  hideGuide();
  sessionStorage.setItem('tutorialReplay', '1');
  leaveRoomAndReload();
}
