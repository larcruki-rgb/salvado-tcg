const { google } = require('googleapis');

const SPREADSHEET_ID = '168JdVonX01n-3RzQmRl06LrzSP5SWAxRRJhItH4Heh0';
const SHEET_NAME = 'コメント';
const DATA_RANGE = `${SHEET_NAME}!A2:E`;
const MAX_COMMENTS_PER_PAGE = 500;

let sheets = null;
let cache = { rows: null, time: 0 };
const CACHE_TTL = 15000;

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

async function fetchRows() {
  if (cache.rows && Date.now() - cache.time < CACHE_TTL) return cache.rows;
  const s = await getSheets();
  const res = await s.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: DATA_RANGE });
  const rows = res.data.values || [];
  cache = { rows, time: Date.now() };
  return rows;
}

// 各行に実シート行番号(1始まり、ヘッダー分+1)を添えて、指定ページ分だけ返す
async function matchesForPage(page) {
  const rows = await fetchRows();
  return rows
    .map((row, i) => ({ row, rowNum: i + 2 }))
    .filter(({ row }) => row[0] === page && row[2]);
}

async function getComments(page) {
  try {
    const matches = await matchesForPage(page);
    return matches.map(({ row }) => ({ name: row[1], text: row[2], date: row[3] }));
  } catch (e) {
    console.error('[Comments] getComments error:', e.message);
    return [];
  }
}

async function addComment(page, name, text, ip) {
  const s = await getSheets();
  const date = new Date().toISOString();
  await s.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: DATA_RANGE,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[page, name, text, date, ip || '']] },
  });
  cache.rows = null;
  await trimOldComments(page, s);
}

// 上限を超えた古いコメントを消す（deleteCommentと同じ、行をクリアする方式）
async function trimOldComments(page, s) {
  const matches = await matchesForPage(page);
  const excess = matches.length - MAX_COMMENTS_PER_PAGE;
  if (excess <= 0) return;
  for (const { rowNum } of matches.slice(0, excess)) {
    await s.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A${rowNum}:E${rowNum}`,
    });
  }
  cache.rows = null;
}

// idx はそのページの表示順（0始まり）。該当行をクリアして削除扱いにする
async function deleteComment(page, idx) {
  const matches = await matchesForPage(page);
  if (idx < 0 || idx >= matches.length) return { ok: false, remaining: matches.length };
  const s = await getSheets();
  const { rowNum } = matches[idx];
  await s.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A${rowNum}:E${rowNum}`,
  });
  cache.rows = null;
  return { ok: true, remaining: matches.length - 1 };
}

module.exports = { getComments, addComment, deleteComment };
