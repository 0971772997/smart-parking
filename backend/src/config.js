const path = require('path');
const dotenv = require('dotenv');

// Thu tu uu tien: bien moi truong that (Render) > .env.local (Neon pull) > .env
const root = path.join(__dirname, '..');
if (process.env.NODE_ENV === 'test') dotenv.config({ path: path.join(root, '.env.test') });
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Thieu bien moi truong ${name}`);
  return v;
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? required('JWT_SECRET') : 'dev-secret-doi-khi-deploy'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  mqtt: {
    url: process.env.MQTT_URL || 'mqtt://broker.hivemq.com:1883',
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    topicPrefix: process.env.MQTT_TOPIC_PREFIX || 'smartparking',
  },
  otpDevMode: process.env.OTP_DEV_MODE !== 'false',   // tra ma OTP ve app (chua co SMS)
  social: {
    // Danh sach OAuth client ID cua Google (web, android, ios), cach nhau boi dau phay
    googleClientIds: (process.env.GOOGLE_CLIENT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
    facebookAppId: process.env.FACEBOOK_APP_ID || undefined,
  },
  deviceTimeoutMs: Number(process.env.DEVICE_TIMEOUT_MS) || 8000,
  // Dia chi cong khai cua API (de MoMo goi IPN / chuyen trinh duyet ve). Render tu cung cap RENDER_EXTERNAL_URL.
  publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${Number(process.env.PORT) || 3000}`).replace(/\/$/, ''),
  payments: {
    // Bo trong -> dung khoa THU NGHIEM cong khai cua MoMo (test-payment.momo.vn)
    momo: {
      endpoint: process.env.MOMO_ENDPOINT || undefined,
      partnerCode: process.env.MOMO_PARTNER_CODE || undefined,
      accessKey: process.env.MOMO_ACCESS_KEY || undefined,
      secretKey: process.env.MOMO_SECRET_KEY || undefined,
    },
    // Tai khoan NHAN TIEN cho thanh toan chuyen khoan / vi MoMo (admin xac nhan da nhan tien roi mo cong)
    payee: {
      bankName: process.env.PAY_BANK_NAME || 'MB Bank',
      bankBin: process.env.PAY_BANK_BIN || '970422', // ma BIN NAPAS cua MB Bank
      bankCode: process.env.PAY_BANK_CODE || 'mb',   // ma ngan hang cho deeplink VietQR (STK@mb)
      accountNo: process.env.PAY_ACCOUNT_NO || '0971772997',
      accountName: process.env.PAY_ACCOUNT_NAME || 'VO VIET MINH',
      momoPhone: process.env.PAY_MOMO_PHONE || '0971772997',
    },
    // Thanh toan gia lap tuc thi (khong qua cong): mac dinh tat tren production
    allowMock: process.env.ALLOW_MOCK_PAYMENTS ? process.env.ALLOW_MOCK_PAYMENTS === 'true' : process.env.NODE_ENV !== 'production',
  },
  admin: {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  },
};
