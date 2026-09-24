// ロビー掲示板(第1段階) — client.js / account.js の後に読み込む
(function(){
  var TOPICS = [
    { key: 'recruit', label: '対戦募集', icon: 'img/lobby_icon_room.png' },
    { key: 'deck',    label: 'デッキ・質問', icon: 'img/lobby_icon_deck.png' },
    { key: 'chat',    label: '雑談', icon: 'img/lobby_icon_cards.png' },
    { key: 'win',     label: '勝利報告', icon: 'img/lobby_icon_ranking.png' },
  ];
  var BODY_MAX = 200;
  var RULES = '掲示板のルール\n\n・誰かを傷つける言葉、差別的な言葉は書かない\n・URL、LINEやSNSのID、電話番号などの連絡先は書かない\n・個人情報(本名・学校・住所など)は書かない\n・宣伝・勧誘はしない\n\n違反した投稿は運営が削除し、繰り返す場合は投稿できなくなります。\n困った投稿を見つけたら「通報」で教えてください。';
  var LS_RULES = 'salvado_board_rules_ok', LS_AVATAR = 'salvado_board_avatar', LS_TOPIC = 'salvado_board_topic';
  var cur = null, loading = false, pollTimer = null, recruitPending = false, lastList = [], canMod = false;

  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function base(){ return (typeof API_BASE !== 'undefined' && API_BASE) ? API_BASE : ''; }
  function token(){ try { return localStorage.getItem('salvado_auth_token'); } catch(e){ return null; } }
  function loggedIn(){ return !!(window.SalvadoAccount && window.SalvadoAccount.isLoggedIn && window.SalvadoAccount.isLoggedIn()); }
  function myId(){ try { return localStorage.getItem('salvado_player_id'); } catch(e){ return null; } }
  function avatar(){ var a = parseInt(localStorage.getItem(LS_AVATAR)) || 1; return (a >= 1 && a <= 4) ? a : 1; }
  function api(path, opts){
    opts = opts || {};
    var h = { 'Content-Type': 'application/json' };
    if (token()) h['Authorization'] = 'Bearer ' + token();
    return fetch(base() + path, { method: opts.method || 'GET', headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j && j.error || 'エラー'); return j; }); });
  }
  function ago(iso){
    var d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 60) return 'たった今'; if (d < 3600) return Math.floor(d/60) + '分前'; if (d < 86400) return Math.floor(d/3600) + '時間前';
    var t = new Date(iso); return (t.getMonth()+1) + '/' + t.getDate();
  }

  // ---- 描画 ----
  function renderTabs(){
    var el = $('boardTabs'); if (!el) return;
    el.innerHTML = TOPICS.map(function(t){ return '<button data-topic="' + t.key + '" class="' + (t.key === cur ? 'on' : '') + '"><img class="lb-chip-ic" src="' + t.icon + '" alt=""> ' + t.label + '</button>'; }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('button'), function(b){ b.onclick = function(){ setTopic(b.getAttribute('data-topic')); }; });
  }
  function renderCompose(){
    var el = $('boardCompose'); if (!el) return;
    var draft = $('boardText') ? $('boardText').value : '', noticeDraft = $('boardNoticeText') ? $('boardNoticeText').value : ''; // 再描画で入力中の文章を消さない
    if (!loggedIn()) {
      el.innerHTML = '<div class="board-guest">投稿するにはアカウント登録（無料）が必要です<br><button type="button" class="acct-btn primary" id="boardLoginBtn">アカウント登録 / ログイン</button></div>';
      var b = $('boardLoginBtn'); if (b) b.onclick = function(){ if (window.SalvadoAccount) window.SalvadoAccount.openLogin(); };
      return;
    }
    var recruit = cur === 'recruit';
    var modBox = canMod ? '<div class="board-modbox"><b>運営メニュー</b><textarea id="boardNoticeText" rows="2" maxlength="500" placeholder="運営からのお知らせ（最新1件が最上段に固定されます）"></textarea><div class="board-compose-row"><span class="board-avnote">あなたはモデレーターです。全投稿の削除・復活ができます</span><button type="button" class="lb-sub" id="boardNoticeBtn">お知らせを投稿</button></div></div>' : '';
    el.innerHTML = modBox +
      '<div class="board-avatars">' + [1,2,3,4].map(function(i){ return '<img src="img/nyanko/p' + i + '.png" data-av="' + i + '" class="' + (i === avatar() ? 'on' : '') + '" alt="アイコン' + i + '">'; }).join('') + '<span class="board-avnote">アイコン</span></div>' +
      '<textarea id="boardText" maxlength="' + BODY_MAX + '" rows="2" placeholder="' + (recruit ? '募集メッセージ（例: 初心者歓迎！ゆっくり対戦しよう）' : 'メッセージを入力（' + BODY_MAX + '文字まで）') + '"></textarea>' +
      '<div class="board-compose-row"><span id="boardCount" class="board-count">0/' + BODY_MAX + '</span>' +
      (recruit ? '<button type="button" class="lb-sub gold" id="boardRecruitBtn">ルームを作って募集</button>' : '<button type="button" class="lb-sub gold" id="boardPostBtn">投稿する</button>') +
      '</div><div id="boardMsg" class="board-msg"></div>' +
      '<div class="board-blocks"><a href="#" id="boardBlocksLink">ブロック中のユーザーを見る</a><div id="boardBlocksList"></div></div>';
    Array.prototype.forEach.call(el.querySelectorAll('.board-avatars img'), function(img){ img.onclick = function(){ localStorage.setItem(LS_AVATAR, img.getAttribute('data-av')); renderCompose(); }; });
    var ta = $('boardText'); ta.oninput = function(){ $('boardCount').textContent = [...ta.value].length + '/' + BODY_MAX; };
    if (draft) { ta.value = draft; ta.oninput(); }
    if (noticeDraft && $('boardNoticeText')) $('boardNoticeText').value = noticeDraft;
    if ($('boardPostBtn')) $('boardPostBtn').onclick = function(){ submit(null); };
    var bl = $('boardBlocksLink'); if (bl) bl.onclick = function(e){ e.preventDefault(); showBlocks(); };
    var nb = $('boardNoticeBtn'); if (nb) nb.onclick = function(){ var t = $('boardNoticeText'); var body = t && t.value.trim(); if (!body) { msg('お知らせの本文を入力してください'); return; } if (!confirm('この内容を「運営からのお知らせ」として掲示板の最上段に出しますか？')) return; api('/board/notice', { method: 'POST', body: { body: body } }).then(function(){ t.value = ''; msg('お知らせを出しました', true); load(); }).catch(function(e){ msg(e.message); }); };
    if ($('boardRecruitBtn')) $('boardRecruitBtn').onclick = startRecruit;
  }
  function renderList(data){
    var el = $('boardList'); if (!el) return;
    var h = '';
    if (data.notice) h += '<div class="board-notice"><b>運営からのお知らせ</b><div>' + esc(data.notice.body).replace(/\n/g,'<br>') + '</div>' + (canMod ? '<button type="button" class="board-noticedel" data-id="' + data.notice.id + '">お知らせを消す</button>' : '') + '</div>';
    if (!data.posts.length) h += '<div class="board-empty">' + (cur === 'recruit' ? 'いま募集はありません。「ルームを作って募集」で最初の1人になろう！' : 'まだ投稿がありません。最初の1件を書いてみよう！') + '</div>';
    data.posts.forEach(function(p){
      var badge = p.roomId ? (p.roomOpen ? '<button type="button" class="board-join" data-room="' + esc(p.roomId) + '">参加する</button>' : '<span class="board-closed">募集終了</span>') : '';
      var modBadges = canMod ? ((p.hidden ? '<span class="board-badge hidden">非表示中</span>' : '') + (p.reports ? '<span class="board-badge report">通報' + p.reports + '</span>' : '')) : '';
      h += '<div class="board-post' + (p.topic === 'recruit' ? ' recruit' : '') + (p.hidden ? ' is-hidden' : '') + '" data-id="' + p.id + '">' +
        '<img class="board-av" src="img/nyanko/p' + (p.avatar || 1) + '.png" alt="">' +
        '<div class="board-main"><div class="board-head"><span class="board-name">' + esc(p.name) + '</span>' + modBadges + '<span class="board-time">' + ago(p.createdAt) + '</span></div>' +
        '<div class="board-body">' + esc(p.body).replace(/\n/g,'<br>') + '</div>' +
        '<div class="board-actions">' +
          '<button type="button" class="board-like' + (p.liked ? ' on' : '') + '" data-id="' + p.id + '">♥ <span>' + p.likes + '</span></button>' + badge +
          (p.mine ? '<button type="button" class="board-del" data-id="' + p.id + '">削除</button>' :
            '<button type="button" class="board-report" data-id="' + p.id + '">通報</button><button type="button" class="board-block" data-uid="' + esc(p.userId) + '" data-name="' + esc(p.name) + '">ブロック</button>' +
            (canMod ? (p.hidden ? '<button type="button" class="board-restore" data-id="' + p.id + '">復活</button>' : '<button type="button" class="board-del mod" data-id="' + p.id + '">運営削除</button>') : '')) +
        '</div></div></div>';
    });
    el.innerHTML = h;
    Array.prototype.forEach.call(el.querySelectorAll('.board-like'), function(b){ b.onclick = function(){ like(b); }; });
    Array.prototype.forEach.call(el.querySelectorAll('.board-report'), function(b){ b.onclick = function(){ report(b.getAttribute('data-id')); }; });
    Array.prototype.forEach.call(el.querySelectorAll('.board-block'), function(b){ b.onclick = function(){ block(b.getAttribute('data-uid'), b.getAttribute('data-name')); }; });
    Array.prototype.forEach.call(el.querySelectorAll('.board-del'), function(b){ b.onclick = function(){ del(b.getAttribute('data-id')); }; });
    Array.prototype.forEach.call(el.querySelectorAll('.board-join'), function(b){ b.onclick = function(){ joinRecruit(b.getAttribute('data-room')); }; });
    Array.prototype.forEach.call(el.querySelectorAll('.board-restore'), function(b){ b.onclick = function(){ if (!confirm('この投稿を表示に戻しますか？（通報もリセットされます）')) return; api('/board/posts/' + b.getAttribute('data-id') + '/restore', { method: 'POST' }).then(load).catch(function(e){ alert(e.message); }); }; });
    Array.prototype.forEach.call(el.querySelectorAll('.board-noticedel'), function(b){ b.onclick = function(){ if (!confirm('お知らせを消しますか？')) return; api('/board/notice/' + b.getAttribute('data-id'), { method: 'DELETE' }).then(load).catch(function(e){ alert(e.message); }); }; });
  }
  function msg(text, ok){ var m = $('boardMsg'); if (m) { m.textContent = text || ''; m.className = 'board-msg' + (ok ? ' ok' : ''); } }

  // ---- データ ----
  var loadSeq = 0;
  function load(){
    if (!cur) return;
    var topic = cur, seq = ++loadSeq; // 取得中にタブが切り替わった古い応答は捨てる
    api('/board/posts?topic=' + topic).then(function(d){ if (seq !== loadSeq || topic !== cur) return; lastList = d.posts; var wasMod = canMod; canMod = !!d.canMod; if (canMod !== wasMod) renderCompose(); renderList(d); }).catch(function(e){ if (seq !== loadSeq || topic !== cur) return; var el = $('boardList'); if (el) el.innerHTML = '<div class="board-empty">読み込みに失敗しました（' + esc(e.message) + '）</div>'; });
  }
  function setTopic(t){ cur = t; try { localStorage.setItem(LS_TOPIC, t); } catch(e){} renderTabs(); renderCompose(); var el = $('boardList'); if (el) el.innerHTML = '<div class="board-empty">読み込み中...</div>'; load(); }
  function ensureRules(){
    if (localStorage.getItem(LS_RULES) === '1') return true;
    if (confirm(RULES + '\n\n上のルールに同意して投稿しますか？')) { localStorage.setItem(LS_RULES, '1'); return true; }
    return false;
  }
  var submitting = false;
  function setBusy(on){ submitting = on; var b = $('boardPostBtn') || $('boardRecruitBtn'); if (b) b.disabled = on; }
  function submit(roomId){
    var ta = $('boardText'); if (!ta || submitting) return;
    var body = ta.value.trim(); if (!body) { msg('メッセージを入力してください'); return; }
    if (!ensureRules()) return;
    setBusy(true); msg('送信中...');
    api('/board/posts', { method: 'POST', body: { topic: cur, body: body, avatar: avatar(), roomId: roomId || undefined } })
      .then(function(){ ta.value = ''; if ($('boardCount')) $('boardCount').textContent = '0/' + BODY_MAX; msg(roomId ? '募集を出しました。相手が来るまでこのまま待ってください' : '投稿しました', true); load(); })
      .catch(function(e){ msg(e.message); })
      .then(function(){ setBusy(false); });
  }
  // 対戦募集: まず自分のルームを作り(既存の createRoom)、waiting が返ってきたらそのルームIDで投稿する
  function startRecruit(){
    var ta = $('boardText'); if (!ta || !ta.value.trim()) { msg('募集メッセージを入力してください'); return; }
    if (!ensureRules()) return;
    if (typeof socket === 'undefined' || typeof getDisplayName !== 'function') { msg('準備中です'); return; }
    if (recruitPending || submitting) return; // 連打で部屋を作り直さない
    recruitPending = true; setBusy(true); msg('ルームを作成中...');
    socket.emit('createRoom', { name: getDisplayName(), deck: (typeof getMyDeckDef === 'function' ? getMyDeckDef() : undefined), playerId: (typeof getPlayerId === 'function' ? getPlayerId() : myId()) });
    setTimeout(function(){ if (recruitPending) { recruitPending = false; setBusy(false); msg('ルームを作れませんでした（デッキが60枚か確認してください）'); } }, 6000);
  }
  if (typeof socket !== 'undefined') {
    socket.on('waiting', function(d){ if (recruitPending && d && d.roomId) { recruitPending = false; setBusy(false); submit(d.roomId); } });
    socket.on('boardPost', function(d){ if (!cur) return; if (!d || !d.topic || d.topic === cur || d.topic === 'notice' || d.removed) { clearTimeout(pollTimer); pollTimer = setTimeout(load, 500); } });
  }
  function joinRecruit(roomId){
    if (typeof socket === 'undefined') return;
    if (!confirm('この募集に参加して対戦を始めますか？')) return;
    socket.emit('joinRoom', { roomId: roomId, name: getDisplayName(), deck: (typeof getMyDeckDef === 'function' ? getMyDeckDef() : undefined), playerId: (typeof getPlayerId === 'function' ? getPlayerId() : myId()) });
    var st = $('lobbyStatus'); if (st) st.textContent = 'ルーム ' + roomId + ' に参加中...';
  }
  function like(btn){
    if (!loggedIn()) { msg('いいねにはログインが必要です'); if (window.SalvadoAccount) window.SalvadoAccount.openLogin(); return; }
    api('/board/posts/' + btn.getAttribute('data-id') + '/like', { method: 'POST' }).then(function(r){ btn.classList.toggle('on', r.liked); btn.querySelector('span').textContent = r.likes; }).catch(function(e){ msg(e.message); });
  }
  function report(id){
    if (!loggedIn()) { msg('通報にはログインが必要です'); return; }
    var reason = prompt('通報の理由を選んでください（番号でOK）\n1: 暴言・いやがらせ\n2: 連絡先・個人情報\n3: 宣伝・スパム\n4: その他');
    if (reason === null) return;
    api('/board/posts/' + id + '/report', { method: 'POST', body: { reason: reason } }).then(function(){ alert('通報しました。運営が確認します。'); load(); }).catch(function(e){ alert(e.message); });
  }
  function block(uid, name){
    if (!loggedIn()) { msg('ブロックにはログインが必要です'); return; }
    if (!confirm((name || 'この人') + ' の投稿を今後表示しないようにしますか？（掲示板の「ブロック中のユーザーを見る」から解除できます）')) return;
    api('/board/block', { method: 'POST', body: { userId: uid } }).then(function(){ load(); }).catch(function(e){ alert(e.message); });
  }
  function showBlocks(){
    var box = $('boardBlocksList'); if (!box) return;
    box.innerHTML = '読み込み中...';
    api('/board/blocks').then(function(r){
      if (!r.blocked.length) { box.innerHTML = '<span class="board-avnote">ブロック中のユーザーはいません</span>'; return; }
      box.innerHTML = r.blocked.map(function(u){ return '<div class="board-blockrow"><span>' + esc(u.name) + '</span><button type="button" data-uid="' + esc(u.userId) + '">解除</button></div>'; }).join('');
      Array.prototype.forEach.call(box.querySelectorAll('button'), function(b){ b.onclick = function(){ api('/board/block/' + encodeURIComponent(b.getAttribute('data-uid')), { method: 'DELETE' }).then(function(){ showBlocks(); load(); }).catch(function(e){ alert(e.message); }); }; });
    }).catch(function(e){ box.innerHTML = '<span class="board-msg">' + esc(e.message) + '</span>'; });
  }
  function del(id){
    if (!confirm('この投稿を削除しますか？')) return;
    api('/board/posts/' + id, { method: 'DELETE' }).then(function(){ load(); }).catch(function(e){ alert(e.message); });
  }

  // ---- 初期化 ----
  function init(){
    if (!$('boardPanel')) return;
    var saved = null; try { saved = localStorage.getItem(LS_TOPIC); } catch(e){}
    cur = TOPICS.some(function(t){ return t.key === saved; }) ? saved : 'recruit';
    renderTabs(); renderCompose(); load();
    setInterval(function(){ var lb = $('lobbyScreen'); if (lb && lb.classList.contains('active') && !document.hidden) load(); }, 30000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.SalvadoBoard = { reload: load, setTopic: setTopic };
})();
