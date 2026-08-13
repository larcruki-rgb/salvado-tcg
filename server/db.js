// PostgreSQL アクセス層（Neon想定）。旧better-sqlite3版から移植。
// 全関数は Promise を返す（非同期）。接続は DATABASE_URL 環境変数から。
const { Pool } = require('pg');

let pool = null;
let schemaReady = null;

function getPool() {
  if (pool) return pool;
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL が未設定です');
  pool = new Pool({
    connectionString: cs,
    // Neon等マネージドPostgresはSSL必須
    ssl: { rejectUnauthorized: false },
    max: 5,
  });
  return pool;
}

async function q(text, params) {
  const p = getPool();
  await ensureSchema();
  return p.query(text, params);
}

// スキーマは初回アクセス時に一度だけ作成
function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = initSchema();
  return schemaReady;
}

async function initSchema() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      last_login_at TIMESTAMPTZ DEFAULT now(),
      auth_provider TEXT,
      auth_external_id TEXT,
      auth_token TEXT
    );

    CREATE TABLE IF NOT EXISTS app_master (
      app_id TEXT PRIMARY KEY,
      app_name TEXT,
      config TEXT
    );

    CREATE TABLE IF NOT EXISTS user_app_state (
      user_id TEXT NOT NULL REFERENCES users(id),
      app_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      updated_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (user_id, app_id, key)
    );

    CREATE TABLE IF NOT EXISTS user_inventory (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      app_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      acquired_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (user_id, app_id, item_type, item_id)
    );

    CREATE TABLE IF NOT EXISTS user_achievements (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      app_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      unlocked_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (user_id, app_id, achievement_id)
    );

    CREATE TABLE IF NOT EXISTS user_daily (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      app_id TEXT NOT NULL,
      date TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      progress INTEGER DEFAULT 0,
      completed BOOLEAN DEFAULT FALSE,
      UNIQUE (user_id, app_id, date, mission_id)
    );

    CREATE TABLE IF NOT EXISTS match_history (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      app_id TEXT NOT NULL DEFAULT 'tcg',
      mode TEXT NOT NULL,
      result TEXT NOT NULL,
      detail TEXT,
      played_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS user_decks (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      slot INTEGER NOT NULL,
      name TEXT,
      deck_data TEXT,
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (user_id, slot)
    );

    CREATE INDEX IF NOT EXISTS idx_match_history_user ON match_history(user_id, app_id);
    CREATE INDEX IF NOT EXISTS idx_match_history_played ON match_history(played_at);
    CREATE INDEX IF NOT EXISTS idx_user_inventory_user ON user_inventory(user_id, app_id);
    CREATE INDEX IF NOT EXISTS idx_user_daily_user ON user_daily(user_id, app_id, date);

    INSERT INTO app_master (app_id, app_name) VALUES ('tcg', 'サルベドTCG')
      ON CONFLICT (app_id) DO NOTHING;
  `);
}

// === Users ===

async function upsertUser(playerId, displayName) {
  if (!playerId) return;
  await q(`
    INSERT INTO users (id, display_name, last_login_at)
    VALUES ($1, $2, now())
    ON CONFLICT (id) DO UPDATE SET
      display_name = COALESCE(EXCLUDED.display_name, users.display_name),
      last_login_at = now()
  `, [playerId, displayName || null]);
}

async function getUser(playerId) {
  const r = await q('SELECT * FROM users WHERE id = $1', [playerId]);
  return r.rows[0] || null;
}

// === Match History ===

async function recordMatch(userId, mode, result, detail) {
  if (!userId) return;
  await q(`
    INSERT INTO match_history (user_id, app_id, mode, result, detail)
    VALUES ($1, 'tcg', $2, $3, $4)
  `, [userId, mode, result, detail ? JSON.stringify(detail) : null]);
}

async function getRankingFromDb(days) {
  let query = `
    SELECT m.user_id, MAX(u.display_name) as name,
      SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN result='lose' THEN 1 ELSE 0 END) as losses,
      COUNT(*) as total
    FROM match_history m
    JOIN users u ON u.id = m.user_id
    WHERE m.app_id = 'tcg' AND m.mode = 'ranked'
  `;
  const params = [];
  if (days) {
    params.push(days + ' days');
    query += ` AND m.played_at >= now() - $${params.length}::interval`;
  }
  query += ` GROUP BY m.user_id ORDER BY wins DESC, total ASC LIMIT 100`;
  const r = await q(query, params);
  return r.rows.map(row => {
    const wins = Number(row.wins), losses = Number(row.losses), total = Number(row.total);
    return { playerId: row.user_id, name: row.name || row.user_id, wins, losses, total, rate: total > 0 ? Math.round(wins / total * 100) : 0 };
  });
}

async function getEndlessRankingFromDb(days) {
  let query = `
    SELECT m.user_id, MAX(u.display_name) as name,
      MAX((detail::json->>'stage')::int) as best_stage
    FROM match_history m
    JOIN users u ON u.id = m.user_id
    WHERE m.app_id = 'tcg' AND m.mode = 'endless'
  `;
  const params = [];
  if (days) {
    params.push(days + ' days');
    query += ` AND m.played_at >= now() - $${params.length}::interval`;
  }
  query += ` GROUP BY m.user_id ORDER BY best_stage DESC NULLS LAST LIMIT 100`;
  const r = await q(query, params);
  return r.rows.map(row => ({ playerId: row.user_id, name: row.name || row.user_id, stage: Number(row.best_stage) || 0 }));
}

// === User App State ===

async function getAppState(userId, appId, key) {
  const r = await q('SELECT value FROM user_app_state WHERE user_id = $1 AND app_id = $2 AND key = $3', [userId, appId, key]);
  return r.rows[0] ? r.rows[0].value : null;
}

async function setAppState(userId, appId, key, value) {
  await q(`
    INSERT INTO user_app_state (user_id, app_id, key, value, updated_at)
    VALUES ($1, $2, $3, $4, now())
    ON CONFLICT (user_id, app_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `, [userId, appId, key, typeof value === 'string' ? value : JSON.stringify(value)]);
}

// === Inventory ===

async function addInventoryItem(userId, appId, itemType, itemId, quantity) {
  quantity = quantity || 1;
  await q(`
    INSERT INTO user_inventory (user_id, app_id, item_type, item_id, quantity)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_id, app_id, item_type, item_id) DO UPDATE SET quantity = user_inventory.quantity + EXCLUDED.quantity
  `, [userId, appId, itemType, itemId, quantity]);
}

async function getInventory(userId, appId, itemType) {
  let query = 'SELECT item_type, item_id, quantity, acquired_at FROM user_inventory WHERE user_id = $1 AND app_id = $2';
  const params = [userId, appId];
  if (itemType) { params.push(itemType); query += ` AND item_type = $${params.length}`; }
  const r = await q(query, params);
  return r.rows;
}

// === Achievements ===

async function unlockAchievement(userId, appId, achievementId) {
  const r = await q(`
    INSERT INTO user_achievements (user_id, app_id, achievement_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id, app_id, achievement_id) DO NOTHING
  `, [userId, appId, achievementId]);
  return r.rowCount > 0;
}

async function getAchievements(userId, appId) {
  const r = await q('SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = $1 AND app_id = $2', [userId, appId]);
  return r.rows;
}

// === Daily Missions ===

async function getDailyProgress(userId, appId, date) {
  const r = await q('SELECT mission_id, progress, completed FROM user_daily WHERE user_id = $1 AND app_id = $2 AND date = $3', [userId, appId, date]);
  return r.rows;
}

async function updateDailyProgress(userId, appId, date, missionId, progress, completed) {
  await q(`
    INSERT INTO user_daily (user_id, app_id, date, mission_id, progress, completed)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_id, app_id, date, mission_id) DO UPDATE SET progress = EXCLUDED.progress, completed = EXCLUDED.completed
  `, [userId, appId, date, missionId, progress, !!completed]);
}

// === Decks ===

async function saveUserDeck(userId, slot, name, deckData) {
  await q(`
    INSERT INTO user_decks (user_id, slot, name, deck_data, updated_at)
    VALUES ($1, $2, $3, $4, now())
    ON CONFLICT (user_id, slot) DO UPDATE SET name = EXCLUDED.name, deck_data = EXCLUDED.deck_data, updated_at = now()
  `, [userId, slot, name, typeof deckData === 'string' ? deckData : JSON.stringify(deckData)]);
}

async function getUserDecks(userId) {
  const r = await q('SELECT slot, name, deck_data, updated_at FROM user_decks WHERE user_id = $1 ORDER BY slot', [userId]);
  return r.rows;
}

module.exports = {
  getPool, initSchema,
  upsertUser, getUser,
  recordMatch, getRankingFromDb, getEndlessRankingFromDb,
  getAppState, setAppState,
  addInventoryItem, getInventory,
  unlockAchievement, getAchievements,
  getDailyProgress, updateDailyProgress,
  saveUserDeck, getUserDecks,
};
