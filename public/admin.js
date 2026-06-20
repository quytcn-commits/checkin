'use strict';
const $ = (id) => document.getElementById(id);
let PW = localStorage.getItem('admin_pw') || '';
let ALL = [];

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
}

async function loadAll() {
  const [stats, rows] = await Promise.all([
    fetch('/api/admin/stats', { headers: authHeaders() }).then((r) => r.json()),
    fetch('/api/admin/checkins', { headers: authHeaders() }).then((r) => r.json()),
  ]);
  $('s-emp').textContent = stats.totalEmp;
  $('s-checkin').textContent = stats.totalCheckin;
  $('s-valid').textContent = stats.validCheckin;
  $('s-winner').textContent = stats.winners;
  ALL = rows;
  render();
}

function render() {
  const q = $('search').value.trim().toLowerCase();
  const tbody = $('tbody');
  const rows = ALL.filter((r) =>
    !q || (r.name || '').toLowerCase().includes(q) ||
    (r.department || '').toLowerCase().includes(q) ||
    (r.cccd_last4 || '').includes(q)
  );
  tbody.innerHTML = rows.map((r) => {
    let dev = '';
    try { const d = JSON.parse(r.device_info || '{}'); dev = (d.platform || '') + ' · ' + (d.screen || ''); } catch (e) {}
    const photo = r.photo_path
      ? `<img class="thumb" src="/uploads/${r.photo_path}" data-full="/uploads/${r.photo_path}" />`
      : '—';
    const gps = r.lat != null
      ? `<a href="https://maps.google.com/?q=${r.lat},${r.lng}" target="_blank" style="color:var(--accent2)">${r.gps_valid ? '✅' : '📍'} bản đồ</a><br><span class="small">±${Math.round(r.gps_accuracy || 0)}m</span>`
      : '—';
    return `<tr>
      <td>${r.id}</td>
      <td>${photo}</td>
      <td>${r.name || ''}</td>
      <td>${r.department || ''}</td>
      <td>****${r.cccd_last4 || ''}</td>
      <td>${(r.checkin_time || '').replace('T', ' ')}</td>
      <td>${gps}</td>
      <td class="small">${r.ip || ''}</td>
      <td class="small">${dev}</td>
      <td><span class="pill ${r.is_valid ? 'ok' : 'no'}">${r.is_valid ? 'Hợp lệ' : 'Không'}</span></td>
    </tr>`;
  }).join('');
}

$('search').addEventListener('input', render);
$('btn-refresh').addEventListener('click', loadAll);

$('btn-export').addEventListener('click', () => {
  window.location = '/api/admin/export?pw=' + encodeURIComponent(PW);
});

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

// Import Excel (.xlsx) - đọc file thành base64 gửi server
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
  $('import-msg').className = 'msg show ok';
  $('import-msg').innerHTML = `Đã import <b>${data.added}</b> nhân viên từ sheet "<b>${data.sheet}</b>" · Bỏ qua nghỉ việc: ${data.skippedInactive} · CCCD lỗi: ${data.skippedInvalid} · Tổng: <b>${data.total}</b>`;
  e.target.value = '';
  loadAll();
});

// Modal xem ảnh
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('thumb')) {
    $('modal-img-el').src = e.target.dataset.full;
    $('modal').classList.add('show');
  } else if (e.target.id === 'modal') {
    $('modal').classList.remove('show');
  }
});
