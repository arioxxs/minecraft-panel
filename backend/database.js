const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'panel.db');

let db = null;
let SQL = null;

async function initDatabase() {
  fs.mkdirSync(DB_DIR, { recursive: true });

  SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      password TEXT,
      display_name TEXT,
      avatar TEXT DEFAULT '',
      role TEXT DEFAULT 'user',
      status TEXT DEFAULT 'active',
      google_id TEXT,
      reset_token TEXT,
      reset_token_expiry INTEGER,
      warnings INTEGER DEFAULT 0,
      last_login TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS warnings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      issued_by TEXT NOT NULL,
      reason TEXT NOT NULL,
      severity TEXT DEFAULT 'low',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ban_list (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      banned_by TEXT NOT NULL,
      reason TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      permission TEXT NOT NULL
    )
  `);

  initializePermissions();
  createDefaultOwner();
  saveDatabase();

  console.log('Database initialized');
  return db;
}

function saveDatabase() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.error('DB save error:', err.message);
  }
}

function initializePermissions() {
  const permissions = {
    owner: ['manage_users', 'manage_roles', 'manage_server', 'manage_plugins', 'manage_backups', 'manage_worlds', 'view_console', 'execute_commands', 'manage_settings', 'manage_warnings', 'manage_bans', 'view_logs', 'manage_schedule', 'delete_users'],
    admin: ['manage_users', 'manage_server', 'manage_plugins', 'manage_backups', 'manage_worlds', 'view_console', 'execute_commands', 'manage_settings', 'manage_warnings', 'manage_bans', 'view_logs', 'manage_schedule'],
    moderator: ['manage_warnings', 'manage_bans', 'view_console', 'view_logs', 'kick_players', 'ban_players'],
    user: ['view_server_status', 'view_players']
  };

  const check = db.exec('SELECT COUNT(*) as c FROM permissions');
  if (check[0] && check[0].values[0][0] > 0) return;

  const stmt = db.prepare('INSERT INTO permissions (id, role, permission) VALUES (?, ?, ?)');
  for (const [role, perms] of Object.entries(permissions)) {
    for (const perm of perms) {
      stmt.run([uuidv4(), role, perm]);
    }
  }
  stmt.free();
}

function createDefaultOwner() {
  const result = db.exec("SELECT id FROM users WHERE role = 'owner'");
  if (result[0] && result[0].values.length > 0) return;

  const hashedPassword = bcrypt.hashSync('admin123', 10);
  db.run(
    'INSERT INTO users (id, username, email, password, display_name, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [uuidv4(), 'admin', 'admin@server.local', hashedPassword, 'Server Owner', 'owner', 'active']
  );
  console.log('Default owner created: admin / admin123');
}

function getDb() {
  return db;
}

module.exports = { initDatabase, getDb, saveDatabase };
