// 十三魔王の入手クエスト quest_10 の通し確認(2026-11-19)。ローカルサーバー(BOARD_ADMIN_TOKEN=testadmin)起動後に:
//   DATABASE_URL=postgres://localhost/salvado_dev SIO_CLIENT=<socket.io-clientのパス> PORT=<ポート> node tests/quest10.e2e.js
// 公開スイッチ(maou13)を書き換えるので、最後に元へ戻す。クリアそのもの(勝って付与)は tests/quest_reward.test.js の R12 が見ている
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/salvado_dev';
const path = require('path');
const { io } = require(process.env.SIO_CLIENT || 'socket.io-client');
const db = require(path.join(__dirname, '..', 'server/db.js'));
const Unlocks = require(path.join(__dirname, '..', 'server/unlocks.js'));
const B = 'http://localhost:' + (process.env.PORT || 3200); const ADMIN = process.env.ADMIN_TOKEN || 'testadmin';
const deck = JSON.parse(require('fs').readFileSync(__dirname + '/deck60.json', 'utf8'));
const jdeck = (() => { const d = JSON.parse(JSON.stringify(deck)); let need = 2; for (const x of d) { while (need > 0 && x.count > 1) { x.count--; need--; } } d.push({ id: 'captain_joe', count: 2 }); return d; })();
const M6 = ['orion', 'holy_sword', 'captain_joe', 'black_vortex', 'menhera', 'yandere'];
let fails = 0; const ok = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (body) => fetch(B + '/api/app/newcards', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));
const DK = 'dk_quest10_e2e';
const conn = () => new Promise(res => { const s = io(B, { transports: ['websocket'], forceNew: true, auth: { deviceKey: DK } }); s.joined = []; s.errors = []; s.on('joined', d => s.joined.push(d)); s.on('error', e => s.errors.push((e && e.msg) || String(e))); s.on('connect', () => res(s)); });
const unlocksApi = (id, dk) => fetch(B + '/api/user/' + id + '/unlocks', { headers: { 'x-device-key': dk || DK } }).then(r => r.json());
const quit = async s => { s.emit('action', { type: 'surrender' }); await sleep(300); s.joined.length = 0; s.errors.length = 0; };
(async () => {
  const before = await fetch(B + '/api/app/newcards').then(r => r.json());
  const guest = 'p_quest10_e2e_' + Date.now();
  try {
    await db.upsertUser(guest, 'ゲスト');
    // ---- 公開前 ----
    ok((await post({ released: true, groups: { kawauso: true, maou13: false } })).status === 200, '0) 十三魔王を非公開に設定');
    { const u = await unlocksApi(guest); ok(u.groups && u.groups.maou13 === false, '1) 公開前: この人に十三魔王は見せない(groups.maou13=false)');
      const s = await conn();
      s.emit('questMatch', { name: 'g', deck, questId: 'quest_10', playerId: guest }); await sleep(900);
      ok(s.joined.length === 0 && s.errors.some(e => e.indexOf('まだ公開されていません') >= 0), '1) 公開前: quest_10 は始められない');
      s.errors.length = 0; s.emit('questMatch', { name: 'g', deck, questId: 'quest_09', playerId: guest }); await sleep(900);
      ok(s.joined.length === 1, '1) 公開前でも、かわうそのクエストは今までどおり始められる'); await quit(s);
      s.emit('aiMatch', { name: 'g', deck: jdeck, playerId: guest }); await sleep(900);
      ok(s.joined.length === 0 && s.errors.some(e => e.indexOf('まだ公開されていません') >= 0), '1) 公開前: ジョー入りのデッキは使えない'); s.disconnect(); }
    // ---- 公開後・クリア前 ----
    ok((await post({ groups: { maou13: true } })).body.groups.maou13 === true, '2) 十三魔王を公開');
    { const u = await unlocksApi(guest); ok(u.groups.maou13 === true && !u.cards.some(id => M6.includes(id)), '2) 公開後・クリア前: 見えるが、解除は0枚');
      const s = await conn();
      s.emit('aiMatch', { name: 'g', deck: jdeck, playerId: guest }); await sleep(900);
      ok(s.joined.length === 0 && s.errors.some(e => e.indexOf('クエストをクリア') >= 0), '2) クリア前: ジョー入りのデッキは使えない(クエストをクリア、の案内) ' + JSON.stringify(s.errors));
      s.errors.length = 0; s.emit('questMatch', { name: 'g', deck, questId: 'quest_10', playerId: guest }); await sleep(900);
      ok(s.joined.length === 1, '2) 公開後: quest_10 を始められる'); await quit(s);
      s.emit('questMatch', { name: 'g', deck: jdeck, questId: 'quest_10', playerId: guest }); await sleep(900);
      ok(s.joined.length === 0, '2) クリア前: ジョー入りのデッキでは quest_10 にも挑めない'); s.disconnect(); }
    // ---- クリア後(付与そのものは R12。ここでは「付与された人」が使えることを見る) ----
    await db.unlockCards(guest, M6, Unlocks.deviceHash(DK));
    { const u = await unlocksApi(guest); ok(M6.every(id => u.cards.includes(id)), '3) クリア後: 解除状況に6枚が出る');
      const o = await unlocksApi(guest, 'dk_someone_else'); ok(!o.cards.some(id => M6.includes(id)), '3) 別の端末が同じゲストIDを名乗っても、解除は見えない');
      const s = await conn();
      s.emit('aiMatch', { name: 'g', deck: jdeck, playerId: guest }); await sleep(900);
      ok(s.joined.length === 1, '3) クリア後: ジョー入りのデッキでCPU戦を始められる'); await quit(s); s.disconnect(); }
    // ---- 非公開に戻すと、クリア済みでも使えない ----
    await post({ groups: { maou13: false } });
    { const s = await conn(); s.emit('aiMatch', { name: 'g', deck: jdeck, playerId: guest }); await sleep(900);
      ok(s.joined.length === 0 && s.errors.some(e => e.indexOf('まだ公開されていません') >= 0), '4) 非公開に戻すと、クリア済みでも使えない(すぐ止められる)'); s.disconnect(); }
  } finally {
    await post({ released: before.released, groups: before.groups || {} });
    await db.getPool().query('DELETE FROM user_inventory WHERE user_id = $1', [guest]); await db.getPool().query('DELETE FROM match_history WHERE user_id = $1', [guest]); await db.getPool().query('DELETE FROM users WHERE id = $1', [guest]);
  }
  console.log(fails === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL (' + fails + ')');
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('ERROR', e && e.stack || e); process.exit(1); });
