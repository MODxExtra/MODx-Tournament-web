import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve('data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  phone TEXT,
  ign TEXT,
  game_uid TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  balance REAL NOT NULL DEFAULT 0,
  email_verified INTEGER NOT NULL DEFAULT 0,
  verify_code TEXT,
  banned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  thumbnail TEXT,
  prize TEXT,
  entry_fee REAL NOT NULL DEFAULT 0,
  mode TEXT,
  map TEXT,
  slots INTEGER NOT NULL DEFAULT 48,
  start_time TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming',
  description TEXT,
  rules TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  ign TEXT,
  game_uid TEXT,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tournament_id, user_id)
);

CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  utr TEXT,
  screenshot TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS redeem_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  amount REAL NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS redeem_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  sender_role TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT,
  type TEXT NOT NULL DEFAULT 'info',
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Seed owner
const ownerEmail = 'modx@admin.modx';
if (!db.prepare('SELECT id FROM users WHERE email = ?').get(ownerEmail)) {
  db.prepare(`INSERT INTO users (email,password_hash,role,email_verified,ign)
    VALUES (?,?,'owner',1,'MODx')`).run(ownerEmail, bcrypt.hashSync('MODx123', 10));
  console.log('[seed] owner created → modx@admin.modx / MODx123');
}

// Default settings
const defaults = {
  'pay.upi_id': 'modx@upi',
  'pay.name': 'MODx',
  'pay.qr_url': '',
  'pay.min_deposit': '10',
  'pay.instructions': 'UPI par pay karo, phir UTR + screenshot submit karo. Admin verify karega.',
  'site.name': 'FIRE ARENA',
  'site.tagline': 'Free Fire Tournaments · Play · Win · Cash Out',
};
for (const [k, v] of Object.entries(defaults))
  db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)').run(k, v);

export default db;
