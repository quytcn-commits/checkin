'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const config = require('./config');
const { db, UPLOAD_DIR } = require('./db');
const lib = require('./lib');

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
  res.json({ eventName: config.eventName, geofenceEnabled: config.geofence.enabled });
});

// Kiểm tra CCCD trước khi chụp ảnh (UX: chào tên + chặn sớm)
app.post('/api/verify', (req, res) => {
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
    const geo = lib.isWithinGeofence(latN, lngN);
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

app.get('/api/admin/checkins', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, department, cccd_last4, photo_path, checkin_time,
           lat, lng, gps_accuracy, gps_valid, ip, device_info, is_valid
    FROM checkins ORDER BY id DESC
  `).all();
  res.json(rows);
});

// Export CSV
app.get('/api/admin/export', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, department, cccd_last4, checkin_time, lat, lng, gps_accuracy,
           gps_valid, ip, is_valid FROM checkins ORDER BY id
  `).all();
  const header = ['id', 'name', 'department', 'cccd_last4', 'checkin_time', 'lat', 'lng', 'gps_accuracy', 'gps_valid', 'ip', 'is_valid'];
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = [header.join(',')];
  for (const r of rows) lines.push(header.map((h) => esc(r[h])).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="checkins.csv"');
  res.send('﻿' + lines.join('\n'));
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
