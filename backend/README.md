# Smart Parking API – Lab 2

Node.js + Express · PostgreSQL (Neon) · MQTT (HiveMQ Cloud) · Deploy Render (gói Free)

```
 App di động ──HTTPS/JSON──►  API (Render)  ──SQL──►  PostgreSQL (Neon)
                                 ▲   │
                       status/event   cmd (+requestId, chờ ack)
                                 │   ▼
                          Broker MQTT (HiveMQ Cloud, TLS)
                                 ▲   │
                                 │   ▼
                            ESP32 (bãi đỗ xe)
```

- API **subscribe** `smartparking/+/status|event|online`, rồi lưu vào DB. Chỉ ghi DB khi dữ liệu thay đổi.
- Khi app đặt chỗ, API **publish** lệnh lên `smartparking/{lotId}/cmd` kèm `requestId`, rồi chờ ESP32 trả `ack` (tối đa 8 giây).

## 1. Thiết kế DB (`db/schema.sql`)

| Bảng | Nội dung | Khóa / ràng buộc chính |
|---|---|---|
| `users` | Tài khoản app (role `user`/`admin`), mật khẩu băm bằng bcrypt | `email` UNIQUE |
| `vehicles` | Xe của người dùng | FK `user_id`, `plate_number` UNIQUE |
| `parking_lots` | Bãi đỗ (= 1 ESP32), giá/giờ, online, trạng thái barie | PK `id` = `PARKING_ID` trong firmware |
| `slots` | Ô đỗ và trạng thái hiện tại `free/occupied/reserved` | UNIQUE(`lot_id`,`slot_number`) |
| `reservations` | Đặt chỗ: `pending→active→fulfilled/cancelled/expired/failed` | UNIQUE `request_id`; index duy nhất: mỗi ô chỉ có 1 đặt chỗ đang hiệu lực |
| `parking_sessions` | Lượt đỗ (xe vào → xe ra), thời gian, phí | FK `slot_id`, `reservation_id` |
| `device_events` | Nhật ký thô các sự kiện từ ESP32 (JSONB) | index (`lot_id`, `created_at`) |

Quan hệ: `users 1–n vehicles`, `users 1–n reservations`, `parking_lots 1–n slots`, `slots 1–n reservations`, `slots 1–n parking_sessions`, `reservations 1–0..1 parking_sessions`, `parking_lots 1–n device_events`.

Phí đỗ được tính tròn lên theo giờ, tối thiểu 1 giờ, nhân với `price_per_hour` của bãi.

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
| GET | `/lots` | – | Danh sách bãi đỗ kèm `freeSlots` |
| GET | `/lots/:lotId` | – | Chi tiết bãi: online, barie, số ô trống/có xe/đặt, danh sách `slots` |
| GET | `/lots/:lotId/slots` | – | Danh sách ô |
| POST | `/lots/:lotId/reservations` | user | `{slotNumber, minutes(1-120)=15, vehicleId?}`, gửi lệnh tới ESP32 |
| GET | `/reservations?status=` | user | Lịch sử đặt chỗ của tôi |
| GET | `/reservations/:id` | user | Chi tiết đặt chỗ |
| POST | `/reservations/:id/extend` | user | `{minutes}`, gia hạn (tổng tối đa 240 phút) |
| DELETE | `/reservations/:id` | user | Huỷ đặt chỗ |
| POST | `/lots` | admin | Tạo bãi mới `{id, name, address?, totalSlots, pricePerHour?}` |
| POST | `/lots/:lotId/gates/:entry\|exit/:open\|close` | admin | Mở/đóng barie từ xa |
| GET | `/lots/:lotId/sessions?limit=` | admin | Lịch sử lượt đỗ và phí |
| GET | `/lots/:lotId/events?type=&limit=` | admin | Nhật ký sự kiện ESP32 |
| GET | `/lots/:lotId/stats?date=YYYY-MM-DD` | admin | Thống kê ngày (giờ VN): số lượt, doanh thu, thời gian trung bình, đặt chỗ, % lấp đầy |

Mã lỗi thường gặp:

| HTTP | `error` | Ý nghĩa |
|---|---|---|
| 400 | `validation_error`, `invalid_json`, `invalid_gate`, `vehicle_not_found` | Dữ liệu gửi lên sai |
| 401 | `unauthorized`, `invalid_token`, `invalid_credentials` | Chưa đăng nhập, token sai/hết hạn, hoặc sai email/mật khẩu |
| 403 | `forbidden` | Không có quyền admin |
| 404 | `not_found`, `lot_not_found`, `reservation_not_found` | Không tìm thấy |
| 409 | `email_taken`, `plate_taken`, `slot_not_free`, `already_has_reservation`, `reservation_not_active` | Xung đột dữ liệu |
| 503 | `device_offline` | ESP32 đang mất kết nối |
| 504 | `device_timeout` | ESP32 không trả `ack` trong 8 giây |

Có thể thử API bằng tay qua file `api.http` (extension **REST Client** trong VS Code).

## 3. Chạy và test trên máy

```bash
npm install
npm run migrate      # tạo bảng và dữ liệu mẫu (bãi sp-demo-01, 4 ô)
npm run dev          # http://localhost:3000
npm test             # 28 test tự động, chạy trên nhánh DB Neon "test" (.env.test), ESP32 được giả lập
node scripts/e2e.js http://localhost:3000 <admin-email> <admin-pass>   # test thật với ESP32/Wokwi qua MQTT
```

Biến môi trường được mô tả trong `.env.example`.
