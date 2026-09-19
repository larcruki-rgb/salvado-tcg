// 「とどめの一撃と同じ解決でクリーチャーが死ぬ + ミーコが場にいる」を再現し、
// gameOver の後に prompt(regen_confirm) が飛ぶか / pendingPrompt が残るかを検査する
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GameState = require(path.join(ROOT, 'server/GameState.js'));
const { CARD_DB, makeCard } = require(path.join(ROOT, 'shared/cards.js'));
const mc = id => makeCard(CARD_DB.find(c => c.id === id));

function run(label, defenderLife) {
  const gs = new GameState('t');
  const events = [];
  ['gameOver','prompt','stateUpdate','resolveResults'].forEach(ev => gs.on(ev, d => events.push(ev + (ev==='prompt' ? ':'+d.type : ''))));
  gs.log = () => {};
  const P0 = gs.G.players[0], P1 = gs.G.players[1];
  // 攻撃側 P0: 2体で攻撃(1体はブロックされる、1体は直接ダメージ)
  const a1 = mc('mamachari'), a2 = mc('mamachari');       // 200/100
  P0.field.push(a1, a2);
  // 防御側 P1: ブロッカー jun(死ぬ) + ミーコ(蘇生条件) + 応援3枚
  const blocker = mc('jun'), miiko = mc('miiko');
  P1.field.push(blocker, miiko);
  for (let i = 0; i < 3; i++) { const m = mc('kaera'); m.manaTapped = false; P1.mana.push(m); }
  P1.life = defenderLife;
  gs.G.cp = 0; gs.G.phase = 'combat';
  gs.G.attackers = [0, 1];
  gs.G.blockAssignments = { 0: blocker };  // a1 は jun にブロックされ jun は死ぬ / a2 は直撃200
  gs._resolveCombatDamage();
  // 実際のクライアントの代わりに ack を返して解決キューを最後まで回す
  for (let i = 0; i < 20 && (gs._combatQueue || gs.ackResolve) ; i++) { gs.handleAckResolve(0); gs.handleAckResolve(1); }
  const goIdx = events.indexOf('gameOver');
  const promptAfterGO = goIdx >= 0 && events.slice(goIdx + 1).some(e => e.startsWith('prompt'));
  console.log(`\n[${label}] life=${defenderLife}`);
  console.log('  events:', events.join(' > '));
  console.log('  終了後LP:', P1.life, '/ pendingPrompt残:', JSON.stringify(gs.pendingPrompt.map(p => p && p.type)));
  return { events, promptAfterGO, gameOver: goIdx >= 0, pendingLeft: gs.pendingPrompt.some(Boolean) };
}

const lethal = run('とどめ+同時死亡(バグ再現条件)', 100);
const normal = run('非致死(蘇生は通常通り出るべき)', 2000);
let ok = true;
if (!lethal.gameOver) { console.log('NG: gameOverが出ていない'); ok = false; }
if (lethal.promptAfterGO) { console.log('NG: gameOver後に蘇生プロンプトが飛んだ(バグ)'); ok = false; }
if (lethal.pendingLeft) { console.log('NG: 終了後にpendingPromptが残っている'); ok = false; }
if (!normal.events.includes('prompt:regen_confirm')) { console.log('NG: 非致死時に蘇生プロンプトが出ない(回帰)'); ok = false; }
if (normal.gameOver) { console.log('NG: 非致死なのにgameOver'); ok = false; }
console.log('\nRESULT:', ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
