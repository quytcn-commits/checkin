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

CREATE TABLE IF NOT EXISTS draw_winners (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  checkin_id  INTEGER UNIQUE NOT NULL,
  prize       TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (checkin_id) REFERENCES checkins(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`);

// Định nghĩa bảng checkins (KHÔNG unique employee_id -> cho phép check-in nhiều lần;
// danh sách quay thưởng sẽ tự lọc mỗi nhân viên 1 lần).
const CHECKINS_BODY = `(
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER,
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
  is_valid     INTEGER DEFAULT 0,
  created_at   TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
)`;

db.exec(`CREATE TABLE IF NOT EXISTS checkins ${CHECKINS_BODY};`);

// Migration: nếu DB cũ còn ràng buộc UNIQUE trên employee_id -> rebuild bỏ UNIQUE
const t = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='checkins'").get();
if (t && /employee_id\s+INTEGER\s+UNIQUE/i.test(t.sql)) {
  const cols = db.prepare('PRAGMA table_info(checkins)').all().map((c) => c.name).join(', ');
  db.transaction(() => {
    db.exec(`CREATE TABLE checkins_new ${CHECKINS_BODY};`);
    db.exec(`INSERT INTO checkins_new (${cols}) SELECT ${cols} FROM checkins;`);
    db.exec('DROP TABLE checkins;');
    db.exec('ALTER TABLE checkins_new RENAME TO checkins;');
  })();
  console.log('🔁 Đã nâng cấp bảng checkins: cho phép check-in nhiều lần.');
}

db.exec('CREATE INDEX IF NOT EXISTS idx_checkins_valid ON checkins(is_valid);');
db.exec('CREATE INDEX IF NOT EXISTS idx_checkins_emp ON checkins(employee_id);');

module.exports = { db, DATA_DIR, UPLOAD_DIR };
