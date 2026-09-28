// ロビー上部: 運営お知らせ(猫耳パネル) / 参加できる募集 / オンライン人数 / 各パネルの「i」説明 — board.js の後に読み込む
(function(){
  var LS_DISMISS = 'salvado_notice_dismissed';
  var REFRESH_MS = 20000;
  var help = null, helpLoading = null, lastData = null, timer = null, openPop = null, seq = 0, popSeq = 0;

  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function base(){ return (typeof API_BASE !== 'undefined' && API_BASE) ? API_BASE : ''; }
  function token(){ try { return localStorage.getItem('salvado_auth_token'); } catch(e){ return null; } }
  function get(path){
    var h = {}; var t = token(); if (t) h['Authorization'] = 'Bearer ' + t;
    return fetch(base() + path, { headers: h }).then(function(r){ return r.json().then(function(d){ if (!r.ok) throw new Error(d.error || '通信に失敗しました'); return d; }); });
  }
  function lobbyActive(){ var lb = $('lobbyScreen'); return !!(lb && lb.classList.contains('active')) && !document.hidden; }
  function fmtDate(iso){ var d = new Date(iso); if (isNaN(d)) return ''; return (d.getMonth() + 1) + '/' + d.getDate(); }

  // ---- 運営からのお知らせ ----
  function renderNotice(n){
    var box = $('lobbyNotice'); if (!box) return;
    var dismissed = null; try { dismissed = localStorage.getItem(LS_DISMISS); } catch(e){}
    if (!n || String(n.id) === dismissed) { box.hidden = true; return; }
    box.hidden = false; box.classList.remove('open');
    $('lobbyNoticeBody').textContent = n.body;
    $('lobbyNoticeDate').textContent = fmtDate(n.createdAt);
    var more = $('lobbyNoticeMore');
    // 2行に収まっていれば「全文を読む」は出さない
    var body = $('lobbyNoticeBody');
    more.hidden = !(body.scrollHeight > body.clientHeight + 2);
    more.textContent = '全文を読む ▼';
    $('lobbyNoticeClose').onclick = function(){ try { localStorage.setItem(LS_DISMISS, String(n.id)); } catch(e){} box.hidden = true; };
    more.onclick = function(){ var o = box.classList.toggle('open'); more.textContent = o ? '閉じる ▲' : '全文を読む ▼'; };
  }

  // ---- 参加できる募集 ----
  function renderRecruit(d){
    var list = $('lobbyRecruitList'), cnt = $('lobbyRecruitCount'), on = $('lobbyOnline'); if (!list) return;
    var items = d.recruits || [];
    cnt.textContent = (d.recruitCount || 0) + '件';
    if (typeof d.online === 'number' && d.online > 0) { on.textContent = 'いまオンライン ' + d.online + '人'; on.hidden = false; } else { on.hidden = true; }
    var h = '';
    if (d.mine) h += '<div class="lb-recruit-item mine"><span class="lb-recruit-name">あなたの募集</span><span class="lb-recruit-msg">' + esc(d.mine.body) + '</span><span class="lb-recruit-wait">相手を待っています…</span></div>';
    items.slice(0, 2).forEach(function(p){
      h += '<div class="lb-recruit-item" data-room="' + esc(p.roomId) + '"><img class="lb-recruit-av" src="img/nyanko/p' + (p.avatar >= 1 && p.avatar <= 4 ? p.avatar : 1) + '.png" alt=""><span class="lb-recruit-name">' + esc(p.name) + '</span><span class="lb-recruit-msg">' + esc(p.body) + '</span><button type="button" class="lb-sub gold lb-recruit-join">参加する</button></div>';
    });
    if (!items.length && !d.mine) h = '<div class="lb-recruit-empty">いま募集はありません。「募集を出す」で最初の1人になろう！（急ぐならクイックマッチ）</div>';
    list.innerHTML = h;
    Array.prototype.forEach.call(list.querySelectorAll('.lb-recruit-join'), function(b){
      b.onclick = function(){ var rid = b.parentNode.getAttribute('data-room'); if (window.SalvadoBoard && window.SalvadoBoard.joinRecruit) window.SalvadoBoard.joinRecruit(rid); };
    });
  }
  function goBoard(compose){
    if (window.SalvadoBoard && window.SalvadoBoard.setTopic) window.SalvadoBoard.setTopic('recruit');
    var p = $('boardPanel'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (compose) setTimeout(function(){ if (window.SalvadoBoard && window.SalvadoBoard.focusCompose) window.SalvadoBoard.focusCompose(); }, 500);
  }

  function refresh(){
    if (!$('lobbyRecruit')) return;
    var my = ++seq; // 先に出した古い応答が、後から来て新しい表示を上書きしないように
    get('/board/lobby').then(function(d){ if (my !== seq) return; lastData = d; setStale(false); renderNotice(d.notice); renderRecruit(d); })
      .catch(function(){ if (my !== seq) return; setStale(true); if (!lastData) { var l = $('lobbyRecruitList'); if (l) l.innerHTML = '<div class="lb-recruit-empty">募集を読み込めませんでした</div>'; } }); // 失敗を「0件」と見せない
  }
  // 取得に失敗した時: 件数を「-」にして注記を出す(前回の一覧は残すが、最新ではないと分かるように)
  function setStale(on){
    var cnt = $('lobbyRecruitCount'), box = $('lobbyRecruit'); if (!cnt || !box) return;
    var note = $('lobbyRecruitStale');
    if (on) { cnt.textContent = '-'; if (!note) { note = document.createElement('div'); note.id = 'lobbyRecruitStale'; note.className = 'lb-recruit-stale'; note.textContent = '最新の状態を取得できませんでした（通信を確認してください）'; box.insertBefore(note, $('lobbyRecruitList')); } }
    else if (note) note.remove();
  }
  function schedule(){ clearTimeout(timer); timer = setTimeout(function(){ if (lobbyActive()) refresh(); schedule(); }, REFRESH_MS); }
  var soonTimer = null;
  // 直近の更新をまとめる。連続で呼ばれても最初の予約(600ms後)は動かさない(他人のイベント連打で更新が永遠に先延ばしにならないように)
  function soon(){ if (soonTimer) return; soonTimer = setTimeout(function(){ soonTimer = null; if (lobbyActive()) refresh(); schedule(); }, 600); }

  // ---- 「i」説明 ----
  function closePop(){ popSeq++; if (openPop) { openPop.pop.remove(); openPop.btn.classList.remove('open'); openPop = null; } } // 読み込み中の吹き出しも取り消す(Escや外タップの後に遅れて開かない)
  function loadHelp(){
    if (help) return Promise.resolve(help);
    if (!helpLoading) helpLoading = get('/board/help').then(function(d){ help = d || {}; return help; }).catch(function(){ helpLoading = null; return {}; });
    return helpLoading;
  }
  function showPop(btn){
    var key = btn.getAttribute('data-help');
    if (openPop && openPop.btn === btn) { closePop(); return; }
    closePop();
    var my = popSeq; // 読み込み中に連打・Esc・外タップがあれば popSeq が進み、この応答は捨てる
    loadHelp().then(function(h){
      if (my !== popSeq) return;
      var t = h && h[key]; if (!t) { t = { title: '説明', lines: ['説明を読み込めませんでした'] }; }
      var pop = document.createElement('div'); pop.className = 'lb-info-pop' + (btn.classList.contains('sm') ? ' gold' : '');
      pop.innerHTML = '<b>' + esc(t.title) + '</b>' + (t.lines || []).map(function(l){ return '<div>' + String(l).replace(/<(?!\/?b>)[^>]*>/g, '') + '</div>'; }).join('');
      if (btn.classList.contains('sm')) btn.parentNode.parentNode.insertBefore(pop, btn.parentNode.nextSibling); // 募集枠: 見出しの下に差し込む
      else btn.parentNode.appendChild(pop); // パネル: 右上のボタンの下
      btn.classList.add('open'); openPop = { btn: btn, pop: pop };
    });
  }
  function initHelp(){
    Array.prototype.forEach.call(document.querySelectorAll('#lobbyScreen .lb-info'), function(b){ b.onclick = function(e){ e.stopPropagation(); showPop(b); }; });
    document.addEventListener('click', function(e){ if (!openPop || !openPop.pop.contains(e.target)) closePop(); }); // 読み込み中(openPop無し)の外タップも取り消す
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closePop(); });
  }

  function init(){
    if (!$('lobbyScreen')) return;
    initHelp();
    var pb = $('lobbyRecruitPost'); if (pb) pb.onclick = function(){ goBoard(true); };
    var mb = $('lobbyRecruitMore'); if (mb) mb.onclick = function(){ goBoard(false); };
    refresh(); schedule();
    document.addEventListener('visibilitychange', function(){ if (!document.hidden) soon(); });
    if (typeof socket !== 'undefined') {
      socket.on('boardPost', soon);      // 投稿・削除・お知らせ
      socket.on('lobbyRooms', soon);     // 募集が埋まった／取り消された
      socket.on('connect', soon);
      socket.on('recruitCancelled', soon);
      socket.on('waiting', soon);
    }
    // ログイン/ログアウトで自分の募集の見え方が変わる
    window.addEventListener('salvado-auth-changed', soon);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.SalvadoLobby = { refresh: refresh };
})();
