// カードの使用権の解除(2026-10)。acquire:'quest' のカードは、対象クエストをクリアして「解除」すると使えるようになる。
// 所持枚数は持たない。解除済みなら、デッキ上限(deckMax)まで使える。
// 解除情報のキャッシュはユーザーIDごと(socket ごとではない)。ゲストIDはイベントごとに渡ってくるので、接続時には確定しないため。
//
// ゲスト(p_)は「クリアした端末」でだけ使える。ゲストIDは本人確認をしていない(名乗るだけで通る)ので、IDだけで判定すると、
// 解除済みの他人のゲストIDを名乗れば、クリアしていなくても使えてしまう。そこで、クリアした時の端末の鍵(接続時に送られる deviceKey。
// 他人には見えない)を解除と一緒に記録し、同じ鍵の接続だけに使用を認める。DBには鍵そのものではなくハッシュを置く。
// アカウント(u_)はログインで本人確認済みなので、端末は問わない。
const crypto = require('crypto');
const db = require('./db');

// userId -> { set: Set(cardId), devs: Set(端末の鍵のハッシュ), at: 読み込んだ時刻 }。
// 入れるのは「解除が1枚以上あるID」だけ(誰でも叩ける入口から、存在しないIDで無限に増やされないように)。件数と期限にも上限を置く
const cache = new Map();
const CACHE_MAX = 5000;
const CACHE_TTL_MS = 10 * 60 * 1000; // 別の経路でDBが変わっても、10分で読み直す

// 環境変数 UNLOCK_ALL_CARDS=1 で、解除が要るカードを誰でも使える(デバッグ用。既定はオフ)
function unlockAll() { return process.env.UNLOCK_ALL_CARDS === '1'; }
function isGuestId(userId) { return !String(userId).startsWith('u_'); }
// 端末の鍵は「文字列・先頭64文字」に揃えてからハッシュにする。socket 接続時(index.js)は64文字に切り詰めているので、
// API(x-device-key ヘッダー)など他の入口でも同じ規則にしないと、同じ端末なのに一致しなくなる。文字列以外・空は鍵なし扱い
function deviceHash(deviceKey) {
  if (typeof deviceKey !== 'string' || !deviceKey) return null;
  return crypto.createHash('sha256').update(deviceKey.slice(0, 64)).digest('hex').slice(0, 32);
}

function remember(userId, entry) {
  cache.delete(userId); // 入れ直して「新しい順」にする
  if (entry.set.size === 0) return;
  entry.at = Date.now();
  cache.set(userId, entry);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); // 古いものから捨てる
}

// 付与・無効化のたびに進める番号。
// キャッシュに入れるのは「DBを読んでいる間に、付与も無効化も起きなかった読み込み結果」だけにする(正はいつもDB)。
// 以前は付与の結果を手元のキャッシュに足し合わせていたが、同時に走る読み込み・別の付与・無効化との順序しだいで
// 記録が欠ける穴が残った。付与したらキャッシュを捨て、次に必要になった時に読み直す形にして、足し合わせをやめた
let epoch = 0;

async function info(userId) {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;
  let r, clean = false;
  for (let i = 0; i < 3 && !clean; i++) { const e0 = epoch; r = await db.getUnlockInfo(userId); clean = (epoch === e0); }
  const fresh = { set: new Set(r.cards), devs: new Set(r.devices), at: 0 };
  if (clean) remember(userId, fresh); // 読んでいる間に更新があった結果は覚えない(返すだけ。次の呼び出しでまた読む)
  return fresh;
}

// その接続で使える解除済みカード(Set)。DB障害は例外で返す(「未解除」と区別するため、空で握りつぶさない)。
// ゲストは、クリアした端末(deviceKey)からの接続でなければ空を返す
async function load(userId, deviceKey) {
  if (!userId) return new Set();
  const e = await info(userId);
  if (isGuestId(userId)) {
    const h = deviceHash(deviceKey);
    if (!h || !e.devs.has(h)) return new Set();
  }
  return e.set;
}

// 解除を付与する。カードと端末の記録を1文(=1トランザクション)で入れ、既にあれば何もしない。
// 戻り値は「今回この接続で新しく使えるようになったカードID」(ゲストが別の端末でクリアし直した時は、全カードが対象)
async function grant(userId, cardIds, displayName, deviceKey) {
  if (!userId || !Array.isArray(cardIds) || cardIds.length === 0) return [];
  const guest = isGuestId(userId);
  const h = guest ? deviceHash(deviceKey) : null;
  if (guest && !h) throw new Error('nodevice'); // 端末の鍵が無いゲストには付与できない(付与しても、どの接続からも使えない)
  let r;
  try { r = await db.unlockCards(userId, cardIds, h); }
  catch (e) {
    // users に行が無い(外部キー違反)時は、行を作ってからもう一度
    await db.upsertUser(userId, displayName || null);
    r = await db.unlockCards(userId, cardIds, h);
  }
  invalidate(userId); // キャッシュを捨てる。同じIDの別端末・別タブも含め、次に必要になった時にDBから読み直す
  return (guest && r.deviceAdded) ? cardIds.slice() : r.cards;
}

function invalidate(userId) { epoch++; cache.delete(userId); }
function _cacheSize() { return cache.size; }

module.exports = { load, grant, invalidate, unlockAll, deviceHash, _cacheSize };
