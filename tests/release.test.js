// 公開スイッチの読み込みと更新の順番(DBを使う)。実行: node tests/release.test.js
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/salvado_dev';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const db = require(path.join(ROOT, 'server/db.js'));
let fails = 0; const _log = console.log; const ok = (c, l) => { _log((c ? 'PASS ' : 'FAIL ') + l); if (!c) fails++; };
console.log = () => {}; console.error = () => {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fresh = () => { delete require.cache[require.resolve(path.join(ROOT, 'server/release.js'))]; return require(path.join(ROOT, 'server/release.js')); };
(async () => {
  const saved = await db.getSetting('newcards_release');
  try {
    // T1) 起動直後(まだ読み込めていない)に preview だけ更新しても、DBの released を初期値で潰さない
    await db.setSetting('newcards_release', JSON.stringify({ released: true, preview: [] }));
    { const R = fresh();
      const st = await R.set({ preview: ['u_someone'] });
      const dbv = JSON.parse(await db.getSetting('newcards_release'));
      ok(st.released === true && dbv.released === true && dbv.preview.length === 1, 'T1) 読み込み前の部分更新でも、公開中のまま(省略した項目は変わらない)'); }
    // T2) 遅れて終わる古い読み込みが、直前の更新(非公開)を上書きしない
    await db.setSetting('newcards_release', JSON.stringify({ released: true, preview: [] }));
    { const R = fresh(); const real = db.getSetting; let release; const gate = new Promise(r => { release = r; }); let first = true;
      db.getSetting = async (k) => { const v = await real(k); if (first) { first = false; await gate; } return v; }; // 最初の読み込みだけ「公開中」を持ったまま待たせる
      const loading = R.load();
      await sleep(100);
      const setting = R.set({ released: false });
      await sleep(100); release(); await loading; await setting; db.getSetting = real;
      const dbv = JSON.parse(await db.getSetting('newcards_release'));
      ok(R.isReleased() === false && dbv.released === false, 'T2) 読み込みと更新が重なっても、最後に指定した「非公開」になる(メモリとDBが一致)'); }
    // T3) DBから読めない時: 非公開のまま動き、set は失敗して何も変えない
    { const R = fresh(); const real = db.getSetting; db.getSetting = async () => { throw new Error('db down'); };
      await R.load();
      let threw = false; try { await R.set({ released: true }); } catch (e) { threw = true; }
      db.getSetting = real;
      ok(R.isReleased() === false && R.visibleTo('u_x') === false && threw, 'T3) DBが読めない間は非公開のまま。更新は失敗として返る'); }
    // T4) 先行テストはアカウント(u_)だけ。ゲストIDは入らない
    { const R = fresh(); const st = await R.set({ released: false, preview: ['u_a', 'p_guest', 123, 'u_b'] });
      ok(st.preview.join(',') === 'u_a,u_b' && R.visibleTo('u_a') && !R.visibleTo('p_guest') && !R.visibleTo(undefined), 'T4) 先行テストに入るのはアカウントIDだけ'); }
  } finally { if (saved === null) await db.getPool().query("DELETE FROM app_settings WHERE key = 'newcards_release'"); else await db.setSetting('newcards_release', saved); }
  _log(fails === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL (' + fails + ')');
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { _log('ERROR ' + (e && e.stack || e)); process.exit(1); });
