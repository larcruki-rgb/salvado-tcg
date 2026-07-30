// 広告モジュール（Capacitorネイティブアプリ専用）
// Webブラウザ・localhostでは window.Capacitor が無いので何もしない。
//
// 【広告設計】
//   - バナー: ロビー画面のみ自動表示。他画面へ移ると自動で消える
//   - 全画面(インタースティシャル): 対戦の勝敗後「ロビーに戻る」タップ時。
//     連発防止のためクールダウン(MATCH_AD_COOLDOWN_MS)あり
//   - 動画リワード: 報酬設計が決まるまで常設なし（デバッグパネルからのみ確認可）
//
// ★現在はGoogle公式の「テスト広告ユニットID」で動作確認中★
// 本番リリース前にやること:
//   1. AdMobコンソール(admob.google.com)で実IDを発行し AD_UNITS を差し替え
//   2. AndroidManifest.xml / Info.plist のアプリIDも実IDへ差し替え
//   3. ストアの申告変更（Playデータセーフティ「広告あり」/ ASCプライバシー表示）
//   4. デバッグパネル(ADS_DEBUG_PANEL)をfalseにするか削除
(function () {
  var isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  if (!isNative) return;

  var ADS_DEBUG_PANEL = true; // 表示確認用パネル。本番前にfalse
  var MATCH_AD_COOLDOWN_MS = 3 * 60 * 1000; // 勝敗後の全画面広告の最短間隔

  // Google公式テスト広告ユニットID（プラットフォーム別）
  var isIOS = window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'ios';
  var AD_UNITS = isIOS ? {
    banner:       'ca-app-pub-3940256099942544/2934735716',
    interstitial: 'ca-app-pub-3940256099942544/4411468910',
    rewarded:     'ca-app-pub-3940256099942544/1712485313'
  } : {
    banner:       'ca-app-pub-3940256099942544/6300978111',
    interstitial: 'ca-app-pub-3940256099942544/1033173712',
    rewarded:     'ca-app-pub-3940256099942544/5224354917'
  };

  function getAdMob() {
    if (window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob) return window.Capacitor.Plugins.AdMob;
    if (window.Capacitor.registerPlugin) {
      try { return window.Capacitor.registerPlugin('AdMob'); } catch (e) { return null; }
    }
    return null;
  }

  var AdMob = getAdMob();
  var initPromise = null;
  function ensureInit() {
    if (!AdMob) return Promise.reject(new Error('AdMobプラグイン未検出'));
    if (!initPromise) initPromise = AdMob.initialize({ initializeForTesting: true });
    return initPromise;
  }

  function removeListener(h) {
    if (!h) return;
    if (h.remove) h.remove();
    else if (h.then) h.then(function (x) { x.remove(); });
  }

  window.Ads = {
    bannerVisible: false,
    _bannerBusy: false,
    showBanner: function () {
      return ensureInit().then(function () {
        return AdMob.showBanner({
          adId: AD_UNITS.banner,
          adSize: 'ADAPTIVE_BANNER',
          position: 'BOTTOM_CENTER',
          margin: 0
        });
      }).then(function () { window.Ads.bannerVisible = true; });
    },
    hideBanner: function () {
      if (!AdMob) return Promise.resolve();
      return AdMob.removeBanner().then(function () { window.Ads.bannerVisible = false; }).catch(function () {});
    },
    showInterstitial: function () {
      return ensureInit().then(function () {
        return AdMob.prepareInterstitial({ adId: AD_UNITS.interstitial });
      }).then(function () { return AdMob.showInterstitial(); });
    },
    // 視聴完了で resolve(reward)、途中で閉じたら reward なし
    showRewarded: function () {
      return ensureInit().then(function () {
        return AdMob.prepareRewardVideoAd({ adId: AD_UNITS.rewarded });
      }).then(function () {
        return new Promise(function (resolve) {
          var rewarded = null;
          var l1 = AdMob.addListener('onRewardedVideoAdReward', function (r) { rewarded = r; });
          var l2 = AdMob.addListener('onRewardedVideoAdDismissed', function () {
            removeListener(l1); removeListener(l2);
            resolve(rewarded);
          });
          AdMob.showRewardVideoAd();
        });
      });
    },
    // 勝敗後の全画面広告。クールダウン中・読込失敗時は何もせず done() を呼ぶ。
    // 広告が出た場合はユーザーが閉じたタイミングで done() を呼ぶ。
    maybeShowMatchEndAd: function (done) {
      done = done || function () {};
      if (!AdMob) { done(); return; }
      var last = 0;
      try { last = parseInt(localStorage.getItem('adsLastInterstitial') || '0', 10) || 0; } catch (e) {}
      if (Date.now() - last < MATCH_AD_COOLDOWN_MS) { done(); return; }

      var finished = false;
      var dismissL = null;
      function fin() {
        if (finished) return;
        finished = true;
        removeListener(dismissL);
        done();
      }
      // 読込が遅い/失敗した時にユーザーを待たせないための保険
      var loadTimer = setTimeout(fin, 12000);
      dismissL = AdMob.addListener('interstitialAdDismissed', function () { clearTimeout(loadTimer); fin(); });
      window.Ads.showInterstitial().then(function () {
        clearTimeout(loadTimer); // 表示成功。あとは閉じるのを待つだけ
        try { localStorage.setItem('adsLastInterstitial', String(Date.now())); } catch (e) {}
      }).catch(function () { clearTimeout(loadTimer); fin(); });
    }
  };

  // ---- バナー自動管理: ロビー画面の時だけ表示 ----
  function updateBanner() {
    var lb = document.getElementById('lobbyScreen');
    var onLobby = !!(lb && lb.classList.contains('active'));
    if (window.Ads._bannerBusy) return;
    if (onLobby && !window.Ads.bannerVisible) {
      window.Ads._bannerBusy = true;
      window.Ads.showBanner().catch(function () {})
        .then(function () { window.Ads._bannerBusy = false; });
    } else if (!onLobby && window.Ads.bannerVisible) {
      window.Ads._bannerBusy = true;
      window.Ads.hideBanner().then(function () { window.Ads._bannerBusy = false; });
    }
  }

  function watchScreens() {
    updateBanner();
    try {
      var screens = document.querySelectorAll('.screen');
      for (var i = 0; i < screens.length; i++) {
        new MutationObserver(updateBanner).observe(screens[i], { attributes: true, attributeFilter: ['class'] });
      }
    } catch (e) {}
  }

  // ---- 表示確認用デバッグパネル ----
  function buildPanel() {
    try {
      var panel = document.createElement('div');
      panel.id = 'adsDebugPanel';
      panel.style.cssText = 'position:fixed;top:60px;right:8px;z-index:2147483647;background:rgba(26,26,46,0.92);border:2px solid #5fd5e3;border-radius:12px;padding:8px;display:flex;flex-direction:column;gap:6px;font-family:sans-serif;';
      panel.innerHTML =
        '<div style="color:#5fd5e3;font-size:10px;font-weight:bold;text-align:center;">広告テスト</div>' +
        '<button id="adsBtnInter" style="font-size:11px;padding:6px 10px;border-radius:8px;border:none;background:#e67e22;color:#fff;">全画面広告</button>' +
        '<button id="adsBtnReward" style="font-size:11px;padding:6px 10px;border-radius:8px;border:none;background:#27ae60;color:#fff;">動画リワード</button>' +
        '<div id="adsDebugStatus" style="color:#f0e6d0;font-size:9px;max-width:110px;text-align:center;white-space:pre-wrap;"></div>';
      document.body.appendChild(panel);

      var status = document.getElementById('adsDebugStatus');
      function setStatus(msg) { status.textContent = msg; }
      function showErr(e) { setStatus('失敗: ' + ((e && (e.message || e.errorMessage)) || e)); }

      setStatus(AdMob ? 'プラグインOK\nバナーはロビーで自動' : '⚠️AdMobプラグイン未検出');

      document.getElementById('adsBtnInter').addEventListener('click', function () {
        setStatus('全画面 読込中…');
        window.Ads.showInterstitial().then(function () { setStatus('全画面 表示OK'); }).catch(showErr);
      });
      document.getElementById('adsBtnReward').addEventListener('click', function () {
        setStatus('動画 読込中…');
        window.Ads.showRewarded().then(function (r) {
          setStatus(r ? '報酬GET: ' + (r.type || '') + ' x' + (r.amount || '') : '途中で閉じた（報酬なし）');
        }).catch(showErr);
      });
    } catch (e) {
      try { alert('広告パネル生成エラー: ' + (e.message || e)); } catch (_) {}
    }
  }

  function boot() {
    watchScreens();
    if (ADS_DEBUG_PANEL) buildPanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
