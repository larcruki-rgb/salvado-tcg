const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'salvado.db');

let db;

function getDb() {
  if (db) return db;
  const fs = require('fs');
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema();
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_login_at TEXT DEFAULT (datetime('now')),
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
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, app_id, key)
    );

    CREATE TABLE IF NOT EXISTS user_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      app_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      acquired_at TEXT DEFAULT (datetime('now')),
      UNIQUE (user_id, app_id, item_type, item_id)
    );

    CREATE TABLE IF NOT EXISTS user_achievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      app_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      unlocked_at TEXT DEFAULT (datetime('now')),
      UNIQUE (user_id, app_id, achievement_id)
    );

    CREATE TABLE IF NOT EXISTS user_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      app_id TEXT NOT NULL,
      date TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      progress INTEGER DEFAULT 0,
      completed INTEGER DEFAULT 0,
      UNIQUE (user_id, app_id, date, mission_id)
    );

    CREATE TABLE IF NOT EXISTS match_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      app_id TEXT NOT NULL DEFAULT 'tcg',
      mode TEXT NOT NULL,
      result TEXT NOT NULL,
      detail TEXT,
      played_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_decks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      slot INTEGER NOT NULL,
      name TEXT,
      deck_data TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE (user_id, slot)
    );

    CREATE INDEX IF NOT EXISTS idx_match_history_user ON match_history(user_id, app_id);
    CREATE INDEX IF NOT EXISTS idx_match_history_played ON match_history(played_at);
    CREATE INDEX IF NOT EXISTS idx_user_inventory_user ON user_inventory(user_id, app_id);
    CREATE INDEX IF NOT EXISTS idx_user_daily_user ON user_daily(user_id, app_id, date);

    INSERT OR IGNORE INTO app_master (app_id, app_name) VALUES ('tcg', 'サルベドTCG');
  `);
}

// === Users ===

const upsertUserStmt = () => getDb().prepare(`
  INSERT INTO users (id, display_name, last_login_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(id) DO UPDATE SET
    display_name = COALESCE(excluded.display_name, users.display_name),
    last_login_at = datetime('now')
`);

function upsertUser(playerId, displayName) {
  if (!playerId) return;
  upsertUserStmt().run(playerId, displayName || null);
}

function getUser(playerId) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(playerId);
}

// === Match History ===

function recordMatch(userId, mode, result, detail) {
  if (!userId) return;
  getDb().prepare(`
    INSERT INTO match_history (user_id, app_id, mode, result, detail)
    VALUES (?, 'tcg', ?, ?, ?)
  `).run(userId, mode, result, detail ? JSON.stringify(detail) : null);
}

function getRankingFromDb(days) {
  let query = `
    SELECT user_id, MAX(display_name) as name,
      SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN result='lose' THEN 1 ELSE 0 END) as losses,
      COUNT(*) as total
    FROM match_history m
    JOIN users u ON u.id = m.user_id
    WHERE m.app_id = 'tcg' AND m.mode = 'ranked'
  `;
  let params = [];
  if (days) {
    query += ` AND m.played_at >= datetime('now', ?)`;
    params.push('-' + days + ' days');
  }
  query += ` GROUP BY user_id ORDER BY wins DESC, total ASC LIMIT 100`;
  let rows = getDb().prepare(query).all(...params);
  return rows.map(r => {
    let name = r.name || r.user_id;
    return { playerId: r.user_id, name, wins: r.wins, losses: r.losses, total: r.total, rate: r.total > 0 ? Math.round(r.wins / r.total * 100) : 0 };
  });
}

function getEndlessRankingFromDb(days) {
  let query = `
    SELECT user_id, MAX(display_name) as name,
      MAX(CAST(json_extract(detail, '$.stage') AS INTEGER)) as best_stage
    FROM match_history m
    JOIN users u ON u.id = m.user_id
    WHERE m.app_id = 'tcg' AND m.mode = 'endless'
  `;
  let params = [];
  if (days) {
    query += ` AND m.played_at >= datetime('now', ?)`;
    params.push('-' + days + ' days');
  }
  query += ` GROUP BY user_id ORDER BY best_stage DESC LIMIT 100`;
  let rows = getDb().prepare(query).all(...params);
  return rows.map(r => ({ playerId: r.user_id, name: r.name || r.user_id, stage: r.best_stage || 0 }));
}

// === User App State ===

function getAppState(userId, appId, key) {
  let row = getDb().prepare('SELECT value FROM user_app_state WHERE user_id = ? AND app_id = ? AND key = ?').get(userId, appId, key);
  return row ? row.value : null;
}

function setAppState(userId, appId, key, value) {
  getDb().prepare(`
    INSERT INTO user_app_state (user_id, app_id, key, value, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, app_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(userId, appId, key, typeof value === 'string' ? value : JSON.stringify(value));
}

// === Inventory ===

function addInventoryItem(userId, appId, itemType, itemId, quantity) {
  quantity = quantity || 1;
  getDb().prepare(`
    INSERT INTO user_inventory (user_id, app_id, item_type, item_id, quantity)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, app_id, item_type, item_id) DO UPDATE SET quantity = quantity + excluded.quantity
  `).run(userId, appId, itemType, itemId, quantity);
}

function getInventory(userId, appId, itemType) {
  let query = 'SELECT item_type, item_id, quantity, acquired_at FROM user_inventory WHERE user_id = ? AND app_id = ?';
  let params = [userId, appId];
  if (itemType) { query += ' AND item_type = ?'; params.push(itemType); }
  return getDb().prepare(query).all(...params);
}

// === Achievements ===

function unlockAchievement(userId, appId, achievementId) {
  return getDb().prepare(`
    INSERT OR IGNORE INTO user_achievements (user_id, app_id, achievement_id)
    VALUES (?, ?, ?)
  `).run(userId, appId, achievementId).changes > 0;
}

function getAchievements(userId, appId) {
  return getDb().prepare('SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = ? AND app_id = ?').all(userId, appId);
}

// === Daily Missions ===

function getDailyProgress(userId, appId, date) {
  return getDb().prepare('SELECT mission_id, progress, completed FROM user_daily WHERE user_id = ? AND app_id = ? AND date = ?').all(userId, appId, date);
}

function updateDailyProgress(userId, appId, date, missionId, progress, completed) {
  getDb().prepare(`
    INSERT INTO user_daily (user_id, app_id, date, mission_id, progress, completed)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, app_id, date, mission_id) DO UPDATE SET progress = excluded.progress, completed = excluded.completed
  `).run(userId, appId, date, missionId, progress, completed ? 1 : 0);
}

// === Decks ===

function saveUserDeck(userId, slot, name, deckData) {
  getDb().prepare(`
    INSERT INTO user_decks (user_id, slot, name, deck_data, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, slot) DO UPDATE SET name = excluded.name, deck_data = excluded.deck_data, updated_at = datetime('now')
  `).run(userId, slot, name, typeof deckData === 'string' ? deckData : JSON.stringify(deckData));
}

function getUserDecks(userId) {
  return getDb().prepare('SELECT slot, name, deck_data, updated_at FROM user_decks WHERE user_id = ? ORDER BY slot').all(userId);
}

module.exports = {
  getDb,
  upsertUser, getUser,
  recordMatch, getRankingFromDb, getEndlessRankingFromDb,
  getAppState, setAppState,
  addInventoryItem, getInventory,
  unlockAchievement, getAchievements,
  getDailyProgress, updateDailyProgress,
  saveUserDeck, getUserDecks,
};
