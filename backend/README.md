# Smart Parking API – Lab 2

Node.js + Express · PostgreSQL (Neon) · MQTT (broker HiveMQ công khai) · Deploy Render (gói Free)

> Nguyên lý hệ thống và giao thức MQTT: xem [`../docs/MQTT_va_nguyen_ly_he_thong.md`](../docs/MQTT_va_nguyen_ly_he_thong.md). Biên bản kiểm thử: [`../docs/KIEM_THU.md`](../docs/KIEM_THU.md).

```
 App di động ──HTTPS/JSON──►  API (Render)  ──SQL──►  PostgreSQL (Neon)
                                 ▲   │
                       status/event   cmd (+requestId, chờ ack)
                                 │   ▼
                      Broker MQTT (broker.hivemq.com)
                                 ▲   │
                                 │   ▼
                            ESP32 (bãi đỗ xe)
```

- API **subscribe** `smartparking/+/status|event|online`, rồi lưu vào DB. Chỉ ghi DB khi dữ liệu thay đổi.
- Khi app đặt chỗ, API **publish** lệnh lên `smartparking/{lotId}/cmd` kèm `requestId`, rồi chờ ESP32 trả `ack` (tối đa 8 giây).

**Bản đang chạy:** https://smart-parking-api-2ro3.onrender.com/api/health

## 0. Cấu hình Broker

| Thông số | Giá trị |
|---|---|
| Broker | `broker.hivemq.com` (công khai, miễn phí). HiveMQ Cloud đã bỏ gói free |
| Cổng | TCP `1883` (ESP32, API) · WebSocket `8000` path `/mqtt` (app/web) · WSS `8884` |
| Topic | `smartparking/{lotId}/status` (retained) · `event` · `cmd` · `online` (retained + LWT) |
| QoS | Lệnh `cmd` gửi với QoS 1; ESP32 subscribe `cmd` với QoS 1 |
| LWT | Khi ESP32 kết nối, nó khai báo LWT `online = "0"` (retained). Nếu ESP32 mất kết nối, broker tự gửi `"0"` → API chuyển bãi sang offline và trả `503 device_offline` |
| Giữ kết nối | ESP32 tự kết nối lại sau 5 giây; API tự kết nối lại sau 3 giây |

Đổi sang broker riêng có TLS (HiveMQ Cloud / EMQX) không cần sửa code:
- Firmware: khai báo `MQTT_HOST_CFG`, `MQTT_PORT_CFG 8883`, `MQTT_USER_CFG`, `MQTT_PASS_CFG` trong `config.h`. Firmware đã nhúng sẵn chứng chỉ gốc ISRG Root X1.
- API: đặt `MQTT_URL=mqtts://host:8883`, `MQTT_USERNAME`, `MQTT_PASSWORD`.

## 1. Thiết kế DB (`db/schema.sql`)

| Bảng | Nội dung | Khóa / ràng buộc chính |
|---|---|---|
| `users` | Tài khoản app (role `user`/`admin`), mật khẩu băm bằng bcrypt | `email` UNIQUE |
| `vehicles` | Xe của người dùng | FK `user_id`, `plate_number` UNIQUE |
| `parking_lots` | Bãi đỗ (= 1 ESP32), giá/giờ, online, trạng thái barie | PK `id` = `PARKING_ID` trong firmware |
| `slots` | Ô đỗ và trạng thái hiện tại `free/occupied/reserved` | UNIQUE(`lot_id`,`slot_number`) |
| `reservations` | Đặt chỗ: `pending→active→fulfilled/cancelled/expired/failed` | UNIQUE `request_id`; index duy nhất: mỗi ô chỉ có 1 đặt chỗ đang hiệu lực |
| `parking_sessions` | Lượt đỗ (xe vào → xe ra), thời gian, phí | FK `slot_id`, `reservation_id` |
| `payments` | **Giao dịch** thanh toán phí gửi xe: mã GD, số tiền, hình thức (`cash/card/momo/zalopay/bank`), admin thu tiền | `code` UNIQUE, `session_id` UNIQUE (mỗi lượt đỗ chỉ trả 1 lần) |
| `parking_schedules` | Lịch gửi xe thường xuyên của tài xế (bãi, xe, giờ đến, ngày lặp, phút giữ chỗ) | FK `user_id`, `lot_id`, `vehicle_id` |
| `device_events` | Nhật ký thô các sự kiện từ ESP32 (JSONB) | index (`lot_id`, `created_at`) |

Quan hệ: `users 1–n vehicles`, `users 1–n reservations`, `parking_lots 1–n slots`, `slots 1–n reservations`, `slots 1–n parking_sessions`, `reservations 1–0..1 parking_sessions`, `parking_sessions 1–0..1 payments`, `users 1–n payments`, `users 1–n parking_schedules`, `parking_lots 1–n device_events`.

Phí đỗ được tính tròn lên theo giờ, tối thiểu 1 giờ, nhân với `price_per_hour` của bãi.

**Luồng thanh toán:** đặt chỗ → xe vào ô (ESP32 báo `slot_changed`) → mở lượt đỗ → xe ra → server tính `fee` → lượt đỗ ở trạng thái *chưa thanh toán* → tài xế trả qua app (`POST /sessions/:id/pay`) hoặc admin thu tiền mặt tại cổng → tạo giao dịch. Cổng thanh toán hiện là **giả lập** (trả về thành công ngay); điểm gắn cổng thật (MoMo/VNPay…) là hàm `pay()` trong `src/routes/payments.js`.

## 2. API

Base URL: `https://<ten-service>.onrender.com/api`. Mọi body đều là JSON.
Các API cần đăng nhập phải gửi header `Authorization: Bearer <token>`.

Khi lỗi, API trả về: `{ "error": "<ma_loi>", "message": "...", "details"?: {...} }`

| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/health` | – | Kiểm tra server và kết nối MQTT |
| POST | `/auth/register` | – | `{email, password(≥6), fullName, phone?}` → `{token, user}` |
| POST | `/auth/login` | – | `{email, password}` → `{token, user}` |
| GET | `/auth/me` | user | Thông tin tài khoản |
| GET | `/vehicles` | user | Danh sách xe của tôi |
| POST | `/vehicles` | user | `{plateNumber, brand?, color?}` |
| DELETE | `/vehicles/:id` | user | Xoá xe |
| GET | `/schedules` | user | Lịch gửi xe thường xuyên của tôi (kèm `lot` {name, freeSlots, online…}, `vehiclePlate`) |
| POST | `/schedules` | user | `{name, lotId, arriveTime "HH:MM" (giờ đến bãi), days [1..7]=[1..5], vehicleId?, minutes(1-120)=15 (giữ chỗ), note?, active=true}` (tối đa 20) |
| PATCH | `/schedules/:id` | user | Sửa một phần, vd `{active:false}` |
| DELETE | `/schedules/:id` | user | Xoá lịch gửi xe |
| GET | `/lots` | – | Danh sách bãi đỗ kèm `freeSlots` |
| GET | `/lots/:lotId` | – | Chi tiết bãi: online, barie, số ô trống/có xe/đặt, danh sách `slots` |
| GET | `/lots/:lotId/slots` | – | Danh sách ô |
| POST | `/lots/:lotId/reservations` | user | `{zone?, slotNumber?, minutes(5-120)=15, durationMinutes(30-1440)=120, vehicleId?}`. Không có `slotNumber` → tự chọn ô trống trong khu. Gửi lệnh tới ESP32, 201 khi ESP32 xác nhận |
| GET | `/reservations/rules` | user | Quy tắc đặt chỗ + số lần không đến / thời điểm hết khoá của tôi |
| GET | `/reservations?status=active,pending` | user | Lịch sử đặt chỗ của tôi (lọc nhiều trạng thái) |
| GET | `/reservations/:id` | user | Chi tiết đặt chỗ |
| POST | `/reservations/:id/extend` | user | `{minutes(5-30)}`, tối đa 2 lần, khi chỗ còn đang giữ |
| DELETE | `/reservations/:id` | user | Huỷ đặt chỗ |
| POST | `/lots` | admin | Tạo bãi mới `{id, name, address?, totalSlots, pricePerHour?}` |
| POST | `/lots/:lotId/gates/:entry\|exit/:open\|close` | admin | Mở/đóng barie từ xa |
| GET | `/lots/:lotId/sessions?limit=` | admin | Lịch sử lượt đỗ và phí |
| GET | `/lots/:lotId/events?type=&limit=` | admin | Nhật ký sự kiện ESP32 |
| GET | `/lots/:lotId/stats?date=YYYY-MM-DD` | admin | Thống kê ngày (giờ VN): số lượt, doanh thu, thời gian trung bình, đặt chỗ, % lấp đầy |
| GET | `/sessions/mine` | user | Lượt đỗ của tôi: `status` = `parking` (đang đỗ, có `estimatedFee`) / `unpaid` / `paid` (kèm `payment`) |
| POST | `/sessions/:id/pay` | user | Thanh toán lượt đỗ đã kết thúc `{method: card\|momo\|zalopay\|bank}` → giao dịch (mã `GD…`) |
| GET | `/payments` | user | Lịch sử giao dịch của tôi |
| GET | `/payments/:id` | user | Chi tiết giao dịch (biên lai) |
| POST | `/lots/:lotId/sessions/:id/pay` | admin | Thu tiền tại cổng (mặc định `cash`), kể cả khách vãng lai |

Mã lỗi thường gặp:

| HTTP | `error` | Ý nghĩa |
|---|---|---|
| 400 | `validation_error`, `invalid_json`, `invalid_gate`, `vehicle_not_found` | Dữ liệu gửi lên sai |
| 401 | `unauthorized`, `invalid_token`, `invalid_credentials` | Chưa đăng nhập, token sai/hết hạn, hoặc sai email/mật khẩu |
| 403 | `forbidden` | Không có quyền admin |
| 403 | `booking_suspended` (kèm `details.suspendedUntil`) | Bị khoá đặt chỗ do không đến nhiều lần |
| 404 | `not_found`, `lot_not_found`, `zone_not_found`, `slot_not_found`, `reservation_not_found`, `session_not_found`, `payment_not_found` | Không tìm thấy |
| 409 | `email_taken`, `plate_taken`, `slot_not_free`, `already_has_reservation`, `reservation_not_active`, `zone_full`, `lot_full`, `extend_limit`, `reservation_expired`, `session_not_ended`, `already_paid` | Xung đột dữ liệu |
| 503 | `device_offline` | ESP32 đang mất kết nối |
| 504 | `device_timeout` | ESP32 không trả `ack` trong 8 giây |

Có thể thử API bằng tay qua file `api.http` (extension **REST Client** trong VS Code).

### Quy tắc đặt chỗ (`src/booking.js`)
- Chọn **bãi → khu vực (A/B, chia đôi dãy ô) → ô** (hoặc để hệ thống tự chọn ô trống nhỏ nhất trong khu) → **thời gian giữ chỗ** (5–120 phút, app gợi ý 15/30/45/60) → **thời lượng gửi dự kiến** (30 phút–24 giờ) → phí dự kiến = số giờ làm tròn lên × giá/giờ.
- **Xác nhận**: đặt chỗ `pending` chỉ thành `active` khi ESP32 trả `ack ok` (ghi `confirmed_at`, giờ hết hạn tính từ lúc này); ESP32 từ chối/không phản hồi → `failed`. Mỗi lượt có mã `DC-XXXXXX` để đối chiếu tại cổng.
- Mỗi tài khoản giữ tối đa **1** chỗ. Huỷ miễn phí khi `active`. Gia hạn tối đa **2 lần**, mỗi lần ≤ **30 phút**.
- **Hết hạn**: ESP32 tự trả ô và gửi `reservation_expired`; ngoài ra server tự đánh dấu `expired` khi quá giờ + 60 giây (kiểm tra "lười" mỗi khi đọc/đặt chỗ, không chạy định kỳ để Neon được ngủ). `pending` treo > 60 giây → `failed`.
- **Không đến**: mỗi lượt `expired` = 1 lần không đến; **3 lần trong 7 ngày → khoá đặt chỗ 24 giờ** (403 `booking_suspended`).

## 3. Chạy và test trên máy

```bash
npm install
npm run migrate      # tạo bảng và dữ liệu mẫu (bãi sp-demo-01, 4 ô)
npm run dev          # http://localhost:3000
npm test             # 46 test tự động, chạy trên nhánh DB Neon "test" (.env.test), ESP32 được giả lập
node scripts/e2e.js http://localhost:3000 <admin-email> <admin-pass>   # test thật với ESP32/Wokwi qua MQTT
```

Biến môi trường được mô tả trong `.env.example`.

### Kết quả test (19/11/2026)

| Loại test | Môi trường | Kết quả |
|---|---|---|
| Test tự động (`npm test`) | Nhánh DB Neon `test`, ESP32 giả lập | **46/46 PASS** (20/11/2026: thêm lịch gửi xe, thanh toán, đồng bộ khoảng cách) |
| End-to-end (`scripts/e2e.js`) | API trên máy + ESP32 trên Wokwi + broker | **11/11 PASS** |
| End-to-end | **API trên Render** + Neon + ESP32 trên Wokwi | **11/11 PASS**, ESP32 phản hồi đặt chỗ trong khoảng 0,6 giây |
| Mất kết nối | Tắt ESP32 → khoảng 15 giây sau gọi đặt chỗ | `503 device_offline` trả về trong 181 ms |

## 4. Deploy Cloud (Render, gói Free)

1. Code nằm trên GitHub (repo private). `render.yaml` ở thư mục gốc khai báo service `smart-parking-api` (Node, khu vực Singapore, health check `/api/health`).
2. Trên Render: **New → Blueprint** → chọn repo. Chỉ cần điền `DATABASE_URL` (chuỗi kết nối pooled của Neon). `JWT_SECRET` do Render tự sinh.
3. Mỗi lần `git push` lên nhánh `main`, Render tự build và deploy lại. Khi khởi động, server tự chạy migrate.
4. Tạo hoặc đổi mật khẩu admin từ máy: `npm run set-admin -- <email> <mat-khau>`.

Giới hạn của gói Free:
- Render "ngủ" sau 15 phút không có request, request đầu tiên sau đó mất khoảng 50 giây để server thức dậy. Khi thức dậy, server tự đồng bộ lại từ bản tin `status` retained. Có thể dùng cron-job.org gọi `/api/health` mỗi 10 phút để giữ server luôn thức.
- Neon tự ngủ sau 5 phút không có truy vấn. API chỉ ghi DB khi dữ liệu thay đổi, nên DB không bị đánh thức liên tục.
