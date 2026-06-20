'use strict';
// Parse file Excel danh sách nhân viên -> [{cccd, name, department, emp_code}]
// Mặc định đọc sheet "Chốt" (danh sách đã chốt). Lọc người đã nghỉ việc.
// Khớp mẫu file: cột "Số CMND/ CCCD", "Mã nhân viên", "Họ và tên",
// "Phòng ban cấp 1", "Chức vụ", "Tình trạng công tác", "Khối nhân viên".
const lib = require('./lib');

const DEFAULT_SHEET = 'Chốt';

// Bỏ dấu + ký tự đặc biệt để so khớp tên cột linh hoạt
const strip = (s) =>
  String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const FIELD = {
  cccd: ['socmndcccd', 'cccd', 'cmnd', 'socccd', 'socanccuoc'],
  name: ['hovaten', 'hoten', 'tennhanvien', 'ten'],
  empCode: ['manhanvien', 'manv', 'ma'],
  dept1: ['phongbancap1', 'phongban1', 'phongban'],
  title: ['chucvu', 'chucdanh', 'vitri'],
  status: ['tinhtrangcongtac', 'trangthai'],
};

function colIndex(header, keys) {
  for (const k of keys) {
    const i = header.indexOf(k);
    if (i >= 0) return i;
  }
  for (const k of keys) {
    const i = header.findIndex((h) => h.includes(k));
    if (i >= 0) return i;
  }
  return -1;
}

function parseEmployeesExcel(XLSX, wb, { sheet = DEFAULT_SHEET, onlyActive = true } = {}) {
  const sheetName =
    wb.SheetNames.find((s) => s === sheet) ||
    wb.SheetNames.find((s) => strip(s) === strip(sheet)) ||
    wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Không tìm thấy sheet "${sheet}". Có: ${wb.SheetNames.join(', ')}`);

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  if (!rows.length) throw new Error('Sheet rỗng');

  const header = rows[0].map((h) => strip(h));
  const idx = {};
  for (const [k, v] of Object.entries(FIELD)) idx[k] = colIndex(header, v);
  if (idx.cccd < 0 || idx.name < 0) {
    throw new Error('File thiếu cột "Số CMND/CCCD" hoặc "Họ và tên" (kiểm tra dòng tiêu đề).');
  }

  const seen = new Map(); // cccd -> { row, name } (lần xuất hiện đầu, được giữ)
  const employees = [];
  let skippedInactive = 0;
  let skippedInvalid = 0;
  const invalid = []; // chi tiết dòng lỗi để admin sửa
  const duplicateList = []; // chi tiết các dòng trùng CCCD
  let duplicates = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const rawCccd = String(row[idx.cccd] == null ? '' : row[idx.cccd]).trim();
    const cccd = lib.normalizeCccd(rawCccd);
    const name = String(row[idx.name] == null ? '' : row[idx.name]).trim();
    if (!cccd && !name) continue; // dòng trống
    // Lọc người đã nghỉ (chỉ khi cột trạng thái có giá trị khác "active")
    if (onlyActive && idx.status >= 0) {
      const st = strip(row[idx.status]);
      if (st && st !== 'active') { skippedInactive++; continue; }
    }
    if (!lib.isValidCccd(cccd) || !name) {
      skippedInvalid++;
      let reason = !name ? 'thiếu Họ tên'
        : !rawCccd ? 'thiếu CCCD'
        : `CCCD "${rawCccd}" không đúng (cần 9 hoặc 12 số, đang ${cccd.length} số)`;
      if (invalid.length < 100) invalid.push({ row: r + 1, name, cccd: rawCccd, reason });
      continue;
    }
    if (seen.has(cccd)) {
      duplicates++;
      const first = seen.get(cccd);
      if (duplicateList.length < 500) {
        duplicateList.push({
          cccd: rawCccd,
          row: r + 1, name,
          firstRow: first.row, firstName: first.name,
          sameName: strip(name) === strip(first.name),
        });
      }
      continue;
    }
    seen.set(cccd, { row: r + 1, name });

    const dept =
      (idx.dept1 >= 0 ? String(row[idx.dept1] == null ? '' : row[idx.dept1]).trim() : '') ||
      (idx.title >= 0 ? String(row[idx.title] == null ? '' : row[idx.title]).trim() : '');
    const emp_code = idx.empCode >= 0 ? String(row[idx.empCode] == null ? '' : row[idx.empCode]).trim() : '';
    employees.push({ cccd, name, department: dept, emp_code });
  }
  return { employees, sheet: sheetName, sheets: wb.SheetNames, skippedInactive, skippedInvalid, duplicates, invalid, duplicateList };
}

module.exports = { parseEmployeesExcel, DEFAULT_SHEET };
