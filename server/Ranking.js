const { google } = require('googleapis');

const SPREADSHEET_ID = '168JdVonX01n-3RzQmRl06LrzSP5SWAxRRJhItH4Heh0';
const SHEET_NAME = 'シート1';

let sheets = null;
let cache = { data: null, time: 0 };
const CACHE_TTL = 30000;

async function getSheets() {
  if (sheets) return sheets;
  let creds;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_B64) {
    creds = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8'));
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } else {
    const path = require('path');
    const fs = require('fs');
    const p = path.resolve(__dirname, '..', '..', '..', '..', '.google-service-account.json');
    creds = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheets = google.sheets({ version: 'v4', auth });
  return sheets;
}

async function recordMatch(playerId, displayName, won) {
  try {
    const s = await getSheets();
    const now = new Date().toISOString();
    await s.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:E`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[playerId, displayName, won ? 1 : 0, won ? 0 : 1, now]],
      },
    });
    cache.data = null;
  } catch (e) {
    console.error('[Ranking] recordMatch error:', e.message);
  }
}

async function getRanking(days) {
  if (cache.data && Date.now() - cache.time < CACHE_TTL && !days) return cache.data;
  try {
    const s = await getSheets();
    const res = await s.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:E`,
    });
    const rows = res.data.values || [];
    let cutoff = null;
    if (days) {
      cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
    }
    const stats = {};
    for (const row of rows) {
      const [pid, name, wins, losses, ts] = row;
      if (!pid) continue;
      if (cutoff && ts && new Date(ts) < cutoff) continue;
      if (!stats[pid]) stats[pid] = { playerId: pid, name, wins: 0, losses: 0 };
      stats[pid].name = name;
      stats[pid].wins += parseInt(wins) || 0;
      stats[pid].losses += parseInt(losses) || 0;
    }
    const ranking = Object.values(stats)
      .map(s => ({ ...s, total: s.wins + s.losses, rate: s.wins + s.losses > 0 ? Math.round(s.wins / (s.wins + s.losses) * 100) : 0 }))
      .filter(s => s.total > 0)
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses);
    const out = numberDuplicateNames(ranking);
    if (!days) { cache.data = out; cache.time = Date.now(); }
    return out;
  } catch (e) {
    console.error('[Ranking] getRanking error:', e.message);
    return [];
  }
}

const ENDLESS_SHEET = '無限ボスラッシュ';
let endlessCache = { data: null, time: 0 };

async function recordEndless(playerId, displayName, stage) {
  try {
    const s = await getSheets();
    const now = new Date().toISOString();
    await s.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${ENDLESS_SHEET}!A:D`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[playerId, displayName, stage, now]],
      },
    });
    endlessCache.data = null;
  } catch (e) {
    console.error('[Ranking] recordEndless error:', e.message);
  }
}

async function getEndlessRanking(days) {
  if (endlessCache.data && Date.now() - endlessCache.time < CACHE_TTL && !days) return endlessCache.data;
  try {
    const s = await getSheets();
    const res = await s.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${ENDLESS_SHEET}!A:D`,
    });
    const rows = res.data.values || [];
    let cutoff = null;
    if (days) {
      cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
    }
    const best = {};
    for (const row of rows) {
      const [pid, name, stage, ts] = row;
      if (!pid) continue;
      if (cutoff && ts && new Date(ts) < cutoff) continue;
      const st = parseInt(stage) || 0;
      if (!best[pid] || st > best[pid].stage) {
        best[pid] = { playerId: pid, name, stage: st };
      }
    }
    const ranking = numberDuplicateNames(Object.values(best).sort((a, b) => b.stage - a.stage));
    if (!days) { endlessCache.data = ranking; endlessCache.time = Date.now(); }
    return ranking;
  } catch (e) {
    console.error('[Ranking] getEndlessRanking error:', e.message);
    return [];
  }
}

// 同じ名前が複数並ぶ時(ゲスト同士は同名が許される)、順位の順に「名前 #1」「名前 #2」…を付けて見分けられるようにする(2026-10-21)。
// 登録済みの名前は一意なので、番号が付くのはゲストの同名だけ。元の名前は rawName に残す
function numberDuplicateNames(list) {
  // 名前は利用者の入力なので、'constructor' や '__proto__' が継承プロパティと衝突しないよう Map で数える(Codex指摘)
  const counts = new Map(); list.forEach(r => { const n = r.name || ''; counts.set(n, (counts.get(n) || 0) + 1); });
  const seen = new Map();
  return list.map(r => { const n = r.name || ''; if ((counts.get(n) || 0) <= 1) return r; seen.set(n, (seen.get(n) || 0) + 1); return Object.assign({}, r, { rawName: n, name: n + ' #' + seen.get(n) }); });
}
module.exports = { recordMatch, getRanking, recordEndless, getEndlessRanking, numberDuplicateNames };
