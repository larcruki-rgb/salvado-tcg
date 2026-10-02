// デッキ検証(2026-10): 全カードの上限枚数、同じIDを複数行に分けた回避、クエスト報酬カードの使用権、クエスト定義
// 実行: node tests/deck_validation.test.js   (DBは使わない)
const path = require('path'); const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const { CARD_DB, buildDeck } = require(path.join(ROOT, 'shared/cards.js'));
const { QUESTS } = require(path.join(ROOT, 'shared/quests.js'));
const V = require(path.join(ROOT, 'server/deckValidation.js'));
const GameState = require(path.join(ROOT, 'server/GameState.js'));
let fails = 0; const ok = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
const deck60 = JSON.parse(fs.readFileSync(path.join(__dirname, 'deck60.json'), 'utf8'));
const clone = d => JSON.parse(JSON.stringify(d));
// 60枚を保ったまま、あるカードを n 枚入れたデッキを作る(上限4のカードで調整)
function withCard(id, n, split) {
  const d = clone(deck60).filter(x => x.id !== id);
  let total = d.reduce((s, x) => s + x.count, 0);
  // n 枚ぶんの空きを作る
  let need = total + n - 60;
  for (const x of d) { while (need > 0 && x.count > 1) { x.count--; need--; } }
  for (let i = d.length - 1; i >= 0 && need > 0; i--) { need -= d[i].count; d.splice(i, 1); }
  if (split) { for (let i = 0; i < n; i++) d.push({ id, count: 1 }); } else d.push({ id, count: n });
  let t = d.reduce((s, x) => s + x.count, 0);
  // 足りない分は上限4のカードで埋める
  const fillers = CARD_DB.filter(c => c.deckMax === 4 && c.id !== id);
  for (const f of fillers) { if (t >= 60) break; const cur = d.find(x => x.id === f.id); const have = cur ? cur.count : 0; const add = Math.min(4 - have, 60 - t); if (add <= 0) continue; if (cur) cur.count += add; else d.push({ id: f.id, count: add }); t += add; }
  return d;
}
const total = d => d.reduce((s, x) => s + x.count, 0);

// V1) 既存の正しいデッキは通る
ok(V.validateDeck('p_x', deck60).ok === true, 'V1) テスト用の通常デッキ(60枚)は通る');
ok(V.validateDeck('p_x', undefined).ok === true, 'V1) デッキ未指定(既定デッキ)は従来どおり通る');

// V2) クライアントの上限表(DECK_CARDS の max)と、共有の deckMax が全カードで一致する
{ const s = fs.readFileSync(path.join(ROOT, 'client/client.js'), 'utf8');
  const a = s.indexOf('var DECK_CARDS = ['); const b = s.indexOf('];', a);
  const DECK_CARDS = eval(s.slice(a + 'var DECK_CARDS = '.length, b + 1));
  const diff = [];
  CARD_DB.forEach(c => { const dc = DECK_CARDS.find(x => x.id === c.id); if (!dc) diff.push(c.id + ':クライアントに無い'); else if (dc.max !== c.deckMax) diff.push(c.id + ':' + dc.max + '≠' + c.deckMax); });
  DECK_CARDS.forEach(dc => { if (!CARD_DB.find(c => c.id === dc.id)) diff.push(dc.id + ':共有に無い'); });
  ok(diff.length === 0, 'V2) デッキ編集の上限と deckMax が全カードで一致 ' + (diff.length ? '(' + diff.join(', ') + ')' : '(' + CARD_DB.length + '種)'));
  // 公式テーマデッキ3つは通る
  const t = s.indexOf('var THEME_DECKS = {'); const u = s.indexOf('\n};', t);
  const THEME = eval('(' + s.slice(t + 'var THEME_DECKS = '.length, u + 2) + ')');
  Object.keys(THEME).forEach(k => { const th = THEME[k]; const list = th.cards || th.deck || th; const d = Array.isArray(list) ? list.map(x => ({ id: x.id, count: x.count })) : Object.entries(list).filter(e => typeof e[1] === 'number').map(e => ({ id: e[0], count: e[1] }));
    const r = V.validateDeck('p_x', d); ok(r.ok === true, 'V2) テーマデッキ ' + k + ' は通る' + (r.ok ? '' : ' (' + r.reason + ')')); }); }

// V3) 上限超えは拒否(理由にカード名)
{ const d = withCard('shinigami', 3); const r = V.validateDeck('p_x', d);
  ok(total(d) === 60 && r.ok === false && r.reason.indexOf('死神少女') >= 0 && r.reason.indexOf('2枚まで') >= 0 && r.cards[0] === 'shinigami', 'V3) 上限2のカードを3枚 → 拒否 (' + r.reason + ')'); }
{ const d = withCard('douga_sakujo', 5); const r = V.validateDeck('p_x', d);
  ok(total(d) === 60 && r.ok === false && r.reason.indexOf('動画削除') >= 0, 'V3) 上限4のカードを5枚 → 拒否'); }
{ const d = withCard('99wari', 2); const r = V.validateDeck('p_x', d);
  ok(total(d) === 60 && r.ok === false, 'V3) 上限1のカードを2枚 → 拒否'); }
{ const d = withCard('shinigami', 2); ok(total(d) === 60 && V.validateDeck('p_x', d).ok === true, 'V3) 上限ちょうど(2枚)は通る'); }

// V4) 同じIDを複数行に分けても、合算して判定する
{ const d = withCard('shinigami', 3, true); const r = V.validateDeck('p_x', d);
  ok(total(d) === 60 && d.filter(x => x.id === 'shinigami').length === 3 && r.ok === false, 'V4) 1枚×3行に分けても拒否'); }

// V5) クエスト報酬カード: 未解除は拒否(理由にカード名)、解除済みは通る、上限は別に効く
{ const d = withCard('zeratine', 2);
  ok(V.needsUnlockCheck(d) === true && V.needsUnlockCheck(deck60) === false && V.needsUnlockCheck(undefined) === false, 'V5) 報酬カード入りのデッキだけ解除情報の読み込みが要る');
  const r0 = V.validateDeck('p_x', d, new Set());
  ok(r0.ok === false && r0.reason.indexOf('大食冠 ゼラチネ') >= 0 && r0.cards.includes('zeratine'), 'V5) 未解除 → 拒否 (' + r0.reason + ')');
  ok(V.validateDeck('p_x', d, null).ok === false, 'V5) 解除情報なし(null)でも素通ししない');
  ok(V.validateDeck('p_x', d, new Set(['zeratine'])).ok === true, 'V5) 解除済み → 通る');
  const d3 = withCard('zeratine', 3);
  const r3 = V.validateDeck('p_x', d3, new Set(['zeratine']));
  ok(r3.ok === false && r3.reason.indexOf('2枚まで') >= 0, 'V5) 解除済みでも上限2枚を超えたら拒否');
  const d4 = withCard('daisuke_dare', 4);
  ok(V.validateDeck('p_x', d4, new Set(['daisuke_dare'])).ok === true, 'V5) ダイスケ誰その男は4枚まで入る');
  process.env.UNLOCK_ALL_CARDS = '1';
  ok(V.validateDeck('p_x', d, null).ok === true && V.needsUnlockCheck(d) === false, 'V5) UNLOCK_ALL_CARDS=1 なら誰でも使える(デバッグ用)');
  delete process.env.UNLOCK_ALL_CARDS;
  ok(V.validateDeck('p_x', d, null).ok === false, 'V5) 環境変数を外すと元に戻る(既定はオフ)'); }

// V6) 新カードは既定デッキ・CPUの山札に混ざらない
{ const d = buildDeck(null); ok(!d.some(c => c.acquire === 'quest'), 'V6) 既定デッキ(' + d.length + '枚)に報酬カードが入らない'); }

// V7) 入手クエスト: 初期盤面とCPU手札
{ const _log = console.log; console.log = () => {};
  const gs = new GameState('q'); gs.log = () => {}; gs.toast = () => {};
  gs.initQuest('quest_08', deck60);
  console.log = _log;
  const q = QUESTS.find(x => x.id === 'quest_08');
  const cpu = gs.G.players[1], me = gs.G.players[0];
  ok(cpu.field.map(c => c.id).join(',') === 'zeratine,lead' && cpu.field.every(c => !c.summonSick), 'V7) CPUの場: ゼラチネ・リード');
  const h = cpu.hand.map(c => c.id);
  ok(h.length === 7 && h.slice(0, 4).join(',') === 'zeratine,lead,daisuke_dare,daisuke_dare', 'V7) CPUの手札: 指定4枚+山札から3枚で7枚 (' + h.join(',') + ')');
  ok(!cpu.deck.some(c => c.acquire === 'quest') && !h.slice(4).some(id => ['zeratine', 'lead', 'daisuke_dare'].includes(id)), 'V7) CPUの山札と補充分に報酬カードは混ざらない');
  ok(me.life === 1000 && me.mana.length === 6 && cpu.life === 1000 && cpu.mana.length === 6 && me.hand.length === 7, 'V7) ライフ1000/視聴者6(両者)、自分の手札7枚');
  ok(q.difficulty === 3 && q.reward.unlockCards.join(',') === 'zeratine,lead,daisuke_dare', 'V7) 難度3、報酬は3枚の解除'); }

// V8) 既存クエストの挙動は変わらない(hand 指定なし → 7枚引く)
{ const _log = console.log; console.log = () => {};
  const gs = new GameState('q'); gs.log = () => {}; gs.toast = () => {}; gs.initQuest('quest_03', deck60);
  console.log = _log;
  ok(gs.G.players[1].hand.length === 7 && gs.G.players[1].field.length === 3, 'V8) 既存クエスト(quest_03): CPU手札7枚・場3体のまま'); }

console.log(fails === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL (' + fails + ')');
process.exit(fails === 0 ? 0 : 1);
