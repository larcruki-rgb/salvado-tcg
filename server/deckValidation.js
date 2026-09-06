// デッキ検証ゲートウェイ — 2026-09-06 (工事メモ_デッキ検証ゲートウェイ に基づく)
// 目的: デッキを受け取る7つのsocket入口の検証をここに集約する。
// 現状は「全カード無料・無制限」なので所有チェックは素通し。
// 将来ガチャ/所有制を入れる時は getAllowedCount を差し替えるだけで全モードに効く。
const { CARD_DB } = require('../shared/cards');

const cardById = new Map(CARD_DB.map(c => [c.id, c]));

// 将来ここを本実装する（acquire:'gacha' のカードは user_inventory の所有数を返す等）。
// 今は全カード無制限。userId はsocket接続時にトークン裏取り済みのIDが渡ってくる
// (アカウントは u_xxx、ゲストは p_xxx、未登録は null)。
function getAllowedCount(userId, cardId) {
  return Infinity;
}

// deck はクライアントの deckDef: [{id, count}] の配列、または未指定(undefined/null)。
// 未指定はサーバー既定デッキ(buildDeckのフォールバック)を意味するので正当。
// 返り値: { ok: true } または { ok: false, reason: '...' }
function validateDeck(userId, deck) {
  // 未指定 = 既定デッキ。従来通り許可
  if (deck === undefined || deck === null) return { ok: true };

  // --- 基本整合性(チート・事故デッキ塞ぎ) ---
  if (!Array.isArray(deck)) return { ok: false, reason: 'デッキの形式が不正です' };
  if (deck.length > 100) return { ok: false, reason: 'デッキの種類数が多すぎます' };
  let total = 0;
  for (const d of deck) {
    if (!d || typeof d !== 'object') return { ok: false, reason: 'デッキの形式が不正です' };
    if (typeof d.id !== 'string' || !cardById.has(d.id)) return { ok: false, reason: '存在しないカードが含まれています' };
    // countの上限60は「1種類がデッキ全体を超えることはない」の緩い縛り。
    // 巨大なcountはbuildDeckの無限ループ級の負荷になるため必須(DoS対策)。
    if (!Number.isInteger(d.count) || d.count < 1 || d.count > 60) return { ok: false, reason: 'カード枚数が不正です' };
    total += d.count;
  }
  // ちょうど60枚を全モードで必須にする(2026-09-06 オーナー決定。60枚未満はデッキ圧縮で有利になるため)
  if (total !== 60) return { ok: false, reason: 'デッキは60枚ちょうどにしてください（現在' + total + '枚）' };

  // --- 所有チェック(現状は素通し) ---
  for (const d of deck) {
    if (d.count > getAllowedCount(userId, d.id)) {
      return { ok: false, reason: '所有していないカードが含まれています' };
    }
  }
  return { ok: true };
}

module.exports = { validateDeck, getAllowedCount };
