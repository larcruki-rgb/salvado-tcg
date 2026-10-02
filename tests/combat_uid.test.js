// 戦闘追跡の uid 化(2026-10)。戦闘中に場からカードが消えても、攻撃者とブロックの対応がずれないこと。
// 以前は攻撃者を「場の番号」で持っていたため、(1)ブロックした攻撃が直撃に化ける (2)攻撃していないカードが攻撃者になる、が起きていた。
// 実行: node tests/combat_uid.test.js
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GameState = require(path.join(ROOT, 'server/GameState.js'));
const { CARD_DB, makeCard } = require(path.join(ROOT, 'shared/cards.js'));
const mc = id => makeCard(CARD_DB.find(c => c.id === id));
let fails = 0; const ok = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
const ready = id => { const c = mc(id); c.tapped = false; c.summonSick = false; return c; };
const _log = console.log; const quiet = fn => { console.log = () => {}; try { return fn(); } finally { console.log = _log; } };

function setup() {
  const gs = new GameState('t'); const prompts = []; gs.on('prompt', d => prompts.push(d)); gs.log = () => {}; gs.toast = () => {};
  gs.on('resolveResults', () => { setImmediate(() => { gs.handleAckResolve(0); gs.handleAckResolve(1); }); });
  for (const P of gs.G.players) { for (let i = 0; i < 9; i++) { const m = mc('kaera'); m.manaTapped = false; P.mana.push(m); } P.deck = []; P.hand = []; P.life = 2000; }
  gs.G.cp = 0; gs.G.phase = 'main'; gs.G.turn = 3;
  return { gs, prompts };
}
// 質問に答えながら落ち着くまで回す。answer(p, seat) が応答を返す(未定義ならパス)
async function settle(gs, prompts, answer, label) {
  let idle = 0; const seen = []; let i = 0;
  console.log = () => {};
  try {
    for (i = 0; i < 400 && idle < 6; i++) {
      await new Promise(r => setImmediate(r));
      const idx = prompts.findIndex(p => p && !p._done);
      if (idx < 0) { idle++; continue; }
      idle = 0; const p = prompts[idx]; p._done = true; const s = p.player;
      if (!gs.pendingPrompt[s] || gs.pendingPrompt[s].type !== p.type) continue;
      seen.push(s + ':' + p.type);
      let r = answer(p, s);
      if (r === undefined) r = (p.type === 'regen_confirm') ? { accept: false } : (p.type === 'block' ? { assignments: {} } : { action: 'pass' });
      gs.handlePromptResponse(s, r);
    }
  } finally { console.log = _log; }
  // 処理が最後まで終わっていること(確認待ち・解決待ち・未回答の質問・積み残しが無い)。プロンプトが来なくなっただけでは合格にしない
  const calm = i < 400 && !gs._busy() && !gs.pendingPrompt[0] && !gs.pendingPrompt[1] && gs.G.chainDepth === 0 && gs.G.effectStack.length === 0 && gs.G.phase === 'main2' && gs.G.attackers.length === 0 && Object.keys(gs.G.blockAssignments).length === 0;
  ok(calm, (label || '?') + ' 戦闘が最後まで終わり、操作できる状態に戻っている (phase=' + gs.G.phase + ' busy=' + gs._busy() + ')');
  return seen;
}
const attack = (gs, idxs) => quiet(() => { gs.startCombat(0); idxs.forEach(i => gs.toggleAttacker(0, i)); gs.confirmAttack(0); });
const names = (gs, pi) => gs.G.players[pi].field.map(c => c.name).join(',');

(async () => {
  // U1) 複数攻撃+ブロック宣言後に、攻撃者より手前の味方が破壊されても、ブロックは外れない
  //     P0:[カエラ, ママチャリA, ママチャリB, 死神少女]  A・Bで攻撃 → P1がBをダリアでブロック → P0が死神少女でカエラを破壊
  //     期待: Aの200だけ直撃(LP1800)。以前は Bも直撃して1600
  { const { gs, prompts } = setup();
    gs.G.players[0].field.push(ready('kaera'), ready('mamachari'), ready('mamachari'), ready('shinigami'));
    gs.G.players[1].field.push(ready('daria'));
    attack(gs, [1, 2]);
    const st = gs.getStateForPlayer(0);
    let used = false;
    await settle(gs, prompts, (p, s) => {
      if (p.type === 'block') return { assignments: { 2: 0 } };
      if (p.type === 'chain_attack' && s === 0 && !used && gs.G.chainContext === 'block') { used = true; const ab = p.data.abilities.find(a => a.ability.id === 'shinigami_destroy'); return { action: 'activate', fi: ab.fi, aid: 'shinigami_destroy' }; }
      if (p.type === 'shinigami_destroy_target') return { targetIdx: 0, pi: 0 };
    }, 'U1)');
    ok(JSON.stringify(st.attackers) === '[1,2]', 'U1) クライアントへ送る attackers は従来どおり場の番号 [1,2] (実際 ' + JSON.stringify(st.attackers) + ')');
    ok(gs.G.players[1].life === 1800, 'U1) ブロックされたBは直撃しない: 相手LP 2000→1800 (実際 ' + gs.G.players[1].life + ')'); }

  // U2) ブロッカーの付け替わりが起きない: A←ダリア(攻撃0・ダメージ無効)、B←Aレイスのボス(300/400) でブロック後に、
  //     手前のカエラが破壊されても、それぞれ元の相手と戦う。Aには投げ銭(+300/+300)。
  //     期待: A(500/400) は ダリアと戦い無傷で生存 / B(200/100) は ボスと戦って破壊、ボスは200ダメージ / 直撃なし
  //     付け替わると: A がボスと戦ってダメージ300を受け、B はダリアと戦って生き残る
  { const { gs, prompts } = setup();
    const A = ready('mamachari'), B = ready('mamachari');
    gs.G.players[0].field.push(ready('kaera'), A, B);
    gs.G.players[0].hand.push(mc('super_chat'));
    const daria = ready('daria'), boss = ready('iron_boss');
    gs.G.players[1].field.push(daria, boss, ready('shinigami'));
    attack(gs, [1, 2]);
    let sc = false, sg = false; let firstInfo = null, lastInfo = null;
    await settle(gs, prompts, (p, s) => {
      if (p.type === 'block') return { assignments: { 1: 0, 2: 1 } };
      if (p.type === 'chain_attack') {
        if (p.data.blockInfo) { if (!firstInfo) firstInfo = p.data.blockInfo; lastInfo = p.data.blockInfo; }
        if (s === 0 && !sc && gs.G.chainContext === 'block') { const o = p.data.supports.find(x => x.id === 'super_chat'); if (o) { sc = true; return { action: 'playSupport', idx: o.idx }; } }
        if (s === 1 && !sg && sc) { const ab = p.data.abilities.find(a => a.ability.id === 'shinigami_destroy'); if (ab) { sg = true; return { action: 'activate', fi: ab.fi, aid: 'shinigami_destroy' }; } } // ブロック宣言後(投げ銭への応答)で使う
      }
      if (p.type === 'buff_target') return { targetIdx: 1 };            // ママチャリA に投げ銭
      if (p.type === 'shinigami_destroy_target') return { targetIdx: 0, pi: 0 }; // 攻撃側の手前のカエラを破壊
    }, 'U2)');
    ok(sc && sg, 'U2) 投げ銭と死神少女の除去が両方使われた');
    ok(JSON.stringify(firstInfo) === JSON.stringify([{ attacker: 'ママチャリ暴走族', blocker: '勇者の兄 ダリア', blocked: true }, { attacker: 'ママチャリ暴走族', blocker: 'Aレイスのボス', blocked: true }]), 'U2) 割り込み画面のブロック状況(blockInfo)が従来どおり送られる ' + JSON.stringify(firstInfo));
    ok(gs.G.players[1].life === 1700, 'U2) 直撃なし: 相手LPは死神の支払い300だけ減って1700 (実際 ' + gs.G.players[1].life + ')');
    ok(gs.G.players[0].field.includes(A) && (A.damage || 0) === 0, 'U2) A は元の相手(ダリア)と戦い、無傷で生存 (damage=' + A.damage + ')');
    ok(!gs.G.players[0].field.includes(B), 'U2) B は元の相手(ボス)と戦って破壊された');
    ok(gs.G.players[1].field.includes(boss) && boss.damage === 200 && (daria.damage || 0) === 0, 'U2) ボスは B から200ダメージ、ダリアは無傷 (ボス=' + boss.damage + ' ダリア=' + (daria.damage || 0) + ')'); }

  // U3) 攻撃宣言後に攻撃者が手札に戻されても、攻撃していないカードが攻撃者にならない
  //     P0:[ミリア(攻撃), イズナ(攻撃しない)] → P1が動画復元で水素水を出し、ミリアを手札に戻す。期待: 攻撃なし、LP2000
  { const { gs, prompts } = setup();
    gs.G.players[0].field.push(ready('milia'), ready('izuna'));
    gs.G.players[1].hand.push(mc('douga_fukugen')); gs.G.players[1].grave.push(mc('suisosui'));
    attack(gs, [0]);
    let used = false; let blockShown = null;
    await settle(gs, prompts, (p, s) => {
      if (p.type === 'chain_attack' && s === 1 && !used) { const o = p.data.supports.find(x => x.id === 'douga_fukugen'); if (o) { used = true; return { action: 'playSupport', idx: o.idx }; } }
      if (p.type === 'douga_fukugen_pick') return { idx: p.data.cards[0].idx };
      if (p.type === 'block') { blockShown = p.data.attackers.map(a => a.name); return { assignments: {} }; }
    }, 'U3)');
    ok(used && gs.G.players[0].hand.some(c => c.id === 'milia'), 'U3) ミリアは手札に戻った');
    ok(blockShown === null, 'U3) 攻撃者がいなくなったのでブロック選択は出ない (出た攻撃者: ' + JSON.stringify(blockShown) + ')');
    ok(gs.G.players[1].life === 2000, 'U3) 攻撃していないイズナは攻撃しない: 相手LP2000のまま (実際 ' + gs.G.players[1].life + ')');
    ok(gs.G.phase === 'main2' && gs.G.attackers.length === 0, 'U3) 戦闘は終わっている (phase=' + gs.G.phase + ')'); }

  // U4) 攻撃中に破壊→同じチェーンの動画復元で場に戻ったカードは、攻撃に戻らない
  //     P0のカエラが攻撃(ブロックなし) → P0が動画復元を宣言 → P1が死神少女でカエラを破壊 → 死神が先に解決 → 動画復元でカエラを戻す
  { const { gs, prompts } = setup();
    gs.G.players[0].field.push(ready('kaera'));
    gs.G.players[0].hand.push(mc('douga_fukugen')); gs.G.players[0].grave.push(mc('imouto'));
    gs.G.players[1].field.push(ready('shinigami'));
    attack(gs, [0]);
    const uidBefore = gs.G.players[0].field[0].uid;
    let df = false, sg = false;
    await settle(gs, prompts, (p, s) => {
      if (p.type === 'block') return { assignments: {} };
      if (p.type === 'chain_attack') {
        if (s === 0 && !df && gs.G.chainContext === 'block') { const o = p.data.supports.find(x => x.id === 'douga_fukugen'); if (o) { df = true; return { action: 'playSupport', idx: o.idx }; } }
        if (s === 1 && df && !sg) { const ab = p.data.abilities.find(a => a.ability.id === 'shinigami_destroy'); if (ab) { sg = true; return { action: 'activate', fi: ab.fi, aid: 'shinigami_destroy' }; } }
      }
      if (p.type === 'shinigami_destroy_target') return { targetIdx: 0, pi: 0 };
      if (p.type === 'douga_fukugen_pick') { const k = p.data.cards.find(c => c.id === 'kaera'); return { idx: (k || p.data.cards[0]).idx }; }
    }, 'U4)');
    const back = gs.G.players[0].field.find(c => c.id === 'kaera');
    ok(df && sg && !!back, 'U4) カエラは破壊された後、動画復元で場に戻った');
    ok(back && back.uid !== uidBefore, 'U4) 戻ったカードは新しい uid (別物として扱う)');
    ok(gs.G.players[1].life === 1700, 'U4) 戻ったカエラは攻撃に戻らない: 相手LPは死神の支払い300だけ減って1700 (実際 ' + gs.G.players[1].life + ')'); }

  // U5) ブロッカーの番号は「アンタップのキャラだけに絞った一覧の中の番号」。手前にタップ済みがいても正しいカードがブロックする
  { const { gs, prompts } = setup();
    gs.G.players[0].field.push(ready('mamachari'));
    const tappedOne = ready('imouto'); tappedOne.tapped = true;
    gs.G.players[1].field.push(tappedOne, ready('daria'));
    attack(gs, [0]);
    let shown = null;
    await settle(gs, prompts, (p) => { if (p.type === 'block') { shown = p.data.blockers.map(b => b.name + '#' + b.idx); return { assignments: { 0: 0 } }; } }, 'U5)');
    ok(shown && shown.length === 1 && shown[0].indexOf('ダリア') >= 0, 'U5) ブロック候補はアンタップのダリアだけ (' + JSON.stringify(shown) + ')');
    ok(gs.G.players[1].life === 2000, 'U5) ダリアがブロックして直撃なし (実際LP ' + gs.G.players[1].life + ')'); }

  // U6) Aレイスの追手: 単独では +100 されない / 他の悪がいれば +100
  { const { gs, prompts } = setup();
    gs.G.players[0].field.push(ready('iron_chaser'));
    attack(gs, [0]);
    await settle(gs, prompts, () => undefined, 'U6a)');
    ok(gs.G.players[1].life === 1900, 'U6) 追手が単独で攻撃: 100点 (実際LP ' + gs.G.players[1].life + ')'); }
  { const { gs, prompts } = setup();
    gs.G.players[0].field.push(ready('mamachari'), ready('iron_chaser'));
    attack(gs, [1]);
    await settle(gs, prompts, () => undefined, 'U6b)');
    ok(gs.G.players[1].life === 1800, 'U6) 他の悪(ママチャリ)がいれば +100 で200点 (実際LP ' + gs.G.players[1].life + ')'); }

  // U7) ブロック確定後に、攻撃者自身(A)が破壊された場合: その攻撃だけ無くなり、もう1体(B)のブロックは元のまま
  //     P0:[ママチャリA, ママチャリB] 両方攻撃。P1: ダリアでBをブロック(Aは素通しの予定)。ブロック後、P0の投げ銭への応答で P1 が死神少女で A を破壊。
  //     期待: A の攻撃は無くなり、B はダリアにブロックされたまま → 直撃なし(LP 2000-300=1700)
  { const { gs, prompts } = setup();
    const A = ready('mamachari'), B = ready('mamachari');
    gs.G.players[0].field.push(A, B); gs.G.players[0].hand.push(mc('super_chat'));
    gs.G.players[1].field.push(ready('daria'), ready('shinigami'));
    attack(gs, [0, 1]);
    let sc = false, sg = false;
    await settle(gs, prompts, (p, s) => {
      if (p.type === 'block') return { assignments: { 1: 0 } };   // B(場の番号1) を ダリア(候補0) でブロック
      if (p.type === 'chain_attack') {
        if (s === 0 && !sc && gs.G.chainContext === 'block') { const o = p.data.supports.find(x => x.id === 'super_chat'); if (o) { sc = true; return { action: 'playSupport', idx: o.idx }; } }
        if (s === 1 && sc && !sg) { const ab = p.data.abilities.find(a => a.ability.id === 'shinigami_destroy'); if (ab) { sg = true; return { action: 'activate', fi: ab.fi, aid: 'shinigami_destroy' }; } }
      }
      if (p.type === 'buff_target') return { targetIdx: 1 };                      // B に投げ銭(Aは破壊される)
      if (p.type === 'shinigami_destroy_target') return { targetIdx: 0, pi: 0 };  // 攻撃者A を破壊
    }, 'U7)');
    ok(sc && sg && !gs.G.players[0].field.includes(A) && gs.G.players[0].field.includes(B), 'U7) ブロック確定後に攻撃者Aが破壊された');
    ok(gs.G.players[1].life === 1700, 'U7) 残ったBはダリアにブロックされたまま直撃なし: LP1700 (実際 ' + gs.G.players[1].life + ')'); }

  console.log(fails === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL (' + fails + ')');
  process.exit(fails === 0 ? 0 : 1);
})();
