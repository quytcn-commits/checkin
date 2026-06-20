'use strict';

const state = {
  cccd: '',
  name: '',
  photoDataUrl: null,
  lat: null,
  lng: null,
  accuracy: null,
  facing: 'environment',
  stream: null,
};

const $ = (id) => document.getElementById(id);
function showMsg(el, type, text) {
  el.className = 'msg show ' + type;
  el.innerHTML = text;
}
function hideMsg(el) { el.className = 'msg'; }
function setDot(i) {
  document.querySelectorAll('.dot').forEach((d, idx) => d.classList.toggle('active', idx <= i));
}
function goStep(name) {
  ['step-cccd', 'step-photo', 'step-submit', 'step-done'].forEach((s) => $(s).classList.add('hidden'));
  $(name).classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Tải tên sự kiện
fetch('/api/config').then((r) => r.json()).then((c) => {
  $('eventName').textContent = c.eventName;
  document.title = 'Check-in · ' + c.eventName;
  state.geofenceEnabled = c.geofenceEnabled;
  if (!c.checkinOpen) {
    showMsg($('msg-cccd'), 'info', '⏰ ' + (c.checkinMessage || 'Hiện chưa mở check-in.'));
    $('btn-verify').disabled = true;
  }
}).catch(() => {});

// ---------- Bước 1: xác minh CCCD ----------
$('btn-verify').addEventListener('click', async () => {
  const cccd = $('cccd').value.replace(/\D/g, '');
  const consent = $('consent').checked;
  hideMsg($('msg-cccd'));
  if (!/^(\d{9}|\d{12})$/.test(cccd)) {
    return showMsg($('msg-cccd'), 'err', 'Số CCCD/CMND phải có 9 hoặc 12 chữ số.');
  }
  if (!consent) {
    return showMsg($('msg-cccd'), 'err', 'Vui lòng tích vào ô đồng ý điều khoản.');
  }
  const btn = $('btn-verify');
  btn.disabled = true; btn.textContent = 'Đang kiểm tra...';
  try {
    const res = await fetch('/api/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cccd }),
    });
    const data = await res.json();
    if (!data.ok) return showMsg($('msg-cccd'), 'err', data.error || 'Không xác minh được.');
    state.cccd = cccd;
    state.name = data.name;
    $('hello').innerHTML = `Xin chào <b>${data.name}</b>${data.department ? ' · ' + data.department : ''}. Hãy đứng trước backdrop và chụp ảnh nhé!`;
    setDot(1);
    goStep('step-photo');
    startCamera();
  } catch (e) {
    showMsg($('msg-cccd'), 'err', 'Lỗi kết nối, thử lại.');
  } finally {
    btn.disabled = false; btn.textContent = 'Tiếp tục';
  }
});

// ---------- Bước 2: camera ----------
async function startCamera() {
  stopCamera();
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: state.facing, width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: false,
    });
    $('video').srcObject = state.stream;
    $('video').classList.remove('hidden');
    $('preview').classList.add('hidden');
  } catch (e) {
    showMsg($('msg-photo'), 'err', 'Không mở được camera. Vui lòng cấp quyền camera cho trình duyệt rồi tải lại trang.');
  }
}
function stopCamera() {
  if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; }
}

$('btn-switch').addEventListener('click', () => {
  state.facing = state.facing === 'environment' ? 'user' : 'environment';
  startCamera();
});

$('btn-capture').addEventListener('click', () => {
  const video = $('video');
  if (!video.videoWidth) return;
  const maxW = 1080;
  const scale = Math.min(1, maxW / video.videoWidth);
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);
  const canvas = $('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(video, 0, 0, w, h);
  state.photoDataUrl = canvas.toDataURL('image/jpeg', 0.75);
  $('preview').src = state.photoDataUrl;
  $('preview').classList.remove('hidden');
  $('video').classList.add('hidden');
  stopCamera();
  $('btn-capture').classList.add('hidden');
  $('btn-switch').classList.add('hidden');
  $('btn-retake').classList.remove('hidden');
  // tự chuyển sang bước gửi sau 600ms
  setTimeout(() => {
    $('preview2').src = state.photoDataUrl;
    $('preview2').classList.remove('hidden');
    setDot(2);
    goStep('step-submit');
    getGps();
  }, 700);
});

$('btn-retake').addEventListener('click', () => {
  state.photoDataUrl = null;
  $('btn-capture').classList.remove('hidden');
  $('btn-switch').classList.remove('hidden');
  $('btn-retake').classList.add('hidden');
  startCamera();
});

// ---------- Bước 3: GPS + gửi ----------
function getGps() {
  if (!navigator.geolocation) {
    showMsg($('gps-status'), 'err', 'Thiết bị không hỗ trợ GPS. Vẫn có thể gửi nhưng có thể không hợp lệ cho quay số.');
    $('btn-submit').disabled = false;
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.lat = pos.coords.latitude;
      state.lng = pos.coords.longitude;
      state.accuracy = pos.coords.accuracy;
      showMsg($('gps-status'), 'ok', `📍 Đã lấy vị trí (sai số ~${Math.round(pos.coords.accuracy)}m).`);
      $('btn-submit').disabled = false;
    },
    (err) => {
      showMsg($('gps-status'), 'err', 'Không lấy được GPS (' + err.message + '). Hãy bật Vị trí/Location rồi thử lại. Bạn vẫn có thể gửi.');
      $('btn-submit').disabled = false;
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
}

$('btn-submit').addEventListener('click', async () => {
  const btn = $('btn-submit');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Đang gửi...';
  hideMsg($('msg-submit'));
  const deviceInfo = {
    ua: navigator.userAgent,
    platform: navigator.platform,
    lang: navigator.language,
    screen: `${screen.width}x${screen.height}`,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  try {
    const res = await fetch('/api/checkin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cccd: state.cccd, photo: state.photoDataUrl,
        lat: state.lat, lng: state.lng, accuracy: state.accuracy,
        consent: true, deviceInfo,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      btn.disabled = false; btn.textContent = 'Gửi check-in';
      return showMsg($('msg-submit'), 'err', data.error || 'Gửi thất bại.');
    }
    $('done-icon').textContent = data.isValid ? '✅' : '⚠️';
    $('done-title').textContent = data.isValid ? 'Check-in thành công!' : 'Đã ghi nhận check-in';
    $('done-msg').innerHTML = `<b>${data.name}</b><br>${data.message}`;
    goStep('step-done');
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Gửi check-in';
    showMsg($('msg-submit'), 'err', 'Lỗi kết nối, thử lại.');
  }
});

// Cho phép Enter ở ô CCCD
$('cccd').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-verify').click(); });
