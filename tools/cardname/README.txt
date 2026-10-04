カード名の画像(client/img/cardname/<id>.png)を作る。2026-06 確定の設定(Hiragino Sans 800 / 36px / 字間2px / #2a2a3a / 白フチ0.5px / ネイビー縁取り影)で、16倍の解像度(高さ896px)。
使い方(Mac・Google Chrome が必要。ws は npm i ws):
  WS=/path/to/node_modules/ws node tools/cardname/gen.js '[{"id":"zeratine","name":"大食冠 ゼラチネ"}]' client/img/cardname
