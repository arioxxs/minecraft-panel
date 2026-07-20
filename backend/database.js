const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'panel.db');

let db;

function initDatabase() {
  const fs = require('fs');
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password TEXT,
      display_name TEXT,
      avatar TEXT DEFAULT '/assets/default-avatar.png',
      role TEXT DEFAULT 'user' CHECK(role IN ('owner', 'admin', 'moderator', 'user')),
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'banned', 'suspended', 'pending')),
      google_id TEXT,
      reset_token TEXT,
      reset_token_expiry INTEGER,
      warnings INTEGER DEFAULT 0,
      last_login TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS warnings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      issued_by TEXT NOT NULL,
      reason TEXT NOT NULL,
      severity TEXT DEFAULT 'low' CHECK(severity IN ('low', 'medium', 'high', 'critical')),
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (issued_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS ban_list (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      banned_by TEXT NOT NULL,
      reason TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (banned_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS login_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      status TEXT CHECK(status IN ('success', 'failed')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      permission TEXT NOT NULL,
      UNIQUE(role, permission)
    );
  `);

  initializePermissions();
  createDefaultOwner();

  return db;
}

function initializePermissions() {
  const permissions = {
    owner: [
      'manage_users', 'manage_roles', 'manage_server', 'manage_plugins',
      'manage_backups', 'manage_worlds', 'view_console', 'execute_commands',
      'manage_settings', 'manage_warnings', 'manage_bans', 'view_logs',
      'manage_schedule', 'delete_users', 'transfer_ownership'
    ],
    admin: [
      'manage_users', 'manage_server', 'manage_plugins', 'manage_backups',
      'manage_worlds', 'view_console', 'execute_commands', 'manage_settings',
      'manage_warnings', 'manage_bans', 'view_logs', 'manage_schedule'
    ],
    moderator: [
      'manage_warnings', 'manage_bans', 'view_console', 'view_logs',
      'kick_players', 'ban_players'
    ],
    user: [
      'view_server_status', 'view_players'
    ]
  };

  const insert = db.prepare('INSERT OR IGNORE INTO permissions (id, role, permission) VALUES (?, ?, ?)');
  
  for (const [role, perms] of Object.entries(permissions)) {
    for (const perm of perms) {
      insert.run(uuidv4(), role, perm);
    }
  }
}

function createDefaultOwner() {
  const existing = db.prepare('SELECT id FROM users WHERE role = ?').get('owner');
  if (!existing) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    db.prepare(`
      INSERT INTO users (id, username, email, password, display_name, role, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      'admin',
      'admin@server.local',
      hashedPassword,
      'Server Owner',
      'owner',
      'active'
    );
    console.log('Default owner created: admin / admin123');
  }
}

function getDb() {
  if (!db) initDatabase();
  return db;
}

module.exports = { initDatabase, getDb };
