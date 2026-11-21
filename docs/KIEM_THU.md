# Biên bản kiểm thử – Hệ thống bãi đỗ xe thông minh

Môi trường:
- Mô phỏng **Wokwi** project `QLBDX`, firmware giống hệt `arduino/SmartParking`.
- Broker `broker.hivemq.com`.
- API trên **Render**, DB **Neon**.
- App Expo chạy bản web trên Chrome.

## 1. Kiểm thử tự động (backend)
Lệnh: `cd backend && npm test`. Test chạy trên nhánh DB Neon `test`, ESP32 được giả lập (`tests/fakeDevice.js`).

| Ngày | Phạm vi | Kết quả |
|---|---|---|
| 19/11/2026 | Xác thực, OTP, xe, bãi, đặt chỗ, đồng bộ MQTT → DB, quản trị | 28/28 PASS |
| 20/11/2026 | Thêm: đăng nhập Google/Facebook, lịch gửi xe, đồng bộ khoảng cách, **thanh toán / giao dịch** | **46/46 PASS** |

Các nhóm test chính: đăng ký/đăng nhập, phân quyền, đặt chỗ (thành công / ô đã đặt / thiết bị timeout 504 / offline 503), xe vào → `fulfilled` → xe ra → tính phí, hết hạn giữ chỗ, thanh toán (chưa kết thúc 409, người khác 404, trả 2 lần 409, thu tiền mặt khách vãng lai), thống kê.

## 2. Kiểm thử end-to-end với Wokwi (API thật + broker + ESP32 mô phỏng)

### 2.1 Bằng script `backend/scripts/e2e.js` (19/11/2026)
| Môi trường | Kết quả |
|---|---|
| API trên máy + Wokwi | 11/11 PASS |
| API trên Render + Neon + Wokwi | 11/11 PASS, ESP32 phản hồi đặt chỗ trong khoảng 0,6 giây |
| Tắt ESP32, khoảng 15 giây sau đặt chỗ | `503 device_offline` sau 181 ms |

### 2.2 Kiểm thử thủ công qua app (20/11/2026)
| # | Thao tác | Kết quả mong đợi | Kết quả |
|---|---|---|---|
| 1 | Bấm ▶ trên Wokwi | LCD hiện "App: ONLINE", API báo bãi `online: true`, 4/4 ô trống | ✅ |
| 2 | Bấm "Đặt chỗ ngay" (lịch gửi xe) | ESP32 trả `ack`, LED ô 1 vàng, LCD `01:R`, đặt chỗ `active` | ✅ |
| 3 | Gia hạn +5 phút | `ack ok`, thời gian giữ chỗ từ 15 lên 20 phút | ✅ |
| 4 | Kéo cảm biến ô 1 < 50 cm (xe vào đúng ô đã đặt) | LED đỏ, LCD `01:X`, đặt chỗ `fulfilled`, mở lượt đỗ | ✅ |
| 5 | Bấm nút XE VÀO | Servo mở, API `gates.entry = open`, tự đóng sau 3 giây | ✅ |
| 6 | Mở Home trên app | Vé "Còn 14 phút", sơ đồ ô khớp Wokwi (đỏ / vàng / xanh) | ✅ |
| 7 | Xe rời ô (cảm biến 400 cm) | Lượt đỗ đóng, 169 giây, phí 10.000đ | ✅ |
| 8 | Xe rời ô khi app đang mở sơ đồ ô | Ô tự chuyển xanh trong ≤ 10 giây, không cần làm mới | ✅ (sau khi sửa lỗi sơ đồ không tự cập nhật) |
| 9 | Huỷ đặt chỗ | ESP32 trả ô, LED xanh, vé biến mất khỏi app | ✅ |
| 10 | Để tab Wokwi chạy nền lâu | Trình duyệt làm chậm mô phỏng, ESP32 mất kết nối, broker gửi LWT → bãi offline | ✅ (đúng cơ chế LWT) |

### 2.3 Thanh toán
Luồng thanh toán (lượt đỗ → chưa thanh toán → trả → giao dịch `GD…`) đã được kiểm tra bằng **test tự động** ở mục 1. Khi chạy với Wokwi, bước 7 ở trên tạo ra lượt đỗ có phí. Lượt này thanh toán được qua `POST /sessions/:id/pay` (mẫu request trong `backend/api.http`).

## 3. Kiểm thử phần cứng thật (ESP32/Arduino)
> **Chưa thực hiện, vì chưa có phần cứng.** Firmware `arduino/SmartParking` giống hệt bản Wokwi, chỉ khác `config.h` (WiFi thật). Khi có mạch, chạy theo bảng dưới và ghi kết quả.

| # | Hạng mục | Cách kiểm tra | Kết quả |
|---|---|---|---|
| 1 | Kết nối WiFi + MQTT | Serial Monitor 115200 hiện `[WiFi] Da ket noi`, `[MQTT] ... OK`; LCD "App: ONLINE" | ☐ |
| 2 | Cảm biến HC-SR04 từng ô | Đặt vật cách < 50 cm → ô đổi `occupied`; bỏ vật → `free` (kiểm tra cả 4 ô) | ☐ |
| 3 | Chống nhiễu | Rung, che cảm biến thoáng qua → trạng thái không nhảy lung tung | ☐ |
| 4 | LED NeoPixel | Xanh / đỏ / vàng đúng trạng thái | ☐ |
| 5 | Servo barie | Nút XE VÀO / XE RA mở 90°, tự đóng sau 3 giây; bãi đầy thì không mở cổng vào | ☐ |
| 6 | Lệnh từ app | Đặt chỗ / huỷ / gia hạn / mở barie từ xa có `ack` < 2 giây | ☐ |
| 7 | Mất mạng | Rút WiFi → API báo offline (LWT); cắm lại → tự kết nối lại | ☐ |
| 8 | Nguồn | Servo dùng nguồn 5V riêng (chung GND), ESP32 không bị reset khi servo quay | ☐ |
| 9 | Chạy script `node scripts/e2e.js <API> <admin> <pass>` | 11/11 PASS | ☐ |

Lưu ý khi lắp mạch: xem [`arduino/README.md`](../arduino/README.md#lưu-ý-khi-lắp-mạch).
