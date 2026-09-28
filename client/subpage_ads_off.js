// カード一覧・ルールなど「ロビー以外の別ページ」ではネイティブの広告バナーを必ず消す。
// バナーはロビー(index.html)で出したネイティブ部品なので、別ページに移っても勝手には消えない。
// 2026-09-28: Google Play から「YouTube プレイヤーの上に広告が重なっている」(YouTube 利用規約違反)で v17 が却下されたため追加。
(function () {
  var cap = window.Capacitor;
  if (!(cap && cap.isNativePlatform && cap.isNativePlatform())) return;
  function plugin() {
    if (cap.Plugins && cap.Plugins.AdMob) return cap.Plugins.AdMob;
    if (cap.registerPlugin) { try { return cap.registerPlugin('AdMob'); } catch (e) { return null; } }
    return null;
  }
  var AdMob = plugin(); if (!AdMob) return;
  var tries = 0;
  function off() { try { AdMob.removeBanner().catch(function () {}); } catch (e) {} if (++tries < 6) setTimeout(off, 500); } // 表示が遅れて出てきても消せるよう数回叩く(未表示時のrejectは無害)
  off();
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { tries = 0; off(); } });
})();
