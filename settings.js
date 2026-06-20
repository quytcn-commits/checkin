'use strict';
// Cài đặt động (lưu DB) cho geofence + khung giờ check-in.
// Mặc định lấy từ .env (config.js) nếu admin chưa đặt.
const { db } = require('./db');
const config = require('./config');

function getAll() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const o = {};
  for (const r of rows) o[r.key] = r.value;
  return o;
}

function set(key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  ).run(key, value == null ? '' : String(value));
}

const asBool = (v, d) => (v == null || v === '' ? d : v === 'true' || v === '1');
const asNum = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const asInt = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

// Cấu hình hiệu lực = DB (nếu có) chồng lên mặc định .env
function effective() {
  const s = getAll();
  return {
    geofence: {
      enabled: asBool(s.geofence_enabled, config.geofence.enabled),
      lat: asNum(s.geofence_lat, config.geofence.lat),
      lng: asNum(s.geofence_lng, config.geofence.lng),
      radius: asNum(s.geofence_radius, config.geofence.radius),
    },
    window: {
      enabled: asBool(s.window_enabled, false),
      start: asInt(s.window_start_ms, 0), // epoch ms (0 = không giới hạn)
      end: asInt(s.window_end_ms, 0),
    },
  };
}

// Trạng thái khung giờ tại thời điểm now (ms)
function windowStatus(now) {
  const w = effective().window;
  if (!w.enabled) return { open: true, state: 'always' };
  if (w.start && now < w.start) return { open: false, state: 'before', start: w.start, end: w.end };
  if (w.end && now > w.end) return { open: false, state: 'after', start: w.start, end: w.end };
  return { open: true, state: 'open', start: w.start, end: w.end };
}

module.exports = { getAll, set, effective, windowStatus };
