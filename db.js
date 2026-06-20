'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'checkin.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS employees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cccd        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  department  TEXT,
  emp_code    TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checkins (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER UNIQUE,         -- 1 nhân viên chỉ check-in 1 lần
  cccd_hash    TEXT,
  cccd_last4   TEXT,
  name         TEXT,
  department   TEXT,
  photo_path   TEXT,
  checkin_time TEXT,
  lat          REAL,
  lng          REAL,
  gps_accuracy REAL,
  gps_valid    INTEGER DEFAULT 0,
  ip           TEXT,
  user_agent   TEXT,
  device_info  TEXT,
  consent      INTEGER DEFAULT 0,
  is_valid     INTEGER DEFAULT 0,      -- đủ điều kiện vào lucky draw
  created_at   TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS draw_winners (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  checkin_id  INTEGER UNIQUE NOT NULL,
  prize       TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (checkin_id) REFERENCES checkins(id)
);

CREATE INDEX IF NOT EXISTS idx_checkins_valid ON checkins(is_valid);
`);

module.exports = { db, DATA_DIR, UPLOAD_DIR };
