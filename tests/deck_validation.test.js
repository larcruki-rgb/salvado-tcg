// デッキ検証(2026-10): 全カードの上限枚数、同じIDを複数行に分けた回避、クエスト報酬カードの使用権、クエスト定義
// 実行: node tests/deck_validation.test.js   (DBは使わない)
const path = require('path'); const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const { CARD_DB, buildDeck } = require(path.join(ROOT, 'shared/cards.js'));
const { QUESTS } = require(path.join(ROOT, 'shared/quests.js'));
const V = require(path.join(ROOT, 'server/deckValidation.js'));
const Release = require(path.join(ROOT, 'server/release.js'));
Release._setForTest({ released: true }); // V1〜V8 は「公開済み」の状態で確かめる(公開スイッチそのものは V9)
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
{ const d = withCard('reichen', 3); const r = V.validateDeck('p_x', d);
  ok(total(d) === 60 && r.ok === false && r.reason.indexOf('賢者 レイチェン') >= 0 && r.reason.indexOf('2枚まで') >= 0 && r.cards[0] === 'reichen', 'V3) 上限2のカードを3枚 → 拒否 (' + r.reason + ')'); }
{ const d = withCard('douga_sakujo', 5); const r = V.validateDeck('p_x', d);
  ok(total(d) === 60 && r.ok === false && r.reason.indexOf('動画削除') >= 0, 'V3) 上限4のカードを5枚 → 拒否'); }
{ const d = withCard('99wari', 2); const r = V.validateDeck('p_x', d);
  ok(total(d) === 60 && r.ok === false, 'V3) 上限1のカードを2枚 → 拒否'); }
{ const d = withCard('reichen', 2); ok(total(d) === 60 && V.validateDeck('p_x', d).ok === true, 'V3) 上限ちょうど(2枚)は通る'); }
// 2026-11 死神少女・盗賊サギを1枚制限に変更。公開グループ kawauso(11/15)と連動: 開くまでは旧上限2のまま、開いたら1
Release._setForTest({ released: true, groups: { kawauso: true } });
['shinigami', 'sagi'].forEach(id => { const d2 = withCard(id, 2); const r2 = V.validateDeck('p_x', d2);
  ok(total(d2) === 60 && r2.ok === false && r2.reason.indexOf('1枚まで') >= 0 && r2.cards[0] === id, 'V3) ' + id + ' は2枚で拒否 (' + r2.reason + ')');
  const d1 = withCard(id, 1); ok(total(d1) === 60 && V.validateDeck('p_x', d1).ok === true, 'V3) ' + id + ' は1枚なら通る');
  const d3 = withCard(id, 3); ok(V.validateDeck('p_x', d3).ok === false, 'V3) ' + id + ' は3枚で拒否(公開後)'); });
Release._setForTest({ released: true }); // kawauso 未指定=非公開
['shinigami', 'sagi'].forEach(id => { const d2 = withCard(id, 2); const r2 = V.validateDeck('p_x', d2);
  ok(r2.ok === true && V.deckMaxOf(CARD_DB.find(c => c.id === id)) === 2, 'V3) 公開前: ' + id + ' は2枚まで通る(旧上限)');
  const d3 = withCard(id, 3); const r3 = V.validateDeck('p_x', d3);
  ok(r3.ok === false && r3.reason.indexOf('2枚まで') >= 0, 'V3) 公開前: ' + id + ' は3枚で拒否・理由は旧上限の2枚 (' + r3.reason + ')'); });
ok(V.deckMaxOf(CARD_DB.find(c => c.id === '99wari')) === 1 && V.deckMaxOf(CARD_DB.find(c => c.id === 'reichen')) === 2, 'V3) 表にないカードの上限は変わらない');
Release._setForTest({ released: true, loaded: false }); // DBから読めていない間は「非公開」が仮の値 → 旧上限に戻さない(厳しい側)
ok(V.deckMaxOf(CARD_DB.find(c => c.id === 'sagi')) === 1 && V.validateDeck('p_x', withCard('sagi', 2)).ok === false, 'V3) 公開状態が未読込の間は新上限(1枚)で判定');
Release._setForTest({ released: true });

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

// V9) 公開スイッチ: 公開前は、解除済みでも誰も使えない。先行テストのアカウントだけ使える。既存カードのデッキには影響しない
{ const d = withCard('zeratine', 2); const all = new Set(['zeratine', 'lead', 'daisuke_dare']);
  Release._setForTest({ released: false, preview: ['u_tester'] });
  const r = V.validateDeck('p_x', d, all);
  ok(r.ok === false && r.reason.indexOf('まだ公開されていません') >= 0 && r.cards.includes('zeratine'), 'V9) 公開前: 解除済みのゲストでも拒否 (' + r.reason + ')');
  ok(V.validateDeck('u_other', d, all).ok === false, 'V9) 公開前: 先行テストでないアカウントも拒否');
  ok(V.validateDeck('u_tester', d, all).ok === true, 'V9) 公開前: 先行テストのアカウントは使える(解除済みなら)');
  ok(V.validateDeck('u_tester', d, new Set()).ok === false, 'V9) 先行テストでも、クエストをクリアしていなければ使えない');
  ok(V.needsUnlockCheck(d, 'p_x') === false && V.needsUnlockCheck(d, 'u_tester') === true, 'V9) 公開前は、見えない人の解除情報は読みに行かない');
  ok(V.validateDeck('p_x', deck60).ok === true && V.validateDeck('u_other', undefined).ok === true, 'V9) 公開前でも、既存カードのデッキ・既定デッキは今までどおり通る');
  ok(Release.visibleTo('p_tester') === false && Release.visibleTo(null) === false, 'V9) ゲストID・IDなしは先行テストの対象にならない');
  Release._setForTest({ released: true });
  ok(V.validateDeck('p_x', d, all).ok === true, 'V9) 公開後: 解除済みなら誰でも使える');
  Release._setForTest({ released: false }); process.env.UNLOCK_ALL_CARDS = '1';
  ok(V.validateDeck('p_x', d, null).ok === true, 'V9) UNLOCK_ALL_CARDS=1(デバッグ)は公開前でも使える');
  delete process.env.UNLOCK_ALL_CARDS; Release._setForTest({ released: true }); }

// V10) グループ別の公開スイッチ(かわうそ3枚 = release:'kawauso')。ゼラチネのスイッチ(released)とは独立
{ const d = withCard('kawauso', 2);
  Release._setForTest({ released: true, preview: ['u_tester'] }); // 既定グループは公開中、kawauso は未指定=非公開
  const r = V.validateDeck('p_x', d, null);
  ok(r.ok === false && r.reason.indexOf('まだ公開されていません') >= 0 && r.cards.includes('kawauso'), 'V10) かわうそ非公開: ゼラチネが公開中でも、かわうそ入りは拒否 (' + r.reason + ')');
  const KU = new Set(['kawauso', 'kawauso_kawauso', 'kawauso_kawaiso']); // かわうそ3枚を解除済み(2026-11 クエスト解除制に変更)
  ok(V.validateDeck('u_tester', d, KU).ok === true, 'V10) 先行テストのアカウントは、かわうそも使える(解除済みなら)');
  ok(V.hasUnreleasedCards(d) === true && V.hasUnreleasedCards(deck60) === false && V.hasUnreleasedCards(withCard('zeratine', 2)) === false, 'V10) hasUnreleasedCards: かわうそ入りだけ true(ゼラチネは公開中なので false)');
  ok(Release.allOpen() === false && Release.isGroupOpen('kawauso') === false && Release.isGroupOpen('default') === true && Release.isGroupOpen(null) === true, 'V10) allOpen=false / default は公開 / 対象外カードは常に公開');
  ok(JSON.stringify(Release.groupsVisibleTo(null)) === '{"kawauso":false,"maou13":false}' && JSON.stringify(Release.groupsVisibleTo('u_tester')) === '{"kawauso":true,"maou13":true}', 'V10) groupsVisibleTo: 一般は false・先行テストは true');
  ok(V.validateDeck('p_x', withCard('zeratine', 2), new Set(['zeratine'])).ok === true, 'V10) かわうそ非公開でも、公開済みのゼラチネは今までどおり使える');
  Release._setForTest({ released: true, groups: { kawauso: true } });
  ok(Release.allOpen() === false, 'V10) 十三魔王(maou13)が非公開の間は allOpen=false');
  Release._setForTest({ released: true, groups: { kawauso: true, maou13: true } }); // 2026-11 公開グループ maou13 を追加。allOpen は全グループが開いた時
  ok(V.validateDeck('p_x', d, KU).ok === true && Release.allOpen() === true && V.hasUnreleasedCards(d) === false, 'V10) かわうそ公開後: 解除済みなら誰でも使える・allOpen=true');
  Release._setForTest({ released: false, groups: { kawauso: true } });
  ok(V.validateDeck('p_x', d, KU).ok === true && V.validateDeck('p_x', withCard('zeratine', 2), new Set(['zeratine'])).ok === false, 'V10) 逆(ゼラチネ非公開・かわうそ公開)も独立に効く');
  Release._setForTest({ released: true, groups: { kawauso: false, bogus: true, weird: 'yes' } });
  ok(Release.isGroupOpen('bogus') === true && Release.isGroupOpen('weird') === false && Release.state().groups.weird === undefined, 'V10) 真偽値でない値は捨てる');
  Release._setForTest({ released: true, groups: { kawauso: true } }); }

// V11) かわうそ3枚はクエスト quest_09 で解除(2026-11)。公開グループ kawauso と組み合わせて効く
{ const d = withCard('kawauso', 2); const KU = new Set(['kawauso', 'kawauso_kawauso', 'kawauso_kawaiso']);
  const q = QUESTS.find(x => x.id === 'quest_09');
  ok(!!q && q.release === 'kawauso' && q.reward.unlockCards.slice().sort().join(',') === 'kawauso,kawauso_kawaiso,kawauso_kawauso', 'V11) quest_09: 公開グループ kawauso、報酬はかわうそ3枚');
  ok(['kawauso', 'kawauso_kawauso', 'kawauso_kawaiso'].every(id => CARD_DB.find(c => c.id === id).acquire === 'quest'), 'V11) かわうそ3枚は acquire:quest');
  Release._setForTest({ released: true, groups: { kawauso: true } });
  const r = V.validateDeck('p_x', d, new Set());
  ok(r.ok === false && r.reason.indexOf('クエストをクリア') >= 0 && r.cards.includes('kawauso'), 'V11) 公開後でも、未解除ならかわうそ入りは拒否 (' + r.reason + ')');
  ok(V.validateDeck('p_x', d, KU).ok === true, 'V11) 解除済みなら使える');
  ok(V.validateDeck('p_x', withCard('kawauso', 2), new Set(['zeratine', 'lead', 'daisuke_dare'])).ok === false, 'V11) ゼラチネの解除では、かわうそは使えない');
  ok(V.needsUnlockCheck(d, 'p_x') === true, 'V11) かわうそ公開後は解除情報を読む');
  Release._setForTest({ released: true, preview: ['u_tester'] }); // かわうそ非公開・ゼラチネ公開
  ok(V.needsUnlockCheck(d, 'p_x') === false && V.needsUnlockCheck(d, 'u_tester') === true, 'V11) かわうそ非公開の間は、見えない人の解除情報は読まない(ゼラチネが公開中でも)');
  ok(V.needsUnlockCheck(withCard('zeratine', 2), 'p_x') === true, 'V11) ゼラチネ入りは今までどおり読む');
  { const _log = console.log; console.log = () => {};
    const gs = new GameState('q'); gs.log = () => {}; gs.toast = () => {}; gs.initQuest('quest_09', deck60);
    console.log = _log;
    const cpu = gs.G.players[1], me = gs.G.players[0], h = cpu.hand.map(c => c.id);
    ok(cpu.field.map(c => c.id).join(',') === 'kawauso,kawauso,kawauso' && cpu.field.every(c => !c.summonSick), 'V11) quest_09 CPUの場: かわうそ3体');
    ok(h.filter(x => x === 'kawauso_kawaiso').length === 3 && h.filter(x => x === 'kawauso_kawauso').length === 4 && h.length === 7, 'V11) quest_09 CPUの手札: かわいそ3・かわうそかわうそ4 (' + h.join(',') + ')');
    ok(me.life === 1000 && me.mana.length === 5 && cpu.life === 1000 && cpu.mana.length === 8 && !cpu.deck.some(c => c.acquire === 'quest'), 'V11) quest_09 LP1000同士・視聴者 自5/敵8・CPU山札に報酬カードなし'); }
  Release._setForTest({ released: true, groups: { kawauso: true } }); }

console.log(fails === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL (' + fails + ')');
process.exit(fails === 0 ? 0 : 1);
