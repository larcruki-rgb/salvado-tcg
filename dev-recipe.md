# サルベドTCG 開発・ビルド手順書（どのPCからでも作業できるように）

最終更新: 2026-09-04。新しい教訓が出たらこのファイルを更新すること。

## 全体構成
- `client/` … ゲーム本体(Web)。ここを直せばWeb版・次回ストアビルドの両方に反映される
- `server/` … Node.js(Express+socket.io)。DBはNeon PostgreSQL(接続はRenderの環境変数DATABASE_URL)
- `android/` `ios/` … Capacitorのネイティブ殻。clientを同梱して各ストアに出す
- 本番: https://game.sarubedo.jp （Render。**mainにpushすると自動デプロイ**、反映は1〜3分）
- リポジトリ: github.com/larcruki-rgb/salvado-tcg （ケーさん=sarubedopr-createはCollaborator）

## Web版の修正フロー（どのPCでも可）
1. `git clone` または `git pull` → `npm install`
2. client/ を修正 → **index.htmlの該当scriptの `?v=` を1つ上げる**（キャッシュ対策）
3. commit → push（ケーさんのGO必須）→ https://game.sarubedo.jp で反映確認

## ローカル動作確認（サーバー込み）
- PostgreSQLが必要: `brew install postgresql@16` →
  `LC_ALL=en_US.UTF-8 /opt/homebrew/opt/postgresql@16/bin/pg_ctl -D /opt/homebrew/var/postgresql@16 start`
  → `createdb salvado_dev`
- 起動: `DATABASE_URL=postgres://localhost/salvado_dev PORT=3200 node server/index.js`
- スマホ実機からは `http://<MacのIP>:3200/`（同一Wi-Fi）
- パスワード再設定メールはGMAIL_APP_PASSWORD未設定時、送信せずログにURLを出す

## Androidビルド（.aab）
署名鍵（Dropbox同期済み・どのPCにもある）:
- `Dropbox/デスク同期/テスト/salvado-upload.keystore`
- `Dropbox/デスク同期/テスト/KEYSTORE_SECRET.txt` … 「ラベル : 値」形式。
  6行目=alias / 7行目=ストアパス / 8行目=キーパス。**値はコロンの後ろだけ抽出**（行全体では通らない）

必要ツール(初回のみ): `brew install openjdk@21 android-commandlinetools bundletool`
→ `android/local.properties` に `sdk.dir=/opt/homebrew/share/android-commandlinetools`

手順:
1. `npx cap sync android`
2. `android/app/build.gradle` の versionCode を+1、versionName を更新
3. `cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH=$JAVA_HOME/bin:$PATH ./gradlew bundleRelease`
4. 署名: `jarsigner -keystore <keystore> -storepass <7行目> -keypass <8行目> app/build/outputs/bundle/release/app-release.aab <alias>`
5. **検品（必須・全部やる）**:
   - `bundletool dump manifest --bundle X.aab | grep -o 'versionCode="[0-9]*"\|versionName="[^"]*"'`
   - 署名指紋が過去版と一致: `keytool -printcert -jarfile X.aab | grep SHA256`
   - アイコン目視: `unzip -o X.aab "base/res/mipmap-xxxhdpi-v4/ic_launcher.png"` → 猫キャラか見る
   - 主要画像: `unzip -l X.aab | grep -E "lobby_logo|account.js"`
   - AdMob: `bundletool dump manifest --bundle X.aab | grep -o "AD_ID\|ca-app-pub-[0-9~]*"`
6. Play Console →テストとリリース→製品版→新しいリリースを作成→.aabをドロップ→公開の概要から審査に送信

## iOSビルド（Macのみ・Xcode必要）
1. `npx cap sync ios`
2. `ios/App/App.xcodeproj/project.pbxproj` の MARKETING_VERSION と CURRENT_PROJECT_VERSION(ビルド番号)を上げる（各2箇所）
3. Xcodeで `ios/App/App.xcodeproj` を開く → 接続先「Any iOS Device (arm64)」→ Product→Archive → Distribute App→App Store Connect→Upload
   （dSYM警告(GoogleMobileAds等)は無害・無視してよい）
4. App Store Connect（編集は会社Apple ID `sarubedo@sarubedo.co.jp`）:
   バージョン作成→最新情報記入→ビルド添付（輸出コンプライアンスは「上記のどれでもない」=標準暗号のみ）→審査へ提出
   ※App Review情報のテストアカウントは保存済みで引き継がれる

## ストア申告まわりの教訓（変更時に必ず見る）
- 広告の有無を変えたら: Playデータセーフティ + **ASCの年齢制限の「広告」項目**（1.1はここ漏れで2.3.6却下）
- 個人情報の収集を変えたら: 両ストア申告 + https://sarubedo.jp/tcg-privacy.html （salvado-websiteリポジトリ）を先に更新
- 審査用テストアカウント: sarubedopr+review@gmail.com / Review-2026-tcg（本番環境に実在）
- aabは「ビルドしたマシンの状態」が全て入る。**検品を省略しない**（v6=画像4枚欠落、v7=アイコンがCapacitorデフォルト、の前科）

## デッキ検証ゲートウェイ(将来のガチャ/所有制の土台) — 2026-09-06
- デッキを受け取る7つのsocket入口は全て `server/deckValidation.js` の `validateDeck()` を経由する
- 基本整合性(実在ID/枚数/形式)は検証済み。**「ちょうど60枚」は未強制**(編集途中デッキの従来挙動を維持)
- ガチャ導入時は `getAllowedCount()` を「acquire:'gacha'はuser_inventoryの所有数、'free'はInfinity」に差し替えるだけで全モードに効く
- 新カードに所有制を付けるには shared/cards.js の定義に `acquire:'gacha'` を書く

## 既知の注意点
- 広告バナーは「ロビーのみ表示」。表示/非表示はclient/ads.jsのupdateBanner()が自動管理
  （初回読込中に対戦へ入ると残るバグは2026-09-03修正済み。1.2.0以前のストア版には残存）
- salvado-websiteリポジトリは裏で自動push(ハレ阻止)が走る → pushが弾かれたら `git pull --rebase` してから
- サーバーの環境変数(Render): DATABASE_URL / GMAIL_APP_PASSWORD。Renderはsarubedopr@gmail.com名義（サービス本体はまっきーにさんのワークスペースから移管予定）
