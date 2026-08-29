// アカウント機能(メール+パスワード) クライアント側 — 2026-08
// client.js より前に読み込む。ログイン中は salvado_player_id をアカウントIDに差し替えることで、
// 既存の対戦・ランキング・デッキ処理をそのままアカウント紐付きにする(過去データの移行はしない)。
(function(){
  var LS_TOKEN = 'salvado_auth_token';
  var LS_ACCOUNT = 'salvado_account';      // {id,email,display_name}
  var LS_GUEST_ID = 'salvado_guest_id';    // ログイン前の匿名IDを退避
  var LS_GUEST_NAME = 'salvado_guest_name';
  var LS_GUEST_DECKS = 'salvado_guest_decks';
  var DECK_KEYS = ['salvado_deck','salvado_deck_names','salvado_deck_slot0','salvado_deck_slot1','salvado_deck_slot2','salvado_deck_slot3','salvado_deck_slot4'];

  function apiBase(){
    return (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ? 'https://game.sarubedo.jp' : '';
  }
  function getToken(){ try { return localStorage.getItem(LS_TOKEN) || ''; } catch(e){ return ''; } }
  function getAccount(){ try { return JSON.parse(localStorage.getItem(LS_ACCOUNT) || 'null'); } catch(e){ return null; } }
  function isLoggedIn(){ return !!(getToken() && getAccount()); }

  // ---- 起動時: ログイン中なら player_id をアカウントIDに固定(client.jsが読む前に) ----
  var acc = getAccount();
  if (acc && getToken()) {
    localStorage.setItem('salvado_player_id', acc.id);
    if (acc.display_name) localStorage.setItem('salvado_player_name', acc.display_name);
    window.SALVADO_SOCKET_AUTH = { token: getToken() };
  }

  function api(path, opts){
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (getToken()) headers['Authorization'] = 'Bearer ' + getToken();
    return fetch(apiBase() + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(j){
        if (!r.ok) throw new Error(j.error || ('エラー(' + r.status + ')'));
        return j;
      });
    });
  }

  // ---- デッキの退避/復元(ゲストのデッキとアカウントのデッキを混ぜない) ----
  function stashGuestDecks(){
    var o = {};
    DECK_KEYS.forEach(function(k){ var v = localStorage.getItem(k); if (v !== null) o[k] = v; });
    localStorage.setItem(LS_GUEST_DECKS, JSON.stringify(o));
  }
  function clearDecks(){ DECK_KEYS.forEach(function(k){ localStorage.removeItem(k); }); }
  function restoreGuestDecks(){
    clearDecks();
    try {
      var o = JSON.parse(localStorage.getItem(LS_GUEST_DECKS) || '{}');
      Object.keys(o).forEach(function(k){ localStorage.setItem(k, o[k]); });
    } catch(e) {}
    localStorage.removeItem(LS_GUEST_DECKS);
  }
  // サーバーのデッキをlocalStorageに展開
  function pullDecks(accId){
    return api('/api/user/' + accId + '/decks').then(function(rows){
      clearDecks();
      var names = ['スロット1','スロット2','スロット3','スロット4','スロット5'];
      (rows || []).forEach(function(r){
        if (r.slot < 0 || r.slot > 4 || !r.deck_data) return;
        localStorage.setItem('salvado_deck_slot' + r.slot, typeof r.deck_data === 'string' ? r.deck_data : JSON.stringify(r.deck_data));
        if (r.name) names[r.slot] = r.name;
      });
      localStorage.setItem('salvado_deck_names', JSON.stringify(names));
    }).catch(function(){});
  }

  // ---- ログイン状態の切替(切替後はページを再読込して全状態をリセット) ----
  function enterAccount(token, user){
    if (!isLoggedIn()) {
      localStorage.setItem(LS_GUEST_ID, localStorage.getItem('salvado_player_id') || '');
      localStorage.setItem(LS_GUEST_NAME, localStorage.getItem('salvado_player_name') || '');
      stashGuestDecks();
    }
    localStorage.setItem(LS_TOKEN, token);
    localStorage.setItem(LS_ACCOUNT, JSON.stringify(user));
    localStorage.setItem('salvado_player_id', user.id);
    localStorage.setItem('salvado_player_name', user.display_name || '');
    return pullDecks(user.id).then(function(){ location.reload(); });
  }
  function leaveAccount(){
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_ACCOUNT);
    var gid = localStorage.getItem(LS_GUEST_ID);
    if (gid) localStorage.setItem('salvado_player_id', gid); else localStorage.removeItem('salvado_player_id');
    localStorage.setItem('salvado_player_name', localStorage.getItem(LS_GUEST_NAME) || '');
    restoreGuestDecks();
    location.reload();
  }

  // ---- デッキ保存/削除をサーバーにも同期(ログイン中のみ) ----
  function hookDeckSync(){
    var origSave = window.saveDeckToSlot, origDel = window.deleteDeckSlot;
    if (typeof origSave === 'function') {
      window.saveDeckToSlot = function(slot){
        origSave(slot);
        if (!isLoggedIn()) return;
        var data = localStorage.getItem('salvado_deck_slot' + slot);
        if (!data) return;
        var names = []; try { names = JSON.parse(localStorage.getItem('salvado_deck_names') || '[]'); } catch(e){}
        api('/api/user/' + getAccount().id + '/decks', { method: 'POST', body: { slot: slot, name: names[slot] || '', deck_data: data } }).catch(function(e){ console.warn('[account] deck sync:', e.message); });
      };
    }
    if (typeof origDel === 'function') {
      window.deleteDeckSlot = function(slot){
        var before = localStorage.getItem('salvado_deck_slot' + slot);
        origDel(slot);
        if (!isLoggedIn() || !before || localStorage.getItem('salvado_deck_slot' + slot)) return;
        api('/api/user/' + getAccount().id + '/decks/' + slot, { method: 'DELETE' }).catch(function(){});
      };
    }
  }

  // ---- UI ----
  var css = document.createElement('style');
  css.textContent =
    '.acct-bar{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin:10px auto 4px;max-width:420px;}' +
    '.acct-btn{font-size:13px;font-weight:800;color:#a07434;background:#fff;border:3px solid #ffd9a8;border-radius:999px;padding:7px 16px;cursor:pointer;box-shadow:0 4px 0 rgba(180,140,90,0.18);}' +
    '.acct-btn.primary{color:#fff;background:linear-gradient(180deg,#b89cf0,#8d6ad6);border-color:#fff;box-shadow:0 4px 0 #6d49c8;}' +
    '.acct-badge{font-size:12px;font-weight:800;color:#6d49c8;background:#f1eaff;border:2px solid #d9c8ff;border-radius:999px;padding:5px 12px;}' +
    '.acct-form{display:flex;flex-direction:column;gap:10px;max-width:320px;margin:0 auto;text-align:left;}' +
    '.acct-form label{font-size:12px;font-weight:800;color:#9a8666;}' +
    '.acct-form input{width:100%;padding:10px 14px;font-size:15px;border:3px solid #ffd9a8;border-radius:14px;background:#fffdf8;color:#5a4a32;}' +
    '.acct-form .acct-submit{margin-top:6px;font-size:16px;font-weight:900;color:#fff;background:linear-gradient(180deg,#5fd5e3,#2fb6cb);border:3px solid #fff;border-radius:999px;padding:11px 22px;cursor:pointer;box-shadow:0 4px 0 #1f93a6;}' +
    '.acct-form .acct-submit.danger{background:linear-gradient(180deg,#ff8a8a,#ef5a6a);box-shadow:0 4px 0 #c43a4a;}' +
    '.acct-form .acct-submit:disabled{opacity:0.6;cursor:default;}' +
    '.acct-msg{min-height:18px;font-size:13px;font-weight:700;color:#e0524a;text-align:center;}' +
    '.acct-msg.ok{color:#1f93a6;}' +
    '.acct-links{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:8px;}' +
    '.acct-links a{font-size:13px;font-weight:800;color:#6d49c8;cursor:pointer;text-decoration:underline;}' +
    '.acct-stats{display:flex;gap:10px;justify-content:center;margin:6px 0 12px;}' +
    '.acct-stats div{background:#fff7ea;border:3px solid #ffe6c4;border-radius:14px;padding:8px 14px;font-size:12px;color:#9a8666;font-weight:800;}' +
    '.acct-stats b{display:block;font-size:20px;color:#5a4a32;}' +
    '.acct-note{font-size:12px;color:#9a8666;margin-top:8px;line-height:1.6;}';
  document.head.appendChild(css);

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function modal(html){ if (typeof window.showModal === 'function') window.showModal(html, 'pop'); }
  function closeModal(){ if (typeof window.closeModal === 'function') window.closeModal(); }
  function setMsg(id, text, ok){ var el = document.getElementById(id); if (el) { el.textContent = text || ''; el.className = 'acct-msg' + (ok ? ' ok' : ''); } }
  function busy(btn, on){ if (btn) { btn.disabled = on; } }

  function renderBar(){
    var host = document.getElementById('profileSection');
    if (!host) return;
    var bar = document.getElementById('acctBar');
    // profileSection(横並びflex)の中ではなく、その直後に独立した行として置く
    if (!bar) { bar = document.createElement('div'); bar.id = 'acctBar'; bar.className = 'acct-bar'; host.parentNode.insertBefore(bar, host.nextSibling); }
    if (isLoggedIn()) {
      var a = getAccount();
      bar.innerHTML = '<span class="acct-badge">ログイン中: ' + esc(a.display_name || a.email) + '</span>' +
        '<button type="button" class="acct-btn" id="acctSettingsBtn">アカウント設定</button>' +
        '<button type="button" class="acct-btn" id="acctLogoutBtn">ログアウト</button>';
      document.getElementById('acctSettingsBtn').onclick = openSettings;
      document.getElementById('acctLogoutBtn').onclick = function(){ if (confirm('ログアウトしますか？')) doLogout(); };
      // ログイン中は「名前変更」ボタンを隠す(名前はアカウント設定から)
      var edit = document.querySelector('#profileRegistered .lb-edit'); if (edit) edit.style.display = 'none';
    } else {
      bar.innerHTML = '<button type="button" class="acct-btn primary" id="acctOpenBtn">アカウント登録 / ログイン</button>' +
        '<span class="acct-note" style="margin:0;width:100%;text-align:center;">登録すると勝敗・デッキが保存され、別の端末でも引き継げます</span>';
      document.getElementById('acctOpenBtn').onclick = openLogin;
    }
  }

  // --- ログイン ---
  function openLogin(){
    modal(
      '<div class="qm-title">ログイン</div>' +
      '<form class="acct-form" id="acctLoginForm">' +
        '<label>メールアドレス<input type="email" id="acctLoginEmail" autocomplete="email" required></label>' +
        '<label>パスワード<input type="password" id="acctLoginPw" autocomplete="current-password" required></label>' +
        '<div class="acct-msg" id="acctLoginMsg"></div>' +
        '<button type="submit" class="acct-submit">ログイン</button>' +
      '</form>' +
      '<div class="acct-links"><a id="acctToRegister">新規登録はこちら</a><a id="acctToForgot">パスワードを忘れた</a></div>' +
      '<button type="button" class="qm-back" id="acctClose">閉じる</button>'
    );
    document.getElementById('acctToRegister').onclick = openRegister;
    document.getElementById('acctToForgot').onclick = openForgot;
    document.getElementById('acctClose').onclick = closeModal;
    document.getElementById('acctLoginForm').onsubmit = function(e){
      e.preventDefault();
      var btn = this.querySelector('.acct-submit'); busy(btn, true); setMsg('acctLoginMsg', '');
      api('/auth/login', { method: 'POST', body: { email: document.getElementById('acctLoginEmail').value, password: document.getElementById('acctLoginPw').value } })
        .then(function(r){ setMsg('acctLoginMsg', 'ログインしました', true); return enterAccount(r.token, r.user); })
        .catch(function(err){ setMsg('acctLoginMsg', err.message); busy(btn, false); });
    };
  }

  // --- 新規登録 ---
  function openRegister(){
    var guestName = localStorage.getItem('salvado_player_name') || '';
    modal(
      '<div class="qm-title">アカウント登録</div>' +
      '<form class="acct-form" id="acctRegForm">' +
        '<label>プレイヤー名<input type="text" id="acctRegName" maxlength="30" value="' + esc(guestName) + '" required></label>' +
        '<label>メールアドレス<input type="email" id="acctRegEmail" autocomplete="email" required></label>' +
        '<label>パスワード(8文字以上)<input type="password" id="acctRegPw" autocomplete="new-password" minlength="8" required></label>' +
        '<label>パスワード(確認)<input type="password" id="acctRegPw2" autocomplete="new-password" minlength="8" required></label>' +
        '<div class="acct-msg" id="acctRegMsg"></div>' +
        '<button type="submit" class="acct-submit">登録する</button>' +
      '</form>' +
      '<div class="acct-note">※ 登録後の勝敗・デッキはこのアカウントに保存されます。<br>今までのゲストのデータは引き継がれません。</div>' +
      '<div class="acct-links"><a id="acctToLogin">ログインはこちら</a></div>' +
      '<button type="button" class="qm-back" id="acctClose">閉じる</button>'
    );
    document.getElementById('acctToLogin').onclick = openLogin;
    document.getElementById('acctClose').onclick = closeModal;
    document.getElementById('acctRegForm').onsubmit = function(e){
      e.preventDefault();
      var pw = document.getElementById('acctRegPw').value, pw2 = document.getElementById('acctRegPw2').value;
      if (pw !== pw2) { setMsg('acctRegMsg', 'パスワード(確認)が一致しません'); return; }
      var btn = this.querySelector('.acct-submit'); busy(btn, true); setMsg('acctRegMsg', '');
      api('/auth/register', { method: 'POST', body: { name: document.getElementById('acctRegName').value, email: document.getElementById('acctRegEmail').value, password: pw } })
        .then(function(r){ setMsg('acctRegMsg', '登録しました', true); return enterAccount(r.token, r.user); })
        .catch(function(err){ setMsg('acctRegMsg', err.message); busy(btn, false); });
    };
  }

  // --- パスワード忘れ ---
  function openForgot(){
    modal(
      '<div class="qm-title">パスワード再設定</div>' +
      '<form class="acct-form" id="acctForgotForm">' +
        '<label>登録したメールアドレス<input type="email" id="acctForgotEmail" autocomplete="email" required></label>' +
        '<div class="acct-msg" id="acctForgotMsg"></div>' +
        '<button type="submit" class="acct-submit">再設定メールを送る</button>' +
      '</form>' +
      '<div class="acct-note">メールに届くリンク(1時間有効)から新しいパスワードを設定できます。</div>' +
      '<div class="acct-links"><a id="acctToLogin">ログインに戻る</a></div>' +
      '<button type="button" class="qm-back" id="acctClose">閉じる</button>'
    );
    document.getElementById('acctToLogin').onclick = openLogin;
    document.getElementById('acctClose').onclick = closeModal;
    document.getElementById('acctForgotForm').onsubmit = function(e){
      e.preventDefault();
      var btn = this.querySelector('.acct-submit'); busy(btn, true); setMsg('acctForgotMsg', '');
      api('/auth/forgot', { method: 'POST', body: { email: document.getElementById('acctForgotEmail').value } })
        .then(function(){ setMsg('acctForgotMsg', '送信しました。メールを確認してください', true); })
        .catch(function(err){ setMsg('acctForgotMsg', err.message); busy(btn, false); });
    };
  }

  // --- 再設定リンクから開いた時(?reset=TOKEN) ---
  function openReset(token){
    modal(
      '<div class="qm-title">新しいパスワード</div>' +
      '<form class="acct-form" id="acctResetForm">' +
        '<label>新しいパスワード(8文字以上)<input type="password" id="acctResetPw" autocomplete="new-password" minlength="8" required></label>' +
        '<label>パスワード(確認)<input type="password" id="acctResetPw2" autocomplete="new-password" minlength="8" required></label>' +
        '<div class="acct-msg" id="acctResetMsg"></div>' +
        '<button type="submit" class="acct-submit">パスワードを変更する</button>' +
      '</form>' +
      '<button type="button" class="qm-back" id="acctClose">閉じる</button>'
    );
    document.getElementById('acctClose').onclick = closeModal;
    document.getElementById('acctResetForm').onsubmit = function(e){
      e.preventDefault();
      var pw = document.getElementById('acctResetPw').value, pw2 = document.getElementById('acctResetPw2').value;
      if (pw !== pw2) { setMsg('acctResetMsg', 'パスワード(確認)が一致しません'); return; }
      var btn = this.querySelector('.acct-submit'); busy(btn, true); setMsg('acctResetMsg', '');
      api('/auth/reset', { method: 'POST', body: { token: token, password: pw } })
        .then(function(){ setMsg('acctResetMsg', '変更しました。新しいパスワードでログインしてください', true); setTimeout(openLogin, 1200); })
        .catch(function(err){ setMsg('acctResetMsg', err.message); busy(btn, false); });
    };
  }

  // --- アカウント設定(戦績・名前変更・パスワード変更・削除) ---
  function openSettings(){
    var a = getAccount();
    modal(
      '<div class="qm-title">アカウント設定</div>' +
      '<div class="acct-stats" id="acctStats"><div>勝利<b>-</b></div><div>敗北<b>-</b></div><div>ボスラッシュ<b>-</b></div></div>' +
      '<form class="acct-form" id="acctNameForm">' +
        '<label>プレイヤー名<input type="text" id="acctSetName" maxlength="30" value="' + esc(a.display_name || '') + '" required></label>' +
        '<div class="acct-msg" id="acctNameMsg"></div>' +
        '<button type="submit" class="acct-submit">名前を変更</button>' +
      '</form>' +
      '<div class="acct-note">メールアドレス: ' + esc(a.email) + '</div>' +
      '<div class="acct-links"><a id="acctToPw">パスワード変更</a><a id="acctToDelete" style="color:#e0524a;">アカウント削除</a></div>' +
      '<button type="button" class="qm-back" id="acctClose">閉じる</button>'
    );
    document.getElementById('acctClose').onclick = closeModal;
    document.getElementById('acctToPw').onclick = openChangePw;
    document.getElementById('acctToDelete').onclick = openDelete;
    api('/auth/me').then(function(r){
      var s = r.stats || {};
      var el = document.getElementById('acctStats');
      if (el) el.innerHTML = '<div>勝利<b>' + (s.wins||0) + '</b></div><div>敗北<b>' + (s.losses||0) + '</b></div><div>ボスラッシュ<b>' + (s.endless||0) + '</b></div>';
    }).catch(function(){});
    document.getElementById('acctNameForm').onsubmit = function(e){
      e.preventDefault();
      var name = document.getElementById('acctSetName').value;
      var btn = this.querySelector('.acct-submit'); busy(btn, true); setMsg('acctNameMsg', '');
      api('/auth/name', { method: 'POST', body: { name: name } }).then(function(r){
        a.display_name = r.display_name; localStorage.setItem(LS_ACCOUNT, JSON.stringify(a));
        localStorage.setItem('salvado_player_name', r.display_name);
        setMsg('acctNameMsg', '変更しました', true); busy(btn, false);
        setTimeout(function(){ location.reload(); }, 600);
      }).catch(function(err){ setMsg('acctNameMsg', err.message); busy(btn, false); });
    };
  }
  function openChangePw(){
    modal(
      '<div class="qm-title">パスワード変更</div>' +
      '<form class="acct-form" id="acctPwForm">' +
        '<label>現在のパスワード<input type="password" id="acctPwCur" autocomplete="current-password" required></label>' +
        '<label>新しいパスワード(8文字以上)<input type="password" id="acctPwNew" autocomplete="new-password" minlength="8" required></label>' +
        '<label>新しいパスワード(確認)<input type="password" id="acctPwNew2" autocomplete="new-password" minlength="8" required></label>' +
        '<div class="acct-msg" id="acctPwMsg"></div>' +
        '<button type="submit" class="acct-submit">変更する</button>' +
      '</form>' +
      '<div class="acct-links"><a id="acctBack">設定に戻る</a></div>' +
      '<button type="button" class="qm-back" id="acctClose">閉じる</button>'
    );
    document.getElementById('acctClose').onclick = closeModal;
    document.getElementById('acctBack').onclick = openSettings;
    document.getElementById('acctPwForm').onsubmit = function(e){
      e.preventDefault();
      var pw = document.getElementById('acctPwNew').value, pw2 = document.getElementById('acctPwNew2').value;
      if (pw !== pw2) { setMsg('acctPwMsg', '新しいパスワード(確認)が一致しません'); return; }
      var btn = this.querySelector('.acct-submit'); busy(btn, true); setMsg('acctPwMsg', '');
      api('/auth/password', { method: 'POST', body: { current: document.getElementById('acctPwCur').value, password: pw } })
        .then(function(){ setMsg('acctPwMsg', '変更しました', true); busy(btn, false); })
        .catch(function(err){ setMsg('acctPwMsg', err.message); busy(btn, false); });
    };
  }
  function openDelete(){
    modal(
      '<div class="qm-title">アカウント削除</div>' +
      '<div class="acct-note" style="color:#e0524a;font-weight:800;">削除すると、このアカウントの勝敗・ランキング・デッキは全て消えます。<br>元に戻すことはできません。</div>' +
      '<form class="acct-form" id="acctDelForm" style="margin-top:10px;">' +
        '<label>確認のためパスワードを入力<input type="password" id="acctDelPw" autocomplete="current-password" required></label>' +
        '<div class="acct-msg" id="acctDelMsg"></div>' +
        '<button type="submit" class="acct-submit danger">アカウントを削除する</button>' +
      '</form>' +
      '<div class="acct-links"><a id="acctBack">設定に戻る</a></div>' +
      '<button type="button" class="qm-back" id="acctClose">閉じる</button>'
    );
    document.getElementById('acctClose').onclick = closeModal;
    document.getElementById('acctBack').onclick = openSettings;
    document.getElementById('acctDelForm').onsubmit = function(e){
      e.preventDefault();
      if (!confirm('本当に削除しますか？この操作は取り消せません。')) return;
      var btn = this.querySelector('.acct-submit'); busy(btn, true); setMsg('acctDelMsg', '');
      api('/auth/account', { method: 'DELETE', body: { password: document.getElementById('acctDelPw').value } })
        .then(function(){ alert('アカウントを削除しました'); leaveAccount(); })
        .catch(function(err){ setMsg('acctDelMsg', err.message); busy(btn, false); });
    };
  }
  function doLogout(){
    api('/auth/logout', { method: 'POST' }).catch(function(){}).then(function(){ leaveAccount(); });
  }

  // ---- 初期化 ----
  function init(){
    renderBar();
    hookDeckSync();
    // ログイン中はトークンの有効性を確認(失効していたらゲストに戻す)
    if (isLoggedIn()) {
      api('/auth/me').then(function(r){
        if (r && r.user) { localStorage.setItem(LS_ACCOUNT, JSON.stringify(r.user)); }
      }).catch(function(err){
        if (/ログインが必要/.test(err.message)) { alert('ログインの有効期限が切れました。もう一度ログインしてください'); leaveAccount(); }
      });
    }
    var m = location.search.match(/[?&]reset=([A-Za-z0-9_-]+)/);
    if (m) { history.replaceState(null, '', location.pathname); setTimeout(function(){ openReset(m[1]); }, 300); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(init, 0); });
  else setTimeout(init, 0);
  // initProfile() が profileSection を書き換えても消えないように、少し遅れて再描画
  setTimeout(renderBar, 800);

  window.SalvadoAccount = { isLoggedIn: isLoggedIn, getAccount: getAccount, openLogin: openLogin, openRegister: openRegister, logout: doLogout };
})();
