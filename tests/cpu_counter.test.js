// CPUの打ち消し判断(2026-11-16): 自分の効果は打ち消さない / ダイスケ誰その男・水素水でナンパする男は損得で決める
// 実行: node tests/cpu_counter.test.js
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GameState = require(path.join(ROOT, 'server/GameState.js'));
const AIPlayer = require(path.join(ROOT, 'server/AIPlayer.js'));
const { CARD_DB, makeCard } = require(path.join(ROOT, 'shared/cards.js'));
const mc = id => makeCard(CARD_DB.find(c => c.id === id));
const ready = id => { const c = mc(id); c.tapped = false; c.summonSick = false; return c; };
let fails = 0; const _log = console.log; const ok = (c, l) => { _log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
console.log = () => {};

// CPU = 席1、相手 = 席0
function setup(o) {
  const gs = new GameState('ai'); gs.toast = () => {}; gs.log = () => {};
  for (const P of gs.G.players) { P.mana = []; for (let i = 0; i < 8; i++) { const m = mc('kaera'); m.manaTapped = false; P.mana.push(m); } P.deck = []; P.hand = []; P.field = []; P.life = 2000; }
  gs.G.cp = o.cp === undefined ? 0 : o.cp; gs.G.phase = 'main'; gs.G.turn = 5; gs.G.manaPlaced = true;
  const sent = []; const sock = { seat: 1, on() {}, emit(ev, d) { if (ev === 'action') sent.push(d); } };
  const ai = new AIPlayer(sock, gs);
  const me = gs.G.players[1], opp = gs.G.players[0];
  (o.field || []).forEach(id => me.field.push(ready(id)));
  (o.oppField || []).forEach(id => opp.field.push(ready(id)));
  (o.hand || []).forEach(id => me.hand.push(mc(id)));
  return { gs, ai, sent, me, opp };
}
const ans = s => { const r = s.sent[0]; return r ? (r.data || r) : null; };
// 割り込みの判断。返り値: 'pass' / 'douga'(動画削除) / 'sagi' / 'shinigami' / その他は文字列化
const chain = (s, stack) => {
  s.sent.length = 0;
  const abilities = []; s.me.field.forEach((c, fi) => s.gs.getActivatable(c, 1).forEach(a => abilities.push({ fi, ability: a, cardId: c.id })));
  s.ai.handleChain('chain', { stack, supports: s.me.hand.map((c, i) => ({ idx: i, id: c.id })), abilities });
  const r = ans(s); if (!r) return 'none';
  if (r.action === 'pass') return 'pass';
  if (r.action === 'playSupport') return s.me.hand[r.idx].id === 'douga_sakujo' ? 'douga' : 'support:' + s.me.hand[r.idx].id;
  if (r.action === 'activate') return r.aid === 'activated_sagi_counter' ? 'sagi' : r.aid === 'shinigami_counter' ? 'shinigami' : 'act:' + r.aid;
  return JSON.stringify(r);
};
const pickT = (s, targets, sourceId) => { s.sent.length = 0; s.ai.handlePrompt('counterspell_target', { targets, sourceId }); const r = ans(s); return r ? r.idx : null; };
const DAISUKE = 'ダイスケ誰その男 → 全ての主人公をダイスケに';
const SUISO = '水素水でナンパする男を投稿 (100/100)';
const ench = (card, id) => { card.enchantments = card.enchantments || []; const e = mc(id); card.enchantments.push({ id: e.id, src: e }); };

// ---- X) 自分の効果を打ち消さない ----
{ const s = setup({ cp: 1, field: ['izuna'], hand: ['douga_sakujo'] });
  const st = [{ description: '企画ボツ → 妹系ヒロイン 破壊', player: 1 }, { description: '投げ銭 → 妹系ヒロイン', player: 0 }];
  ok(chain(s, st) === 'pass', 'X1) 自分の企画ボツに相手が投げ銭 → 動画削除を撃たない');
  ok(pickT(s, st.map((e, i) => Object.assign({ idx: i }, e))) === 1, 'X1) 打ち消す先を選ぶ時も、自分の企画ボツは選ばない'); }
{ const s = setup({ cp: 1, hand: ['douga_sakujo'] });
  const st = [{ description: 'トモを投稿 (800/800)', player: 1 }, { description: 'あかぽ → ママチャリ暴走族', player: 0 }];
  ok(chain(s, st) === 'pass', 'X2) 自分のトモ投稿に相手があかぽ → 動画削除を撃たない');
  ok(pickT(s, st.map((e, i) => Object.assign({ idx: i }, e))) === 1, 'X2) 打ち消す先に自分のトモを選ばない'); }
{ const s = setup({ cp: 1, field: ['sagi'], hand: ['kaera'] });
  ok(chain(s, [{ description: 'チャンネル削除 → 全キャラ破壊', player: 1 }, { description: '投げ銭 → サギ', player: 0, cancelled: true }]) === 'pass', 'X3) サギの打ち消しも、自分の効果には反応しない'); }
{ const s = setup({ cp: 1, hand: ['douga_sakujo'] });
  const st = [{ description: 'トモを投稿 (800/800)', player: 1 }, { description: '動画削除→「トモを投稿 (800/800)」を打ち消し', player: 0 }];
  ok(chain(s, st) === 'douga', 'X4) 自分のトモを打ち消されそう → 相手の打ち消しを打ち消す');
  ok(pickT(s, st.map((e, i) => Object.assign({ idx: i }, e))) === 1, 'X4) 打ち消す先は相手の動画削除'); }

// ---- 回帰: 相手の強い効果は今まで通り打ち消す / どうでもいい効果は通す ----
{ const s = setup({ field: ['izuna'], hand: ['douga_sakujo'] });
  ok(chain(s, [{ description: 'チャンネル削除 → 全キャラ破壊', player: 0 }]) === 'douga', 'R1) 相手のチャンネル削除は動画削除で打ち消す(回帰)');
  ok(chain(s, [{ description: '投げ銭 → 妹系ヒロイン', player: 0 }]) === 'pass', 'R2) 相手の投げ銭は通す(回帰)');
  ok(chain(s, [{ description: 'チャンネル削除 → 全キャラ破壊', player: 0, cancelled: true }]) === 'pass', 'R3) もう無効になった効果には撃たない(回帰)'); }
{ const s = setup({ field: ['shinigami'], hand: [] });
  ok(chain(s, [{ description: '企画ボツ → 死神少女 破壊', player: 0 }]) === 'shinigami', 'R4) 死神少女は相手の企画ボツを打ち消す(回帰)');
  ok(chain(s, [{ description: 'トモを投稿 (800/800)', player: 0 }]) === 'pass', 'R5) 死神少女はキャラの投稿を打ち消さない(回帰)'); }
{ const s = setup({ hand: ['douga_sakujo'] });
  s.sent.length = 0; s.ai.handleChain('chain', { lastAction: 'チャンネル削除 → 全キャラ破壊', supports: [{ idx: 0, id: 'douga_sakujo' }], abilities: [] });
  ok(ans(s) && ans(s).action === 'playSupport', 'R6) スタックが渡されない時は、直前の行動の説明文で判断する(回帰)'); }

// ---- D) ダイスケ誰その男 ----
{ const s = setup({ field: ['ark', 'sagi'], hand: ['douga_sakujo', 'kaera'] });
  ok(chain(s, [{ description: DAISUKE, player: 0, cardId: 'daisuke_dare' }]) === 'douga', 'D1) 自分の場にアーク・サギ → 相手のダイスケを動画削除で打ち消す'); }
{ const s = setup({ field: ['ark', 'shinigami'], hand: [] });
  ok(chain(s, [{ description: DAISUKE, player: 0, cardId: 'daisuke_dare' }]) === 'shinigami', 'D2) 動画削除が無くても、死神少女で打ち消す'); }
{ const s = setup({ field: ['ark', 'sagi'], hand: ['kaera'] });
  ok(chain(s, [{ description: DAISUKE, player: 0, cardId: 'daisuke_dare' }]) === 'sagi', 'D3) サギが自分の打ち消しで自分たちを守る'); }
{ const s = setup({ field: ['sagi'], oppField: ['ark'], hand: ['douga_sakujo'] });
  ok(chain(s, [{ description: DAISUKE, player: 0, cardId: 'daisuke_dare' }]) === 'pass', 'D4) 相手の主人公の方が多く失う → 通す'); }
{ const s = setup({ field: ['izuna'], hand: ['douga_sakujo'] });
  ok(chain(s, [{ description: DAISUKE, player: 0, cardId: 'daisuke_dare' }]) === 'pass', 'D5) 自分の場に主人公がいない → 通す'); }
{ const s = setup({ field: ['ark'], oppField: ['ark'], hand: ['douga_sakujo'] });
  ok(chain(s, [{ description: DAISUKE, player: 0, cardId: 'daisuke_dare' }]) === 'pass', 'D6) 損が同じ → 通す'); }
{ const s = setup({ cp: 1, field: ['ark'], hand: ['douga_sakujo'] });
  ok(chain(s, [{ description: DAISUKE, player: 1, cardId: 'daisuke_dare' }, { description: '投げ銭 → 妹系ヒロイン', player: 0 }]) === 'pass', 'D7) 自分が撃ったダイスケは打ち消さない'); }
{ const s = setup({ field: ['ark'], hand: ['douga_sakujo'] });
  const t = [{ idx: 0, description: '企画ボツ → 妹系ヒロイン 破壊', player: 1 }, { idx: 1, description: DAISUKE, player: 0, cardId: 'daisuke_dare' }, { idx: 2, description: '投げ銭 → 妹系ヒロイン', player: 0 }];
  ok(pickT(s, t) === 1, 'D8) 打ち消す先: 上に投げ銭が積まれていても、ダイスケを選ぶ'); }

// ---- S) 水素水でナンパする男 ----
{ const s = setup({ field: ['izuna'], oppField: ['zeratine'], hand: ['douga_sakujo'] });
  ok(chain(s, [{ description: SUISO, player: 0 }]) === 'pass', 'S1) 自分にヒロインがいない(戻るのは相手だけ) → 通す'); }
{ const s = setup({ field: ['tomo', 'milia'], hand: ['douga_sakujo'] });
  ok(chain(s, [{ description: SUISO, player: 0 }]) === 'douga', 'S2) 自分の場にトモ・ミリア → 打ち消す'); }
{ const s = setup({ field: ['milia'], oppField: ['tomo'], hand: ['douga_sakujo'] });
  ok(chain(s, [{ description: SUISO, player: 0 }]) === 'pass', 'S3) 相手の方が多く失う → 通す'); }
{ const s = setup({ field: ['milia'], oppField: ['milia'], hand: ['douga_sakujo'] });
  ok(chain(s, [{ description: SUISO, player: 0 }]) === 'pass', 'S4) 損が同じ → 通す');
  ench(s.me.field[0], 'parasite');
  ok(chain(s, [{ description: SUISO, player: 0 }]) === 'douga', 'S5) 自分のヒロインにエンチャントが付いている(消える) → 打ち消す'); }
{ const s = setup({ field: ['zeratine'], oppField: ['tomo'], hand: ['douga_sakujo'] });
  s.me.field[0].counters = [{ power: 600, toughness: 600, source: 'zeratine_eat' }];
  ok(chain(s, [{ description: SUISO, player: 0 }]) === 'douga', 'S6) 捕食で育ったゼラチネ(強化が消える) → 打ち消す'); }
{ const s = setup({ cp: 1, field: ['tomo'], hand: ['douga_sakujo'] });
  ok(chain(s, [{ description: SUISO, player: 1 }, { description: '投げ銭 → トモ', player: 0, cancelled: true }]) === 'pass', 'S7) 自分が出した水素水は打ち消さない'); }
{ const s = setup({ field: ['tomo', 'sagi'], hand: ['kaera'] });
  ok(chain(s, [{ description: SUISO, player: 0 }]) === 'sagi', 'S8) サギの打ち消しでも同じ判断(自分のトモを守る)'); }

_log('RESULT ' + (fails ? 'FAIL ' + fails : 'ALL PASS'));
process.exit(fails ? 1 : 0);
