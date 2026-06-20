'use strict';
const $ = (id) => document.getElementById(id);
let PW = localStorage.getItem('admin_pw') || '';
let page = 1, search = '', editingId = null, pages = 1, dept = '', checked = '', ROWS = [];

function authHeaders() { return { 'x-admin-password': PW, 'Content-Type': 'application/json' }; }
async function tryLogin(pw) {
  const res = await fetch('/api/admin/employees?limit=1', { headers: { 'x-admin-password': pw } });
  return res.ok;
}

(async () => { if (PW && (await tryLogin(PW))) showDash(); })();

$('btn-login').addEventListener('click', async () => {
  const pw = $('pw').value;
  if (await tryLogin(pw)) { PW = pw; localStorage.setItem('admin_pw', pw); showDash(); }
  else { $('login-msg').className = 'msg show err'; $('login-msg').textContent = 'Sai mật khẩu.'; }
});
$('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-login').click(); });

function showDash() {
  $('login').classList.add('hidden');
  $('dash').classList.remove('hidden');
  loadDepartments();
  load();
}

async function loadDepartments() {
  const rows = await fetch('/api/admin/departments', { headers: authHeaders() }).then((r) => r.json());
  $('f-dept').innerHTML = '<option value="">📁 Tất cả phòng ban</option>' +
    rows.map((d) => `<option value="${esc(d.name)}">${esc(d.name)} (${d.c})</option>`).join('');
}

async function load() {
  const params = new URLSearchParams({ search, page, limit: 20 });
  if (dept) params.set('department', dept);
  if (checked) params.set('checked', checked);
  const data = await fetch('/api/admin/employees?' + params, { headers: authHeaders() }).then((r) => r.json());
  pages = data.pages || 1;
  $('count').textContent = `(${data.total})`;
  ROWS = data.rows;
  $('list').innerHTML = data.rows.map((e) => `
    <div class="emp">
      <div class="top">
        <span class="name">${esc(e.name)}</span>
        ${e.checked ? '<span class="tag-checked">Đã check-in</span>' : ''}
      </div>
      <div class="cccd">CCCD: ${esc(e.cccd)}</div>
      <div class="meta">${e.department ? 'Phòng ban: <b>' + esc(e.department) + '</b>' : ''}${e.emp_code ? ' · Mã: <b>' + esc(e.emp_code) + '</b>' : ''}</div>
      <div class="acts">
        <button class="btn-sm btn-edit" onclick="editEmp(${e.id})">✏️ Sửa</button>
        <button class="btn-sm btn-del" onclick="delEmp(${e.id})">🗑️ Xoá</button>
      </div>
    </div>`).join('') || '<div class="emp">Không có nhân viên nào.</div>';
  renderPager();
}

function renderPager() {
  $('pager').innerHTML = `
    <button ${page <= 1 ? 'disabled' : ''} onclick="goPage(${page - 1})">← Trước</button>
    <span>Trang ${page} / ${pages}</span>
    <button ${page >= pages ? 'disabled' : ''} onclick="goPage(${page + 1})">Sau →</button>`;
}
window.goPage = (p) => { page = Math.max(1, Math.min(pages, p)); load(); };

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

let searchTimer;
$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { search = $('search').value.trim(); page = 1; load(); }, 300);
});

// Lọc theo phòng ban
$('f-dept').addEventListener('change', () => { dept = $('f-dept').value; page = 1; load(); });

// Lọc theo trạng thái check-in
$('f-checked').querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => {
    $('f-checked').querySelectorAll('button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    checked = b.dataset.v; page = 1; load();
  });
});

// Xoá toàn bộ bộ lọc
$('btn-clear').addEventListener('click', () => {
  search = ''; dept = ''; checked = ''; page = 1;
  $('search').value = ''; $('f-dept').value = '';
  $('f-checked').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.v === ''));
  load();
});

// ===== Modal =====
function openModal(emp) {
  editingId = emp ? emp.id : null;
  $('modal-title').textContent = emp ? 'Sửa nhân viên' : 'Thêm nhân viên';
  $('f-name').value = emp ? emp.name : '';
  $('f-cccd').value = emp ? emp.cccd : '';
  $('f-dept').value = emp ? (emp.department || '') : '';
  $('f-code').value = emp ? (emp.emp_code || '') : '';
  $('modal-msg').className = 'msg';
  $('modal').classList.add('show');
}
window.editEmp = (id) => { const e = ROWS.find((x) => x.id === id); if (e) openModal(e); };
$('btn-add').addEventListener('click', () => openModal(null));
$('btn-cancel').addEventListener('click', () => $('modal').classList.remove('show'));
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('modal').classList.remove('show'); });

$('btn-save').addEventListener('click', async () => {
  const body = {
    name: $('f-name').value.trim(),
    cccd: $('f-cccd').value.trim(),
    department: $('f-dept').value.trim(),
    emp_code: $('f-code').value.trim(),
  };
  const url = editingId ? '/api/admin/employees/' + editingId : '/api/admin/employees';
  const method = editingId ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { $('modal-msg').className = 'msg show err'; $('modal-msg').textContent = data.error || 'Lưu thất bại'; return; }
  $('modal').classList.remove('show');
  load();
});

window.delEmp = async (id) => {
  const e = ROWS.find((x) => x.id === id);
  const name = e ? e.name : '';
  if (!confirm('Xoá nhân viên "' + name + '"?')) return;
  const res = await fetch('/api/admin/employees/' + id, { method: 'DELETE', headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Xoá thất bại'); return; }
  load();
};
