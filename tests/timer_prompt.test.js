// 制限時間の残りわずかで質問(プロンプト)が出た時に、ターンが途中で終わったり止まったりしないか
process.env.TURN_TIMER_MS = '400'; process.env.TURN_TIMER_GRACE_MS = '300'; // 表示400ms、実期限700ms
const path = require('path'); const EventEmitter = require('events');
const GameRoom = require(path.join(__dirname, '..', 'server/GameRoom.js'));
const fs = require('fs'); const deck = JSON.parse(fs.readFileSync(path.join(__dirname, 'deck60.json'), 'utf8'));
const { CARD_DB, makeCard } = require(path.join(__dirname, '..', 'shared/cards.js')); const mc = id => makeCard(CARD_DB.find(c => c.id === id));
let fails = 0; const ok = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
const mkSock = (n) => { const s = new EventEmitter(); s.id = n; s.connected = true; s.events = []; const orig = s.emit.bind(s); s.emit = (ev, d) => { s.events.push(ev); return orig(ev, d); }; return s; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  // A) 残り100msで自分に質問が出る → 時間切れでは終わらない → 答えると(解決後に)終わる
  { const room = new GameRoom('t1'); const a = mkSock('a'), b = mkSock('b');
    room.join(a, 'A', deck, 'p_ta'); room.join(b, 'B', deck, 'p_tb'); const gs = room.game; const cp = gs.G.cp; const me = room.sockets[cp];
    room.handleAction(me, 'startTurn', {}); await sleep(600); // 表示上は残り0、実期限まで約100ms
    gs.prompt(cp, 'test_prompt', { q: 1 }); // 質問が出る(タイマー一時停止)
    await sleep(300); // 実期限も過ぎる
    ok(gs.G.cp === cp && !!gs.pendingPrompt[cp], 'A) 質問中は時間切れでもターンが終わらない(質問が残っている)');
    room.handleAction(me, 'promptResponse', { data: {} }); await sleep(300);
    ok(gs.G.cp !== cp, 'A) 質問に答えた後、時間切れ扱いでターンが終わる(止まらない)'); room._clearTurnTimer(); room._clearAckTimeout(); }
  // B) 相手側に質問(ブロック選択など)が出ている間も同様に止まらず、答えた後に進む
  { const room = new GameRoom('t2'); const a = mkSock('a'), b = mkSock('b');
    room.join(a, 'A', deck, 'p_tc'); room.join(b, 'B', deck, 'p_td'); const gs = room.game; const cp = gs.G.cp; const opp = 1 - cp; const me = room.sockets[cp];
    room.handleAction(me, 'startTurn', {}); room.handleAction(me, 'placeMana', { idx: 0 }); await sleep(600); // 一度は操作している(無操作の放置判定にしない)
    gs.prompt(opp, 'test_prompt', { q: 2 }); await sleep(300);
    ok(gs.G.cp === cp && !!gs.pendingPrompt[opp], 'B) 相手への質問中も時間切れで終わらない');
    room.handleAction(room.sockets[opp], 'promptResponse', { data: {} }); await sleep(300);
    ok(gs.G.cp !== cp, 'B) 相手が答えた後、ターンが進む'); room._clearTurnTimer(); room._clearAckTimeout(); }
  // C) 時間切れの直後に届いた「プレイ」は通らない(手番確認)
  { const room = new GameRoom('t3'); const a = mkSock('a'), b = mkSock('b');
    room.join(a, 'A', deck, 'p_te'); room.join(b, 'B', deck, 'p_tf'); const gs = room.game; const cp = gs.G.cp; const me = room.sockets[cp];
    room.handleAction(me, 'startTurn', {}); room.handleAction(me, 'placeMana', { idx: 0 }); await sleep(900); // 時間切れ(表示400+猶予300)→ターン交代済み(1回操作済みなので敗北ではなく交代)
    const opp = gs.G.cp; ok(opp !== cp, 'C) 時間切れでターンが交代した');
    const handBefore = gs.G.players[cp].hand.length; gs.G.players[cp].mana.forEach(m => m.manaTapped = false);
    room.handleAction(me, 'playCard', { idx: 0 }); await sleep(50);
    ok(gs.G.players[cp].hand.length === handBefore, 'C) 交代後に届いた元手番のプレイは無視される'); room._clearTurnTimer(); room._clearAckTimeout(); }
  // D) 表示上は0秒でも、猶予(裏の2秒相当)の間に届いたプレイは自分のターン内として通る
  { const room = new GameRoom('t4'); const a = mkSock('a'), b = mkSock('b');
    room.join(a, 'A', deck, 'p_tg'); room.join(b, 'B', deck, 'p_th'); const gs = room.game; const cp = gs.G.cp; const me = room.sockets[cp];
    room.handleAction(me, 'startTurn', {}); room.handleAction(me, 'placeMana', { idx: 0 });
    gs.G.players[cp].mana.forEach(m => m.manaTapped = false); for (let i = 0; i < 5; i++) { const m = mc('kaera'); m.manaTapped = false; gs.G.players[cp].mana.push(m); }
    gs.G.players[cp].hand.unshift(mc('mamachari')); // 手札先頭を効果なしのクリーチャーに固定(引きで結果がぶれないように)
    const oppP = gs.G.players[1 - cp]; oppP.hand = oppP.hand.filter(c => c.speed !== 'instant'); // 相手に割り込みが無い状態に固定(チェーン確認で止まらないように)
    await sleep(500); // 表示(400ms)は切れたが実期限(700ms)前
    const handBefore = gs.G.players[cp].hand.length; room.handleAction(me, 'playCard', { idx: 0 }); await sleep(50);
    ok(gs.G.cp === cp && gs.G.players[cp].hand.length === handBefore - 1, 'D) 表示0秒直後のプレイは猶予内なので通る(手札-1、まだ自分のターン)');
    await sleep(300); // 実期限を過ぎる(演出の確認待ちなら交代は保留、演出無しならそのまま交代)
    room.handleAction(a, 'ackResolve', {}); room.handleAction(b, 'ackResolve', {}); // 両者の確認 → 一時停止していた制限時間が再開(残り約200ms)
    await sleep(700);
    ok(gs.G.cp !== cp, 'D) 確認が揃って再開した制限時間が切れ、ターンが交代する'); room._clearTurnTimer(); room._clearAckTimeout(); }
  console.log(fails ? 'TIMER+PROMPT: FAIL(' + fails + ')' : 'TIMER+PROMPT: PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack); process.exit(1); });
