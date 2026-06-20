'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const XLSX = require('xlsx');
const config = require('./config');
const { db, UPLOAD_DIR } = require('./db');
const lib = require('./lib');
const settings = require('./settings');
const { parseEmployeesExcel, DEFAULT_SHEET } = require('./lib-excel');

const app = express();
app.set('trust proxy', true); // lấy đúng IP khi chạy sau reverse proxy / tunnel
app.use(express.json({ limit: '12mb' })); // ảnh base64

// ---------- Helpers ----------
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.ip || req.socket.remoteAddress || '';
}

function requireAdmin(req, res, next) {
  const pw = req.headers['x-admin-password'] || req.query.pw;
  if (pw && String(pw) === config.adminPassword) return next();
  return res.status(401).json({ error: 'Sai mật khẩu quản trị' });
}

function savePhoto(dataUrl, checkinId) {
  // dataUrl dạng: data:image/jpeg;base64,xxxx
  const m = /^data:image\/(jpeg|jpg|png);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) return null;
  const ext = m[1].toLowerCase() === 'png' ? 'png' : 'jpg';
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) return null; // chặn ảnh >8MB
  const filename = `checkin_${checkinId}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
  return filename;
}

// ---------- API công khai ----------

// Config tối thiểu cho frontend
app.get('/api/config', (req, res) => {
  const eff = settings.effective();
  const ws = settings.windowStatus(Date.now());
  res.json({
    eventName: config.eventName,
    geofenceEnabled: eff.geofence.enabled,
    checkinOpen: ws.open,
    windowState: ws.state,
    windowStart: ws.start || null,
    windowEnd: ws.end || null,
    checkinMessage: ws.open ? '' : checkinClosedMessage(ws),
  });
});

// Thông báo khi ngoài khung giờ check-in
function checkinClosedMessage(ws) {
  if (ws.state === 'before') {
    const t = new Date(ws.start).toLocaleString('vi-VN');
    return `Chưa đến giờ check-in. Bắt đầu lúc ${t}.`;
  }
  if (ws.state === 'after') {
    const t = new Date(ws.end).toLocaleString('vi-VN');
    return `Đã hết giờ check-in (kết thúc lúc ${t}).`;
  }
  return 'Hiện chưa mở check-in.';
}

// Kiểm tra CCCD trước khi chụp ảnh (UX: chào tên + chặn sớm)
app.post('/api/verify', (req, res) => {
  const ws = settings.windowStatus(Date.now());
  if (!ws.open) return res.status(403).json({ ok: false, error: checkinClosedMessage(ws) });
  const cccd = lib.normalizeCccd(req.body.cccd);
  if (!lib.isValidCccd(cccd)) {
    return res.status(400).json({ ok: false, error: 'Số CCCD/CMND không hợp lệ (cần 9 hoặc 12 số)' });
  }
  const emp = db.prepare('SELECT * FROM employees WHERE cccd = ?').get(cccd);
  if (!emp) {
    return res.status(404).json({ ok: false, error: 'CCCD không có trong danh sách nhân viên' });
  }
  const existed = db.prepare('SELECT id FROM checkins WHERE employee_id = ?').get(emp.id);
  if (existed) {
    return res.status(409).json({ ok: false, error: 'Nhân viên này đã check-in rồi' });
  }
  res.json({ ok: true, name: emp.name, department: emp.department || '' });
});

// Gửi check-in
app.post('/api/checkin', (req, res) => {
  try {
    const ws = settings.windowStatus(Date.now());
    if (!ws.open) return res.status(403).json({ ok: false, error: checkinClosedMessage(ws) });

    const cccd = lib.normalizeCccd(req.body.cccd);
    const { photo, lat, lng, accuracy, consent, deviceInfo } = req.body;

    if (!lib.isValidCccd(cccd)) {
      return res.status(400).json({ ok: false, error: 'Số CCCD/CMND không hợp lệ' });
    }
    if (!consent) {
      return res.status(400).json({ ok: false, error: 'Bạn cần đồng ý điều khoản để check-in' });
    }
    const emp = db.prepare('SELECT * FROM employees WHERE cccd = ?').get(cccd);
    if (!emp) {
      return res.status(404).json({ ok: false, error: 'CCCD không có trong danh sách nhân viên' });
    }
    const existed = db.prepare('SELECT id FROM checkins WHERE employee_id = ?').get(emp.id);
    if (existed) {
      return res.status(409).json({ ok: false, error: 'Nhân viên này đã check-in rồi' });
    }
    if (!photo) {
      return res.status(400).json({ ok: false, error: 'Thiếu ảnh check-in' });
    }

    const latN = typeof lat === 'number' ? lat : null;
    const lngN = typeof lng === 'number' ? lng : null;
    const geo = lib.isWithinGeofence(latN, lngN, settings.effective().geofence);
    const gpsValid = geo.ok ? 1 : 0;

    // is_valid: có consent + có ảnh + đúng nhân viên + (qua geofence nếu bật)
    const isValid = consent && (!geo.applicable || geo.ok) ? 1 : 0;

    const insert = db.prepare(`
      INSERT INTO checkins
        (employee_id, cccd_hash, cccd_last4, name, department, checkin_time,
         lat, lng, gps_accuracy, gps_valid, ip, user_agent, device_info, consent, is_valid)
      VALUES
        (@employee_id, @cccd_hash, @cccd_last4, @name, @department, datetime('now'),
         @lat, @lng, @gps_accuracy, @gps_valid, @ip, @user_agent, @device_info, @consent, @is_valid)
    `);

    const info = insert.run({
      employee_id: emp.id,
      cccd_hash: lib.hashCccd(cccd),
      cccd_last4: lib.last4(cccd),
      name: emp.name,
      department: emp.department || '',
      lat: latN,
      lng: lngN,
      gps_accuracy: typeof accuracy === 'number' ? accuracy : null,
      gps_valid: gpsValid,
      ip: getClientIp(req),
      user_agent: req.headers['user-agent'] || '',
      device_info: deviceInfo ? JSON.stringify(deviceInfo).slice(0, 1000) : '',
      consent: consent ? 1 : 0,
      is_valid: isValid,
    });

    const filename = savePhoto(photo, info.lastInsertRowid);
    if (filename) {
      db.prepare('UPDATE checkins SET photo_path = ? WHERE id = ?').run(filename, info.lastInsertRowid);
    }

    res.json({
      ok: true,
      name: emp.name,
      isValid: !!isValid,
      gpsValid: !!gpsValid,
      geofenceApplicable: geo.applicable,
      distance: geo.distance,
      message: isValid
        ? 'Check-in thành công! Bạn đã đủ điều kiện tham gia quay số may mắn.'
        : 'Đã ghi nhận check-in nhưng CHƯA hợp lệ cho quay số (vui lòng kiểm tra vị trí GPS).',
    });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ ok: false, error: 'Nhân viên này đã check-in rồi' });
    }
    console.error(err);
    res.status(500).json({ ok: false, error: 'Lỗi máy chủ' });
  }
});

// Ảnh check-in (chỉ admin xem qua trang, nhưng để đơn giản cho phép truy cập file)
app.get('/uploads/:file', requireAdminMaybe, (req, res) => {
  const f = path.basename(req.params.file);
  const full = path.join(UPLOAD_DIR, f);
  if (!fs.existsSync(full)) return res.status(404).end();
  res.sendFile(full);
});
// Cho phép xem ảnh nếu có mật khẩu ở query (admin/draw embed), nếu không vẫn cho xem (nội bộ)
function requireAdminMaybe(req, res, next) { next(); }

// ---------- API quản trị ----------

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const totalEmp = db.prepare('SELECT COUNT(*) c FROM employees').get().c;
  const totalCheckin = db.prepare('SELECT COUNT(*) c FROM checkins').get().c;
  const validCheckin = db.prepare('SELECT COUNT(*) c FROM checkins WHERE is_valid = 1').get().c;
  const winners = db.prepare('SELECT COUNT(*) c FROM draw_winners').get().c;
  res.json({ totalEmp, totalCheckin, validCheckin, winners });
});

// Cài đặt geofence + khung giờ (đọc)
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  res.json({ ...settings.effective(), serverNow: Date.now() });
});

// Cài đặt geofence + khung giờ (ghi)
app.post('/api/admin/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (b.geofence) {
    settings.set('geofence_enabled', b.geofence.enabled ? 'true' : 'false');
    if (b.geofence.lat != null) settings.set('geofence_lat', b.geofence.lat);
    if (b.geofence.lng != null) settings.set('geofence_lng', b.geofence.lng);
    if (b.geofence.radius != null) settings.set('geofence_radius', b.geofence.radius);
  }
  if (b.window) {
    settings.set('window_enabled', b.window.enabled ? 'true' : 'false');
    settings.set('window_start_ms', b.window.start || 0);
    settings.set('window_end_ms', b.window.end || 0);
  }
  res.json({ ...settings.effective(), serverNow: Date.now() });
});

app.get('/api/admin/checkins', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, department, cccd_last4, photo_path, checkin_time,
           lat, lng, gps_accuracy, gps_valid, ip, device_info, is_valid
    FROM checkins ORDER BY id DESC
  `).all();
  res.json(rows);
});

// Export CSV (kèm cột link ảnh)
app.get('/api/admin/export', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, department, cccd_last4, checkin_time, lat, lng, gps_accuracy,
           gps_valid, ip, is_valid, photo_path FROM checkins ORDER BY id
  `).all();
  const base = `${req.protocol}://${req.get('host')}`;
  const header = ['id', 'name', 'department', 'cccd_last4', 'checkin_time', 'lat', 'lng', 'gps_accuracy', 'gps_valid', 'ip', 'is_valid', 'photo_url'];
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = [header.join(',')];
  for (const r of rows) {
    r.photo_url = r.photo_path ? `${base}/uploads/${r.photo_path}` : '';
    lines.push(header.map((h) => esc(r[h])).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="checkins.csv"');
  res.send('﻿' + lines.join('\n'));
});

// Báo cáo HTML kèm ảnh (mở để xem/in PDF). Cho phép mật khẩu qua query.
app.get('/api/admin/report', requireAdmin, (req, res) => {
  const onlyValid = req.query.valid === '1';
  const rows = db.prepare(`
    SELECT id, name, department, cccd_last4, photo_path, checkin_time,
           lat, lng, gps_accuracy, gps_valid, ip, is_valid
    FROM checkins ${onlyValid ? 'WHERE is_valid = 1' : ''} ORDER BY id
  `).all();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cards = rows.map((r) => `
    <div class="c">
      <div class="ph">${r.photo_path ? `<img src="/uploads/${r.photo_path}" loading="lazy">` : '<div class="noph">Không ảnh</div>'}</div>
      <div class="meta">
        <div class="nm">#${r.id} · ${esc(r.name)}</div>
        <div class="dp">${esc(r.department || '')}</div>
        <div class="ln">CCCD: ****${esc(r.cccd_last4 || '')}</div>
        <div class="ln">${esc((r.checkin_time || '').replace('T', ' '))}</div>
        <div class="ln">${r.lat != null ? `GPS: ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)} ${r.gps_valid ? '✅' : '⚠️'} (±${Math.round(r.gps_accuracy || 0)}m)` : 'GPS: —'}</div>
        <div class="ln">IP: ${esc(r.ip || '')}</div>
        <div class="bd ${r.is_valid ? 'ok' : 'no'}">${r.is_valid ? 'HỢP LỆ' : 'KHÔNG HỢP LỆ'}</div>
      </div>
    </div>`).join('');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8">
<title>Báo cáo check-in · ${esc(config.eventName)}</title>
<style>
body{font-family:system-ui,Segoe UI,Roboto,sans-serif;margin:0;padding:20px;background:#f3f4f8;color:#111}
h1{font-size:20px;margin:0 0 4px}.sub{color:#666;font-size:13px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
.c{background:#fff;border:1px solid #e3e6ef;border-radius:12px;overflow:hidden;break-inside:avoid}
.ph{aspect-ratio:3/4;background:#000}.ph img{width:100%;height:100%;object-fit:cover;display:block}
.noph{display:flex;align-items:center;justify-content:center;height:100%;color:#888;font-size:13px}
.meta{padding:10px 12px}.nm{font-weight:700;font-size:14px}.dp{color:#555;font-size:12px;margin:2px 0 6px}
.ln{font-size:11.5px;color:#444;margin:2px 0}
.bd{display:inline-block;margin-top:6px;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700}
.bd.ok{background:#dcfce7;color:#15803d}.bd.no{background:#fee2e2;color:#b91c1c}
.bar{margin-bottom:14px}.bar button,.bar a{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #cbd2e1;background:#fff;cursor:pointer;text-decoration:none;color:#111}
@media print{.bar{display:none}body{background:#fff}}
</style></head><body>
<h1>Báo cáo check-in — ${esc(config.eventName)}</h1>
<div class="sub">Tổng: ${rows.length} bản ghi${onlyValid ? ' (chỉ hợp lệ)' : ''} · Xuất lúc ${esc(new Date().toLocaleString('vi-VN'))}</div>
<div class="bar">
  <button onclick="window.print()">🖨️ In / Lưu PDF</button>
  <a href="/api/admin/report?pw=${esc(req.query.pw || '')}">Tất cả</a>
  <a href="/api/admin/report?valid=1&pw=${esc(req.query.pw || '')}">Chỉ hợp lệ</a>
</div>
<div class="grid">${cards}</div>
</body></html>`);
});

// Import danh sách nhân viên từ Excel (.xlsx) - mặc định sheet "Chốt"
app.post('/api/admin/import-excel', requireAdmin, (req, res) => {
  try {
    const { fileBase64, sheet } = req.body;
    if (!fileBase64) return res.status(400).json({ error: 'Thiếu file Excel' });
    const buf = Buffer.from(String(fileBase64).split(',').pop(), 'base64');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const parsed = parseEmployeesExcel(XLSX, wb, { sheet: sheet || DEFAULT_SHEET });
    if (!parsed.employees.length) {
      return res.status(400).json({ error: `Không đọc được nhân sự từ sheet "${parsed.sheet}".`, sheets: parsed.sheets });
    }
    const upsert = db.prepare(`
      INSERT INTO employees (cccd, name, department, emp_code)
      VALUES (@cccd, @name, @department, @emp_code)
      ON CONFLICT(cccd) DO UPDATE SET name=excluded.name, department=excluded.department, emp_code=excluded.emp_code
    `);
    db.transaction(() => { for (const e of parsed.employees) upsert.run(e); })();
    res.json({
      added: parsed.employees.length,
      skippedInactive: parsed.skippedInactive,
      skippedInvalid: parsed.skippedInvalid,
      duplicates: parsed.duplicates,
      invalid: parsed.invalid,
      sheet: parsed.sheet,
      sheets: parsed.sheets,
      total: db.prepare('SELECT COUNT(*) c FROM employees').get().c,
    });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Lỗi đọc file Excel' });
  }
});

// Import danh sách nhân viên từ CSV (cột: cccd,name,department,emp_code)
app.post('/api/admin/import-employees', requireAdmin, (req, res) => {
  const csv = req.body.csv;
  if (!csv) return res.status(400).json({ error: 'Thiếu nội dung CSV' });
  const rows = lib.parseCsv(csv);
  if (rows.length === 0) return res.status(400).json({ error: 'CSV rỗng' });

  // Xác định header
  let start = 0;
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = { cccd: 0, name: 1, department: 2, emp_code: 3 };
  if (head.includes('cccd') || head.includes('name') || head.includes('ten') || head.includes('hoten')) {
    start = 1;
    head.forEach((h, i) => {
      if (h === 'cccd' || h === 'cmnd' || h === 'so cccd') col.cccd = i;
      else if (h === 'name' || h === 'ten' || h === 'hoten' || h === 'ho ten' || h === 'họ tên') col.name = i;
      else if (h === 'department' || h === 'phong ban' || h === 'phòng ban' || h === 'bo phan') col.department = i;
      else if (h === 'emp_code' || h === 'ma nv' || h === 'manv' || h === 'ma') col.emp_code = i;
    });
  }

  const upsert = db.prepare(`
    INSERT INTO employees (cccd, name, department, emp_code)
    VALUES (@cccd, @name, @department, @emp_code)
    ON CONFLICT(cccd) DO UPDATE SET name=excluded.name, department=excluded.department, emp_code=excluded.emp_code
  `);

  let added = 0, skipped = 0;
  const errors = [];
  const tx = db.transaction(() => {
    for (let i = start; i < rows.length; i++) {
      const r = rows[i];
      const cccd = lib.normalizeCccd(r[col.cccd]);
      const name = (r[col.name] || '').trim();
      if (!lib.isValidCccd(cccd) || !name) { skipped++; if (errors.length < 10) errors.push(`Dòng ${i + 1}: CCCD/tên không hợp lệ`); continue; }
      upsert.run({ cccd, name, department: (r[col.department] || '').trim(), emp_code: (r[col.emp_code] || '').trim() });
      added++;
    }
  });
  tx();
  res.json({ added, skipped, total: db.prepare('SELECT COUNT(*) c FROM employees').get().c, errors });
});

// ---------- API quản lý nhân viên ----------

// Danh sách nhân viên (tìm kiếm + phân trang)
app.get('/api/admin/employees', requireAdmin, (req, res) => {
  const q = (req.query.search || '').trim();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  const where = q ? 'WHERE e.name LIKE @q OR e.cccd LIKE @q OR e.department LIKE @q OR e.emp_code LIKE @q' : '';
  const like = '%' + q + '%';
  const total = q
    ? db.prepare(`SELECT COUNT(*) c FROM employees e ${where}`).get({ q: like }).c
    : db.prepare('SELECT COUNT(*) c FROM employees').get().c;
  const sql = `
    SELECT e.id, e.cccd, e.name, e.department, e.emp_code,
      (SELECT COUNT(*) FROM checkins c WHERE c.employee_id = e.id) AS checked
    FROM employees e ${where} ORDER BY e.name LIMIT @limit OFFSET @offset`;
  const rows = q
    ? db.prepare(sql).all({ q: like, limit, offset })
    : db.prepare(sql).all({ limit, offset });
  res.json({ total, page, limit, pages: Math.ceil(total / limit), rows });
});

// Thêm nhân viên
app.post('/api/admin/employees', requireAdmin, (req, res) => {
  const cccd = lib.normalizeCccd(req.body.cccd);
  const name = (req.body.name || '').trim();
  if (!lib.isValidCccd(cccd)) return res.status(400).json({ error: 'CCCD phải có 9 hoặc 12 số' });
  if (!name) return res.status(400).json({ error: 'Thiếu họ tên' });
  try {
    const info = db.prepare('INSERT INTO employees (cccd, name, department, emp_code) VALUES (?,?,?,?)')
      .run(cccd, name, (req.body.department || '').trim(), (req.body.emp_code || '').trim());
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'CCCD đã tồn tại trong danh sách' });
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

// Sửa nhân viên
app.put('/api/admin/employees/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const emp = db.prepare('SELECT id FROM employees WHERE id = ?').get(id);
  if (!emp) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });
  const cccd = lib.normalizeCccd(req.body.cccd);
  const name = (req.body.name || '').trim();
  if (!lib.isValidCccd(cccd)) return res.status(400).json({ error: 'CCCD phải có 9 hoặc 12 số' });
  if (!name) return res.status(400).json({ error: 'Thiếu họ tên' });
  try {
    db.prepare('UPDATE employees SET cccd=?, name=?, department=?, emp_code=? WHERE id=?')
      .run(cccd, name, (req.body.department || '').trim(), (req.body.emp_code || '').trim(), id);
    res.json({ ok: true });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'CCCD này đã thuộc nhân viên khác' });
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

// Xoá nhân viên
app.delete('/api/admin/employees/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const checked = db.prepare('SELECT id FROM checkins WHERE employee_id = ?').get(id);
  if (checked) return res.status(400).json({ error: 'Nhân viên đã check-in — không thể xoá (để bảo toàn dữ liệu).' });
  db.prepare('DELETE FROM employees WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- API quay số ----------

// Danh sách người hợp lệ chưa trúng (cho hiệu ứng cuộn tên)
app.get('/api/draw/pool', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.name, c.department FROM checkins c
    WHERE c.is_valid = 1 AND c.id NOT IN (SELECT checkin_id FROM draw_winners)
  `).all();
  res.json(rows);
});

// Quay 1 người trúng
app.post('/api/draw/spin', requireAdmin, (req, res) => {
  const prize = (req.body.prize || '').toString().slice(0, 200);
  const pool = db.prepare(`
    SELECT c.id, c.name, c.department, c.photo_path FROM checkins c
    WHERE c.is_valid = 1 AND c.id NOT IN (SELECT checkin_id FROM draw_winners)
  `).all();
  if (pool.length === 0) return res.status(400).json({ error: 'Không còn người hợp lệ để quay' });
  const pick = pool[Math.floor(Math.random() * pool.length)];
  db.prepare('INSERT INTO draw_winners (checkin_id, prize) VALUES (?, ?)').run(pick.id, prize);
  res.json({ winner: pick, prize, remaining: pool.length - 1 });
});

app.get('/api/draw/winners', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT w.id, w.prize, w.created_at, c.name, c.department, c.photo_path, c.cccd_last4
    FROM draw_winners w JOIN checkins c ON c.id = w.checkin_id
    ORDER BY w.id DESC
  `).all();
  res.json(rows);
});

// Xoá 1 kết quả trúng (quay lại nếu cần)
app.delete('/api/draw/winners/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM draw_winners WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Static ----------
app.use(express.static(path.join(__dirname, 'public')));

app.listen(config.port, () => {
  console.log(`\n✅ Check-in server đang chạy: http://localhost:${config.port}`);
  console.log(`   • Trang check-in (QR trỏ về đây): http://localhost:${config.port}/`);
  console.log(`   • Trang quản trị:                 http://localhost:${config.port}/admin.html`);
  console.log(`   • Trang quay số:                  http://localhost:${config.port}/draw.html`);
  console.log(`   • Sự kiện: ${config.eventName} | Geofence: ${config.geofence.enabled ? 'BẬT' : 'TẮT'}\n`);
});
