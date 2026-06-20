'use strict';
const $ = (id) => document.getElementById(id);
let PW = localStorage.getItem('admin_pw') || '';
let POOL = [];
let spinning = false;

function authHeaders() { return { 'x-admin-password': PW, 'Content-Type': 'application/json' }; }
async function check(pw) {
  const res = await fetch('/api/draw/pool', { headers: { 'x-admin-password': pw } });
  return res.ok;
}

(async () => { if (PW && (await check(PW))) enter(); })();

$('btn-login').addEventListener('click', async () => {
  const pw = $('pw').value;
  if (await check(pw)) { PW = pw; localStorage.setItem('admin_pw', pw); enter(); }
  else { $('login-msg').className = 'msg show err'; $('login-msg').textContent = 'Sai mật khẩu.'; }
});
$('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-login').click(); });

function enter() {
  $('login').classList.add('hidden');
  $('stage').classList.remove('hidden');
  loadPool();
  loadWinners();
}

async function loadPool() {
  POOL = await fetch('/api/draw/pool', { headers: authHeaders() }).then((r) => r.json());
  $('pool-info').textContent = `Còn ${POOL.length} người hợp lệ chưa trúng`;
}
async function loadWinners() {
  const winners = await fetch('/api/draw/winners', { headers: authHeaders() }).then((r) => r.json());
  $('winners').innerHTML = '<div class="small" style="color:var(--muted);margin-bottom:6px">🏆 Đã trúng (' + winners.length + ')</div>' +
    winners.map((w) => `<div class="w"><b>${w.name}</b>${w.prize ? ' · ' + w.prize : ''}<br><span class="small">${w.department || ''}</span></div>`).join('');
}

$('btn-reload').addEventListener('click', () => { loadPool(); loadWinners(); });

$('btn-spin').addEventListener('click', async () => {
  if (spinning) return;
  if (POOL.length === 0) { await loadPool(); if (POOL.length === 0) { alert('Không còn người hợp lệ để quay.'); return; } }
  spinning = true;
  $('btn-spin').disabled = true;
  $('winner-photo').classList.add('hidden');
  $('prize-label').textContent = $('prize').value || '';

  // Hiệu ứng cuộn tên
  const start = performance.now();
  const duration = 2600;
  const nameEl = $('name'), deptEl = $('dept');
  function frame(now) {
    const t = now - start;
    const r = POOL[Math.floor(Math.random() * POOL.length)];
    nameEl.textContent = r.name;
    deptEl.textContent = r.department || '';
    if (t < duration) {
      const delay = 40 + (t / duration) * 180; // chậm dần
      setTimeout(() => requestAnimationFrame(frame), delay);
    } else {
      finalize();
    }
  }
  requestAnimationFrame(frame);

  async function finalize() {
    try {
      const res = await fetch('/api/draw/spin', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ prize: $('prize').value || '' }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'Lỗi quay số'); spinning = false; $('btn-spin').disabled = false; return; }
      const w = data.winner;
      $('name').textContent = '🎉 ' + w.name + ' 🎉';
      $('dept').textContent = w.department || '';
      if (w.photo_path) {
        $('winner-photo').src = '/uploads/' + w.photo_path;
        $('winner-photo').classList.remove('hidden');
      }
      confettiBurst();
      await loadPool();
      await loadWinners();
    } catch (e) {
      alert('Lỗi kết nối');
    } finally {
      spinning = false;
      $('btn-spin').disabled = false;
    }
  }
});

// Confetti đơn giản
function confettiBurst() {
  const colors = ['#ffb020', '#6c5ce7', '#1bbf7a', '#ff5470', '#ffffff'];
  for (let i = 0; i < 80; i++) {
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;top:-10px;left:${Math.random() * 100}vw;width:9px;height:9px;background:${colors[i % colors.length]};z-index:99;pointer-events:none;border-radius:2px;`;
    document.body.appendChild(d);
    const fall = 1500 + Math.random() * 1500;
    const x = (Math.random() - 0.5) * 200;
    d.animate(
      [{ transform: 'translate(0,0) rotate(0)', opacity: 1 },
       { transform: `translate(${x}px, ${window.innerHeight + 40}px) rotate(${Math.random() * 720}deg)`, opacity: 1 }],
      { duration: fall, easing: 'ease-in' }
    ).onfinish = () => d.remove();
  }
}
