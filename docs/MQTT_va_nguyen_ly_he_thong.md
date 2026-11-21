# Giao thức MQTT và nguyên lý hệ thống IoT bãi đỗ xe

## 1. Nguyên lý hoạt động của hệ thống

Mỗi bãi đỗ có một **ESP32** gắn cảm biến ở từng ô. ESP32 biết ô nào trống hay có xe, điều khiển barie và đèn báo, rồi gửi trạng thái lên Internet qua **MQTT**. **Backend** nhận dữ liệu đó, lưu vào **CSDL** và cung cấp **API** cho **app di động**. Khi tài xế đặt chỗ trên app, backend gửi lệnh ngược xuống ESP32 để giữ ô.

```
 ┌──────────── Bãi đỗ (ESP32) ────────────┐
 │ HC-SR04 x4 ─► đo khoảng cách ─► ô trống/có xe │
 │ Nút XE VÀO / XE RA ─► Servo barie vào/ra  │        MQTT (TCP 1883)
 │ LED NeoPixel x4: xanh/đỏ/vàng           │◄──────────────────────────┐
 │ LCD 20x4: số chỗ trống, trạng thái      │──── status / event ────►  │
 └─────────────────────────────────────────┘                          │
                                                          Broker MQTT (broker.hivemq.com)
 ┌──────── Backend (Render) ────────┐                                  │
 │ mqttBridge: subscribe status/event/online ◄────────────────────────┤
 │             publish cmd (+requestId) ──────────────────────────────►┘
 │ sync: ghi DB khi có thay đổi        │
 │ REST API (Express) ◄── HTTPS/JSON ── App di động (Expo / React Native)
 └──────────────┬──────────────────────┘
                │ SQL
        PostgreSQL (Neon): users, parking_lots, slots, reservations,
                           parking_sessions, payments, parking_schedules, device_events
```

### 1.1 Xác định trạng thái chỗ đỗ
- Mỗi ô có 1 cảm biến siêu âm **HC-SR04** gắn phía trên hoặc phía trước. ESP32 phát xung TRIG rồi đo thời gian xung ECHO (`pulseIn`). Khoảng cách (cm) = thời gian (µs) / 58 (tốc độ âm thanh 343 m/s, đi và về).
- Khoảng cách **< 50 cm** nghĩa là có xe.
- **Chống nhiễu:** trạng thái ô chỉ đổi khi **3 lần đọc liên tiếp** (mỗi 100 ms) cho cùng kết quả.
- Một ô có 3 trạng thái:

| Trạng thái | Điều kiện | LED |
|---|---|---|
| `free` | Không có xe, không ai đặt | Xanh |
| `occupied` | Cảm biến thấy xe | Đỏ |
| `reserved` | Được đặt từ app, chưa hết hạn giữ chỗ | Vàng |

- Xe vào đúng ô đã đặt thì đặt chỗ hoàn thành (`reservationFulfilled`). Hết thời gian giữ chỗ thì ô tự trở về `free` và ESP32 gửi sự kiện `reservation_expired`.

### 1.2 Barie (servo)
- Bấm nút **XE VÀO**: barie vào chỉ mở khi còn ô trống, nếu bãi đầy thì ESP32 gửi `entry_rejected`. Bấm nút **XE RA**: barie ra mở.
- Barie **tự đóng sau 3 giây**. App/admin có thể mở hoặc đóng barie từ xa bằng lệnh `open_gate` / `close_gate`.

### 1.3 Luồng nghiệp vụ chính
1. **Đặt chỗ:** App gọi `POST /lots/:id/reservations`. Backend publish `cmd {action:"reserve", slot, minutes, requestId}`. ESP32 giữ ô (LED vàng) rồi trả `ack` có cùng `requestId`. Backend nhận ack thì lưu đặt chỗ `active` và trả kết quả cho app (thường dưới 1 giây).
2. **Xe vào ô:** ESP32 gửi `event slot_changed → occupied`. Backend mở **lượt đỗ** (`parking_sessions`) và đánh dấu đặt chỗ `fulfilled`.
3. **Xe ra:** ESP32 gửi `slot_changed → free`. Backend đóng lượt đỗ và tính phí (làm tròn lên theo giờ, tối thiểu 1 giờ × giá/giờ).
4. **Thanh toán:** Tài xế trả qua app (`POST /sessions/:id/pay`) hoặc admin thu tiền mặt tại cổng. Hệ thống tạo **giao dịch** `payments` với mã `GD…`.
5. **Mất kết nối:** Nếu ESP32 mất mạng, broker tự gửi `online = "0"` (cơ chế LWT). Backend chuyển bãi sang *offline* và từ chối đặt chỗ (`503 device_offline`).

## 2. Giao thức MQTT

### 2.1 MQTT là gì
**MQTT** (Message Queuing Telemetry Transport) là giao thức nhắn tin dạng **publish/subscribe**, rất nhẹ, chạy trên TCP. Nó được thiết kế cho thiết bị IoT có tài nguyên và băng thông hạn chế.

- **Broker:** máy chủ trung gian nhận và chuyển tin. Dự án dùng `broker.hivemq.com` (miễn phí, công khai).
- **Client:** ESP32, backend và công cụ test đều là client. Các client **không nói chuyện trực tiếp với nhau** mà chỉ qua broker.
- **Topic:** "địa chỉ" của tin nhắn, dạng cây phân cấp bằng `/`, ví dụ `smartparking/sp-demo-01/status`.
  Wildcard: `+` thay **một** cấp (`smartparking/+/status` nghĩa là status của mọi bãi), `#` thay **mọi** cấp còn lại.
- **Publish:** gửi một tin (payload, ở đây là JSON) lên một topic. **Subscribe:** đăng ký nhận tin của các topic.

### 2.2 So với HTTP
| | MQTT | HTTP (REST) |
|---|---|---|
| Mô hình | Publish/subscribe, giữ kết nối lâu dài | Request/response, mỗi lần gọi một yêu cầu |
| Chiều dữ liệu | Hai chiều, server **đẩy** xuống thiết bị ngay | Client phải hỏi (polling) |
| Header | Rất nhỏ (từ 2 byte) | Lớn (hàng trăm byte) |
| Phù hợp | Thiết bị IoT ↔ server | App ↔ server |

Vì vậy dự án dùng **MQTT giữa ESP32 và backend**, và **HTTP/JSON giữa app và backend**.

### 2.3 Các khái niệm quan trọng (và cách dự án dùng)
| Khái niệm | Ý nghĩa | Trong dự án |
|---|---|---|
| **QoS 0** | Gửi tối đa 1 lần, không xác nhận | `status`, `event` (gửi lại định kỳ nên mất 1 tin không sao) |
| **QoS 1** | Ít nhất 1 lần, broker xác nhận (PUBACK) | `cmd`: backend publish QoS 1, ESP32 subscribe QoS 1 |
| **QoS 2** | Đúng 1 lần (bắt tay 4 bước) | Không dùng (tốn tài nguyên) |
| **Retained** | Broker giữ tin cuối cùng của topic, gửi ngay cho client mới subscribe | `status`, `online`: backend khởi động lại vẫn biết ngay trạng thái bãi |
| **LWT** (Last Will) | Tin "di chúc" broker tự gửi khi client mất kết nối bất thường | ESP32 khai báo LWT `online = "0"` (retained) |
| **Keep-alive** | Client gửi PINGREQ định kỳ để broker biết còn sống | Mặc định của PubSubClient (15 giây) |
| **Clean session / Client ID** | Mỗi client cần ID riêng | ESP32 dùng `esp32-<PARKING_ID>-<địa chỉ MAC>` |

### 2.4 Topic của dự án
Tiền tố: `smartparking/{PARKING_ID}/`

| Topic | Hướng | QoS | Retained | Nội dung |
|---|---|---|---|---|
| `status` | ESP32 → Backend/App | 0 | ✔ | Toàn bộ trạng thái bãi, gửi khi có thay đổi và mỗi 10 giây |
| `event` | ESP32 → Backend | 0 | ✗ | `slot_changed`, `gate`, `entry_rejected`, `reservation_expired`, `ack` |
| `cmd` | Backend → ESP32 | 1 | ✗ | `reserve`, `extend_reservation`, `cancel_reservation`, `open_gate`, `close_gate`, `get_status`, `reset_stats` |
| `online` | ESP32 (LWT: broker) → Backend | 1 | ✔ | `"1"` khi kết nối, `"0"` khi mất kết nối |

Định dạng JSON chi tiết của từng topic nằm ở [`wokwi/README.md`](../wokwi/README.md#giao-thức-mqtt-dành-cho-app-di-động).

### 2.5 Lệnh có phản hồi (request/response trên MQTT)
MQTT không có sẵn kiểu "hỏi – đáp" như HTTP, nên dự án tự ghép bằng **`requestId`**:
1. Backend tạo `requestId` ngẫu nhiên (UUID), publish lên `cmd`, rồi chờ.
2. ESP32 xử lý lệnh, publish `event {type:"ack", ok, error?, requestId}`.
3. Backend khớp `requestId` để biết lệnh thành công hay thất bại. Nếu quá **8 giây** không có ack thì trả `504 device_timeout`.

### 2.6 Bảo mật
- Broker công khai thì ai cũng đọc/ghi được topic. Cách này chỉ phù hợp để học tập và demo, nên cần đặt `PARKING_ID` khó đoán.
- Khi triển khai thật, nên dùng broker riêng có **TLS (cổng 8883) + username/password** (HiveMQ Cloud, EMQX…). Firmware và backend **đã hỗ trợ sẵn**, chỉ cần đổi cấu hình (`config.h`, biến môi trường `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`).
- App **không** kết nối thẳng tới broker mà đi qua API (có JWT). Nhờ vậy người dùng không thể tự gửi lệnh mở barie.

## 3. Công nghệ sử dụng
| Thành phần | Công nghệ |
|---|---|
| Thiết bị | ESP32 DevKit, HC-SR04, NeoPixel, servo SG90, LCD 20x4 I2C, nút nhấn, buzzer. Mô phỏng trên **Wokwi** |
| Firmware | Arduino C++: `WiFi`, `PubSubClient` (MQTT), `ArduinoJson`, `ESP32Servo`, `Adafruit_NeoPixel`, `LiquidCrystal_I2C`, NTP |
| Broker | `broker.hivemq.com` (TCP 1883 / WebSocket 8000 / WSS 8884) |
| Backend | Node.js + Express, thư viện `mqtt`, `pg`, JWT, bcrypt. Deploy **Render** |
| CSDL | PostgreSQL trên **Neon** (nhánh `main` = thật, nhánh `test` = kiểm thử) |
| App | Expo SDK 58 / React Native, React Navigation |
