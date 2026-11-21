const bcrypt = require('bcryptjs');
const config = require('./config');
const { createDb } = require('./db');
const { createAuth } = require('./auth');
const { createSync } = require('./sync');
const { createLiveHub } = require('./live');
const { createMomoGateway } = require('./paymentGateway');
const { createMqttBridge } = require('./mqttBridge');
const { createApp } = require('./app');
const { createSocialVerifier } = require('./social');
const { createGatePass } = require('./gatePass');

async function ensureAdmin(db) {
  const { email, password } = config.admin;
  if (!email || !password) return;
  const hash = await bcrypt.hash(password, 10);
  await db.query(
    `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, 'Quan tri vien', 'admin')
     ON CONFLICT (email) DO UPDATE SET role = 'admin', password_hash = EXCLUDED.password_hash`,
    [email.toLowerCase(), hash]);
}

async function main() {
  const db = createDb(config.databaseUrl);
  await db.migrate();
  await ensureAdmin(db);

  const live = createLiveHub();
  const sync = createSync(db, { live });
  const device = createMqttBridge(config.mqtt, sync, { timeoutMs: config.deviceTimeoutMs });
  sync.attachDevice(device);
  const app = createApp({ db, auth: createAuth(config), device, otpDevMode: config.otpDevMode,
    social: createSocialVerifier(config.social), gatePass: createGatePass(config.jwtSecret), live,
    gateway: createMomoGateway(config.payments.momo), publicUrl: config.publicUrl, receiptSecret: config.jwtSecret,
    allowMockPayments: config.payments.allowMock });

  const server = app.listen(config.port, () => console.log(`[API] Dang chay tai cong ${config.port}`));

  const shutdown = async () => {
    server.close();
    await device.close();
    await db.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error('Khoi dong that bai:', e);
  process.exit(1);
});
