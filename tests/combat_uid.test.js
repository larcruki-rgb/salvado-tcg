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
async function settle(gs, prompts, answer) {
  let idle = 0; const seen = [];
  console.log = () => {};
  try {
    for (let i = 0; i < 400 && idle < 6; i++) {
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
    });
    ok(JSON.stringify(st.attackers) === '[1,2]', 'U1) クライアントへ送る attackers は従来どおり場の番号 [1,2] (実際 ' + JSON.stringify(st.attackers) + ')');
    ok(gs.G.players[1].life === 1800, 'U1) ブロックされたBは直撃しない: 相手LP 2000→1800 (実際 ' + gs.G.players[1].life + ')'); }

  // U2) ブロッカーの付け替わりが起きない: A←ダリア1、B←ダリア2 でブロック後に手前のカエラが破壊されても、それぞれ元の相手と戦う
  //     Aに投げ銭(+300/+300)。期待: 直撃なし(LP2000のまま、死神の支払いは攻撃側)、ダリアはダメージ無効で2体とも生存
  { const { gs, prompts } = setup();
    gs.G.players[0].field.push(ready('kaera'), ready('mamachari'), ready('mamachari'));
    gs.G.players[0].hand.push(mc('super_chat'));
    gs.G.players[1].field.push(ready('daria'), ready('daria'), ready('shinigami'));
    attack(gs, [1, 2]);
    let sc = false, sg = false; let lastInfo = null;
    await settle(gs, prompts, (p, s) => {
      if (p.type === 'block') return { assignments: { 1: 0, 2: 1 } };
      if (p.type === 'chain_attack') {
        if (p.data.blockInfo) lastInfo = p.data.blockInfo;
        if (s === 0 && !sc && gs.G.chainContext === 'block') { const o = p.data.supports.find(x => x.id === 'super_chat'); if (o) { sc = true; return { action: 'playSupport', idx: o.idx }; } }
        if (s === 1 && !sg && sc) { const ab = p.data.abilities.find(a => a.ability.id === 'shinigami_destroy'); if (ab) { sg = true; return { action: 'activate', fi: ab.fi, aid: 'shinigami_destroy' }; } } // ブロック宣言後(投げ銭への応答)で使う
      }
      if (p.type === 'buff_target') return { targetIdx: 1 };            // ママチャリA に投げ銭
      if (p.type === 'shinigami_destroy_target') return { targetIdx: 0, pi: 0 }; // 攻撃側の手前のカエラを破壊
    });
    ok(sc && sg, 'U2) 投げ銭と死神少女の除去が両方使われた');
    ok(gs.G.players[1].life === 1700, 'U2) 直撃なし: 相手LPは死神の支払い300だけ減って1700 (実際 ' + gs.G.players[1].life + ')');
    ok(gs.G.players[1].field.filter(c => c.id === 'daria').length === 2, 'U2) ダリア2体は生存(' + names(gs, 1) + ')');
    const a = gs.G.players[0].field.filter(c => c.id === 'mamachari');
    ok(a.length === 2 && a.every(c => (c.damage || 0) === 0), 'U2) ママチャリA・Bはそれぞれ元のダリア(攻撃0)と戦い、ダメージ0で生存'); }

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
    });
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
    });
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
    await settle(gs, prompts, (p) => { if (p.type === 'block') { shown = p.data.blockers.map(b => b.name + '#' + b.idx); return { assignments: { 0: 0 } }; } });
    ok(shown && shown.length === 1 && shown[0].indexOf('ダリア') >= 0, 'U5) ブロック候補はアンタップのダリアだけ (' + JSON.stringify(shown) + ')');
    ok(gs.G.players[1].life === 2000, 'U5) ダリアがブロックして直撃なし (実際LP ' + gs.G.players[1].life + ')'); }

  // U6) Aレイスの追手: 単独では +100 されない / 他の悪がいれば +100
  { const { gs, prompts } = setup();
    gs.G.players[0].field.push(ready('iron_chaser'));
    attack(gs, [0]);
    await settle(gs, prompts, () => undefined);
    ok(gs.G.players[1].life === 1900, 'U6) 追手が単独で攻撃: 100点 (実際LP ' + gs.G.players[1].life + ')'); }
  { const { gs, prompts } = setup();
    gs.G.players[0].field.push(ready('mamachari'), ready('iron_chaser'));
    attack(gs, [1]);
    await settle(gs, prompts, () => undefined);
    ok(gs.G.players[1].life === 1800, 'U6) 他の悪(ママチャリ)がいれば +100 で200点 (実際LP ' + gs.G.players[1].life + ')'); }

  // U7) 攻撃者自身が破壊された場合: その攻撃だけ無くなり、もう1体のブロックは元のまま
  //     P0:[ママチャリA, ママチャリB] 両方攻撃。P1: ダリアでBをブロック、死神少女でAを破壊。期待: 直撃なし(LP 2000-300=1700)
  { const { gs, prompts } = setup();
    gs.G.players[0].field.push(ready('mamachari'), ready('mamachari'));
    gs.G.players[1].field.push(ready('daria'), ready('shinigami'));
    attack(gs, [0, 1]);
    let sg = false;
    await settle(gs, prompts, (p, s) => {
      if (p.type === 'chain_attack' && s === 1 && !sg && gs.G.chainContext !== 'block') { const ab = p.data.abilities.find(a => a.ability.id === 'shinigami_destroy'); if (ab) { sg = true; return { action: 'activate', fi: ab.fi, aid: 'shinigami_destroy' }; } }
      if (p.type === 'shinigami_destroy_target') return { targetIdx: 0, pi: 0 };
      if (p.type === 'block') { const b = p.data.blockers.findIndex(x => x.name.indexOf('ダリア') >= 0); return { assignments: { [p.data.attackers[0].idx]: b } }; }
    });
    ok(sg && gs.G.players[0].field.length === 1, 'U7) 攻撃者Aは破壊された (' + names(gs, 0) + ')');
    ok(gs.G.players[1].life === 1700, 'U7) 残ったBはダリアにブロックされ直撃なし: LP1700 (実際 ' + gs.G.players[1].life + ')'); }

  console.log(fails === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL (' + fails + ')');
  process.exit(fails === 0 ? 0 : 1);
})();
