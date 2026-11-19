// Tao bang + du lieu mau: npm run migrate
const config = require('../src/config');
const { createDb } = require('../src/db');

(async () => {
  const db = createDb(config.databaseUrl);
  await db.migrate();
  const { rows } = await db.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`);
  console.log('Da migrate. Cac bang:', rows.map((r) => r.table_name).join(', '));
  await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
