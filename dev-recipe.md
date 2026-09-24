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
- 基本整合性(実在ID/枚数/形式)を検証。**デッキ指定時は全モード60枚ちょうど必須**(2026-09-06オーナー決定)。デッキ未指定(既定デッキ)は従来通り可
- ガチャ導入時は `getAllowedCount()` を「acquire:'gacha'はuser_inventoryの所有数、'free'はInfinity」に差し替えるだけで全モードに効く
- 新カードに所有制を付けるには shared/cards.js の定義に `acquire:'gacha'` を書く

## ゲーム終了の終端処理(_terminate) — 2026-09-20
- LP0や降参で終了する時は必ず `GameState._terminate(loser)` を通る（checkWin/surrender）。
  最終stateUpdate→待ち行列・プロンプト全破棄→gameOver を最後のイベントとして送る
- 終了後は sweep/broadcast/prompt/ack/解決キューの各入口が `_gameOver` で全て止まる。
  終了後に蘇生プロンプトが勝敗モーダルを上書きして試合が閉じなくなるバグの恒久対策
- 回帰テスト: `node tests/regen_after_gameover.test.js`（致死+同時死亡でプロンプトが飛ばない／非致死で蘇生が出る）
- 注意: 「changeLifeに勝敗判定を埋め込む」案は採用していない。同一解決内でダメージ→回復する効果があった場合に
  早すぎる終了を招く恐れがあるため。checkWinの呼び出し位置は従来のまま

## プロンプト用モーダル(#modal)の扱い — 2026-09-20
- `showModal()` は #modal を共用するため、**回答待ちのプロンプト(ブロック選択/チェーン応答/蘇生確認など)を
  表示中に別の情報表示で showModal() を呼ぶと上書きされ、回答不能=進行不能になる**
  （実例: アサキの手札覗きが2.5秒遅延で出て、相手の攻撃中のブロック選択モーダルを消していた）
- 情報表示(手札覗き等)は `showPeekPanel()` のような独立パネルに出す。#modal は「回答が必要なもの」専用
- 保険: クライアントは stateUpdate で「pendingPromptがあるのに #modal が閉じている」を検知すると
  `resendPrompt` を送り、サーバー(GameRoom)が未回答プロンプトを再送する

## 再接続(rejoin)の復帰処理 — 2026-09-20
- 再接続時は `broadcastState()` を呼ばない（プロンプト待ちで保留中の `_afterSweepAction` を早撃ちする）。
  `stateUpdate` を送り直し、その席の未回答プロンプトを再送し、解決演出のack待ち中(`_awaitingAck`)なら自動ack
- `_awaitingAck` は GameRoom が resolveResults を送った時に立て、両者のackが揃った時/終了時に下りる

## クリーチャーを場に出す処理は `_enterField()` に集約 — 2026-09-20
- 通常投稿(playCard)/青春詭弁/動画復元など、場に出す経路は全て `GameState._enterField(card, p, src)` を通す。
  登場時能力(etb_*)の処理はここにだけ書く。**新しい強制召喚カードを作る時もここを呼ぶ**(コピペ禁止)
- 「ゾーンから選んで出す」候補は `_legalHandHeroCandidates()` / `_legalGraveCreatureCandidates()` で
  **選ばせる瞬間に**同名制限まで含めて絞る。選んでから弾く作りにすると停止やCPUの無限ループになる
- 弾く場合の作法: 合法な候補だけで再提示、候補が無ければ `_continueAfterPick()` で解決を再開
- 回帰テスト: `node tests/resolve_prompt_reentry.test.js`（A〜G）

## 既知の注意点
- 広告バナーは「ロビーのみ表示」。表示/非表示はclient/ads.jsのupdateBanner()が自動管理
  （初回読込中に対戦へ入ると残るバグは2026-09-03修正済み。1.2.0以前のストア版には残存）
- salvado-websiteリポジトリは裏で自動push(ハレ阻止)が走る → pushが弾かれたら `git pull --rebase` してから
- サーバーの環境変数(Render): DATABASE_URL / GMAIL_APP_PASSWORD。Renderはsarubedopr@gmail.com名義（サービス本体はまっきーにさんのワークスペースから移管予定）

## クイックマッチの幽霊接続対策（2026-09-21）
- 対戦を始めるハンドラは、検証(デッキ・部屋の存在・満席)が全部通った後に `detachSocketFromRooms(socket)` で前の部屋を抜ける。先に抜くと失敗時に今の対戦が敗北扱いになる
- 待機枠に同じプレイヤーIDの古い接続がいたら、古い方を捨てて新しい接続で待ち直す(「waitingだけ返す」は永久待機を生む)
- 放置判定 `GameRoom._expireTurn`: 一度も操作していないプレイヤーの時間切れ、または2ターン連続の時間切れ(自分でendTurnした時だけ連続回数リセット)で `gs._terminate(p)` → 通常のgameOver経路で記録される
- socket.io は pingInterval 10s / pingTimeout 8s。死んだ接続の検出は最大18秒
- シナリオテスト: `TURN_TIMER_MS=3000` でサーバーを起動して `node tests/ghost_match.e2e.js`（socket.io-client が無ければ `SIO_CLIENT=<path>`）

## 切断からの復帰（2026-09-21）
- 対戦中の切断は `RECONNECT_GRACE_MS`(既定30秒)だけ席を保持。戻らなければ相手の勝ち(opponentLeft)
- クライアントは接続のたびに `rejoin` を送る(再接続時は即、起動時は300ms後)。アプリ完全終了→開き直しでも猶予内なら盤面・未回答プロンプト・タイマーごと復帰する
- 端末識別子 `deviceKey`(localStorage `salvado_device_key`、接続時の auth で送る→`socket.deviceKey`、`room.deviceKeys[seat]`に記録)。rejoin の規則: 別端末からは戻れない／席に生きた接続がいれば横取りしない／同じ端末の再起動なら古い接続を置き換える(先に席を差し替えてから古い接続を切る。逆順だと切断処理が対戦離脱と誤認する)。鍵の無い旧クライアントは従来通り playerId だけで判定
- rejoin 時は `room.getTurnTimerState()` でターン残り時間も送り直す
- 起動時の自動復帰は `rejoin {startup:true}`。チュートリアルの部屋は対象外。明示的に「ロビーに戻る」で再読込する時は先に `leaveRoom` を送る(`leaveRoomAndReload()`)。送らないと自動復帰で同じ部屋に戻される
- テスト: `node tests/rejoin_after_kill.e2e.js`（ローカルサーバーを RECONNECT_GRACE_MS=5000 TURN_TIMER_MS=20000 で起動。ターン制限は猶予より長く）

## ロビー掲示板（2026-09-24 第1段階）
- サーバー: `server/board.js`（/board/posts 一覧・投稿、/like、/report、/board/block、DELETE /board/posts/:id、POST /board/notice）。テーブル board_posts/likes/reports/blocks は初回アクセス時に自動作成
- 投稿は登録者のみ（Auth.attachUser + requireAuth）。200字、30秒/1件、50件/日、通報は1分5件。通報3件で自動非表示＋ `BOARD_REPORT_TO`（既定 sarubedopr@gmail.com）へメール（GMAIL_APP_PASSWORD 必須）
- NGワード: `server/board_ngwords.txt`（1行1語）。変更後は `POST /board/reload-ngwords`（x-admin-token）か再起動。表示名にも同じフィルタ
- 運営操作は環境変数 `BOARD_ADMIN_TOKEN`（Renderに設定。値は Dropbox/AI関連/Claude環境/secrets/salvado_board_admin_token.txt）を `x-admin-token` ヘッダーで送る:
  - 削除: `curl -X DELETE https://game.sarubedo.jp/board/posts/<id> -H "x-admin-token: ..."`
  - お知らせ: `curl -X POST https://game.sarubedo.jp/board/notice -H "x-admin-token: ..." -H "Content-Type: application/json" -d '{"body":"..."}'`（最新1件が最上段に固定）
- 対戦募集: クライアントが createRoom → waiting の roomId で投稿。サーバーは「自分が作った待機中の部屋」だけ許可。10分で一覧から消える。参加は joinRoom
- クライアント: `client/board.js`（ロビーの #boardPanel）。ルール同意は localStorage `salvado_board_rules_ok`
- テスト: `BOARD_ADMIN_TOKEN=testadmin` でローカル起動 → `node tests/board.e2e.js`（11シナリオ）
- ストア申告: UGC追加につき Play データセーフティ「その他のユーザー作成コンテンツ」/ASC「ユーザーコンテンツ」/tcg-privacy.html の追記が必要（未実施）
- モデレーター(運営権限をアカウントに付ける。合言葉は配らない): `POST /board/mods {"name":"表示名"}` / `DELETE /board/mods/<user_id または表示名>`（解除は GET が返す user_id 指定を推奨。改名で名前がずれても確実） / `GET /board/mods`（いずれも x-admin-token）。付いた人はログインするだけで、掲示板に運営メニュー(お知らせ投稿)・全投稿の「運営削除」「復活」・通報数/非表示中バッジが出る。削除者は board_posts.hidden_by に記録
