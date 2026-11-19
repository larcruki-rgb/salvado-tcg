// ロビーの新カード予告パネル(サーバーが中身を送る方式、client v165〜)の通し確認。サーバーを BOARD_ADMIN_TOKEN=testadmin で起動してから:
//   PORT=<ポート> node tests/lobby_teaser.e2e.js
// 設定(lobby_flags・公開スイッチ)を書き換えるので、最後に元へ戻す
const B = 'http://localhost:' + (process.env.PORT || 3200);
const ADMIN = 'testadmin';
let fails = 0; const ok = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
const J = { 'Content-Type': 'application/json', 'x-admin-token': ADMIN };
const post = async (p, body) => { const r = await fetch(B + p, { method: 'POST', headers: J, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
const lobby = async () => (await (await fetch(B + '/board/lobby?t=' + Date.now())).json()).newcards;
(async () => {
  const flags0 = await (await fetch(B + '/api/app/lobby-flags')).json();
  const rel0 = await (await fetch(B + '/api/app/newcards')).json();
  try {
    // 1) 既定(かわうそ): 新しい画面向けの panel と、1.3.6向けの teaser がどちらもかわうそ
    await post('/api/app/lobby-flags', { newcardsTeaser: 'auto', newcardsGroup: 'kawauso', newcardsWhen: '11/15(日)' });
    await post('/api/app/newcards', { groups: { kawauso: true, maou13: false } });
    { const n = await lobby();
      ok(n && n.panel && n.panel.group === 'kawauso' && n.panel.released === true && n.panel.cards.length === 3 && n.teaser.group === 'kawauso' && n.teaser.released === true, '1) 既定はかわうそ(公開済み)のパネル');
      ok(!/\{when\}/.test(n.panel.title + n.panel.sub) && !/11\/15/.test(n.panel.title), '1) 公開済みの題に日付は入らない: ' + n.panel.title); }

    // 2) 十三魔王の予告に切り替え: panel は十三魔王の予告、1.3.6向けの teaser はかわうその公開済みのまま
    { const r = await post('/api/app/lobby-flags', { newcardsGroup: 'maou13', newcardsWhen: '11/29(日)' });
      ok(r.status === 200 && r.body.flags.newcardsGroup === 'maou13', '2) newcardsGroup を maou13 に設定');
      const n = await lobby();
      ok(n.panel.group === 'maou13' && n.panel.released === false && n.panel.cards.length === 6 && n.panel.title.includes('11/29(日)') && n.panel.title.includes('6枚'), '2) 十三魔王の予告(6枚・日付入り): ' + n.panel.title);
      ok(n.panel.cards.every(c => /^img\/[a-z_]+\.jpg$/.test(c.img) && c.name), '2) カード6枚に絵と名前');
      ok(n.teaser.group === 'kawauso' && n.teaser.released === true, '2) 1.3.6向けの teaser は、かわうそ公開済みのまま(古いアプリに「かわうそ予告」が出ない)'); }

    // 3) 公開スイッチを開けると、同じパネルが「登場」に変わる
    { await post('/api/app/newcards', { groups: { maou13: true } }); const n = await lobby();
      ok(n.panel.group === 'maou13' && n.panel.released === true && !n.panel.title.includes('11/29') && n.panel.title.includes('登場'), '3) 公開後は登場の文面: ' + n.panel.title);
      await post('/api/app/newcards', { groups: { maou13: false } }); }

    // 4) 知らないグループ名は断る(設定は変わらない)
    { const r = await post('/api/app/lobby-flags', { newcardsGroup: 'nazo' }); const n = await lobby();
      ok(r.status === 400 && n.panel.group === 'maou13', '4) 知らないグループ名は 400'); }

    // 5) 合言葉なしでは切り替えられない
    { const r = await fetch(B + '/api/app/lobby-flags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newcardsGroup: 'kawauso' }) }); const n = await lobby();
      ok(r.status === 403 && n.panel.group === 'maou13', '5) 合言葉なしは 403'); }

    // 6) パネルを出さない設定なら、何も返さない
    { await post('/api/app/lobby-flags', { newcardsTeaser: 'off' }); const n = await lobby();
      ok(!n, '6) newcardsTeaser=off ならパネルなし'); }
  } catch (e) { console.log('FAIL 例外: ' + e.stack); fails++; }
  finally {
    await post('/api/app/lobby-flags', { newcardsTeaser: flags0.newcardsTeaser || 'auto', newcardsWhen: flags0.newcardsWhen || '近日', newcardsGroup: flags0.newcardsGroup || 'kawauso' });
    if (rel0 && rel0.groups) await post('/api/app/newcards', { groups: rel0.groups });
  }
  console.log('RESULT ' + (fails ? 'FAIL ' + fails : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
