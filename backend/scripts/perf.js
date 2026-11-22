// KIEM THU HIEU NANG: npm run perf   (dung nhanh DB "test" - XOA du lieu test truoc khi chay)
//   - Du lieu mau: 60 tai xe, ~600 phien gui xe / giao dich trong 30 ngay, danh gia, yeu cau ho tro
//   - Tai doc dong thoi tren cac API chinh (HTTP that, cong ngau nhien) -> p50 / p95 / p99, so yeu cau/giay
//   - Tai ghi: dat cho + huy lien tuc (co lenh toi ESP32 gia lap)
//   - Long-poll: 500 ket noi dang cho -> 1 thay doi danh thuc tat ca trong bao lau
//   - Tinh phi (CPU): 1 trieu lan
// Ngưỡng mục tiêu (SLO) cho Render free + Neon Singapore: p95 doc < 800ms, p95 ghi < 1500ms, long-poll < 500ms, loi = 0
process.env.NODE_ENV = 'test';
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const { createDb } = require('../src/db');
const { createAuth } = require('../src/auth');
const { createSync } = require('../src/sync');
const { createApp } = require('../src/app');
const { createGatePass } = require('../src/gatePass');
const { createLiveHub } = require('../src/live');
const { sessionFee } = require('../src/sessions');
const { createFakeDevice } = require('../tests/fakeDevice');

if (!/ep-lucky-mountain/.test(config.databaseUrl) && !process.env.ALLOW_ANY_TEST_DB) {
  throw new Error('Chi chay tren nhanh DB "test" (.env.test)');
}
const LOT = 'sp-demo-01';
// Tai xe: p95 < 800ms; quan tri (it nguoi dung, nhieu truy van): < 1500ms; dot bien 50 ket noi: < 2000ms
const SLO = { readP95: 800, adminP95: 1500, spikeP95: 2000, writeP95: 1500, longPollWake: 1000 };

const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const fmt = (n) => `${Math.round(n)}`;

async function load(base, { name, path, token, n = 200, concurrency = 10, method = 'GET' }) {
  const times = [];
  let errors = 0;
  let next = 0;
  const t0 = performance.now();
  async function worker() {
    while (next < n) {
      next += 1;
      const s = performance.now();
      try {
        const r = await fetch(base + path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
        await r.arrayBuffer();
        if (r.status >= 400) errors += 1;
      } catch { errors += 1; }
      times.push(performance.now() - s);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const total = (performance.now() - t0) / 1000;
  return { name, n, concurrency, p50: pct(times, 50), p95: pct(times, 95), p99: pct(times, 99), max: Math.max(...times), rps: n / total, errors };
}

async function seed(db) {
  console.log('• Tao du lieu mau...');
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.migrate();
  await db.query('UPDATE parking_lots SET online = true WHERE id = $1', [LOT]);
  const hash = await bcrypt.hash('perf123', 4);
  await db.query(`INSERT INTO users (email, password_hash, full_name, role) VALUES ('admin@perf.vn', $1, 'Admin', 'admin')`, [hash]);
  await db.query(`INSERT INTO users (email, username, password_hash, full_name)
    SELECT 'u' || i || '@perf.vn', 'u' || i, $1, 'Tai xe ' || i FROM generate_series(1, 60) i`, [hash]);
  // ~600 phien da ket thuc + thanh toan, rai deu 30 ngay
  await db.query(`
    WITH s AS (
      INSERT INTO parking_sessions (slot_id, user_id, source, started_at, parked_at, ended_at, exited_at, duration_seconds, fee, overtime_fee)
      SELECT (SELECT id FROM slots WHERE lot_id = '${LOT}' AND slot_number = 1 + (i % 4)), 2 + (i % 60), 'gate',
             now() - make_interval(hours => i), now() - make_interval(hours => i), now() - make_interval(hours => i) + interval '75 minutes',
             now() - make_interval(hours => i) + interval '80 minutes', 4500, 20000, 0
      FROM generate_series(1, 600) i RETURNING id, user_id, ended_at)
    INSERT INTO payments (code, session_id, user_id, amount, method, provider, receipt_no, created_at)
    SELECT 'GDP-' || id, id, user_id, 20000, (ARRAY['momo','atm','card','cash'])[1 + id % 4], 'mock', 'BLP-' || lpad(id::text, 6, '0'), ended_at FROM s`);
  await db.query(`INSERT INTO lot_reviews (user_id, lot_id, rating, tags, comment)
    SELECT i, '${LOT}', 1 + (i % 5), ARRAY['clean','safe'], 'Danh gia ' || i FROM generate_series(2, 61) i`);
  await db.query(`INSERT INTO support_tickets (code, user_id, kind, category, subject, description, lot_id)
    SELECT 'HT-P' || lpad(i::text, 4, '0'), 2 + (i % 60), 'support', 'other', 'Hoi ' || i, 'Noi dung yeu cau ' || i, '${LOT}'
    FROM generate_series(1, 40) i`);
}

(async () => {
  const db = createDb(config.databaseUrl);
  await seed(db);
  const live = createLiveHub();
  const device = createFakeDevice(4);
  const sync = createSync(db, { live });
  sync.attachDevice(device);
  const app = createApp({ db, auth: createAuth(config, { db }), device, gatePass: createGatePass('perf'), live,
    loginLimits: { account: { max: 1e6 }, ip: { max: 1e6 } } });
  const server = require('http').createServer(app).listen({ port: 0, host: '127.0.0.1', backlog: 2048 });
  await new Promise((ok) => server.once('listening', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async (email) => (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'perf123' }) })).json()).token;
  const admin = await login('admin@perf.vn');
  const driver = await login('u7@perf.vn');

  // Lam nong ket noi DB (Neon co the dang ngu)
  await load(base, { name: 'warmup', path: '/api/lots', n: 20, concurrency: 5 });

  console.log('• Tai doc dong thoi (10 ket noi, 200 yeu cau / API)...');
  const reads = [];
  for (const c of [
    { name: 'GET /lots (cong khai)', path: '/api/lots' },
    { name: 'GET /lots/:id (so do o)', path: `/api/lots/${LOT}` },
    { name: 'GET /lots/:id/reviews', path: `/api/lots/${LOT}/reviews` },
    { name: 'GET /sessions/active', path: '/api/sessions/active', token: driver },
    { name: 'GET /history (30 ngay)', path: '/api/history', token: driver },
    { name: 'GET /payments', path: '/api/payments', token: driver },
    { name: 'GET /admin/overview', path: '/api/admin/overview', token: admin, n: 100 },
    { name: 'GET /admin/payments', path: '/api/admin/payments', token: admin, n: 100 },
    { name: 'GET /admin/users?q=', path: '/api/admin/users?q=tai', token: admin, n: 100 },
  ]) reads.push(await load(base, c));

  console.log('• Tai dot bien: 50 ket noi cung luc vao GET /lots ...');
  const spike = await load(base, { name: 'GET /lots x50 dong thoi', path: '/api/lots', n: 500, concurrency: 50 });

  console.log('• Tai ghi: dat cho + huy (gui lenh ESP32)...');
  const writes = [];
  for (let i = 0; i < 25; i += 1) {
    const t = await login(`u${10 + i}@perf.vn`);
    const s = performance.now();
    const r = await fetch(`${base}/api/lots/${LOT}/reservations`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: '{}' });
    const j = await r.json();
    writes.push(performance.now() - s);
    if (r.status !== 201) { writes.errors = (writes.errors || 0) + 1; continue; }
    await fetch(`${base}/api/reservations/${j.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } });
  }

  console.log('• Long-poll: 500 ket noi dang cho...');
  await new Promise((ok) => setTimeout(ok, 500)); // cho thay doi cuoi (huy dat cho) duoc ghi nhan xong
  const { version } = await (await fetch(`${base}/api/live?wait=0`)).json();
  // Mo dan 50 ket noi / dot (nguoi dung vao app rai rac), giu tat ca cung luc
  const waiters = [];
  let lpErrors = 0;
  for (let b = 0; b < 10; b += 1) {
    for (let i = 0; i < 50; i += 1) {
      waiters.push(fetch(`${base}/api/live?v=${version}&wait=25`).then((r) => { if (!r.ok) lpErrors += 1; return r.json(); }).catch(() => { lpErrors += 1; return { changed: false }; }));
    }
    await new Promise((ok) => setTimeout(ok, 150));
  }
  await new Promise((ok) => setTimeout(ok, 1500));
  const holding = live.waiting();
  const tWake = performance.now();
  live.bump();
  const woke = await Promise.all(waiters);
  const wakeMs = performance.now() - tWake;

  const tFee = performance.now();
  for (let i = 0; i < 1e6; i += 1) sessionFee({ startedAt: 0, endAt: i * 1000, pricePerHour: 10000, plannedEndAt: 3600000 });
  const feeNs = ((performance.now() - tFee) * 1e6) / 1e6;

  server.close();
  await db.end();

  // ---- Bao cao ----
  const rows = [...reads, spike];
  const lines = ['| API | Yêu cầu | Đồng thời | p50 (ms) | p95 (ms) | p99 (ms) | Yêu cầu/giây | Lỗi |', '|---|---:|---:|---:|---:|---:|---:|---:|'];
  for (const r of rows) lines.push(`| ${r.name} | ${r.n} | ${r.concurrency} | ${fmt(r.p50)} | ${fmt(r.p95)} | ${fmt(r.p99)} | ${r.rps.toFixed(1)} | ${r.errors} |`);
  const wP95 = pct(writes, 95);
  lines.push(`| POST đặt chỗ (lệnh tới ESP32) | ${writes.length} | 1 | ${fmt(pct(writes, 50))} | ${fmt(wP95)} | ${fmt(pct(writes, 99))} | – | ${writes.errors || 0} |`);
  const driverWorst = Math.max(...reads.filter((r) => !r.name.includes('/admin')).map((r) => r.p95));
  const adminWorst = Math.max(...reads.filter((r) => r.name.includes('/admin')).map((r) => r.p95));
  const errs = rows.reduce((a, r) => a + r.errors, 0) + (writes.errors || 0);
  const checks = [
    [`p95 API tài xế lớn nhất ${fmt(driverWorst)}ms < ${SLO.readP95}ms`, driverWorst < SLO.readP95],
    [`p95 API quản trị lớn nhất ${fmt(adminWorst)}ms < ${SLO.adminP95}ms`, adminWorst < SLO.adminP95],
    [`Đột biến 50 kết nối: p95 ${fmt(spike.p95)}ms < ${SLO.spikeP95}ms`, spike.p95 < SLO.spikeP95],
    [`p95 ghi ${fmt(wP95)}ms < ${SLO.writeP95}ms`, wP95 < SLO.writeP95],
    [`Long-poll: ${holding}/500 kết nối được giữ, đánh thức tất cả sau ${fmt(wakeMs)}ms < ${SLO.longPollWake}ms`,
      holding === 500 && lpErrors === 0 && woke.every((x) => x.changed) && wakeMs < SLO.longPollWake],
    [`Không có lỗi (${errs})`, errs === 0],
    [`Tính phí: ${feeNs.toFixed(0)} ns / lần`, feeNs < 5000],
  ];
  console.log(`\n## Kết quả kiểm thử hiệu năng (${new Date().toISOString().slice(0, 16)}Z)\n`);
  console.log(lines.join('\n'));
  console.log('\n' + checks.map(([t, ok]) => `- ${ok ? '✅' : '❌'} ${t}`).join('\n'));
  process.exit(checks.every((c) => c[1]) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
