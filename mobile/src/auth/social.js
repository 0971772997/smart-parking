// Dang nhap Google / Facebook.
//
// Trang thai hien tai: CHUA BAT. Thu vien chinh thuc can code native nen khong chay trong Expo Go.
// Backend da san sang: POST /api/auth/social { provider, token } (server tu xac minh token).
//
// Cach bat (khi build APK rieng bang EAS - xem mobile/README.md):
//  1. npx expo install @react-native-google-signin/google-signin react-native-fbsdk-next
//  2. Khai bao config plugin + khoa trong app.json, dien SOCIAL_CONFIG ben duoi
//  3. Viet getGoogleIdToken / getFacebookAccessToken theo huong dan trong 2 ham do
//  4. Dat GOOGLE_CLIENT_IDS va FACEBOOK_APP_ID tren Render (backend)
import Constants, { ExecutionEnvironment } from 'expo-constants';

export const SOCIAL_CONFIG = {
  enabled: false,
  google: { webClientId: '' },      // OAuth client "Web application" tren Google Cloud Console
  facebook: { appId: '' },          // App ID tren developers.facebook.com
};

export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export class SocialUnavailableError extends Error {}

const NAMES = { google: 'Google', facebook: 'Facebook' };

// Tra ve token de gui len backend
export async function getProviderToken(provider) {
  const name = NAMES[provider];
  if (isExpoGo) {
    throw new SocialUnavailableError(`Đăng nhập ${name} cần bản cài đặt riêng (APK), không chạy được trong Expo Go.`);
  }
  if (!SOCIAL_CONFIG.enabled) {
    throw new SocialUnavailableError(`Đăng nhập ${name} chưa được cấu hình. Vui lòng dùng email và mật khẩu.`);
  }
  return provider === 'google' ? getGoogleIdToken() : getFacebookAccessToken();
}

async function getGoogleIdToken() {
  // const { GoogleSignin } = require('@react-native-google-signin/google-signin');
  // GoogleSignin.configure({ webClientId: SOCIAL_CONFIG.google.webClientId });
  // await GoogleSignin.hasPlayServices();
  // const res = await GoogleSignin.signIn();
  // return res.data.idToken;
  throw new SocialUnavailableError('Chưa gắn thư viện Google Sign-In.');
}

async function getFacebookAccessToken() {
  // const { LoginManager, AccessToken } = require('react-native-fbsdk-next');
  // const r = await LoginManager.logInWithPermissions(['public_profile', 'email']);
  // if (r.isCancelled) return null;
  // return (await AccessToken.getCurrentAccessToken()).accessToken;
  throw new SocialUnavailableError('Chưa gắn thư viện Facebook SDK.');
}
