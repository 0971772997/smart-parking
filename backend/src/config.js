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
  deviceTimeoutMs: Number(process.env.DEVICE_TIMEOUT_MS) || 8000,
  admin: {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  },
};
