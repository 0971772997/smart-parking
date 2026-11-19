# SmartPark – App di động

Expo SDK 58 · React Native · JavaScript · React Navigation (native-stack)

## Chạy app
```bash
npm install
npx expo start -c        # quét mã QR bằng Expo Go (Expo Go phải hỗ trợ SDK 58)
npx expo start --web     # chạy thử trên trình duyệt
```
App gọi API trên Render: `src/api/client.js` (`API_URL`).

## Màn hình đã có

| Màn hình | File | Chức năng |
|---|---|---|
| Splash | `src/screens/SplashScreen.js` | Logo có hiệu ứng. Tự đăng nhập nếu đã bật "Tự động đăng nhập". Báo khi máy chủ đang khởi động |
| Đăng nhập (UI-001) | `src/screens/auth/LoginScreen.js` | Email + mật khẩu, Lưu ID, Tự động đăng nhập, Quên mật khẩu, nút Google / Facebook, link Đăng ký |
| Đăng ký (UI-002) | `src/screens/auth/RegisterScreen.js` | Tên đăng nhập, email, số điện thoại, mật khẩu, nhập lại mật khẩu. Kiểm tra từng ô; nếu trùng username/email thì báo ngay dưới ô đó |
| Quên mật khẩu | `src/screens/auth/FindPasswordScreen.js` | Email → mã OTP (giả lập) → đặt mật khẩu mới |
| Trang chủ (tạm) | `src/screens/home/HomeScreen.js` | Thông tin tài khoản, đăng xuất |

Lưu trữ: token đăng nhập lưu trong SecureStore. Email đã lưu và các tuỳ chọn lưu trong AsyncStorage.

## Đăng nhập Google / Facebook – cách bật

Hiện tại hai nút đã có nhưng **chưa bật**:
- Trong Expo Go, bấm nút sẽ hiện thông báo "cần bản cài đặt riêng (APK)".
- Lý do: thư viện chính thức cần code native, nên không chạy được trong Expo Go.
- Backend đã sẵn sàng: `POST /api/auth/social` tự xác minh token với Google/Facebook. Sau đó server tìm tài khoản, hoặc liên kết theo email, hoặc tạo tài khoản mới.

Các bước bật:
1. **Google Cloud Console** → tạo OAuth Client loại *Web application* và loại *Android*. Loại Android cần package `vn.smartpark.app` và mã SHA-1 của khoá ký app (lấy bằng `npx eas-cli credentials`).
2. **Facebook Developers** → tạo App, bật Facebook Login, lấy *App ID* và *Client Token*.
3. Cài thư viện:
   ```bash
   npx expo install @react-native-google-signin/google-signin react-native-fbsdk-next
   ```
   Thêm config plugin của 2 thư viện vào `app.json`, theo hướng dẫn Expo của từng thư viện.
4. Mở `src/auth/social.js`: đặt `SOCIAL_CONFIG.enabled = true`, điền `webClientId` / `appId`, rồi bỏ comment trong 2 hàm lấy token.
5. Trên Render, thêm 2 biến môi trường:
   - `GOOGLE_CLIENT_IDS` = các client ID, cách nhau bằng dấu phẩy
   - `FACEBOOK_APP_ID`
6. Build APK: `npx eas-cli build -p android --profile development`, rồi cài APK lên điện thoại thay cho Expo Go.
