// デッキ検証ゲートウェイ — 2026-09-06 (工事メモ_デッキ検証ゲートウェイ に基づく)
// 目的: デッキを受け取る7つのsocket入口の検証をここに集約する。
// 2026-10: (1)全カードの上限枚数(deckMax)をサーバーでも検証 (2)acquire:'quest' のカードは使用権の解除済みかを検証
const { CARD_DB } = require('../shared/cards');
const Unlocks = require('./unlocks');

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

// デッキに「解除が要るカード」が入っているか。入っていなければ解除情報を読み込む必要がない(=既存プレイヤーの対戦開始を待たせない)
function needsUnlockCheck(deck) {
  if (!Array.isArray(deck) || Unlocks.unlockAll()) return false;
  return deck.some(d => { const c = d && cardById.get(d.id); return !!(c && c.acquire === 'quest'); });
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
  for (const [id, n] of sum) { const c = cardById.get(id); if (Number.isInteger(c.deckMax) && n > c.deckMax) over.push(id); }
  if (over.length > 0) {
    const c = cardById.get(over[0]);
    return { ok: false, reason: '「' + c.name + '」は' + c.deckMax + '枚までです（現在' + sum.get(c.id) + '枚）。デッキ編集で直してください', cards: over };
  }

  // --- 使用権(クエスト報酬カード) ---
  const locked = [];
  for (const [id, n] of sum) { if (n > getAllowedCount(userId, id, unlocked)) locked.push(id); }
  if (locked.length > 0) {
    return { ok: false, reason: '「' + locked.map(id => cardById.get(id).name).join('」「') + '」はまだ使えません（クエストをクリアすると解除されます）。デッキ編集で外してください', cards: locked };
  }
  return { ok: true };
}

module.exports = { validateDeck, getAllowedCount, needsUnlockCheck };
