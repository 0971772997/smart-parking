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

### 1.1 Bộ kiểm thử đầy đủ (22/11/2026)

| Lệnh (`backend/`) | Nhóm | Nội dung chính |
|---|---|---|
| `npm run test:unit` | **Đơn vị** (không cần DB) | Tính phí (bảng 10 trường hợp, phí không giảm theo thời gian, khớp phí dự kiến), vòng đời phiên; JWT (thiếu / sai khoá / hết hạn / `alg: none` / sửa payload / bị khoá / đổi quyền / cache); mã QR cổng (sửa từng phần, hết hạn, khoá khác); chữ ký MoMo; giới hạn đăng nhập; kiểm tra dữ liệu vào (nhầm kiểu, ngày, SĐT); MQTT (ack, timeout, mất broker); long-poll; thông báo đẩy khi mạng lỗi; API khi CSDL mất kết nối |
| `npm run test:integration` | **Tích hợp API** (DB `test`) | Toàn bộ API theo chức năng: xác thực, đặt chỗ, QR cổng, phiên gửi xe, thanh toán MoMo, thông báo đẩy, lịch sử / yêu thích / đánh giá / hỗ trợ, quản trị, điều chỉnh giá (giá đã chốt cho xe đang gửi, 2 admin bấm cùng lúc, thông báo tài xế) |
| `npm run test:e2e` | **Đầu cuối** (server HTTP thật) | Đặt chỗ → QR vào → xe vào ô → gia hạn → rời ô (chốt phí) → MoMo (IPN ký thật) → biên nhận → QR ra → kết thúc → lịch sử / đánh giá / doanh thu; thanh toán bị từ chối rồi trả lại; MoMo mất kết nối; ESP32 không phản hồi; bãi offline; huỷ / không đến; app mất mạng khi long-poll |
| `npm run test:security` | **Phân quyền & bảo mật** | Truy cập chéo 18 API (B đụng tài nguyên A → 404, dữ liệu A không đổi); 26 API quản trị (khách 401, tài xế 403); token thật (hết hạn, khoá giả, tự gán admin, tài khoản xoá / khoá); dò mật khẩu → 429; không lộ hash / email; chèn SQL, ký tự đại diện LIKE; mass assignment; nhầm kiểu dữ liệu |
| `npm run test:load` | **Tải đồng thời** | 10 người tranh 1 ô; bấm đặt chỗ 5 lần; 8 IPN cùng lúc; yêu thích / đánh giá trùng; gia hạn phiên / giữ chỗ vượt giới hạn |
| `npm run perf` | **Hiệu năng** | p50/p95/p99, yêu cầu/giây trên 600 phiên / 60 tài xế mẫu; đột biến 50 kết nối; 500 kết nối long-poll |
| `npm test` / `npm run test:coverage` | Tất cả | Chạy mọi nhóm trên + đo độ phủ mã nguồn |
| `cd mobile && npm test` | **App** (node:test, không cần thiết bị) | Gọi API khi mất mạng / timeout / Render đang khởi động / 502-504 HTML; ánh xạ lỗi tiếng Việt; tài khoản bị khoá giữa chừng; long-poll thử lại lùi dần 2-4-8-15 giây, tạm dừng khi chạy nền; hộp thoại xác nhận chạy trên web; tiện ích ngày / tiền / thời gian |

### 1.2 Kết quả (22/11/2026)

| Nhóm | Kết quả |
|---|---|
| Backend – toàn bộ (`npm test`: đơn vị + tích hợp + E2E + bảo mật + tải đồng thời) | **290/290 PASS** (60 nhóm, khoảng 2,5 phút) |
| Độ phủ mã nguồn backend (`npm run test:coverage`) | **98,8 % dòng lệnh**, 85,9 % nhánh, 95,4 % hàm |
| App (`mobile/ npm test`) | **35/35 PASS** |
| `npx expo-doctor` | 20/20 kiểm tra đạt |

**Lỗi tìm ra nhờ kiểm thử (đã sửa):**

| # | Nhóm test phát hiện | Lỗi | Cách sửa |
|---|---|---|---|
| 1 | Bảo mật (thiết kế ca kiểm thử) | Đăng nhập không giới hạn số lần sai → dò được mật khẩu | Tối đa 10 lần sai / 15 phút cho mỗi (IP + tài khoản), 50 lần / IP → `429 too_many_attempts`; Render: `trust proxy` để lấy IP thật |
| 2 | Đơn vị | `validate.int` nhận cả `[1]`, `true`, số vượt giới hạn an toàn | Chỉ nhận số hoặc chuỗi chữ số, `Number.isSafeInteger` |
| 3 | Bảo mật | Tìm kiếm quản trị không thoát `%` `_` → tìm "%_%" ra mọi tài khoản | Thoát ký tự đại diện LIKE |
| 4 | Tải đồng thời | Bấm "Gia hạn phiên" 8 lần cùng lúc → gia hạn 8 lần (giới hạn 5) | Điều kiện nằm trong câu `UPDATE` (nguyên tử) |
| 5 | Tải đồng thời (rà cùng lúc) | Gia hạn giữ chỗ cùng lỗi trên | Giữ "suất" gia hạn trong DB trước khi gửi lệnh ESP32, lỗi thì trả lại |
| 6 | Gián đoạn | CSDL mất kết nối → `500` chung chung | `503 service_unavailable`, app báo "máy chủ tạm gián đoạn" |
| 7 | Gián đoạn | Server mất broker MQTT → người dùng chờ hết 8 giây mới báo lỗi | Báo lỗi ngay khi chưa kết nối broker |
| 8 | Hiệu năng | Mỗi thay đổi làm **mọi** app đang long-poll cùng truy vấn DB (500 app ≈ 2.000 truy vấn) | Ảnh chụp `/live` tính 1 lần / phiên bản, dùng chung |
| 9 | Hiệu năng | Pool DB 5 kết nối; dọn đặt chỗ hết hạn tốn 2 lượt gọi DB / lần đọc | Pool 10 (`DB_POOL_MAX`), gộp thành 1 câu SQL |
| 10 | Tương thích thiết bị | `Alert.alert` là hàm rỗng trên web → **không xoá được xe / bãi**, lỗi bị nuốt | `appAlert`: điện thoại dùng `Alert`, web dùng `confirm` / `alert` |
| 11 | Gián đoạn (app) | Render đang khởi động trả trang HTML 502/503 → app báo "lỗi máy chủ" | Mã `service_unavailable` + thông báo "máy chủ đang khởi động" |
| 12 | Bảo mật | Thiếu header bảo mật; body quá lớn trả 500 | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`; `413 payload_too_large` |

### 1.3 Hiệu năng (`npm run perf`, server trên máy ↔ Neon Singapore, 600 phiên / 60 tài xế mẫu)

| API | Đồng thời | p50 (ms) | p95 (ms) | Yêu cầu/giây | Lỗi |
|---|---:|---:|---:|---:|---:|
| GET /lots | 10 | 80 | 119 | 109 | 0 |
| GET /lots/:id (sơ đồ ô) | 10 | 155 | 197 | 62 | 0 |
| GET /lots/:id/reviews | 10 | 154 | 199 | 63 | 0 |
| GET /sessions/active | 10 | 129 | 392 | 65 | 0 |
| GET /history (30 ngày) | 10 | 173 | 396 | 50 | 0 |
| GET /payments | 10 | 52 | 72 | 181 | 0 |
| GET /admin/overview | 10 | 356 | 613 | 26 | 0 |
| GET /admin/payments | 10 | 182 | 251 | 53 | 0 |
| GET /lots – đột biến | **50** | 386 | 432 | 125 | 0 |
| POST đặt chỗ (lệnh tới ESP32) | 1 | 422 | 476 | – | 0 |

- Long-poll: **500/500** kết nối được giữ, một thay đổi đánh thức tất cả trong **197 ms**.
- Trước khi tối ưu (mục 8, 9): `/lots` p95 271 ms, `/admin/overview` 1.003 ms, đột biến 50 kết nối 1.318 ms (nhanh hơn khoảng 2–3 lần sau khi sửa).
- Ngưỡng đạt: API tài xế p95 < 800 ms, quản trị < 1.500 ms, đột biến < 2.000 ms, ghi < 1.500 ms, 0 lỗi.
- Tính phí: khoảng 160 ns / lần.
- Lưu ý: Render gói Free "ngủ" sau 15 phút không có truy cập, nên lần gọi đầu mất khoảng 30–50 giây. App báo "máy chủ đang khởi động" (`onSlow` sau 4 giây).

### 1.4 Tương thích thiết bị & gián đoạn mạng trên app (Chrome, 22/11/2026)

| Kiểm tra | Kết quả |
|---|---|
| 7 màn hình (Trang chủ, Hồ sơ, Lịch sử, Chi tiết phiên, Hỗ trợ, Báo cáo sự cố, Bãi yêu thích) × 5 chiều rộng: 320 (iPhone SE 1), 360 (Android nhỏ), 390 (iPhone 14), 412 (Pixel 7), 768 (iPad) | Không phần tử nào tràn ngang / bị cắt; ở 320px tên dài được rút gọn "…" |
| Tắt API khi app đang mở | Sau khoảng 5 giây hiện banner "Mất kết nối máy chủ – đang thử kết nối lại…", **vẫn hiện dữ liệu cũ** |
| Bật lại API | App tự kết nối lại và tắt banner sau **7,7 giây**, không cần thao tác |
| `app.json` | Android (`vn.smartpark.app`, quyền Camera + thông báo), iOS hỗ trợ iPad, khoá dọc; `expo-doctor` 20/20 |
| Hạn chế | **Chưa chạy trên điện thoại thật** trong đợt này (chỉ Chrome mô phỏng chiều rộng). Nên thử bằng bản dev build Android + Expo Go trên iPhone: quét QR bằng camera, thông báo đẩy khi tắt màn hình, cỡ chữ lớn của hệ điều hành. Ghi chú: một trình duyệt mở **6 tab app trở lên** cùng lúc sẽ đụng giới hạn 6 kết nối HTTP/1.1 / máy chủ của Chrome (mỗi tab giữ 1 long-poll); người dùng bình thường mở 1 app nên không gặp. |

### 1.5 Tài xế tự quét mã QR tại cổng + khai báo loại xe (25/11/2026)

| Kiểm tra | Kết quả |
|---|---|
| `backend/tests/checkin.test.js` (12 test): admin lấy mã cổng (tài xế 403); mã rác / mã đặt chỗ cũ / khoá khác / sửa id bãi / hết hạn / bãi đã xoá; chưa đặt chỗ → `no_reservation`; offline → 503; quét cổng RA khi chưa vào; gắn xe người khác; vào bãi (gắn xe, mở phiên), quét lại → `already_entered`; cổng ra `still_parked` → 402 → trả tiền → mở; bấm 2 lần cùng lúc chỉ mở 1 lần; nhật ký `mode=driver`; thêm / sửa xe, loại xe, biển số sai | **12/12 PASS** (+ `gate.test.js` cũ 9/9 vẫn PASS) |
| Backend toàn bộ (`npm test`) | 298/302 – 4 lỗi ở `concurrency.test.js` khi chạy chung (độ trễ DB); chạy riêng `npm run test:load` **6/6 PASS** |
| App `tests/gateVehicle.test.mjs` (nhận diện mã cổng, thông báo lỗi tài xế, loại xe, biển số) | `mobile/ npm test` **39/39 PASS** |
| Chrome (API local + ESP32 giả lập): admin mở "Mã QR tại cổng" → tài xế nhập mã cổng VÀO → barie mở, khu B ô #3, xe 43A-123.45 gắn vào đặt chỗ; cổng RA chưa trả phí → màn cam "Chưa thanh toán 10.000đ"; admin bấm "Đã thu tiền mặt" → tài xế quét lại → màn cổng hiện "Hẹn gặp lại!"; thêm xe máy `43-b1 678.90` → lưu `43-B1 678.90` | Đạt. Chưa thử camera thật trên điện thoại |

### 1.6 Một mã QR chung + thanh toán tiền mặt / chuyển khoản / MoMo do nhân viên xác nhận (25/11/2026)

| Kiểm tra | Kết quả |
|---|---|
| `backend/tests/manualpay.test.js` (8 test): mã chung `G`; cùng 1 mã lần đầu → VÀO, sau đó → RA (`still_parked`, 402); cấu hình tài khoản nhận tiền; chọn tiền mặt rồi đổi sang chuyển khoản giữ mã đơn, VietQR đúng BIN 970422 / STK / số tiền / nội dung / CRC; tài xế không tự xác nhận (403); admin xác nhận → giao dịch + barie ra mở; bấm lại → 409; "Chưa nhận được" → đơn thất bại; `openGate=false`; nút thu tiền mặt cũ đánh dấu đơn chờ + mở cổng | **8/8 PASS** |
| `tests/unit/vietqr.test.js`: CRC16 vector chuẩn `123456789 → 29B1`, cấu trúc VietQR, nội dung bỏ dấu | **3/3 PASS** |
| Backend toàn bộ (`npm test`) | **313/313 PASS** |
| Chrome (API local + ESP32 giả lập): tài xế quét mã chung ở cổng ra → màn "Chưa thanh toán 10.000đ" có nút Trả tiền mặt / Chuyển khoản – MoMo → mã VietQR MB 0971772997 VO VIET MINH, nội dung SPxxxx → admin thấy "Thanh toán chờ xác nhận" → "Đã nhận tiền – mở cổng" → barie ra mở, "Hẹn gặp lại!", đơn của tài xế `paid` + biên nhận | Đạt. Lỗi tìm thấy và đã sửa: app gửi `gate=undefined` khi lấy mã chung → 400 |

### 1.7 Phí gia hạn giữ chỗ 5.000đ/lần (25/11/2026)

| Kiểm tra | Kết quả |
|---|---|
| `manualpay.test.js` (+2 test): gia hạn 2 lần → phí dự kiến +10.000đ; vào bãi → phí tạm tính có `holdFee` 10.000đ; rời ô → phí chốt gồm 10.000đ, cổng ra báo 402 đúng số tiền; trả tiền mặt → biên nhận có dòng "Phí gia hạn giữ chỗ (2 lần × 5.000đ)"; không gia hạn → 0đ | **PASS** |
| `tests/unit/fees.test.js` (+1): phí giữ chỗ luôn cộng vào tổng, kể cả vào rồi ra miễn phí trong ân hạn | **PASS** |

### 1.8 Mở app ngân hàng tự điền số tiền + nội dung (25/11/2026)

| Kiểm tra | Kết quả |
|---|---|
| `tests/unit/vietqr.test.js` (+1): deeplink `dl.vietqr.io/pay` cho MB có `ba=0971772997@mb`, `am`, `tn`, `bn`, `url`; app không hỗ trợ tự điền (VCB) chỉ mở app | **PASS** |
| `manualpay.test.js`: `payInfo.bankApps` có link MB đúng số tiền, nội dung; trang quay lại `/api/payments/transfer-return` | **PASS** — backend toàn bộ **317/317** |
| Chrome: màn chờ xác nhận hiện nút "Mở MB Bank – tự điền" + BIDV / VietinBank / ACB / OCB; mã VietQR chỉ còn là phương án dự phòng | Đạt. **Chưa thử trên điện thoại thật** (link chỉ mở app khi chạy trên điện thoại đã cài app ngân hàng) |

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
