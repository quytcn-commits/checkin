'use strict';
// Import nhân viên từ file Excel:
//   node scripts/import-excel.js <file.xlsx> [tên-sheet]
// Mặc định đọc sheet "Chốt".
const path = require('path');
const XLSX = require('xlsx');
const { db } = require('../db');
const { parseEmployeesExcel, DEFAULT_SHEET } = require('../lib-excel');

const file = process.argv[2];
const sheet = process.argv[3] || DEFAULT_SHEET;
if (!file) {
  console.error('Cách dùng: node scripts/import-excel.js <file.xlsx> [tên-sheet]');
  console.error(`Mặc định sheet: "${DEFAULT_SHEET}"`);
  process.exit(1);
}

const wb = XLSX.readFile(path.resolve(file));
const { employees, sheet: used, sheets, skippedInactive, skippedInvalid, duplicates, invalid } = parseEmployeesExcel(XLSX, wb, { sheet });

const upsert = db.prepare(`
  INSERT INTO employees (cccd, name, department, emp_code)
  VALUES (@cccd, @name, @department, @emp_code)
  ON CONFLICT(cccd) DO UPDATE SET name=excluded.name, department=excluded.department, emp_code=excluded.emp_code
`);
db.transaction(() => { for (const e of employees) upsert.run(e); })();

console.log(`✅ Import Excel xong (sheet "${used}").`);
console.log(`   Nhân viên hợp lệ: ${employees.length} · Bỏ qua nghỉ việc: ${skippedInactive} · CCCD lỗi: ${skippedInvalid} · Trùng: ${duplicates}`);
if (invalid && invalid.length) {
  console.log('   ⚠️ Dòng lỗi cần sửa trong Excel:');
  for (const x of invalid) console.log(`     - Dòng ${x.row}${x.name ? ' · ' + x.name : ''}: ${x.reason}`);
}
console.log(`   Sheet trong file: ${sheets.join(', ')}`);
console.log(`   Tổng nhân viên trong DB: ${db.prepare('SELECT COUNT(*) c FROM employees').get().c}`);
