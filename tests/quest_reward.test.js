// クエスト報酬(カードの使用権の解除)と、CPUのダイスケ誰その男。DBを使う(DATABASE_URL。既定 postgres://localhost/salvado_dev)
// 実行: node tests/quest_reward.test.js
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/salvado_dev';
process.env.TURN_TIMER_MS = '600000';
const path = require('path'); const EventEmitter = require('events'); const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const GameRoom = require(path.join(ROOT, 'server/GameRoom.js'));
const db = require(path.join(ROOT, 'server/db.js'));
const Unlocks = require(path.join(ROOT, 'server/unlocks.js'));
const V = require(path.join(ROOT, 'server/deckValidation.js'));
const { CARD_DB, makeCard } = require(path.join(ROOT, 'shared/cards.js'));
const mc = id => makeCard(CARD_DB.find(c => c.id === id));
const deck = JSON.parse(fs.readFileSync(path.join(__dirname, 'deck60.json'), 'utf8'));
let fails = 0; const _log = console.log; const ok = (c, l) => { _log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
console.log = () => {}; console.error = () => {};
const mkSock = (n) => { const s = new EventEmitter(); s.id = n; s.connected = true; s.rewards = []; s.on('questReward', d => s.rewards.push(d)); return s; };
function questRoom(tag, questId, pid) {
  const room = new GameRoom('quest_' + tag); const a = mkSock('a');
  room.join(a, 'テスト', deck, pid); room.joinAI(null, false, questId);
  return { room, a, gs: room.game };
}
const stop = room => { room._clearTurnTimer(); room._clearAckTimeout(); room._clearAllPromptTimeouts(); room.state = 'finished'; };
const zdeck = (() => { const d = JSON.parse(JSON.stringify(deck)); let need = 2; for (const x of d) { while (need > 0 && x.count > 1) { x.count--; need--; } } d.push({ id: 'zeratine', count: 2 }); return d; })();

(async () => {
  const pid = 'p_test_unlock_' + Date.now();
  await db.upsertUser(pid, 'テスト');

  // R1) 対象クエストに勝つと3枚が解除される。保存が済んでから通知が届く
  { const { room, a, gs } = questRoom('r1', 'quest_08', pid);
    ok(V.validateDeck(pid, zdeck, await Unlocks.load(pid)).ok === false, 'R1) クリア前: ゼラチネ入りのデッキは使えない');
    gs.G.players[1].life = 0; gs.checkWin();
    await sleep(600);
    const r = a.rewards[0];
    ok(a.rewards.length === 1 && r.ok === true && r.cards.slice().sort().join(',') === 'daisuke_dare,lead,zeratine' && r.guest === true, 'R1) クリアで3枚が解除され、通知が届く (' + JSON.stringify(r && r.names) + ')');
    const rows = await db.getUnlockedCards(pid);
    ok(rows.slice().sort().join(',') === 'daisuke_dare,lead,zeratine', 'R1) DBに3枚ぶん保存されている');
    ok(V.validateDeck(pid, zdeck, await Unlocks.load(pid)).ok === true, 'R1) クリア後: 同じデッキが使える(キャッシュも更新済み)');
    stop(room); }

  // R2) 再クリアしても増えない(通知は「新しく解除されたものなし」)
  { const { room, a, gs } = questRoom('r2', 'quest_08', pid);
    gs.G.players[1].life = 0; gs.checkWin();
    await sleep(600);
    ok(a.rewards.length === 1 && a.rewards[0].ok === true && a.rewards[0].cards.length === 0, 'R2) 再クリア: 新しく解除されたカードは0枚');
    const r = await db.getPool().query("SELECT item_id, quantity FROM user_inventory WHERE user_id = $1 AND item_type = 'card_unlock'", [pid]);
    ok(r.rows.length === 3 && r.rows.every(x => x.quantity === 1), 'R2) DBの行は3行・数量1のまま');
    stop(room); }

  // R3) 負けた時・別のクエスト・IDなし では解除されない
  { const p2 = 'p_test_unlock2_' + Date.now(); await db.upsertUser(p2, 'テスト2');
    { const { room, a, gs } = questRoom('r3a', 'quest_08', p2); gs.G.players[0].life = 0; gs.checkWin(); await sleep(400);
      ok(a.rewards.length === 0 && (await db.getUnlockedCards(p2)).length === 0, 'R3) 負けた時は解除されない'); stop(room); }
    { const { room, a, gs } = questRoom('r3b', 'quest_01', p2); gs.G.players[1].life = 0; gs.checkWin(); await sleep(400);
      ok(a.rewards.length === 0 && (await db.getUnlockedCards(p2)).length === 0, 'R3) 別のクエストに勝っても解除されない'); stop(room); }
    { const { room, a, gs } = questRoom('r3c', 'quest_08', null); gs.G.players[1].life = 0; gs.checkWin(); await sleep(400);
      ok(a.rewards.length === 1 && a.rewards[0].ok === false && a.rewards[0].reason === 'noid', 'R3) IDなし: 付与できない旨の通知だけ届く'); stop(room); }
    // users に行が無いIDでも、行を作ってから付与できる
    { const p3 = 'p_test_unlock3_' + Date.now(); const { room, a, gs } = questRoom('r3d', 'quest_08', p3); gs.G.players[1].life = 0; gs.checkWin(); await sleep(900);
      ok(a.rewards.length === 1 && a.rewards[0].ok === true && a.rewards[0].cards.length === 3, 'R3) ユーザー行がまだ無いIDでも付与できる'); stop(room);
      await db.getPool().query("DELETE FROM user_inventory WHERE user_id = $1", [p3]); await db.getPool().query("DELETE FROM match_history WHERE user_id = $1", [p3]); await db.getPool().query("DELETE FROM users WHERE id = $1", [p3]); }
    await db.getPool().query("DELETE FROM match_history WHERE user_id = $1", [p2]); await db.getPool().query("DELETE FROM users WHERE id = $1", [p2]); }

  // A1) CPU: 相手に強い主人公がいる時、割り込みでダイスケ誰その男を撃つ
  { const room = new GameRoom('ai_a1'); const a = mkSock('a');
    a.on('resolveResults', () => setTimeout(() => room.handleAction(a, 'ackResolve', {}), 50));
    a.on('prompt', p => setTimeout(() => room.handleAction(a, 'promptResponse', (p.type === 'block') ? { assignments: {} } : { action: 'pass' }), 50));
    room.join(a, 'テスト', deck, null); room.joinAI(null);
    const gs = room.game; const me = gs.G.players[0], cpu = gs.G.players[1];
    gs.G.cp = 0; gs.G.phase = 'main'; gs.pendingPrompt = [null, null];
    const ready = id => { const c = mc(id); c.summonSick = false; return c; };
    me.field = [ready('maoria'), ready('asaki')]; cpu.field = [ready('milia')];
    me.hand = [mc('kaera')]; cpu.hand = [mc('daisuke_dare')];
    me.mana.forEach(m => m.manaTapped = false); cpu.mana.forEach(m => m.manaTapped = false);
    room.handleAction(a, 'playCard', { idx: 0 });
    for (let i = 0; i < 40 && !(me.field.filter(c => c.id === 'token_daisuke').length === 2 && !gs._busy() && gs.G.effectStack.length === 0); i++) await sleep(150);
    ok(me.field.filter(c => c.id === 'token_daisuke').length === 2 && cpu.grave.some(c => c.id === 'daisuke_dare'), 'A1) CPUがダイスケ誰その男を撃ち、相手の主人公2体がダイスケになった (' + me.field.map(c => c.name).join(',') + ')');
    ok(cpu.field.some(c => c.id === 'milia') && me.field.some(c => c.id === 'kaera'), 'A1) CPUのヒロインはそのまま。相手の投稿も解決された');
    stop(room); }

  // A2) CPU: 相手に主人公がいない時は撃たない
  { const room = new GameRoom('ai_a2'); const a = mkSock('a');
    a.on('resolveResults', () => setTimeout(() => room.handleAction(a, 'ackResolve', {}), 50));
    a.on('prompt', p => setTimeout(() => room.handleAction(a, 'promptResponse', { action: 'pass' }), 50));
    room.join(a, 'テスト', deck, null); room.joinAI(null);
    const gs = room.game; const me = gs.G.players[0], cpu = gs.G.players[1];
    gs.G.cp = 0; gs.G.phase = 'main'; gs.pendingPrompt = [null, null];
    me.field = [mc('tomo')]; cpu.field = []; me.hand = [mc('kaera')]; cpu.hand = [mc('daisuke_dare')];
    me.mana.forEach(m => m.manaTapped = false); cpu.mana.forEach(m => m.manaTapped = false);
    room.handleAction(a, 'playCard', { idx: 0 });
    for (let i = 0; i < 20 && !(me.field.some(c => c.id === 'kaera') && !gs._busy()); i++) await sleep(150);
    ok(cpu.hand.some(c => c.id === 'daisuke_dare') && me.field.some(c => c.id === 'kaera'), 'A2) 主人公がいなければ撃たない(手札に残る)');
    stop(room); }

  await db.getPool().query("DELETE FROM user_inventory WHERE user_id = $1", [pid]);
  await db.getPool().query("DELETE FROM match_history WHERE user_id = $1", [pid]);
  await db.getPool().query("DELETE FROM users WHERE id = $1", [pid]);
  _log(fails === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL (' + fails + ')');
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { _log('ERROR ' + (e && e.stack || e)); process.exit(1); });
