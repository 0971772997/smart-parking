# Bãi đậu xe thông minh – ESP32 (phần cứng thật, Arduino IDE)

Bản này dùng chung code với bản Wokwi (`../wokwi/sketch.ino`), chỉ khác file `config.h`.
Sơ đồ chân và giao thức MQTT dành cho app được mô tả trong `../wokwi/README.md`.

Tính năng (firmware 1.1.0):
- 4 ô đỗ dùng cảm biến HC-SR04. Chỉ đổi trạng thái ô khi **3 lần đọc liên tiếp** cho cùng kết quả, để lọc nhiễu.
- Đèn NeoPixel theo trạng thái ô: xanh = trống, đỏ = có xe, vàng = đã đặt chỗ.
- Hai barie vào/ra dùng servo, tự đóng sau 3 giây. Cổng vào từ chối mở khi bãi đầy và có còi báo.
- LCD 20x4 hiển thị số chỗ trống, trạng thái từng ô, giờ thực (NTP) và tình trạng kết nối với app. LCD không bị nhấp nháy khi cập nhật.
- MQTT: gửi trạng thái và sự kiện, nhận lệnh từ app (đặt chỗ, gia hạn, huỷ, mở/đóng barie, xoá thống kê).
- Thống kê số lượt vào, lượt ra và lượt bị từ chối. Ghi lại thời gian mỗi xe đã đỗ.
- Serial console: gõ `help` để xem lệnh. Có thể gõ lệnh JSON giống app để test khi chưa có app.

## Nạp code
1. Sửa `SmartParking/config.h`: điền tên WiFi 2.4 GHz, mật khẩu và `PARKING_ID` (phải trùng với app).
2. Arduino IDE → File → Open → `SmartParking/SmartParking.ino`.
3. Tools → Board → esp32 → **ESP32 Dev Module**. Tools → Port → chọn cổng COM của ESP32.
4. Bấm Upload. Nếu bị kẹt ở "Connecting…", giữ nút **BOOT** trên board cho đến khi bắt đầu nạp.
5. Mở Serial Monitor ở tốc độ **115200** để xem log WiFi/MQTT và JSON trạng thái.

Đã có sẵn: core `esp32:esp32` 4.0.0, LiquidCrystal I2C, ESP32Servo, ArduinoJson, PubSubClient, Adafruit NeoPixel.
(Dữ liệu Arduino đã chuyển sang `D:\Arduino15` vì ổ C đầy.)

## Lưu ý khi lắp mạch
- **ECHO của HC-SR04 ra 5V**, mà ESP32 chỉ chịu 3.3V → mỗi chân ECHO cần mắc cầu chia áp (ECHO–1kΩ–chân ESP32–2kΩ–GND).
  Hoặc dùng loại HC-SR04P chạy 3.3V.
- Servo nên cấp nguồn 5V riêng (≥1A), **nối chung GND** với ESP32.
- LCD I2C nếu không hiện chữ: vặn biến trở tương phản phía sau. Nếu vẫn không được, đổi địa chỉ `0x27` thành `0x3F`.
- Các chân 34/35/36/39 chỉ dùng làm input, không có điện trở kéo lên. Với ECHO thì không sao.
