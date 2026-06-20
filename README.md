# Web Check-in Sự kiện + Lucky Draw

Luồng: **Quét QR → web check-in → nhập CCCD (đối chiếu danh sách nhân viên) → chụp ảnh tại backdrop → lưu thời gian/GPS/IP/thiết bị → chỉ người check-in hợp lệ mới vào quay số may mắn.**

Stack: Node.js + Express + better-sqlite3 + frontend thuần (không cần build). Phù hợp sự kiện 500–700 người.

---

## 1. Cài đặt

```bash
cd d:/nhatquy/checkin
npm install
cp .env.example .env      # rồi mở .env đổi mật khẩu, tên sự kiện, salt
```

> Windows PowerShell: dùng `Copy-Item .env.example .env`

## 2. Import danh sách nhân viên

File CSV cần cột: `cccd,name,department,emp_code` (xem `employees.sample.csv`).

Hai cách:
- **Qua web:** vào `/admin.html` → nút **Import nhân viên (CSV)**.
- **Qua CLI:** `node scripts/import-employees.js employees.sample.csv`

## 3. Chạy server

```bash
npm start
```

Mở:
- Check-in (QR trỏ về đây): `http://localhost:3000/`
- Quản trị: `http://localhost:3000/admin.html`
- Quay số: `http://localhost:3000/draw.html`

## 4. Đưa lên Internet để quét QR (BẮT BUỘC HTTPS)

Camera + GPS chỉ chạy trên **HTTPS** (hoặc localhost). Trong sự kiện, điện thoại khách quét QR phải vào qua domain HTTPS. Cách nhanh nhất:

**Cloudflare Tunnel (miễn phí, không cần mở port):**
```bash
# cài cloudflared, rồi:
cloudflared tunnel --url http://localhost:3000
```
Lệnh này in ra 1 URL dạng `https://xxxx.trycloudflare.com` → tạo QR từ URL này (dùng bất kỳ trang tạo QR nào) → in lên backdrop/standee.

Cách khác: `ngrok http 3000`, hoặc deploy lên 1 VPS có domain + SSL (Caddy/Nginx). Khuyến nghị chạy trên 1 server/VPS chạy liên tục thay vì serverless (vì lưu ảnh ra ổ đĩa + SQLite).

## 5. Geofence (giới hạn vị trí — chống check-in từ xa)

Trong `.env`:
```
GEOFENCE_ENABLED=true
GEOFENCE_LAT=...      # toạ độ địa điểm (Google Maps: chuột phải → toạ độ)
GEOFENCE_LNG=...
GEOFENCE_RADIUS=300   # mét
```
Khi bật: chỉ check-in trong bán kính mới được tính **hợp lệ** (mới vào quay số). GPS luôn được lưu dù bật/tắt.

## 6. Quay số

Vào `/draw.html` → nhập tên giải → bấm **QUAY**. Hệ thống chỉ chọn ngẫu nhiên trong số người **hợp lệ chưa trúng**, và tự loại người đã trúng. Có thể chiếu trang này lên màn hình lớn.

---

## Điều kiện "hợp lệ" để vào quay số
- Đã đồng ý điều khoản (consent)
- Có trong danh sách nhân viên (CCCD khớp)
- Có ảnh check-in
- Chưa check-in trước đó (1 nhân viên = 1 lần)
- Nếu bật geofence: GPS nằm trong bán kính

## Bảo mật & dữ liệu cá nhân (Nghị định 13/2023/NĐ-CP)
- CCCD **không lưu dạng đầy đủ**: chỉ lưu hash (SHA-256 + salt) và 4 số cuối.
- Có bước đồng ý (consent) trước khi thu thập.
- Ảnh + DB nằm trong thư mục `data/` (đã gitignore). **Xoá `data/` sau sự kiện** nếu không cần lưu.
- Đổi `ADMIN_PASSWORD` và `CCCD_SALT` trước khi dùng thật.

## 7. Deploy lên VPS bằng Docker (khuyến nghị)

Đã có sẵn: `Dockerfile`, `docker-compose.yml`, `Caddyfile`. Caddy tự cấp **SSL/HTTPS** (Let's Encrypt) — bắt buộc để camera/GPS chạy.

**Yêu cầu:** 1 VPS (Debian/Ubuntu) + 1 **domain** trỏ DNS về IP VPS.

### Bước 1 — Cài Docker trên VPS (Debian/Ubuntu)
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # đăng xuất/đăng nhập lại để áp dụng
```

### Bước 2 — Lấy code + cấu hình
```bash
git clone https://github.com/quytcn-commits/checkin.git
cd checkin
cp .env.example .env
nano .env     # đổi: ADMIN_PASSWORD, CCCD_SALT, EVENT_NAME, DOMAIN=checkin.congty.com
```

### Bước 3 — Trỏ DNS + mở firewall
- Tạo bản ghi **DNS A**: `checkin.congty.com → <IP VPS>`.
- Mở cổng **80** và **443** trên firewall.
  - GCP (máy bạn đang dùng): vào VPC > Firewall, hoặc:
    ```bash
    gcloud compute firewall-rules create allow-http-https \
      --allow tcp:80,tcp:443 --direction INGRESS --network default
    ```
    và gán tag/áp dụng cho VM, hoặc bật sẵn "Allow HTTP/HTTPS traffic" trong cài đặt VM.

### Bước 4 — Chạy
```bash
docker compose up -d --build
docker compose logs -f        # xem log, Ctrl+C để thoát
```
Truy cập `https://checkin.congty.com` — Caddy tự lấy chứng chỉ trong ~30 giây.

### Bước 5 — Import nhân viên
```bash
docker compose exec app node scripts/import-employees.js employees.sample.csv
# hoặc dùng trang /admin.html > Import nhân viên (CSV)
```

### Lệnh vận hành
| Việc | Lệnh |
|---|---|
| Cập nhật code mới | `git pull && docker compose up -d --build` |
| Xem log | `docker compose logs -f app` |
| Dừng | `docker compose down` |
| Sao lưu dữ liệu | copy thư mục `./data` (chứa `checkin.db` + ảnh) |

> **Không có domain?** Vẫn chạy được tạm bằng Cloudflare Tunnel: bỏ comment `ports: 3000:3000` trong `docker-compose.yml`, xoá service `caddy`, rồi chạy `cloudflared tunnel --url http://localhost:3000` để lấy URL HTTPS. Tuy nhiên cho sự kiện thật nên mua 1 domain (vài chục nghìn/năm) cho ổn định.

## Cấu trúc
```
server.js            API + phục vụ web
db.js                SQLite schema
lib.js               CCCD hash, haversine, parse CSV
config.js            đọc .env
public/              index(check-in) + admin + draw
scripts/             import nhân viên qua CLI
data/                DB + ảnh (tự tạo, gitignore)
Dockerfile           build image
docker-compose.yml   app + Caddy (HTTPS tự động)
Caddyfile            cấu hình reverse proxy + SSL
```

## Lưu ý vận hành sự kiện
- Test trước với 2–3 điện thoại thật (iOS + Android) qua đúng URL HTTPS.
- Chuẩn bị wifi/4G ổn định ở khu vực backdrop.
- Có người hỗ trợ khách cấp quyền Camera/Vị trí (hay bị bỏ qua).
- Sao lưu file `data/checkin.db` định kỳ trong lúc sự kiện diễn ra.
```
