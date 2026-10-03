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
  - お知らせ: `curl -X POST https://game.sarubedo.jp/board/notice -H "x-admin-token: ..." -H "Content-Type: application/json" -d '{"body":"..."}'`（ロビー上部に1件だけ表示。前のお知らせは自動で消える）
- 対戦募集: クライアントが createRoom → waiting の roomId で投稿。サーバーは「自分が作った待機中の部屋」だけ許可。10分で一覧から消える。参加は joinRoom
- クライアント: `client/board.js`（ロビーの #boardPanel）。ルール同意は localStorage `salvado_board_rules_ok`
- テスト: `BOARD_ADMIN_TOKEN=testadmin` でローカル起動 → `node tests/board.e2e.js`（11シナリオ）
- ストア申告: UGC追加につき Play データセーフティ「その他のユーザー作成コンテンツ」/ASC「ユーザーコンテンツ」/tcg-privacy.html の追記が必要（未実施）
- モデレーター(運営権限をアカウントに付ける。合言葉は配らない): `POST /board/mods {"name":"表示名"}` / `DELETE /board/mods/<user_id または表示名>`（解除は GET が返す user_id 指定を推奨。改名で名前がずれても確実） / `GET /board/mods`（いずれも x-admin-token）。付いた人はログインするだけで、掲示板に運営メニュー(お知らせ投稿)・全投稿の「運営削除」「復活」・通報数/非表示中バッジが出る。削除者は board_posts.hidden_by に記録

## ロビー上部の改善（2026-09-28）: 運営お知らせ / 参加できる募集 / iボタン
- 画面: `client/lobby.js`（board.js の後に読む）。`#lobbyNotice`（金色の猫耳パネル）、対戦パネル内の `#lobbyRecruit`、各パネル右上の `.lb-info[data-help=…]`
- API（すべて `server/board.js`、CORSは /board 共通）:
  - `GET /board/lobby` → `{ notice, recruits[], recruitCount, mine, online }`。募集は「生きている待機部屋(state=waiting)」だけ、自分の募集は `mine`、ブロック相手は除外、roomId で重複排除。online は接続ソケット数
  - `GET /board/help` → `server/lobby_help.json` の中身（`_comment` は除く）。**文面を直すならこのファイル。アプリ更新なしで反映**（mtime で自動再読込）
- お知らせは常に1件: `POST /board/notice` は前のお知らせを `hidden=true, hidden_by='replaced'` にしてから挿入。最新を消しても古いのが復活しない。閉じた人は localStorage `salvado_notice_dismissed` にIDを持つ（同じお知らせは二度と出ない。新しいお知らせは出る）
- 募集の後始末: 本人が募集投稿を DELETE → `closeRecruitRoom()` が待機中の自分の部屋を消して `recruitCancelled` を送る（運営削除では部屋を触らない）。投稿失敗時はクライアントが `leaveRoom`。`joinRoom`/`leaveRoom` 時にサーバーが `lobbyRooms` を全員に流し、ロビーは 20 秒ポーリング＋`boardPost`/`lobbyRooms`/`visibilitychange` で更新。取得失敗は「0件」と表示しない
- `/debug` に `roomsTotal`（待機中も含む全部屋数。`rooms` は対戦開始後だけ）
- 掲示板の募集に定型文ボタン（`PRESETS` in client/board.js）
- テスト: `tests/board.e2e.js` 18〜20（お知らせ1件・ロビーAPI・削除で部屋を閉じる・運営削除では閉じない）

## 勝敗の理由と放置判定（2026-09-30）
- `GameState._terminate(loser, reason)`: reason = life(LP0) / surrender / afk(操作なしの時間切れ) / prompt_timeout(選択に無回答)。`gameOver` に reason が乗り、結果画面に一言出る(client END_REASON_TEXT)。切断は従来どおり `opponentLeft`
- 戦績 match_history.detail に `{reason, turn, opp}`(切断は reason:'disconnect')。「勝てる状況なのに負けた」の問い合わせは detail で追える: `SELECT played_at, result, detail FROM match_history WHERE user_id=... ORDER BY played_at DESC`
- 放置判定(GameRoom._expireTurn): **そのターンに1回でも操作していれば時間切れは「ターンが終わるだけ」**(放置カウントをリセット)。操作ゼロの時間切れだけを数え、「試合で一度も操作なし」または「操作なしの時間切れが2ターン連続」で敗北。以前は操作していても2連続の時間切れで敗北していた(考え込む人が有利でも負けた)
- 蘇生確認の「(残り: N)」は「(いま使える応援: N)」に(Nは未タップの視聴者数。初期3+毎ターン1なので中盤で10超えは正常)

## 掲示板の返信（2026-09-30・1段だけ）
- `board_posts.parent_id`（NULL=トップレベル）。返信は親のトピックを継ぐ。`POST /board/posts {parentId, body, avatar}`
- 返信できない: 返信への返信(1段だけ)、募集トピック、非表示の親、お知らせ。連投・NGワード・1日上限は通常投稿と同じ
- `GET /board/posts` はトップレベルだけ返し、各投稿に `replies[]`(古い順・最大50)と `replyCount`。非表示・ブロック相手の返信は除外(運営は非表示も見える)
- 画面: `client/board.js` の postHtml()。返信は親の下に小さく、4件以上は最新3件＋「前のN件を表示」。「返信」ボタンで入力欄が1つ開く(下書きは再描画でも残る)
- テスト: tests/board.e2e.js 23

## 戦闘の死亡判定は同時（2026-09-30）
- `sweepDeadCreatures()` は除去を始める前に、両者の場で致死のもの全部に `_lethal` 印を付けてから処理する。以前は席0から順に除去していたため、アークの-100のような静的効果が先に外れて、席1のアークが必ず生き残っていた
- 印は 蘇生受諾・レイチェン回復・ターン終了のダメージ回復・stripEnchantState(場に出し直す/手札に戻す)・ボスラッシュ引き継ぎ・掃除完走時 に消す。同時に死ぬミーコは他者を救えない
- テスト: tests/combat_mutual.test.js（席0/席1の攻撃で相打ち、片方だけ致死、ミーコ蘇生の回帰）

## 操作検証と安全網（2026-09-27）
- 全操作はサーバーで手番/フェイズ/候補を検証する（GameState: playCard/activateAbility は手番のみ、_busy() 中は通常操作不可、チェーン応答は _getChainOptions の候補だけ、creatorDiscard は本人+クリエイター札）。テスト: `node tests/turn_guard.test.js`
- 解決確認(ack)の安全網: `ACK_TIMEOUT_MS`(既定20秒)で来ていない席を GameRoom が自動ack。テスト: `ACK_TIMEOUT_MS=2000` で起動して `node tests/ack_timeout.e2e.js`
- 保留したターン終了は `_deferredEndTurn` → broadcastState 時に `_flushDeferredEndTurn`。/debug の各部屋に deferredEndTurn/awaitingAck/acks/combatQueue/resolveQueue が出るので詰まりの調査に使う
- CPU戦の通し確認: `node tests/cpu_smoke.e2e.js`（70秒で3ターン目到達を期待。カードの引きで稀に止まることがある→/debug で内部状態を見る）
- 質問(プロンプト)の制限時間: 質問中は90秒タイマーが止まるため別途 `PROMPT_TIMEOUT_MS`(既定30秒)/`PROMPT_FORFEIT_MS`(既定90秒)。chain/chain_attack→自動パス、block→ブロック無し、それ以外→30秒で再送・90秒で _terminate(放置扱い)。CPU側の質問は対象外。テスト: `node tests/prompt_timeout.test.js`
- ターン制限の猶予: 表示は TURN_TIMER_MS、実期限は +`TURN_TIMER_GRACE_MS`(既定2秒)。0秒直前の操作が遅れて届いても受理される。テスト: `node tests/timer_prompt.test.js`

## 戦闘の追跡は uid（2026-10-02）
- `G.attackers` は攻撃者の **uid の配列**、`G.blockAssignments` は **攻撃者uid → ブロッカーuid**。場の番号では持たない（戦闘中に場からカードが消えると番号がずれ、ブロックが直撃に化ける／攻撃していないカードが攻撃者になる、が実際に起きていた）。
- 通信は従来どおり番号。番号の意味は2種類ある: 攻撃者は「攻撃側の場全体の番号」、ブロッカーは「アンタップのキャラだけに絞った一覧の中の番号」。取り違えない。
- カードが場を離れる経路では必ず `_leaveField(c)` を呼ぶ（戦闘から外す＋カウンターを消す）。今ある経路: `_executeDestroy`、水素水の手札戻し、GameRoom の無限ボスラッシュ場4体制限。その場の蘇生・ターン開始では呼ばない。
- 場に入る時（`_enterField`）に uid を振り直す。出し直したカードは別物として扱う（出し直す前に積まれた対象指定は不発になる）。採番は `shared/cards.js` の `newUid()` だけ。
- ダイスケ誰その男の変身だけは `_replaceInCombat(旧uid, 新uid)` で戦闘参加を引き継ぐ。
- テスト: `tests/combat_uid.test.js`

## カウンターと新カード3枚（2026-10-02）
- **カウンター**: カードの `counters` 配列（`{power, toughness, source}`）。`getP` / `getT` が合計を足す。場にいる間だけ残る。`enchantments` とは別物。
- **新カードは `copies` を書かない**。`copies` はデッキ上限ではなく「既定デッキに入れる枚数」で、書くと既定デッキと全クエスト・ボスラッシュのCPU山札（`buildDeck(null)`）に混ざる。デッキ上限は `deckMax`。
- **大食冠ゼラチネ**: 分裂（コストは「タップ＋自身の生贄」で、宣言時に払う。タップ済みなら使えない＝攻撃した後・捕食したターンは分裂できない。体数は宣言時の残りHP。2026-10-02 オーナー変更でタップを追加）／捕食（対象選択 `zeratine_eat_target` に回答した時点でタップと生贄を払う。増えるのは生贄の**素の** power/toughness だけ。`getP`/`getT` は使わない）。回答ハンドラは、キャンセル・不正回答でも必ず `returnToChain` に戻す。
- **店主リード**: 山札のキャラをランダムに1枚。取ったカード名はログ・トーストに出さない（ログは両者に配信される）。
- **ダイスケ誰その男**: 全主人公を新規トークン（新uid）に一括置換。途中で `broadcastState`・死亡判定を挟まない（相手アークの -100 でトークンが死ぬ）。
- 新しいプロンプト種別を足す時は、①サーバーの `PROMPT_HANDLERS` ②クライアントの `handlePrompt` ③CPUの `handlePrompt` の3か所。CPU席には時間切れが無いので、CPUが答えられないと止まる。
- 新しい起動能力を足す時は、サーバーの `getActivatable` / `activateAbility` に加えて、クライアントの `showAbilitySelect`（自分の手番のボタン。能力IDごとの列挙）にも足す。
- テスト: `tests/counters.test.js` `tests/newcards.test.js`

## 枚数上限と使用権の解除（2026-10-02）
- デッキ上限は `shared/cards.js` の `deckMax`（既存カードは `DECK_MAX` の表、新カードは定義に直接）。サーバー（`server/deckValidation.js`）とクライアント（`DECK_CARDS` の `max`）で同じ値。`tests/deck_validation.test.js` が全カードの一致を照合する。
- `acquire: 'quest'` のカードは「使用権の解除」が要る。所持枚数は持たない。保存先は `user_inventory` の `item_type='card_unlock'`（`db.unlockCards` は1文・重複なし。`addInventoryItem` は加算なので使わない）。
- 7つの対戦入口は `async`。**報酬カード入りのデッキの時だけ** `Unlocks.load(playerId)` を待ってから、同期の `validateDeck(playerId, deck, unlocked)` を呼ぶ。通常のデッキでは待ちが発生しない。
- 付与は `GameRoom._grantQuestReward()`（対象クエスト かつ `winner === 0` の時だけ。保存後に `questReward` を通知）。報酬の定義は `shared/quests.js` の `reward.unlockCards`。
- ゲスト（`p_`）で解除した分は、後からログインしても引き継がない（過去データを移行しない方針）。クライアントは報酬つきクエストの前に案内を出す。
- デバッグ用: `UNLOCK_ALL_CARDS=1` で誰でも使える。**本番では設定しない。**
- クエストの `cpu.hand` は初期手札の指定。`cpu.handFill: 7` を付けた時だけ、山札から引いて7枚にする。
- テスト: `tests/quest_reward.test.js`（DB）、`tests/quest08.e2e.js`

## 強制更新（2026-10-02）
- 古いアプリは更新するまで対戦を始められない。ブラウザ版は対象外。ブラウザ版への案内は置かない（アプリだけで運用する方針）。
- 版 = 同梱の `client.js` の番号。**`client/index.html` の `client.js?v=NNN` と `client/client.js` の `CLIENT_V` は必ず同じ番号にする**（`tests/app_gate.test.js` が照合）。
- 最低版は DB の `app_settings`（`min_client_v`）。切り替えは再起動なし:
  ```bash
  curl -X POST https://game.sarubedo.jp/api/app/min-version -H "Content-Type: application/json" -H "x-admin-token: <BOARD_ADMIN_TOKEN>" -d '{"minClientV":123}'   # 0 で無効
  ```
- サーバー側: `server/appGate.js`。アプリからの接続は Origin（`capacitor://localhost` / `https://localhost` / `http://localhost`）で見分ける。配布済みの古いアプリは版を送らないので 0 扱い。最低版未満は、対戦開始（7入口＋チュートリアル＋パズル）と復帰（rejoin）を止め、`error` で案内する。
- 画面側: `shared/app_gate.js`。`shared/cards.js` の末尾から読み込む。`cards.js` はアプリでも起動のたびにサーバーから読むので、配布済みのアプリにも更新画面が届く。
- **有効にする前に毎回確認**: ①Android・iOS の両方で新しい版が公開済み ②段階的な公開ではなく全員に配信済み ③すぐ戻せる（0 を POST）④有効化の後、古い版で更新画面→ストアに飛べることを実機で確認 ⑤その後に新カードを公開。
- 実機での確認は 2026-10-02 時点で未実施（ローカルのブラウザでアプリを模して確認しただけ）。
- テスト: `tests/app_gate.test.js`（DB）、`tests/app_gate.e2e.js`

## 単体テストの一括実行
```bash
bash tests/run_unit.sh   # tests/*.test.js を全部。prompt_timeout / timer_prompt / quest_reward / app_gate は DB(既定 postgres://localhost/salvado_dev)を使う
```

## 対戦開始まわりの安全策（2026-10-02・Codexレビュー反映）
- 接続ごとのイベント処理は、`io.on('connection')` の冒頭で `socket.on` を包んで例外を捕まえている。クライアントの入力1つで例外が出ても、サーバー全体（＝進行中の全対戦）は落ちない。以前は、名前に文字列以外を入れた開始要求1つでプロセスが終了していた。
- 7つの対戦入口は、解除情報の読み込みを待つことがある。待っている間に同じ接続が別の操作（別モードの開始・退出・復帰）をしたら、古い開始要求は捨てる（`beginStart(socket)` の番号で照合）。捨てないと、後から始めた対戦の部屋を古い要求が消す。**開始・退出・復帰の入口を足す時は `beginStart(socket)` を呼ぶこと。**
- 解除情報のキャッシュ（`server/unlocks.js`）: 正はいつもDB。キャッシュに入れるのは「読んでいる間に付与も無効化も起きなかった読み込み結果」だけで、解除が1枚以上あるIDに限る（最大5000件・10分）。付与したらキャッシュを捨て、次に必要になった時に読み直す。付与の結果を手元のキャッシュに足す作りにはしない（同時実行の順序しだいで記録が欠ける）。
- **ゲストの解除は「クリアした端末」に結びつける**（`server/unlocks.js`）。ゲストID（`p_`）は本人確認をしていない（名乗るだけで通る）ので、IDだけで判定すると、解除済みの他人のゲストIDを名乗ればクリアせずに使えてしまう。クリア時の端末の鍵（接続時の `auth.deviceKey`。他人には見えない）のハッシュを `user_inventory` の `item_type='unlock_device'` に記録し、同じ鍵の接続にだけ使用を認める。同じゲストIDのまま別の端末でクリアし直せば、その端末でも使える。アカウント（`u_`）は端末を問わない。解除状況のAPI（`GET /api/user/:id/unlocks`）は `x-device-key` ヘッダーで同じ判定をする。
- 残っている制限: ゲストの戦績（ランキング）は、今もゲストIDを名乗るだけで書ける（今回の変更より前から）。
- テスト: `tests/start_guard.e2e.js`、`tests/app_gate_screen.e2e.js`（Chromeが必要）

## 新カードの公開スイッチと先行テスト（2026-10-02）
- `acquire: 'quest'` のカードと、報酬つきクエスト（`shared/quests.js` の `reward` があるもの）は、**公開スイッチがオンになるまで誰にも見えず・使えない**（`server/release.js`）。サーバーを先に本番へ出しても見た目は変わらない。新しいアプリが全員に行き渡ってから、全員同時に公開するための仕組み。
- 状態は DB の `app_settings`（`newcards_release`）。切り替えは再起動なし:
  ```bash
  # 公開する / 非公開に戻す
  curl -X POST https://game.sarubedo.jp/api/app/newcards -H "Content-Type: application/json" -H "x-admin-token: <BOARD_ADMIN_TOKEN>" -d '{"released":true}'
  # 先行テスト: 公開前でも、指定したアカウントにだけ見せる(表示名で指定。ログイン済みのアカウントだけが対象。ゲストは不可)
  curl -X POST https://game.sarubedo.jp/api/app/newcards -H "Content-Type: application/json" -H "x-admin-token: <BOARD_ADMIN_TOKEN>" -d '{"previewNames":["表示名"]}'
  ```
  指定しなかった項目は変わらない。型が違う指定は 400（何も変えない）。
- 公開前の動き: 入手クエストは始められない／新カード入りのデッキは拒否（「まだ公開されていません」）／`GET /api/user/:id/unlocks` は `visible:false`／クライアントはクエスト一覧・デッキ編集の欄・カード一覧の節を出さない。
- 先行テスト中の新カードは、**CPU戦・クエスト・ボスラッシュ・先行テストの人どうしの部屋**でだけ使える。クイックマッチ、一般の人が作った部屋、クイックマッチの待機室への合流では使えない（古いアプリの人と当たらないように）。新カード入りのデッキで作った部屋は `room.previewOnly`（先行テストの人だけが入れる）。
- 非公開に戻すと、新カード入りで待機中の部屋を取り消す（`closeWaitingNewCardRooms`）。進行中の対戦は止めない。
- 新しく判定を足す時は `Release.visibleTo(裏取り済みのID)` を使う。裏取りしていないID（クライアントが名乗っただけの `u_`）を渡さないこと。
- 出す順番: ①サーバーを push（スイッチはオフ）②新しいアプリを両ストアに ③全員に配信されたら強制更新をオン ④公開スイッチをオン ⑤告知。
- あわせて直した以前からの穴: 部屋番号で入れるのは待機中の部屋だけにした（対戦が始まった部屋の空席に別の人が入れていた）／DBのスキーマ初期化が失敗した時に控えを捨てる（起動時にDBへ繋げないと、復旧後も再起動まで読めなかった）。
- ローカルで全部試す時: `UNLOCK_ALL_CARDS=1` で起動すると、公開済み・全員解除済みの扱いになる（**本番では設定しない**）。
- テスト: `tests/release.test.js`（DB）、`tests/release.e2e.js`、`tests/deck_validation.test.js` の V9
- **previewNames / preview は「追加」ではなく「一覧の置き換え」**。人を足す時は今いる人も全員まとめて送る(10/3に サルベド が一度消えた)。本番の先行テスト枠(10/3時点): サルベド・まっきーに・坂街透

## チュートリアル(初心者の最初の1戦)（2026-10-03 作り直し）
- 相手役は `server/TutorialPlayer.js` の台本どおりに動く(視聴者4固定・フォローしない)。T1: 動画編集(キャマキリ対象)→プレイヤーが動画削除で打ち消す→一般女子高生A投稿→終了。T2: ママチャリ暴走族(俊足)を投稿して攻撃(プレイヤーのブロック練習)→終了。T3以降はターン終了だけ。ブロックはキャマキリを `data.attackers[].idx`(場の番号)で止める(一覧の順番ではない)
- 初期配置は `GameState.initTutorial`。プレイヤー手札: キャマキリ・動画削除・妹系ヒロイン・カエラ×2、視聴者3。相手手札: 動画編集・一般女子高生A・ママチャリ暴走族、視聴者4
- クライアントの進行は `tutorialStep`(1〜11、12=TUT_FREE_STEP で自由操作)。段階ごとに出すボタンは render 内の `isTutorial && tutorialStep < TUT_FREE_STEP` の分岐と `TUT_PLAY_ALLOW`(その段階で出せるカード)で決める。遷移は tutorialCheck(T1)/tutorialPromptCheck(割り込み・打ち消し対象・ブロック)/tutorialCancelResolved(打ち消しの解決演出後)/tutorialStateCheck(T2)/tutorialCombatResult(自分の攻撃後)/tutorialBlockResult(相手の攻撃後)
- 案内箱 `#tutorialGuide` は `showGuide(body, act)`。画面上部・横長・最大45vh・「たたむ」。モーダルが開いている間は自動で👉の1行だけ(`_guideAuto`)、手動のたたみ(`_guideManual`)とは別。モーダルの中に `.tut-note`(tutNote())がある時は箱ごと消す。文面を変える時は、進行の分岐で `showGuide` を呼んでいる箇所を直す
- 攻撃確定は「キャマキリと妹系ヒロインが居る分だけ」必須(想定外で片方が居なくても進める)。ブロック未選択の確定は1回だけ止めて `.tut-note` に警告(2回目は通す=ブロックしない結果も見せる)
- チュートリアルの部屋は、ターンの制限時間も質問(割り込み・ブロック)の制限時間も無し(`GameRoom._armPromptTimeout` で isTutorial は return)。自動パスがあると台本のキャマキリが破壊されて詰む
- 初回判定: `_firstRun`(client.js 先頭。`salvado_player_id` 未作成 かつ `tutorialDone` 無し)。index.html 末尾で `maybeFirstRun()`(「まず3分のチュートリアル」の案内)。終了時に `tutorialDone=1`。「CPUと対戦してみる」は sessionStorage `afterTutorial=cpu` → 再読込後に aiMatch()
- 通し確認: scratchpad の cdp_tutorial2.js(ヘッドレスChrome、PORTRAIT=1 で縦向き)。文面を変えたら必ず通す

## Phase 0: 対戦会・今日遊んだ人・初期デッキ・計測（2026-10-03）
- 設定は DB の app_settings(`server/settings.js`、30秒キャッシュ)。`meetups`={label, from:'YYYY-MM-DD', slots:[{dow,h,m,len}]}(JST)、`lobby_flags`={showPlayedToday, starterDeck}。GET は誰でも(`/api/app/meetups`, `/api/app/lobby-flags`)、POST は x-admin-token(BOARD_ADMIN_TOKEN)。既定: 日曜/木曜 13:00〜13:30、初回 2026-10-11、人数表示オフ、初期デッキ fantasy
- `/board/lobby` に `server/lobbyExtras.js` の extras(meet, starterDeck, showPlayed, playedToday)が混ざる(board.js mount の第5引数)。クライアントは `client/lobby.js` の renderMeet(帯。開催中はクイックマッチに .qm-meet)と renderRecruit(人数表示の切替、starterDeck を localStorage に控える)
- 初期デッキ: `shared/cards.js` の STARTER_DECKS(クライアントの THEME_DECKS と同じ60枚×3)。クライアントはデッキ未保存なら initDeckEditor で入れて保存。サーバーも deck 未指定なら `Lobby.starterDeckDef(Lobby.starterDeckSync())` で受ける(7入口)。以前は98枚の全カードで戦っていた
- 計測: `POST /api/track` {device:'d_…', pid, event, meta}。許可イベントは index.js の TRACK_EVENTS(open/tutorial_start/tutorial_end/first_match_prompt/first_match_start/quickmatch_press/store_click)。1端末1時間60件まで。集計は `GET /api/admin/funnel?days=7`(x-admin-token)= opened/newDevices/tutorialDone/played/ranked/returned(6日後以降の再起動)。クライアントの `track()` は失敗しても何もしない。open は1日1回(localStorage `salvado_track_open_day`)
- 広告: `client/ads.js` の FIRST_MATCHES_NO_AD=3(勝敗後の全画面広告を最初の3戦は出さない。localStorage `adsMatchCount`)
- テスト: `node tests/lobby_extras.test.js`(日程計算のJST境界、初期デッキの検証、funnel)。結合テストは PORT=3210 のサーバーで(ghost_match は TURN_TIMER_MS=3000、release/start_guard は BOARD_ADMIN_TOKEN=testadmin)
