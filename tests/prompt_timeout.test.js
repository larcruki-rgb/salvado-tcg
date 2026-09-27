// 質問(プロンプト)の制限時間: 割り込み/ブロックは自動パス、それ以外は再送→放置扱い。答えれば何も起きない
process.env.TURN_TIMER_MS = '60000'; process.env.PROMPT_TIMEOUT_MS = '300'; process.env.PROMPT_FORFEIT_MS = '600';
const path = require('path'); const EventEmitter = require('events');
const GameRoom = require(path.join(__dirname, '..', 'server/GameRoom.js'));
const fs = require('fs'); const deck = JSON.parse(fs.readFileSync(path.join(__dirname, 'deck60.json'), 'utf8'));
const { CARD_DB, makeCard } = require(path.join(__dirname, '..', 'shared/cards.js')); const mc = id => makeCard(CARD_DB.find(c => c.id === id));
let fails = 0; const ok = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
const mkSock = (n) => { const s = new EventEmitter(); s.id = n; s.connected = true; s.prompts = 0; s.on('prompt', () => s.prompts++); return s; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function mkRoom(tag) { const room = new GameRoom(tag); const a = mkSock('a'), b = mkSock('b'); room.join(a, 'A', deck, 'p_' + tag + 'a'); room.join(b, 'B', deck, 'p_' + tag + 'b'); const gs = room.game; gs.log = () => {}; return { room, gs, a, b }; }
(async () => {
  // A) 割り込み確認に答えない → 自動パス → 解決が進む(確認待ちに入る)
  { const { room, gs } = mkRoom('t1'); const cp = gs.G.cp, opp = 1 - cp; const me = room.sockets[cp];
    room.handleAction(me, 'startTurn', {}); gs.G.players[cp].mana.forEach(m => m.manaTapped = false); for (let i = 0; i < 5; i++) { const m = mc('kaera'); m.manaTapped = false; gs.G.players[cp].mana.push(m); }
    gs.G.players[cp].hand.unshift(mc('mamachari')); const oppP = gs.G.players[opp]; oppP.hand = [mc('douga_fukugen')]; for (let i = 0; i < 5; i++) { const m = mc('kaera'); m.manaTapped = false; oppP.mana.push(m); }
    room.handleAction(me, 'playCard', { idx: 0 }); await sleep(50);
    ok(!!gs.pendingPrompt[opp] && gs.pendingPrompt[opp].type === 'chain', 'A) 相手に割り込み確認が出る');
    await sleep(500);
    ok(!gs.pendingPrompt[opp] && gs.G.chainDepth === 0 && gs._awaitingAck === true, 'A) 30秒(テストでは0.3秒)無回答で自動パスされ、解決が進む');
    room._clearTurnTimer(); room._clearAckTimeout(); room._clearAllPromptTimeouts(); }
  // B) ブロック選択に答えない → ブロック無しで戦闘が進む
  { const { room, gs } = mkRoom('t2'); const cp = gs.G.cp, opp = 1 - cp; const me = room.sockets[cp];
    room.handleAction(me, 'startTurn', {}); const ky = mc('mamachari'); ky.tapped = false; ky.summonSick = false; gs.G.players[cp].field.push(ky); gs.G.players[opp].field.push(mc('mamachari')); gs.G.players[opp].hand = [];
    room.handleAction(me, 'startCombat', {}); room.handleAction(me, 'toggleAttacker', { fi: 0 }); room.handleAction(me, 'confirmAttack', {}); await sleep(50);
    ok(!!gs.pendingPrompt[opp] && gs.pendingPrompt[opp].type === 'block', 'B) 相手にブロック選択が出る');
    const lifeBefore = gs.G.players[opp].life; await sleep(500);
    ok(!gs.pendingPrompt[opp], 'B) 無回答でブロック無しとして進む(質問が消える)');
    room._clearTurnTimer(); room._clearAckTimeout(); room._clearAllPromptTimeouts(); }
  // C) 答えないと進めない質問 → 再送 → さらに無回答で放置扱い(敗北)
  { const { room, gs } = mkRoom('t3'); const cp = gs.G.cp; const me = room.sockets[cp]; let over = null; gs.on('gameOver', d => over = d);
    room.handleAction(me, 'startTurn', {}); gs.prompt(cp, 'test_prompt', { q: 1 }); const before = me.prompts;
    await sleep(400); ok(me.prompts === before + 1 && !over, 'C) 0.3秒で質問が再送される(まだ敗北ではない)');
    await sleep(400); ok(over && over.loser === cp, 'C) 0.6秒で放置扱いになり、答えなかった側の敗北');
    room._clearTurnTimer(); room._clearAckTimeout(); room._clearAllPromptTimeouts(); }
  // D) 時間内に答えれば何も起きない
  { const { room, gs } = mkRoom('t4'); const cp = gs.G.cp; const me = room.sockets[cp]; let over = null; gs.on('gameOver', d => over = d);
    room.handleAction(me, 'startTurn', {}); gs.prompt(cp, 'test_prompt', { q: 2 }); await sleep(100);
    room.handleAction(me, 'promptResponse', { data: {} }); await sleep(800);
    ok(!over && !gs.pendingPrompt[cp], 'D) 答えれば再送も敗北も起きない');
    room._clearTurnTimer(); room._clearAckTimeout(); room._clearAllPromptTimeouts(); }
  console.log(fails ? 'PROMPT TIMEOUT: FAIL(' + fails + ')' : 'PROMPT TIMEOUT: PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack); process.exit(1); });
