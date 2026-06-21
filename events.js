'use strict';
// Quản lý nhiều sự kiện/địa điểm check-in (mỗi cái có vị trí + khung giờ riêng).
const { db } = require('./db');
const lib = require('./lib');

function activeEvents() {
  return db.prepare('SELECT * FROM events WHERE active = 1 ORDER BY start_ms, id').all();
}

function timeOk(e, now) {
  if (!e.window_enabled) return true;
  if (e.start_ms && now < e.start_ms) return false;
  if (e.end_ms && now > e.end_ms) return false;
  return true;
}

// Sự kiện đang mở theo thời gian
function openEvents(now) {
  return activeEvents().filter((e) => timeOk(e, now));
}

// Có dùng chế độ nhiều sự kiện không (đã tạo ít nhất 1 sự kiện active)
function hasEvents() {
  return db.prepare('SELECT COUNT(*) c FROM events WHERE active = 1').get().c > 0;
}

// Khớp 1 check-in vào sự kiện theo thời gian + vị trí GPS
function matchForCheckin(now, lat, lng) {
  const evs = activeEvents();
  if (!evs.length) return { mode: 'global' };
  const cands = evs.filter((e) => timeOk(e, now));
  if (!cands.length) return { mode: 'events', event: null };

  // Ưu tiên: sự kiện bật geofence mà GPS nằm trong vùng
  for (const e of cands) {
    if (e.geofence_enabled && lat != null && lng != null) {
      const d = lib.distanceMeters(e.lat, e.lng, lat, lng);
      if (d <= e.radius) return { mode: 'events', event: e, gpsOk: true, distance: Math.round(d) };
    }
  }
  // Kế: sự kiện không bật geofence (chỉ theo giờ)
  const noFence = cands.find((e) => !e.geofence_enabled);
  if (noFence) return { mode: 'events', event: noFence, gpsOk: true };
  // Còn lại: có khớp giờ nhưng GPS ngoài vùng -> gắn vào cái đầu, đánh dấu gps sai
  const e = cands[0];
  const distance = (lat != null && lng != null) ? Math.round(lib.distanceMeters(e.lat, e.lng, lat, lng)) : null;
  return { mode: 'events', event: e, gpsOk: false, distance };
}

// Đánh giá geofence cho 1 sự kiện cụ thể (khi nhân viên tự chọn địa điểm)
function evalEvent(ev, lat, lng) {
  const geofenceApplicable = !!ev.geofence_enabled;
  let gpsOk = !geofenceApplicable;
  let distance = null;
  if (geofenceApplicable && lat != null && lng != null) {
    distance = Math.round(lib.distanceMeters(ev.lat, ev.lng, lat, lng));
    gpsOk = distance <= ev.radius;
  }
  return { geofenceApplicable, gpsOk, distance };
}

module.exports = { activeEvents, openEvents, hasEvents, timeOk, matchForCheckin, evalEvent };
