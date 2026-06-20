'use strict';
const $ = (id) => document.getElementById(id);
let PW = localStorage.getItem('admin_pw') || '';
let ALL = [];
let VIEW = 'table';

function authHeaders() { return { 'x-admin-password': PW, 'Content-Type': 'application/json' }; }

async function tryLogin(pw) {
  const res = await fetch('/api/admin/stats', { headers: { 'x-admin-password': pw } });
  return res.ok;
}

async function init() {
  if (PW && (await tryLogin(PW))) { showDash(); }
}
init();

$('btn-login').addEventListener('click', async () => {
  const pw = $('pw').value;
  if (await tryLogin(pw)) {
    PW = pw; localStorage.setItem('admin_pw', pw); showDash();
  } else {
    $('login-msg').className = 'msg show err';
    $('login-msg').textContent = 'Sai mật khẩu.';
  }
});
$('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-login').click(); });

function showDash() {
  $('login').classList.add('hidden');
  $('dash').classList.remove('hidden');
  loadAll();
  loadSettings();
}

async function loadAll() {
  const [stats, rows] = await Promise.all([
    fetch('/api/admin/stats', { headers: authHeaders() }).then((r) => r.json()),
    fetch('/api/admin/checkins', { headers: authHeaders() }).then((r) => r.json()),
  ]);
  $('s-emp').textContent = stats.totalEmp;
  $('s-checkin').textContent = stats.totalCheckin;
  if ($('s-unique')) $('s-unique').textContent = stats.uniqueCheckedIn != null ? `(${stats.uniqueCheckedIn} người)` : '';
  $('s-valid').textContent = stats.validCheckin;
  $('s-winner').textContent = stats.winners;
  ALL = rows;
  render();
}

function filtered() {
  const q = $('search').value.trim().toLowerCase();
  return ALL.filter((r) =>
    !q || (r.name || '').toLowerCase().includes(q) ||
    (r.department || '').toLowerCase().includes(q) ||
    (r.cccd_last4 || '').includes(q)
  );
}

function render() {
  if (VIEW === 'table') renderTable(); else renderGallery();
}

function gpsCell(r) {
  if (r.lat == null) return '—';
  return `<a href="https://maps.google.com/?q=${r.lat},${r.lng}" target="_blank" style="color:var(--accent2)">${r.gps_valid ? '✅' : '📍'} bản đồ</a><br><span class="small">±${Math.round(r.gps_accuracy || 0)}m</span>`;
}

function renderTable() {
  const rows = filtered();
  $('tbody').innerHTML = rows.map((r) => {
    let dev = '';
    try { const d = JSON.parse(r.device_info || '{}'); dev = (d.platform || '') + ' · ' + (d.screen || ''); } catch (e) {}
    const photo = r.photo_path
      ? `<img class="thumb" src="/uploads/${r.photo_path}" data-full="/uploads/${r.photo_path}" />`
      : '—';
    return `<tr>
      <td>${r.id}</td>
      <td>${photo}</td>
      <td>${r.name || ''}</td>
      <td>${r.department || ''}</td>
      <td>****${r.cccd_last4 || ''}</td>
      <td>${(r.checkin_time || '').replace('T', ' ')}</td>
      <td>${gpsCell(r)}</td>
      <td class="small">${r.ip || ''}</td>
      <td class="small">${dev}</td>
      <td><span class="pill ${r.is_valid ? 'ok' : 'no'}">${r.is_valid ? 'Hợp lệ' : 'Không'}</span></td>
      <td><button class="btn-sm btn-del btn-del-checkin" data-id="${r.id}" data-name="${encodeURIComponent(r.name || '')}">🗑️</button></td>
    </tr>`;
  }).join('');
}

function renderGallery() {
  const rows = filtered();
  $('gallery-view').innerHTML = rows.map((r) => `
    <div class="gcard">
      <div class="gph">${r.photo_path ? `<img class="thumb" src="/uploads/${r.photo_path}" data-full="/uploads/${r.photo_path}" />` : '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#888;font-size:12px">Không ảnh</div>'}</div>
      <div class="gmeta">
        <div class="gnm">#${r.id} · ${r.name || ''} <span class="pill ${r.is_valid ? 'ok' : 'no'}" style="font-size:10px">${r.is_valid ? 'OK' : 'X'}</span></div>
        <div class="gln">${r.department || ''}</div>
        <div class="gln">${(r.checkin_time || '').replace('T', ' ')}</div>
        <div class="gln">${r.lat != null ? (r.gps_valid ? '📍 trong vùng' : '⚠️ ngoài vùng') : 'GPS —'}</div>
        <button class="btn-sm btn-del btn-del-checkin" style="margin-top:6px" data-id="${r.id}" data-name="${encodeURIComponent(r.name || '')}">🗑️ Xoá để check-in lại</button>
      </div>
    </div>`).join('');
}

$('search').addEventListener('input', render);
$('btn-refresh').addEventListener('click', loadAll);

// Chuyển chế độ xem
function setView(v) {
  VIEW = v;
  $('view-table').classList.toggle('active', v === 'table');
  $('view-gallery').classList.toggle('active', v === 'gallery');
  $('table-view').classList.toggle('hidden', v !== 'table');
  $('gallery-view').classList.toggle('hidden', v !== 'gallery');
  render();
}
$('view-table').addEventListener('click', () => setView('table'));
$('view-gallery').addEventListener('click', () => setView('gallery'));

// Xuất CSV + Báo cáo ảnh
$('btn-export').addEventListener('click', () => {
  window.location = '/api/admin/export?pw=' + encodeURIComponent(PW);
});
$('btn-export-draw').addEventListener('click', () => {
  window.location = '/api/admin/export?unique=1&pw=' + encodeURIComponent(PW);
});
$('btn-report').addEventListener('click', () => {
  window.open('/api/admin/report?pw=' + encodeURIComponent(PW), '_blank');
});

// ===== Cài đặt =====
$('btn-settings').addEventListener('click', () => {
  $('settings-panel').classList.toggle('hidden');
});

function msToLocalInput(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function loadSettings() {
  const s = await fetch('/api/admin/settings', { headers: authHeaders() }).then((r) => r.json());
  $('gf-enabled').checked = !!s.geofence.enabled;
  $('gf-lat').value = s.geofence.lat ?? '';
  $('gf-lng').value = s.geofence.lng ?? '';
  $('gf-radius').value = s.geofence.radius ?? '';
  $('wd-enabled').checked = !!s.window.enabled;
  $('wd-start').value = msToLocalInput(s.window.start);
  $('wd-end').value = msToLocalInput(s.window.end);
  $('server-time').textContent = 'Giờ máy chủ hiện tại: ' + new Date(s.serverNow).toLocaleString('vi-VN');
}

$('btn-here').addEventListener('click', () => {
  if (!navigator.geolocation) { $('gf-here-msg').textContent = 'Thiết bị không hỗ trợ GPS.'; return; }
  $('gf-here-msg').textContent = 'Đang lấy vị trí...';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      $('gf-lat').value = pos.coords.latitude.toFixed(6);
      $('gf-lng').value = pos.coords.longitude.toFixed(6);
      $('gf-here-msg').textContent = `Đã lấy vị trí (sai số ~${Math.round(pos.coords.accuracy)}m). Nhớ bấm Lưu.`;
    },
    (err) => { $('gf-here-msg').textContent = 'Không lấy được GPS: ' + err.message; },
    { enableHighAccuracy: true, timeout: 12000 }
  );
});

$('btn-save-settings').addEventListener('click', async () => {
  const startV = $('wd-start').value;
  const endV = $('wd-end').value;
  const body = {
    geofence: {
      enabled: $('gf-enabled').checked,
      lat: parseFloat($('gf-lat').value) || 0,
      lng: parseFloat($('gf-lng').value) || 0,
      radius: parseFloat($('gf-radius').value) || 0,
    },
    window: {
      enabled: $('wd-enabled').checked,
      start: startV ? new Date(startV).getTime() : 0,
      end: endV ? new Date(endV).getTime() : 0,
    },
  };
  if (body.window.enabled && body.window.start && body.window.end && body.window.end <= body.window.start) {
    $('settings-msg').className = 'msg show err';
    $('settings-msg').textContent = 'Giờ kết thúc phải sau giờ bắt đầu.';
    return;
  }
  const res = await fetch('/api/admin/settings', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) { $('settings-msg').className = 'msg show err'; $('settings-msg').textContent = 'Lưu thất bại.'; return; }
  $('settings-msg').className = 'msg show ok';
  $('settings-msg').textContent = '✅ Đã lưu cài đặt (áp dụng ngay, không cần restart).';
  loadSettings();
});

// ===== Import Excel =====
$('import-xlsx').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $('import-msg').className = 'msg show info';
  $('import-msg').textContent = 'Đang đọc Excel...';
  const fileBase64 = await new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.readAsDataURL(file);
  });
  const sheet = $('sheet-name').value.trim();
  const res = await fetch('/api/admin/import-excel', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ fileBase64, sheet }),
  });
  const data = await res.json();
  if (!res.ok) {
    $('import-msg').className = 'msg show err';
    $('import-msg').innerHTML = (data.error || 'Lỗi import') + (data.sheets ? `<br><span class="small">Các sheet: ${data.sheets.join(', ')}</span>` : '');
    e.target.value = '';
    return;
  }
  LAST_DUP = data.duplicateList || [];
  let html = `Đã import <b>${data.added}</b> nhân viên từ sheet "<b>${data.sheet}</b>" · Bỏ qua nghỉ việc: ${data.skippedInactive} · CCCD lỗi: ${data.skippedInvalid}${data.duplicates ? ' · Trùng CCCD: ' + data.duplicates : ''} · Tổng: <b>${data.total}</b>`;
  if (data.invalid && data.invalid.length) {
    html += '<br><b>Dòng lỗi cần sửa trong Excel:</b><ul style="margin:6px 0 0;padding-left:18px">' +
      data.invalid.map((x) => `<li>Dòng ${x.row}${x.name ? ' · ' + x.name : ''}: ${x.reason}</li>`).join('') +
      '</ul>';
  }
  if (LAST_DUP.length) {
    const diff = LAST_DUP.filter((x) => !x.sameName);
    html += `<br><b>Trùng CCCD (${LAST_DUP.length}) — đã tự giữ bản đầu:</b> ` +
      `<button onclick="downloadDup()" style="font:inherit;padding:4px 10px;border-radius:8px;border:1px solid #cbd2e1;background:#fff;cursor:pointer">⬇ Tải CSV trùng</button>`;
    if (diff.length) html += `<br><span style="color:#b91c1c"><b>⚠️ ${diff.length} cặp TRÙNG KHÁC TÊN cần kiểm tra gấp.</b></span>`;
    html += '<div style="max-height:200px;overflow:auto;margin-top:6px;font-size:12px;line-height:1.7">' +
      LAST_DUP.map((x) => `<div${x.sameName ? '' : ' style="color:#b91c1c;font-weight:600"'}>CCCD ${x.cccd}: dòng ${x.firstRow} "${x.firstName}" ↔ dòng ${x.row} "${x.name}"${x.sameName ? '' : ' ⚠️ khác tên'}</div>`).join('') +
      '</div>';
  }
  $('import-msg').className = 'msg show info';
  $('import-msg').innerHTML = html;
  e.target.value = '';
  loadAll();
});

// Tải danh sách trùng CCCD ra CSV
let LAST_DUP = [];
window.downloadDup = function () {
  if (!LAST_DUP.length) return;
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const header = ['cccd', 'dong_giu', 'ten_giu', 'dong_trung', 'ten_trung', 'khac_ten'];
  const lines = [header.join(',')];
  for (const x of LAST_DUP) lines.push([x.cccd, x.firstRow, x.firstName, x.row, x.name, x.sameName ? 'không' : 'CÓ'].map(esc).join(','));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'trung-cccd.csv';
  a.click();
};

// ===== Import CSV =====
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  $('import-msg').className = 'msg show info';
  $('import-msg').textContent = 'Đang import...';
  const res = await fetch('/api/admin/import-employees', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ csv: text }),
  });
  const data = await res.json();
  if (!res.ok) { $('import-msg').className = 'msg show err'; $('import-msg').textContent = data.error || 'Lỗi import'; return; }
  $('import-msg').className = 'msg show ok';
  $('import-msg').innerHTML = `Đã import: <b>${data.added}</b> · Bỏ qua: ${data.skipped} · Tổng nhân viên: <b>${data.total}</b>` +
    (data.errors && data.errors.length ? '<br><span class="small">' + data.errors.join('; ') + '</span>' : '');
  e.target.value = '';
  loadAll();
});

// Xoá 1 check-in để nhân viên check-in lại
async function delCheckin(id, name) {
  if (!confirm(`Xoá check-in của "${name}"?\nNhân viên này sẽ được phép check-in lại từ đầu.`)) return;
  const res = await fetch('/api/admin/checkins/' + id, { method: 'DELETE', headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Xoá thất bại'); return; }
  loadAll();
}

// Xoá tất cả check-in (reset sau khi test)
$('btn-reset-all').addEventListener('click', async () => {
  if (!confirm('⚠️ XOÁ TẤT CẢ check-in?\nDùng để reset sau khi test. KHÔNG xoá danh sách nhân viên. Hành động không thể hoàn tác.')) return;
  if (!confirm('Chắc chắn xoá HẾT check-in chứ? Bấm OK để xác nhận lần cuối.')) return;
  const res = await fetch('/api/admin/checkins', { method: 'DELETE', headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Lỗi'); return; }
  alert(`Đã xoá ${data.deleted} check-in. Mọi người có thể check-in lại.`);
  loadAll();
});

// Modal xem ảnh + nút xoá check-in (delegation)
document.addEventListener('click', (e) => {
  const del = e.target.closest('.btn-del-checkin');
  if (del) { delCheckin(del.dataset.id, decodeURIComponent(del.dataset.name || '')); return; }
  if (e.target.classList.contains('thumb')) {
    $('modal-img-el').src = e.target.dataset.full;
    $('modal').classList.add('show');
  } else if (e.target.id === 'modal') {
    $('modal').classList.remove('show');
  }
});
