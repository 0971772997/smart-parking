// Tao hoac doi mat khau tai khoan admin trong DB:
//   npm run set-admin -- <email> <mat-khau>
// (khong truyen tham so -> lay ADMIN_EMAIL / ADMIN_PASSWORD trong .env)
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const { createDb } = require('../src/db');

(async () => {
  const email = (process.argv[2] || config.admin.email || '').toLowerCase();
  const password = process.argv[3] || config.admin.password;
  if (!email || !password || password.length < 6) {
    console.error('Can email va mat khau (>= 6 ky tu)');
    process.exit(1);
  }
  const db = createDb(config.databaseUrl);
  const hash = await bcrypt.hash(password, 10);
  await db.query(
    `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, 'Quan tri vien', 'admin')
     ON CONFLICT (email) DO UPDATE SET role = 'admin', password_hash = EXCLUDED.password_hash`, [email, hash]);
  console.log('Da dat mat khau admin cho', email);
  await db.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
