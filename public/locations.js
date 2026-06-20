'use strict';
const $ = (id) => document.getElementById(id);
let PW = localStorage.getItem('admin_pw') || '';
let editingId = null;

function authHeaders() { return { 'x-admin-password': PW, 'Content-Type': 'application/json' }; }
async function tryLogin(pw) {
  const res = await fetch('/api/admin/events', { headers: { 'x-admin-password': pw } });
  return res.ok;
}
(async () => { if (PW && (await tryLogin(PW))) showDash(); })();

$('btn-login').addEventListener('click', async () => {
  const pw = $('pw').value;
  if (await tryLogin(pw)) { PW = pw; localStorage.setItem('admin_pw', pw); showDash(); }
  else { $('login-msg').className = 'msg show err'; $('login-msg').textContent = 'Sai mật khẩu.'; }
});
$('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-login').click(); });

function showDash() { $('login').classList.add('hidden'); $('dash').classList.remove('hidden'); load(); }

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(ms) { return ms ? new Date(ms).toLocaleString('vi-VN') : '—'; }
function msToLocal(ms) {
  if (!ms) return '';
  const d = new Date(ms); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

let EVENTS = [];
async function load() {
  EVENTS = await fetch('/api/admin/events', { headers: authHeaders() }).then((r) => r.json());
  $('list').innerHTML = EVENTS.map((e) => `
    <div class="emp">
      <div class="top"><span class="name">${esc(e.name)}</span>
        <span class="tag-checked" style="background:#e6f0fb;color:#1565c0">${e.checkins} lượt · ${e.valid_people} người hợp lệ</span></div>
      <div class="meta">⏰ ${e.window_enabled ? (fmt(e.start_ms) + ' → ' + fmt(e.end_ms)) : 'Không giới hạn giờ'}</div>
      <div class="meta">📍 ${e.geofence_enabled ? (`${e.lat}, ${e.lng} · bán kính ${e.radius}m`) : 'Không giới hạn vị trí'}</div>
      <div class="acts">
        <button class="btn-sm btn-edit" onclick="editEv(${e.id})">✏️ Sửa</button>
        <button class="btn-sm btn-del" onclick="delEv(${e.id})">🗑️ Xoá</button>
      </div>
    </div>`).join('') || '<div class="emp">Chưa có địa điểm nào. Bấm "Thêm địa điểm" để tạo (vd Hà Nội, HCM).</div>';
}

function openModal(e) {
  editingId = e ? e.id : null;
  $('modal-title').textContent = e ? 'Sửa địa điểm' : 'Thêm địa điểm';
  $('f-name').value = e ? e.name : '';
  $('f-win').checked = e ? !!e.window_enabled : true;
  $('f-start').value = e ? msToLocal(e.start_ms) : '';
  $('f-end').value = e ? msToLocal(e.end_ms) : '';
  $('f-geo').checked = e ? !!e.geofence_enabled : false;
  $('f-lat').value = e && e.lat != null ? e.lat : '';
  $('f-lng').value = e && e.lng != null ? e.lng : '';
  $('f-radius').value = e && e.radius != null ? e.radius : 300;
  $('f-maps').value = '';
  $('maps-msg').textContent = '';
  $('here-msg').textContent = '';
  $('modal-msg').className = 'msg';
  $('modal').classList.add('show');
}
window.editEv = (id) => { const e = EVENTS.find((x) => x.id === id); if (e) openModal(e); };
$('btn-add').addEventListener('click', () => openModal(null));
$('btn-cancel').addEventListener('click', () => $('modal').classList.remove('show'));
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('modal').classList.remove('show'); });

// Trích vĩ độ/kinh độ từ link Google Maps hoặc chuỗi "lat, lng"
function parseLatLng(text) {
  if (!text) return null;
  text = text.trim();
  let m = text.match(/^(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);            // "lat, lng"
  if (m) return { lat: +m[1], lng: +m[2] };
  m = text.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);                   // địa điểm chính xác trong URL
  if (m) return { lat: +m[1], lng: +m[2] };
  m = text.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);                       // tâm bản đồ @lat,lng
  if (m) return { lat: +m[1], lng: +m[2] };
  m = text.match(/[?&](?:q|query|ll|center|destination)=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/); // ?q=lat,lng
  if (m) return { lat: +m[1], lng: +m[2] };
  m = text.match(/(-?\d{1,3}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})/);              // 2 số thập phân bất kỳ
  if (m) return { lat: +m[1], lng: +m[2] };
  return null;
}

function applyCoord(c, src) {
  $('f-lat').value = c.lat;
  $('f-lng').value = c.lng;
  $('f-geo').checked = true;
  $('maps-msg').textContent = `✅ Đã lấy: ${c.lat}, ${c.lng}${src ? ' (' + src + ')' : ''}`;
}

async function doParseMaps() {
  const txt = $('f-maps').value.trim();
  if (!txt) { $('maps-msg').textContent = ''; return; }
  const c = parseLatLng(txt);
  if (c) { applyCoord(c); return; }
  // Link rút gọn (maps.app.goo.gl / goo.gl) -> nhờ server mở ra lấy toạ độ
  if (/^https?:\/\//i.test(txt) && /goo\.gl|maps\.app/i.test(txt)) {
    $('maps-msg').textContent = 'Đang mở link rút gọn...';
    try {
      const res = await fetch('/api/admin/resolve-maps', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ url: txt }) });
      const data = await res.json();
      if (res.ok && data.lat != null) { applyCoord(data, 'từ link'); return; }
      $('maps-msg').textContent = data.error || 'Không lấy được toạ độ. Hãy mở link rồi copy phần "@vĩ độ,kinh độ".';
    } catch (e) { $('maps-msg').textContent = 'Lỗi kết nối khi mở link.'; }
    return;
  }
  $('maps-msg').textContent = '⚠️ Không nhận ra toạ độ. Dán link đầy đủ (có @...) hoặc "vĩ độ, kinh độ".';
}
$('btn-parse').addEventListener('click', doParseMaps);
$('f-maps').addEventListener('paste', () => setTimeout(doParseMaps, 50));

$('btn-here').addEventListener('click', () => {
  if (!navigator.geolocation) { $('here-msg').textContent = 'Thiết bị không hỗ trợ GPS.'; return; }
  $('here-msg').textContent = 'Đang lấy vị trí...';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      $('f-lat').value = pos.coords.latitude.toFixed(6);
      $('f-lng').value = pos.coords.longitude.toFixed(6);
      $('f-geo').checked = true;
      $('here-msg').textContent = `Đã lấy vị trí (±${Math.round(pos.coords.accuracy)}m).`;
    },
    (err) => { $('here-msg').textContent = 'Không lấy được GPS: ' + err.message; },
    { enableHighAccuracy: true, timeout: 12000 }
  );
});

$('btn-save').addEventListener('click', async () => {
  const startV = $('f-start').value, endV = $('f-end').value;
  const body = {
    name: $('f-name').value.trim(),
    window_enabled: $('f-win').checked,
    start_ms: startV ? new Date(startV).getTime() : 0,
    end_ms: endV ? new Date(endV).getTime() : 0,
    geofence_enabled: $('f-geo').checked,
    lat: parseFloat($('f-lat').value) || null,
    lng: parseFloat($('f-lng').value) || null,
    radius: parseFloat($('f-radius').value) || 300,
    active: true,
  };
  if (!body.name) { $('modal-msg').className = 'msg show err'; $('modal-msg').textContent = 'Nhập tên địa điểm.'; return; }
  if (body.window_enabled && body.start_ms && body.end_ms && body.end_ms <= body.start_ms) {
    $('modal-msg').className = 'msg show err'; $('modal-msg').textContent = 'Giờ kết thúc phải sau giờ bắt đầu.'; return;
  }
  const url = editingId ? '/api/admin/events/' + editingId : '/api/admin/events';
  const res = await fetch(url, { method: editingId ? 'PUT' : 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { $('modal-msg').className = 'msg show err'; $('modal-msg').textContent = data.error || 'Lưu thất bại'; return; }
  $('modal').classList.remove('show');
  load();
});

window.delEv = async (id) => {
  const e = EVENTS.find((x) => x.id === id);
  const name = e ? e.name : '';
  if (!confirm(`Xoá địa điểm "${name}"?\nCác check-in đã gắn sẽ được gỡ khỏi địa điểm này (không xoá check-in).`)) return;
  const res = await fetch('/api/admin/events/' + id, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) { alert('Xoá thất bại'); return; }
  load();
};
