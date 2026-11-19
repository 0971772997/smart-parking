# Wokwi – Bãi đậu xe thông minh (ESP32)

> `sketch.ino` ở đây **giống hệt** `../arduino/SmartParking/SmartParking.ino`, chỉ khác `config.h`.
> Khi sửa code: sửa bản trong `arduino/`, rồi chép sang `wokwi/sketch.ino`.

## Cách chạy – cách 1: wokwi.com (trình duyệt)
1. Vào https://wokwi.com → **New Project** → **ESP32**.
2. Dán `sketch.ino`, `diagram.json` vào tab tương ứng. Tạo thêm tab `libraries.txt` và `config.h` bằng nút ▾ → *New file*, rồi dán nội dung vào.
3. Đổi `PARKING_ID` trong `config.h` nếu cần (broker công khai, nên tránh trùng với người khác).
4. Bấm ▶ Start.

## Cách chạy – cách 2: VS Code trên máy (dùng firmware biên dịch bằng Arduino)
1. Cài extension **Wokwi Simulator** trong VS Code, rồi chạy `Wokwi: Request a new License` (miễn phí).
2. Biên dịch ra `wokwi/build/`. Trong Arduino IDE dùng Sketch → Export Compiled Binary, hoặc chạy arduino-cli:
   `arduino-cli compile -b esp32:esp32:esp32 --output-dir build <thư mục chứa sketch.ino + config.h>`
3. Mở thư mục `wokwi` bằng VS Code → mở `diagram.json` → **Wokwi: Start Simulator**.

## Test không cần app
Gõ vào Serial Monitor (115200): `help`, `status`, `in`, `out`, `wifi`, hoặc gõ lệnh JSON giống app, ví dụ
`{"action":"reserve","slot":2,"minutes":15}`.

**Mô phỏng:**
- Bấm vào cảm biến HC-SR04 (`slot1`..`slot4`) → kéo thanh khoảng cách **< 50 cm** = có xe.
- Nút xanh **XE VAO** → mở barie vào (nếu còn chỗ trống), nút đỏ **XE RA** → mở barie ra. Barie tự đóng sau 3 giây.
- LED: 🟢 trống · 🔴 có xe · 🟡 đã đặt chỗ (từ app).

## Sơ đồ chân

| Linh kiện | Chân ESP32 |
|---|---|
| HC-SR04 ô 1 (TRIG/ECHO) | 4 / 34 |
| HC-SR04 ô 2 | 16 / 35 |
| HC-SR04 ô 3 | 17 / 36 (VP) |
| HC-SR04 ô 4 | 5 / 39 (VN) |
| NeoPixel x4 (DIN) | 15 |
| Servo barie vào | 13 |
| Servo barie ra | 14 |
| Nút XE VÀO / XE RA | 32 / 33 (INPUT_PULLUP) |
| Buzzer | 25 |
| LCD 20x4 I2C (SDA/SCL, addr 0x27) | 21 / 22 |

## Giao thức MQTT (dành cho app di động)

Broker: `broker.hivemq.com` – TCP `1883`, WebSocket `8000` (path `/mqtt`), WSS `8884`.
Tiền tố topic: `smartparking/{PARKING_ID}/`

| Topic | Hướng | Retained | Mô tả |
|---|---|---|---|
| `status` | ESP32 → App | ✔ | Toàn bộ trạng thái bãi, gửi khi có thay đổi + mỗi 10 s |
| `event` | ESP32 → App | ✗ | Sự kiện: xe vào/ra ô, barie, phản hồi lệnh |
| `cmd` | App → ESP32 | ✗ | Lệnh điều khiển |
| `online` | ESP32 → App | ✔ | `"1"` online, `"0"` mất kết nối (LWT) |

### `status`
```json
{
  "id": "sp-demo-01", "fw": "1.1.0", "total": 4, "free": 2, "occupied": 1, "reserved": 1,
  "slots": [
    { "id": 1, "state": "occupied", "distance": 20, "occupiedSeconds": 315 },
    { "id": 2, "state": "reserved", "distance": 400, "reservedSecondsLeft": 842 },
    { "id": 3, "state": "free", "distance": 400 },
    { "id": 4, "state": "free", "distance": 400 }
  ],
  "gates": { "entry": "closed", "exit": "closed" },
  "stats": { "entries": 5, "exits": 4, "rejected": 1 },
  "uptime": 123, "time": 1795600000, "rssi": -61
}
```
- `time`: thời gian thực (epoch UTC, tính bằng giây), đồng bộ qua NTP. Trường này **không có** khi chưa đồng bộ được.
- `ts` (trong event) và `uptime`: số giây kể từ khi ESP32 khởi động.
- `stats` đếm từ lúc khởi động. Gửi lệnh `reset_stats` để xoá về 0.

### `event`
```json
{ "type": "slot_changed", "slot": 1, "state": "occupied", "reservationFulfilled": true, "ts": 120, "time": 1795600000 }
{ "type": "slot_changed", "slot": 1, "state": "free", "parkedSeconds": 3600, "ts": 3720 }
{ "type": "gate", "gate": "entry", "state": "open", "by": "button", "ts": 121 }   // by: button | app | serial | auto
{ "type": "entry_rejected", "reason": "full", "ts": 130 }
{ "type": "reservation_expired", "slot": 2, "ts": 900 }
{ "type": "ack", "action": "reserve", "ok": true, "slot": 2, "minutes": 15, "requestId": "abc", "ts": 140 }
```

### `cmd`
```json
{ "action": "open_gate", "gate": "entry" }            // hoặc "exit"; app mở được cổng vào cả khi bãi đầy
{ "action": "close_gate", "gate": "entry" }
{ "action": "reserve", "slot": 2, "minutes": 15, "requestId": "abc" }   // minutes 1..120
{ "action": "extend_reservation", "slot": 2, "minutes": 10 }
{ "action": "cancel_reservation", "slot": 2 }
{ "action": "reset_stats" }
{ "action": "get_status" }
```
Mọi lệnh đều được trả lời bằng một event `ack`. Nếu lệnh có `requestId` thì `ack` gửi lại đúng `requestId` đó, để app biết đây là phản hồi cho lệnh nào.
Lỗi trả về trong `ack.error`: `invalid_slot`, `invalid_gate`, `invalid_minutes`, `slot_not_free`, `not_reserved`, `unknown_action`.

**Thử nhanh không cần app:** mở https://www.hivemq.com/demos/websocket-client/ → Connect → Subscribe `smartparking/sp-demo-01/#` → Publish lên `smartparking/sp-demo-01/cmd`.
