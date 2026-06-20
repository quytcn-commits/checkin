'use strict';
// Import nhân viên từ CLI:  node scripts/import-employees.js duong-dan.csv
const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const lib = require('../lib');

const file = process.argv[2];
if (!file) {
  console.error('Cách dùng: node scripts/import-employees.js <file.csv>');
  console.error('Cột CSV: cccd,name,department,emp_code (có thể có dòng tiêu đề)');
  process.exit(1);
}
const text = fs.readFileSync(path.resolve(file), 'utf8');
const rows = lib.parseCsv(text);

let start = 0;
const head = (rows[0] || []).map((h) => h.trim().toLowerCase());
const col = { cccd: 0, name: 1, department: 2, emp_code: 3 };
if (head.includes('cccd') || head.includes('name') || head.includes('ten')) {
  start = 1;
  head.forEach((h, i) => {
    if (h === 'cccd' || h === 'cmnd') col.cccd = i;
    else if (h === 'name' || h === 'ten' || h === 'hoten' || h === 'họ tên') col.name = i;
    else if (h === 'department' || h === 'phong ban' || h === 'phòng ban') col.department = i;
    else if (h === 'emp_code' || h === 'manv' || h === 'ma') col.emp_code = i;
  });
}

const upsert = db.prepare(`
  INSERT INTO employees (cccd, name, department, emp_code)
  VALUES (@cccd, @name, @department, @emp_code)
  ON CONFLICT(cccd) DO UPDATE SET name=excluded.name, department=excluded.department, emp_code=excluded.emp_code
`);

let added = 0, skipped = 0;
db.transaction(() => {
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const cccd = lib.normalizeCccd(r[col.cccd]);
    const name = (r[col.name] || '').trim();
    if (!lib.isValidCccd(cccd) || !name) { skipped++; continue; }
    upsert.run({ cccd, name, department: (r[col.department] || '').trim(), emp_code: (r[col.emp_code] || '').trim() });
    added++;
  }
})();

console.log(`✅ Import xong. Thêm/cập nhật: ${added} · Bỏ qua: ${skipped} · Tổng nhân viên: ${db.prepare('SELECT COUNT(*) c FROM employees').get().c}`);
