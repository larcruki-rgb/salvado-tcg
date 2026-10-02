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
require(path.join(ROOT, 'server/release.js'))._setForTest({ released: true }); // 公開済みの状態で確かめる
const { CARD_DB, makeCard } = require(path.join(ROOT, 'shared/cards.js'));
const mc = id => makeCard(CARD_DB.find(c => c.id === id));
const deck = JSON.parse(fs.readFileSync(path.join(__dirname, 'deck60.json'), 'utf8'));
let fails = 0; const _log = console.log; const ok = (c, l) => { _log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
console.log = () => {}; console.error = () => {};
const DK = 'dk_test_device_A';   // この端末の鍵(接続時に送られる deviceKey の代わり)
const mkSock = (n, dk) => { const s = new EventEmitter(); s.id = n; s.connected = true; s.deviceKey = (dk === undefined ? DK : dk); s.rewards = []; s.on('questReward', d => s.rewards.push(d)); return s; };
function questRoom(tag, questId, pid, dk) {
  const room = new GameRoom('quest_' + tag); const a = mkSock('a', dk);
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
    ok(V.validateDeck(pid, zdeck, await Unlocks.load(pid, DK)).ok === false, 'R1) クリア前: ゼラチネ入りのデッキは使えない');
    gs.G.players[1].life = 0; gs.checkWin();
    await sleep(600);
    const r = a.rewards[0];
    ok(a.rewards.length === 1 && r.ok === true && r.cards.slice().sort().join(',') === 'daisuke_dare,lead,zeratine' && r.guest === true, 'R1) クリアで3枚が解除され、通知が届く (' + JSON.stringify(r && r.names) + ')');
    const rows = await db.getUnlockedCards(pid);
    ok(rows.slice().sort().join(',') === 'daisuke_dare,lead,zeratine', 'R1) DBに3枚ぶん保存されている');
    ok(V.validateDeck(pid, zdeck, await Unlocks.load(pid, DK)).ok === true, 'R1) クリア後: 同じデッキが使える(キャッシュも更新済み)');
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
    const real = db.getUnlockInfo; let release; const gate = new Promise(r => { release = r; });
    db.getUnlockInfo = async (id) => { const rows = await real(id); await gate; return rows; }; // 付与前の「空」を読んだまま待たせる
    const pending = Unlocks.load(p5, DK);
    await sleep(100);
    db.getUnlockInfo = real;
    await Unlocks.grant(p5, ['zeratine', 'lead', 'daisuke_dare'], 'テスト5', DK);
    release(); const stale = await pending;
    const again = await Unlocks.load(p5, DK);
    ok(stale.has('zeratine') && again.has('zeratine') && again.size === 3, 'R5) 古い読み込み結果で上書きされず、解除3枚が残る (size=' + again.size + ')');
    await db.getPool().query("DELETE FROM user_inventory WHERE user_id = $1", [p5]); await db.getPool().query("DELETE FROM users WHERE id = $1", [p5]); Unlocks.invalidate(p5); }

  // R6) 解除が無いIDはキャッシュに残さない(でたらめなIDで増やされない)
  { const n0 = Unlocks._cacheSize();
    for (let i = 0; i < 20; i++) await Unlocks.load('p_nobody_' + i + '_' + Date.now(), DK);
    ok(Unlocks._cacheSize() === n0, 'R6) 解除の無いIDを20件読み込んでもキャッシュは増えない (' + n0 + '→' + Unlocks._cacheSize() + ')'); }

  // R7) ゲスト: 解除済みのゲストIDを、別の端末から名乗っても使えない(クリアしていない人は使えない)
  { const mine = await Unlocks.load(pid, DK), other = await Unlocks.load(pid, 'dk_someone_else'), none = await Unlocks.load(pid, null);
    ok(mine.size === 3 && other.size === 0 && none.size === 0, 'R7) クリアした端末では3枚、別の端末・端末の鍵なしでは0枚 (' + mine.size + '/' + other.size + '/' + none.size + ')');
    ok(V.validateDeck(pid, zdeck, mine).ok === true && V.validateDeck(pid, zdeck, other).ok === false, 'R7) 別の端末から同じゲストIDを名乗っても、ゼラチネ入りのデッキは拒否される');
    const r = await db.getPool().query("SELECT item_id FROM user_inventory WHERE user_id = $1 AND item_type = 'unlock_device'", [pid]);
    ok(r.rows.length === 1 && r.rows[0].item_id !== DK && r.rows[0].item_id === Unlocks.deviceHash(DK), 'R7) DBに置くのは端末の鍵そのものではなくハッシュ'); }

  // R8) ゲスト: 別の端末で同じIDのままクリアし直すと、その端末でも使えるようになる(その人はクリアした)
  { const { room, a, gs } = questRoom('r8', 'quest_08', pid, 'dk_second_device');
    gs.G.players[1].life = 0; gs.checkWin(); await sleep(600);
    ok(a.rewards.length === 1 && a.rewards[0].ok === true && a.rewards[0].cards.length === 3, 'R8) 別の端末でクリア: この端末で新しく使えるようになった3枚として通知される');
    ok((await Unlocks.load(pid, 'dk_second_device')).size === 3 && (await Unlocks.load(pid, DK)).size === 3 && (await Unlocks.load(pid, 'dk_third')).size === 0, 'R8) クリアした2つの端末では使え、それ以外では使えない');
    stop(room); }

  // R8b) キャッシュが無い状態で別の端末に付与しても、以前にクリアした端末が使えなくならない(キャッシュはDBから全部読み直して作る)
  { Unlocks.invalidate(pid);
    await Unlocks.grant(pid, ['zeratine', 'lead', 'daisuke_dare'], 'テスト', 'dk_fourth_device');
    ok((await Unlocks.load(pid, DK)).size === 3 && (await Unlocks.load(pid, 'dk_second_device')).size === 3 && (await Unlocks.load(pid, 'dk_fourth_device')).size === 3, 'R8b) キャッシュなしで4台目に付与: 1台目・2台目も引き続き使える'); }

  // R8c) 期限切れの読み直し中に別の端末への付与が終わっても、その端末の記録が古い読み込み結果で消えない
  { Unlocks.invalidate(pid);
    const real = db.getUnlockInfo; let release; const gate = new Promise(r => { release = r; }); let first = true;
    db.getUnlockInfo = async (id) => { const rows = await real(id); if (first) { first = false; await gate; } return rows; }; // 最初の読み込みだけ、古い結果を持ったまま待たせる
    const pending = Unlocks.load(pid, DK);
    await sleep(100);
    await Unlocks.grant(pid, ['zeratine', 'lead', 'daisuke_dare'], 'テスト', 'dk_fifth_device');
    release(); await pending; db.getUnlockInfo = real;
    ok((await Unlocks.load(pid, 'dk_fifth_device')).size === 3 && (await Unlocks.load(pid, DK)).size === 3, 'R8c) 読み直しと付与が重なっても、新しい端末の記録が残る'); }

  // R8e) 2つの付与が重なった時: 先に始まった付与(古い読み直し結果を持ったまま待つ)が、後から終わった付与の記録をキャッシュから消さない
  { Unlocks.invalidate(pid);
    const real = db.getUnlockInfo; let release; const gate = new Promise(r => { release = r; }); let first = true;
    db.getUnlockInfo = async (id) => { const rows = await real(id); if (first) { first = false; await gate; } return rows; };
    const ga = Unlocks.grant(pid, ['zeratine', 'lead', 'daisuke_dare'], 'テスト', 'dk_sixth_device');   // 読み直しで待つ(この時点のDBには7台目が無い)
    await sleep(150);
    await Unlocks.grant(pid, ['zeratine', 'lead', 'daisuke_dare'], 'テスト', 'dk_seventh_device');     // 後から始めて先に終わる
    release(); await ga; db.getUnlockInfo = real;
    ok((await Unlocks.load(pid, 'dk_seventh_device')).size === 3 && (await Unlocks.load(pid, 'dk_sixth_device')).size === 3 && (await Unlocks.load(pid, DK)).size === 3, 'R8e) 付与が重なっても、どちらの端末の記録もキャッシュに残る'); }

  // R8f) 古い読み込みの最中に「付与→キャッシュの無効化」が起きても、古い結果が残らない(読み直す)
  { Unlocks.invalidate(pid);
    const real = db.getUnlockInfo; let release; const gate = new Promise(r => { release = r; }); let first = true;
    db.getUnlockInfo = async (id) => { const rows = await real(id); if (first) { first = false; await gate; } return rows; };
    const pending = Unlocks.load(pid, 'dk_eighth_device');           // この時点のDBには8台目が無い(古い結果を持ったまま待つ)
    await sleep(150);
    await Unlocks.grant(pid, ['zeratine', 'lead', 'daisuke_dare'], 'テスト', 'dk_eighth_device');
    Unlocks.invalidate(pid);                                        // 足し合わせる相手(キャッシュ)が無くなる
    release(); const got = await pending; db.getUnlockInfo = real;
    ok(got.size === 3 && (await Unlocks.load(pid, 'dk_eighth_device')).size === 3, 'R8f) 読み込み中に付与と無効化が挟まっても、最新の内容が返る (size=' + got.size + ')'); }

  // R8d) 端末の鍵は先頭64文字で比べる(接続時は64文字に切り詰められる。APIなど他の入口と食い違わない)。文字列以外は鍵なし扱い
  { const long = 'k'.repeat(80);
    ok(Unlocks.deviceHash(long) === Unlocks.deviceHash(long.slice(0, 64)) && Unlocks.deviceHash(['x']) === null && Unlocks.deviceHash('') === null && Unlocks.deviceHash({}) === null, 'R8d) 65文字以上の鍵も先頭64文字で同じ扱い。配列・空文字・オブジェクトは鍵なし'); }

  // R9) ゲストで端末の鍵が無い接続には付与しない(付与しても、どの接続からも使えないため)
  { const p9 = 'p_test_unlock9_' + Date.now(); await db.upsertUser(p9, 'テスト9');
    const { room, a, gs } = questRoom('r9', 'quest_08', p9, null);
    gs.G.players[1].life = 0; gs.checkWin(); await sleep(600);
    ok(a.rewards.length === 1 && a.rewards[0].ok === false && a.rewards[0].reason === 'nodevice' && (await db.getUnlockedCards(p9)).length === 0, 'R9) 端末の鍵が無いゲスト: 付与されず、その旨の通知だけ届く');
    stop(room); await db.getPool().query("DELETE FROM match_history WHERE user_id = $1", [p9]); await db.getPool().query("DELETE FROM users WHERE id = $1", [p9]); }

  // R10) アカウント(ログイン済み)は、端末に関係なく使える
  { const u1 = 'u_test_unlock_' + Date.now(); await db.getPool().query("INSERT INTO users (id, display_name) VALUES ($1, $2)", [u1, 'テストアカウント']);
    const { room, a, gs } = questRoom('r10', 'quest_08', u1, 'dk_account_device_1');
    gs.G.players[1].life = 0; gs.checkWin(); await sleep(600);
    ok(a.rewards.length === 1 && a.rewards[0].ok === true && a.rewards[0].cards.length === 3 && a.rewards[0].guest === false, 'R10) アカウントでクリア: 3枚が解除される');
    ok((await Unlocks.load(u1, 'dk_another_device')).size === 3 && (await Unlocks.load(u1, null)).size === 3, 'R10) アカウントは別の端末からでも使える');
    const r = await db.getPool().query("SELECT 1 FROM user_inventory WHERE user_id = $1 AND item_type = 'unlock_device'", [u1]);
    ok(r.rows.length === 0, 'R10) アカウントには端末の記録を作らない');
    stop(room); await db.getPool().query("DELETE FROM user_inventory WHERE user_id = $1", [u1]); await db.getPool().query("DELETE FROM match_history WHERE user_id = $1", [u1]); await db.getPool().query("DELETE FROM users WHERE id = $1", [u1]); Unlocks.invalidate(u1); }

  await db.getPool().query("DELETE FROM user_inventory WHERE user_id = $1", [pid]);
  await db.getPool().query("DELETE FROM match_history WHERE user_id = $1", [pid]);
  await db.getPool().query("DELETE FROM users WHERE id = $1", [pid]);
  _log(fails === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL (' + fails + ')');
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { _log('ERROR ' + (e && e.stack || e)); process.exit(1); });
