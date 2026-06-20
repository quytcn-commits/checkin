'use strict';
const crypto = require('crypto');
const config = require('./config');

// Chuẩn hoá CCCD: chỉ giữ chữ số
function normalizeCccd(raw) {
  return String(raw || '').replace(/\D/g, '');
}

// CCCD 12 số (mới) hoặc CMND 9 số (cũ)
function isValidCccd(cccd) {
  return /^(\d{9}|\d{12})$/.test(cccd);
}

function hashCccd(cccd) {
  return crypto
    .createHash('sha256')
    .update(cccd + '|' + config.cccdSalt)
    .digest('hex');
}

function last4(cccd) {
  return cccd.slice(-4);
}

// Khoảng cách Haversine (mét)
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isWithinGeofence(lat, lng, geofence = config.geofence) {
  if (!geofence.enabled) return { applicable: false, ok: true, distance: null };
  if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
    return { applicable: true, ok: false, distance: null };
  }
  const d = distanceMeters(geofence.lat, geofence.lng, lat, lng);
  return { applicable: true, ok: d <= geofence.radius, distance: Math.round(d) };
}

// Parser CSV tối giản: hỗ trợ dấu phẩy, có thể bọc "..."
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  text = text.replace(/^﻿/, ''); // bỏ BOM
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* bỏ qua */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

module.exports = {
  normalizeCccd,
  isValidCccd,
  hashCccd,
  last4,
  distanceMeters,
  isWithinGeofence,
  parseCsv,
};
