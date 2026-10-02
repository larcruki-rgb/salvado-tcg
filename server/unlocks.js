// カードの使用権の解除(2026-10)。acquire:'quest' のカードは、対象クエストをクリアして「解除」すると使えるようになる。
// 所持枚数は持たない。解除済みなら、デッキ上限(deckMax)まで使える。
// 解除情報のキャッシュはユーザーIDごと(socket ごとではない)。ゲストIDはイベントごとに渡ってくるので、接続時には確定しないため。
const db = require('./db');

// userId -> { set: Set(cardId), at: 読み込んだ時刻 }。
// 入れるのは「解除が1枚以上あるID」だけ(誰でも叩ける入口から、存在しないIDで無限に増やされないように)。件数と期限にも上限を置く
const cache = new Map();
const CACHE_MAX = 5000;
const CACHE_TTL_MS = 10 * 60 * 1000; // 別の経路でDBが変わっても、10分で読み直す

// 環境変数 UNLOCK_ALL_CARDS=1 で、解除が要るカードを誰でも使える(デバッグ用。既定はオフ)
function unlockAll() { return process.env.UNLOCK_ALL_CARDS === '1'; }

function remember(userId, set) {
  if (set.size === 0) { cache.delete(userId); return; }
  cache.delete(userId); // 入れ直して「新しい順」にする
  cache.set(userId, { set, at: Date.now() });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); // 古いものから捨てる
}

// そのIDの解除済みカード(Set)。DB障害は例外で返す(「未解除」と区別するため、空で握りつぶさない)
async function load(userId) {
  if (!userId) return new Set();
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.set;
  const fresh = new Set(await db.getUnlockedCards(userId));
  // 読み込みを待っている間に grant が先に終わっていた場合、その結果を古い読み込み結果で消さない(解除は増える一方なので、足し合わせる)
  const now = cache.get(userId);
  if (now && now !== hit) now.set.forEach(id => fresh.add(id));
  remember(userId, fresh);
  return fresh;
}

// 解除を付与する。3枚を1文(=1トランザクション)で入れ、既にあれば何もしない。戻り値は「今回新しく解除されたカードID」
async function grant(userId, cardIds, displayName) {
  if (!userId || !Array.isArray(cardIds) || cardIds.length === 0) return [];
  let added;
  try { added = await db.unlockCards(userId, cardIds); }
  catch (e) {
    // users に行が無い(外部キー違反)時は、行を作ってからもう一度
    await db.upsertUser(userId, displayName || null);
    added = await db.unlockCards(userId, cardIds);
  }
  // 同じIDで繋いでいる別端末・別タブにも効くよう、IDごとのキャッシュを更新する
  const cur = cache.get(userId);
  const set = cur ? cur.set : new Set();
  cardIds.forEach(id => set.add(id));
  remember(userId, set);
  return added;
}

function invalidate(userId) { cache.delete(userId); }
function _cacheSize() { return cache.size; }

module.exports = { load, grant, invalidate, unlockAll, _cacheSize };
