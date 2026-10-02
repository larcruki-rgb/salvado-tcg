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

  // A3) CPU: 全体除去(ルシアの全体200ダメージ)には分裂で応じない(出した子供も巻き込まれて全滅するだけなので)
  { const room = new GameRoom('ai_a3'); const a = mkSock('a');
    a.on('resolveResults', () => setTimeout(() => room.handleAction(a, 'ackResolve', {}), 50));
    a.on('prompt', p => setTimeout(() => room.handleAction(a, 'promptResponse', { action: 'pass' }), 50));
    room.join(a, 'テスト', deck, null); room.joinAI(null);
    const gs = room.game; const me = gs.G.players[0], cpu = gs.G.players[1];
    gs.G.cp = 0; gs.G.phase = 'main'; gs.pendingPrompt = [null, null];
    const ready = id => { const c = mc(id); c.summonSick = false; return c; };
    me.field = [ready('lucia')]; cpu.field = [ready('zeratine')]; me.hand = []; cpu.hand = [];
    while (me.mana.length < 6) { const m = mc('kaera'); m.manaTapped = false; me.mana.push(m); }
    me.mana.forEach(m => m.manaTapped = false); cpu.mana.forEach(m => m.manaTapped = false);
    room.handleAction(a, 'activateAbility', { fi: 0, aid: 'activated_lucia_breath' });
    for (let i = 0; i < 30 && !(cpu.field[0] && cpu.field[0].damage === 200 && !gs._busy() && gs.G.effectStack.length === 0); i++) await sleep(150);
    ok(cpu.field.length === 1 && cpu.field[0].id === 'zeratine' && cpu.field[0].damage === 200, 'A3) 全体200ダメージには分裂しない(ゼラチネは200ダメージを受けて生存) (' + cpu.field.map(c => c.name + ':' + (c.damage || 0)).join(',') + ')');
    stop(room); }

  // A3b) CPU: ゼラチネ1体を狙った除去(企画ボツ)には、割り込んで分裂する
  { const room = new GameRoom('ai_a3b'); const a = mkSock('a');
    a.on('resolveResults', () => setTimeout(() => room.handleAction(a, 'ackResolve', {}), 50));
    a.on('prompt', p => setTimeout(() => { if (p.type === 'destroy_target') { const t = p.data.targets.find(x => x.id === 'zeratine'); room.handleAction(a, 'promptResponse', { targetIdx: t.idx, pi: t.pi }); } else room.handleAction(a, 'promptResponse', { action: 'pass' }); }, 50));
    room.join(a, 'テスト', deck, null); room.joinAI(null);
    const gs = room.game; const me = gs.G.players[0], cpu = gs.G.players[1];
    gs.G.cp = 0; gs.G.phase = 'main'; gs.pendingPrompt = [null, null];
    const ready = id => { const c = mc(id); c.summonSick = false; return c; };
    me.field = []; cpu.field = [ready('zeratine')]; me.hand = [mc('kikaku_botsu')]; cpu.hand = [];
    while (me.mana.length < 6) { const m = mc('kaera'); m.manaTapped = false; me.mana.push(m); }
    me.mana.forEach(m => m.manaTapped = false);
    room.handleAction(a, 'playCard', { idx: 0 });
    for (let i = 0; i < 40 && !(cpu.field.filter(c => c.id === 'token_zeratine_child').length === 3 && !gs._busy() && gs.G.effectStack.length === 0); i++) await sleep(150);
    ok(cpu.field.filter(c => c.id === 'token_zeratine_child').length === 3 && !cpu.field.some(c => c.id === 'zeratine'), 'A3b) 単体除去(企画ボツ)には割り込んで分裂し、子供3体を残す (' + cpu.field.map(c => c.name).join(',') + ')');
    stop(room); }

  // A4) CPU: 同じチェーンにダイスケ誰その男を重ねない(1枚目が積まれた後、相手が応答して応答権が戻ってきても2枚目は撃たない)
  { const room = new GameRoom('ai_a4'); const a = mkSock('a'); let asakiUsed = false;
    a.on('resolveResults', () => setTimeout(() => room.handleAction(a, 'ackResolve', {}), 50));
    a.on('prompt', p => setTimeout(() => {
      if (p.type === 'chain' && !asakiUsed) { const ab = (p.data.abilities || []).find(x => x.ability.id === 'activated_asaki'); if (ab) { asakiUsed = true; room.handleAction(a, 'promptResponse', { action: 'activate', fi: ab.fi, aid: 'activated_asaki' }); return; } }
      room.handleAction(a, 'promptResponse', { action: 'pass', shuffle: false });
    }, 50));
    room.join(a, 'テスト', deck, null); room.joinAI(null);
    const gs = room.game; const me = gs.G.players[0], cpu = gs.G.players[1];
    gs.G.cp = 0; gs.G.phase = 'main'; gs.pendingPrompt = [null, null];
    const ready = id => { const c = mc(id); c.summonSick = false; return c; };
    me.field = [ready('maoria'), ready('asaki')]; cpu.field = []; me.hand = [mc('kaera')]; cpu.hand = [mc('daisuke_dare'), mc('daisuke_dare')];
    me.mana.forEach(m => m.manaTapped = false); while (cpu.mana.length < 6) { const m = mc('kaera'); m.manaTapped = false; cpu.mana.push(m); } cpu.mana.forEach(m => m.manaTapped = false);
    room.handleAction(a, 'playCard', { idx: 0 });
    for (let i = 0; i < 50 && !(me.field.filter(c => c.id === 'token_daisuke').length === 2 && !gs._busy() && gs.G.effectStack.length === 0 && gs.G.chainDepth === 0); i++) await sleep(150);
    ok(asakiUsed && me.field.filter(c => c.id === 'token_daisuke').length === 2, 'A4) 1枚目のダイスケは解決された(相手はアサキの能力で応答した)');
    ok(cpu.hand.filter(c => c.id === 'daisuke_dare').length === 1, 'A4) 2枚目は撃たずに手札に残している (手札のダイスケ: ' + cpu.hand.filter(c => c.id === 'daisuke_dare').length + '枚)');
    stop(room); }

  // R4) 通知は保存が済んでから届く(保存を遅らせても、保存前には届かない)
  { const p4 = 'p_test_unlock4_' + Date.now(); await db.upsertUser(p4, 'テスト4');
    const real = db.unlockCards; let release; const gate = new Promise(r => { release = r; });
    db.unlockCards = async (...args) => { await gate; return real(...args); };
    const { room, a, gs } = questRoom('r4', 'quest_08', p4);
    gs.G.players[1].life = 0; gs.checkWin();
    await sleep(500);
    const before = a.rewards.length; const rowsBefore = (await db.getUnlockedCards(p4)).length;
    release(); await sleep(500);
    db.unlockCards = real;
    ok(before === 0 && rowsBefore === 0 && a.rewards.length === 1 && a.rewards[0].ok === true && (await db.getUnlockedCards(p4)).length === 3, 'R4) 保存が終わるまで通知は届かず、保存後に届く (保存前の通知=' + before + ')');
    stop(room);
    await db.getPool().query("DELETE FROM user_inventory WHERE user_id = $1", [p4]); await db.getPool().query("DELETE FROM match_history WHERE user_id = $1", [p4]); await db.getPool().query("DELETE FROM users WHERE id = $1", [p4]); }

  // R5) 読み込みを待っている間に付与が先に終わっても、古い読み込み結果(空)で解除が消えない
  { const p5 = 'p_test_unlock5_' + Date.now(); await db.upsertUser(p5, 'テスト5');
    const real = db.getUnlockedCards; let release; const gate = new Promise(r => { release = r; });
    db.getUnlockedCards = async (id) => { const rows = await real(id); await gate; return rows; }; // 付与前の「空」を読んだまま待たせる
    const pending = Unlocks.load(p5);
    await sleep(100);
    db.getUnlockedCards = real;
    await Unlocks.grant(p5, ['zeratine', 'lead', 'daisuke_dare'], 'テスト5');
    release(); const stale = await pending;
    const again = await Unlocks.load(p5);
    ok(stale.has('zeratine') && again.has('zeratine') && again.size === 3, 'R5) 古い読み込み結果で上書きされず、解除3枚が残る (size=' + again.size + ')');
    await db.getPool().query("DELETE FROM user_inventory WHERE user_id = $1", [p5]); await db.getPool().query("DELETE FROM users WHERE id = $1", [p5]); Unlocks.invalidate(p5); }

  // R6) 解除が無いIDはキャッシュに残さない(でたらめなIDで増やされない)
  { const n0 = Unlocks._cacheSize();
    for (let i = 0; i < 20; i++) await Unlocks.load('p_nobody_' + i + '_' + Date.now());
    ok(Unlocks._cacheSize() === n0, 'R6) 解除の無いIDを20件読み込んでもキャッシュは増えない (' + n0 + '→' + Unlocks._cacheSize() + ')'); }

  await db.getPool().query("DELETE FROM user_inventory WHERE user_id = $1", [pid]);
  await db.getPool().query("DELETE FROM match_history WHERE user_id = $1", [pid]);
  await db.getPool().query("DELETE FROM users WHERE id = $1", [pid]);
  _log(fails === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL (' + fails + ')');
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { _log('ERROR ' + (e && e.stack || e)); process.exit(1); });
