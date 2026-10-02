// カードの使用権の解除(2026-10)。acquire:'quest' のカードは、対象クエストをクリアして「解除」すると使えるようになる。
// 所持枚数は持たない。解除済みなら、デッキ上限(deckMax)まで使える。
// 解除情報のキャッシュはユーザーIDごと(socket ごとではない)。ゲストIDはイベントごとに渡ってくるので、接続時には確定しないため。
const db = require('./db');

const cache = new Map(); // userId -> Set(cardId)

// 環境変数 UNLOCK_ALL_CARDS=1 で、解除が要るカードを誰でも使える(デバッグ用。既定はオフ)
function unlockAll() { return process.env.UNLOCK_ALL_CARDS === '1'; }

// そのIDの解除済みカード(Set)。DB障害は例外で返す(「未解除」と区別するため、空で握りつぶさない)
async function load(userId) {
  if (!userId) return new Set();
  if (cache.has(userId)) return cache.get(userId);
  const set = new Set(await db.getUnlockedCards(userId));
  cache.set(userId, set);
  return set;
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
  const set = cache.get(userId) || new Set();
  cardIds.forEach(id => set.add(id));
  cache.set(userId, set);
  return added;
}

function invalidate(userId) { cache.delete(userId); }

module.exports = { load, grant, invalidate, unlockAll };
