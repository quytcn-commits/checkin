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
  geofenceEnabled: false,
  gpsAsked: false,
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

// Phát hiện trình duyệt in-app (Zalo/FB/...) — hay chặn GPS trên iOS
function isInAppBrowser() {
  return /Zalo|FBAN|FBAV|FB_IAB|Instagram|Line\/|Messenger|TikTok|MicroMessenger|GSA/i.test(navigator.userAgent || '');
}
function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
if (isInAppBrowser()) {
  if (isIOS()) {
    $('ios-banner-text').innerHTML = '⚠️ Bạn đang mở trong <b>Zalo/Facebook</b>. iOS chặn quyền Vị trí ở đây — hãy bấm <b>•••</b> góc dưới phải → <b>"Mở bằng Safari"</b> để check-in chuẩn.';
  }
  $('ios-banner').classList.remove('hidden');
}
$('ios-banner-x').addEventListener('click', () => $('ios-banner').classList.add('hidden'));

// Tải tên sự kiện
fetch('/api/config').then((r) => r.json()).then((c) => {
  $('eventName').textContent = c.eventName;
  document.title = 'Check-in · ' + c.eventName;
  state.geofenceEnabled = !!c.geofenceEnabled;
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
    if (state.geofenceEnabled && (typeof state.lat !== 'number' || typeof state.lng !== 'number')) {
      $('btn-start-gps').classList.remove('hidden');
      $('btn-capture').classList.add('hidden');
      $('btn-switch').classList.add('hidden');
      showMsg($('msg-photo'), 'info', 'Bấm "Bật vị trí GPS" và chọn Cho phép để tiếp tục chụp ảnh.');
    } else {
      startCamera();
    }
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
    // Camera trước (selfie): soi gương cho tự nhiên, dễ canh; camera sau giữ nguyên
    $('video').style.transform = state.facing === 'user' ? 'scaleX(-1)' : 'none';
    $('video').classList.remove('hidden');
    $('preview').classList.add('hidden');
    $('btn-start-gps').classList.add('hidden');
    $('btn-capture').classList.remove('hidden');
    $('btn-switch').classList.remove('hidden');
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

$('btn-start-gps').addEventListener('click', () => {
  state.gpsAsked = true;
  $('btn-start-gps').classList.add('hidden');
  getGps({
    statusEl: $('msg-photo'),
    manageSubmit: false,
    onSuccess: () => {
      hideMsg($('msg-photo'));
      startCamera();
    },
    onError: () => {
      $('btn-start-gps').classList.remove('hidden');
    },
  });
});

$('btn-capture').addEventListener('click', () => {
  const video = $('video');
  if (!video.videoWidth) return;
  // QUAN TRỌNG: xin GPS NGAY trong cú chạm này (user gesture). iOS 12.2+ chỉ hiện
  // popup quyền vị trí khi được kích hoạt bởi gesture — gọi trong setTimeout sẽ bị bỏ qua.
  if (!state.gpsAsked) { state.gpsAsked = true; getGps(); }
  const maxW = 1080;
  const scale = Math.min(1, maxW / video.videoWidth);
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);
  const canvas = $('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  // Camera trước: lật ngang khi chụp để ảnh khớp với những gì người dùng thấy (đã soi gương)
  if (state.facing === 'user') { ctx.translate(w, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0, w, h);
  state.photoDataUrl = canvas.toDataURL('image/jpeg', 0.75);
  $('preview').src = state.photoDataUrl;
  $('preview').classList.remove('hidden');
  $('video').classList.add('hidden');
  stopCamera();
  $('btn-capture').classList.add('hidden');
  $('btn-switch').classList.add('hidden');
  $('btn-retake').classList.remove('hidden');
  // tự chuyển sang bước gửi sau 600ms (GPS đã được xin ở trên, trong gesture)
  setTimeout(() => {
    $('preview2').src = state.photoDataUrl;
    $('preview2').classList.remove('hidden');
    setDot(2);
    goStep('step-submit');
    refreshSubmitGps();
  }, 700);
});

// Cập nhật ô GPS + nút gửi ở bước 3 theo trạng thái hiện có (GPS có thể đã lấy
// từ bước "Bật vị trí GPS" trước camera, hoặc đang lấy nền khi geofence tắt).
function refreshSubmitGps() {
  const hasGps = typeof state.lat === 'number' && typeof state.lng === 'number';
  if (hasGps) {
    showMsg($('gps-status'), 'ok', `📍 Đã lấy vị trí (sai số ~${Math.round(state.accuracy || 0)}m).`);
    $('btn-gps-retry').classList.add('hidden');
    $('btn-submit').disabled = false;
  } else if (!state.geofenceEnabled) {
    showMsg($('gps-status'), 'info', 'GPS không bắt buộc — bạn có thể bấm "Gửi check-in".');
    $('btn-submit').disabled = false;
  } else {
    showMsg($('gps-status'), 'err', 'Chưa có vị trí GPS. Bấm "Thử lấy lại vị trí" và chọn Cho phép để check-in hợp lệ.');
    $('btn-gps-retry').classList.remove('hidden');
    $('btn-submit').disabled = true;
  }
}

$('btn-retake').addEventListener('click', () => {
  state.photoDataUrl = null;
  $('btn-capture').classList.remove('hidden');
  $('btn-switch').classList.remove('hidden');
  $('btn-retake').classList.add('hidden');
  startCamera();
});

// ---------- Bước 3: GPS + gửi ----------
function getGps(options = {}) {
  const statusEl = options.statusEl || $('gps-status');
  const manageSubmit = options.manageSubmit !== false;
  if (manageSubmit) $('btn-gps-retry').classList.add('hidden');
  // geofence tắt -> GPS không bắt buộc: cho gửi ngay, lấy GPS nền để lưu nếu được
  const optional = !state.geofenceEnabled;
  if (manageSubmit) $('btn-submit').disabled = !optional;

  if (!navigator.geolocation) {
    showMsg(statusEl, optional ? 'info' : 'err',
      optional ? 'GPS không bắt buộc — bạn có thể bấm "Gửi check-in".' : 'Thiết bị không hỗ trợ GPS.');
    if (manageSubmit) $('btn-submit').disabled = !optional;
    if (options.onError) options.onError();
    return;
  }
  showMsg(statusEl, 'info',
    `<span class="spinner"></span> Đang lấy vị trí GPS${optional ? ' (không bắt buộc, có thể gửi luôn)' : ''}...`);
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.lat = pos.coords.latitude;
      state.lng = pos.coords.longitude;
      state.accuracy = pos.coords.accuracy;
      showMsg(statusEl, 'ok', `📍 Đã lấy vị trí (sai số ~${Math.round(pos.coords.accuracy)}m).`);
      if (manageSubmit) $('btn-submit').disabled = false;
      if (options.onSuccess) options.onSuccess(pos);
    },
    (err) => {
      const inApp = isInAppBrowser();
      let reason = '';
      if (err.code === 1) { // PERMISSION_DENIED
        reason = inApp
          ? 'Trình duyệt trong Zalo/Facebook chặn vị trí — hãy <b>mở bằng Safari</b> (••• → Mở bằng Safari).'
          : 'Quyền vị trí bị tắt. Bật lại: <b>Cài đặt → Quyền riêng tư & Bảo mật → Dịch vụ định vị → Safari → "Khi dùng app"</b>; hoặc trên thanh địa chỉ bấm <b>"ᴀA" → Cài đặt trang → Vị trí → Cho phép</b>, rồi bấm "Thử lấy lại vị trí".';
      } else if (err.code === 3) { // TIMEOUT
        reason = 'Lấy vị trí quá lâu (sóng yếu). Bấm "Thử lấy lại vị trí".';
      } else { // POSITION_UNAVAILABLE
        reason = 'Không xác định được vị trí lúc này. Bấm "Thử lấy lại vị trí".';
      }
      const tail = optional
        ? '<br>👉 GPS không bắt buộc — bạn <b>cứ bấm "Gửi check-in"</b> là xong.'
        : '<br>👉 Cần có GPS để check-in hợp lệ. Vui lòng mở bằng Safari/Chrome, cấp quyền Vị trí, rồi bấm "Thử lấy lại vị trí".';
      showMsg(statusEl, optional ? 'info' : 'err', reason + tail);
      if (manageSubmit) {
        $('btn-gps-retry').classList.remove('hidden');
        $('btn-submit').disabled = !optional;
      }
      if (options.onError) options.onError(err);
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
}

$('btn-gps-retry').addEventListener('click', getGps);

$('btn-submit').addEventListener('click', async () => {
  const btn = $('btn-submit');
  if (state.geofenceEnabled && (typeof state.lat !== 'number' || typeof state.lng !== 'number')) {
    btn.disabled = true;
    $('btn-gps-retry').classList.remove('hidden');
    return showMsg($('msg-submit'), 'err', 'Chưa có GPS nên chưa thể gửi check-in. Hãy cấp quyền Vị trí và thử lấy lại.');
  }
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
