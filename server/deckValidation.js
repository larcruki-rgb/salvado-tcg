// デッキ検証ゲートウェイ — 2026-09-06 (工事メモ_デッキ検証ゲートウェイ に基づく)
// 目的: デッキを受け取る7つのsocket入口の検証をここに集約する。
// 2026-10: (1)全カードの上限枚数(deckMax)をサーバーでも検証 (2)acquire:'quest' のカードは使用権の解除済みかを検証
const { CARD_DB, DECK_MAX_BEFORE_RELEASE } = require('../shared/cards');
const Unlocks = require('./unlocks');
const Release = require('./release');

const cardById = new Map(CARD_DB.map(c => [c.id, c]));

// そのカードを何枚まで使ってよいか(所有・解除の観点。デッキ上限 deckMax は別に見る)。
// 既存カード(acquire:'free')は無制限。acquire:'quest' は解除済みなら無制限、未解除なら 0。
// unlocked: そのユーザーの解除済みカードIDの Set(呼び出し側が先に読み込んで渡す。socket入口は同期のまま使うため)
function getAllowedCount(userId, cardId, unlocked) {
  const c = cardById.get(cardId);
  if (!c || c.acquire !== 'quest') return Infinity;
  if (Unlocks.unlockAll()) return Infinity;
  return (unlocked && unlocked.has(cardId)) ? Infinity : 0;
}

// デッキに「解除が要るカード」が入っているか
function hasQuestCards(deck) {
  return Array.isArray(deck) && deck.some(d => { const c = d && cardById.get(d.id); return !!(c && c.acquire === 'quest'); });
}
// デッキに「まだ全員には公開されていないカード」が入っているか(先行テストの人かどうかは見ない。部屋の制限に使う)
function hasUnreleasedCards(deck) {
  if (process.env.UNLOCK_ALL_CARDS === '1') return false;
  return Array.isArray(deck) && deck.some(d => { const c = d && cardById.get(d.id); return !!(c && !Release.isGroupOpen(Release.cardGroup(c))); });
}
// 解除情報を読み込む必要があるか。報酬カードが入っていなければ不要(=既存プレイヤーの対戦開始を待たせない)。
// その人にまだ公開されていない時も不要(どのみち検証で拒否する)
function needsUnlockCheck(deck, userId) {
  if (Unlocks.unlockAll()) return false;
  return Array.isArray(deck) && deck.some(d => { const c = d && cardById.get(d.id); return !!(c && c.acquire === 'quest' && Release.cardVisibleTo(c, userId)); });
}

// そのカードの今の上限枚数。上限が変わる更新(DECK_MAX_BEFORE_RELEASE)は、紐づく公開グループが開くまで旧上限のまま。
// 公開状態がまだDBから読めていない間(起動直後・DB障害)は「非公開」が仮の値なので、旧上限に戻さず新上限(厳しい側)を使う(Codex指摘)
function deckMaxOf(c) {
  if (process.env.UNLOCK_ALL_CARDS !== '1' && Release.isLoaded()) {
    for (const g of Object.keys(DECK_MAX_BEFORE_RELEASE || {})) {
      const m = DECK_MAX_BEFORE_RELEASE[g][c.id];
      if (m !== undefined && !Release.isGroupOpen(g)) return m;
    }
  }
  return c.deckMax;
}

// deck はクライアントの deckDef: [{id, count}] の配列、または未指定(undefined/null)。
// 未指定はサーバー既定デッキ(buildDeckのフォールバック)を意味するので正当。
// 返り値: { ok: true } または { ok: false, reason: '...', cards: [該当カードID] }
function validateDeck(userId, deck, unlocked) {
  // 未指定 = 既定デッキ。従来通り許可
  if (deck === undefined || deck === null) return { ok: true };

  // --- 基本整合性(チート・事故デッキ塞ぎ) ---
  if (!Array.isArray(deck)) return { ok: false, reason: 'デッキの形式が不正です' };
  if (deck.length > 100) return { ok: false, reason: 'デッキの種類数が多すぎます' };
  let total = 0;
  const sum = new Map(); // 同じIDが複数行に分かれていても、IDごとに合算してから判定する
  for (const d of deck) {
    if (!d || typeof d !== 'object') return { ok: false, reason: 'デッキの形式が不正です' };
    if (typeof d.id !== 'string' || !cardById.has(d.id)) return { ok: false, reason: '存在しないカードが含まれています' };
    // countの上限60は「1種類がデッキ全体を超えることはない」の緩い縛り。
    // 巨大なcountはbuildDeckの無限ループ級の負荷になるため必須(DoS対策)。
    if (!Number.isInteger(d.count) || d.count < 1 || d.count > 60) return { ok: false, reason: 'カード枚数が不正です' };
    total += d.count;
    sum.set(d.id, (sum.get(d.id) || 0) + d.count);
  }
  // ちょうど60枚を全モードで必須にする(2026-09-06 オーナー決定。60枚未満はデッキ圧縮で有利になるため)
  if (total !== 60) return { ok: false, reason: 'デッキは60枚ちょうどにしてください（現在' + total + '枚）' };

  // --- 上限枚数(全カード) ---
  const over = [];
  for (const [id, n] of sum) { const m = deckMaxOf(cardById.get(id)); if (Number.isInteger(m) && n > m) over.push(id); }
  if (over.length > 0) {
    const c = cardById.get(over[0]);
    return { ok: false, reason: '「' + c.name + '」は' + deckMaxOf(c) + '枚までです（現在' + sum.get(c.id) + '枚）。デッキ編集で直してください', cards: over };
  }

  // --- 公開前のカード(そのカードの公開スイッチがオフで、先行テストのアカウントでもない) ---
  {
    const hidden = [];
    for (const [id] of sum) { const c = cardById.get(id); if (!Release.cardVisibleTo(c, userId)) hidden.push(id); }
    if (hidden.length > 0) return { ok: false, reason: '「' + hidden.map(id => cardById.get(id).name).join('」「') + '」はまだ公開されていません。デッキ編集で外してください', cards: hidden };
  }

  // --- 使用権(クエスト報酬カード) ---
  const locked = [];
  for (const [id, n] of sum) { if (n > getAllowedCount(userId, id, unlocked)) locked.push(id); }
  if (locked.length > 0) {
    return { ok: false, reason: '「' + locked.map(id => cardById.get(id).name).join('」「') + '」はまだ使えません（クエストをクリアすると解除されます）。デッキ編集で外してください', cards: locked };
  }
  return { ok: true };
}

module.exports = { validateDeck, getAllowedCount, needsUnlockCheck, hasQuestCards, hasUnreleasedCards, deckMaxOf };
