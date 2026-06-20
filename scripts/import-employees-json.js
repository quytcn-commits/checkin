'use strict';
// Import nhân viên từ file JSON (mảng object).
//   node scripts/import-employees-json.js <file.json>
// Map linh hoạt: cccd; name <- name|fullName; department <- department|title; emp_code <- emp_code|khoi
const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const lib = require('../lib');

const file = process.argv[2];
if (!file) {
  console.error('Cách dùng: node scripts/import-employees-json.js <file.json>');
  process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const list = Array.isArray(raw) ? raw : (raw.employees || Object.values(raw));

const upsert = db.prepare(`
  INSERT INTO employees (cccd, name, department, emp_code)
  VALUES (@cccd, @name, @department, @emp_code)
  ON CONFLICT(cccd) DO UPDATE SET name=excluded.name, department=excluded.department, emp_code=excluded.emp_code
`);

let added = 0, skipped = 0;
db.transaction(() => {
  for (const e of list) {
    const cccd = lib.normalizeCccd(e.cccd);
    const name = (e.name || e.fullName || '').trim();
    if (!lib.isValidCccd(cccd) || !name) { skipped++; continue; }
    upsert.run({
      cccd,
      name,
      department: (e.department || e.title || '').toString().trim(),
      emp_code: (e.emp_code || e.khoi || '').toString().trim(),
    });
    added++;
  }
})();

console.log(`✅ Import JSON xong. Thêm/cập nhật: ${added} · Bỏ qua: ${skipped} · Tổng nhân viên: ${db.prepare('SELECT COUNT(*) c FROM employees').get().c}`);
