// 広告モジュール（Capacitorネイティブアプリ専用）
// Webブラウザ・localhostでは window.Capacitor が無いので何もしない。
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
  var AdMob = window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob;
  if (!AdMob) return;

  var ADS_DEBUG_PANEL = true; // 表示確認用パネル。本番前にfalse

  // Google公式テスト広告ユニットID（プラットフォーム別）
  var isIOS = window.Capacitor.getPlatform() === 'ios';
  var AD_UNITS = isIOS ? {
    banner:       'ca-app-pub-3940256099942544/2934735716',
    interstitial: 'ca-app-pub-3940256099942544/4411468910',
    rewarded:     'ca-app-pub-3940256099942544/1712485313'
  } : {
    banner:       'ca-app-pub-3940256099942544/6300978111',
    interstitial: 'ca-app-pub-3940256099942544/1033173712',
    rewarded:     'ca-app-pub-3940256099942544/5224354917'
  };

  var initPromise = AdMob.initialize({ initializeForTesting: true });

  window.Ads = {
    bannerVisible: false,
    showBanner: function () {
      return initPromise.then(function () {
        return AdMob.showBanner({
          adId: AD_UNITS.banner,
          adSize: 'ADAPTIVE_BANNER',
          position: 'BOTTOM_CENTER',
          margin: 0
        });
      }).then(function () { window.Ads.bannerVisible = true; });
    },
    hideBanner: function () {
      return AdMob.removeBanner().then(function () { window.Ads.bannerVisible = false; }).catch(function () {});
    },
    showInterstitial: function () {
      return initPromise.then(function () {
        return AdMob.prepareInterstitial({ adId: AD_UNITS.interstitial });
      }).then(function () { return AdMob.showInterstitial(); });
    },
    // 視聴完了で resolve(reward)、途中で閉じたら reward なし
    showRewarded: function () {
      return initPromise.then(function () {
        return AdMob.prepareRewardVideoAd({ adId: AD_UNITS.rewarded });
      }).then(function () {
        return new Promise(function (resolve) {
          var rewarded = null;
          var l1 = AdMob.addListener('onRewardedVideoAdReward', function (r) { rewarded = r; });
          var l2 = AdMob.addListener('onRewardedVideoAdDismissed', function () {
            l1.then ? l1.then(function(h){h.remove();}) : l1.remove();
            l2.then ? l2.then(function(h){h.remove();}) : l2.remove();
            resolve(rewarded);
          });
          AdMob.showRewardVideoAd();
        });
      });
    }
  };

  // ---- 以下、表示確認用デバッグパネル（ネイティブアプリでのみ表示） ----
  if (!ADS_DEBUG_PANEL) return;

  function buildPanel() {
    var panel = document.createElement('div');
    panel.id = 'adsDebugPanel';
    panel.style.cssText = 'position:fixed;top:60px;right:8px;z-index:99999;background:rgba(26,26,46,0.92);border:2px solid #5fd5e3;border-radius:12px;padding:8px;display:flex;flex-direction:column;gap:6px;font-family:sans-serif;';
    panel.innerHTML =
      '<div style="color:#5fd5e3;font-size:10px;font-weight:bold;text-align:center;">広告テスト</div>' +
      '<button id="adsBtnBanner" style="font-size:11px;padding:6px 10px;border-radius:8px;border:none;background:#2fb6cb;color:#fff;">バナー表示</button>' +
      '<button id="adsBtnInter" style="font-size:11px;padding:6px 10px;border-radius:8px;border:none;background:#e67e22;color:#fff;">全画面広告</button>' +
      '<button id="adsBtnReward" style="font-size:11px;padding:6px 10px;border-radius:8px;border:none;background:#27ae60;color:#fff;">動画リワード</button>' +
      '<div id="adsDebugStatus" style="color:#f0e6d0;font-size:9px;max-width:110px;text-align:center;"></div>';
    document.body.appendChild(panel);

    var status = document.getElementById('adsDebugStatus');
    function setStatus(msg) { status.textContent = msg; }

    var bannerBtn = document.getElementById('adsBtnBanner');
    bannerBtn.addEventListener('click', function () {
      if (window.Ads.bannerVisible) {
        window.Ads.hideBanner().then(function () { setStatus('バナー消去'); bannerBtn.textContent = 'バナー表示'; });
      } else {
        setStatus('バナー読込中…');
        window.Ads.showBanner().then(function () { setStatus('バナー表示中'); bannerBtn.textContent = 'バナー消去'; })
          .catch(function (e) { setStatus('失敗: ' + (e.message || e)); });
      }
    });
    document.getElementById('adsBtnInter').addEventListener('click', function () {
      setStatus('全画面 読込中…');
      window.Ads.showInterstitial().then(function () { setStatus('全画面 表示OK'); })
        .catch(function (e) { setStatus('失敗: ' + (e.message || e)); });
    });
    document.getElementById('adsBtnReward').addEventListener('click', function () {
      setStatus('動画 読込中…');
      window.Ads.showRewarded().then(function (r) {
        setStatus(r ? '報酬GET: ' + (r.type || '') + ' x' + (r.amount || '') : '途中で閉じた（報酬なし）');
      }).catch(function (e) { setStatus('失敗: ' + (e.message || e)); });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildPanel);
  } else {
    buildPanel();
  }
})();
