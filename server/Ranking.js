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
    if (!days) { cache.data = ranking; cache.time = Date.now(); }
    return ranking;
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
    const ranking = Object.values(best).sort((a, b) => b.stage - a.stage);
    if (!days) { endlessCache.data = ranking; endlessCache.time = Date.now(); }
    return ranking;
  } catch (e) {
    console.error('[Ranking] getEndlessRanking error:', e.message);
    return [];
  }
}

module.exports = { recordMatch, getRanking, recordEndless, getEndlessRanking };
