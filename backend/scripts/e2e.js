// Test end-to-end: API that -> MQTT -> ESP32 (Wokwi/phan cung) -> MQTT -> API -> DB
// Chay: node scripts/e2e.js [BASE_URL] [ADMIN_EMAIL] [ADMIN_PASSWORD]
const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const ADMIN = { email: process.argv[3], password: process.argv[4] };
const LOT = process.env.LOT_ID || 'sp-demo-01';

let pass = 0, fail = 0;
async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
function check(name, cond, info) {
  if (cond) pass++; else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + JSON.stringify(info) : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('API:', BASE);
  const h = await call('GET', '/api/health');
  check('health', h.status === 200 && h.body.ok, h.body);

  const lot = await call('GET', `/api/lots/${LOT}`);
  check('bai do online (ESP32 dang ket noi MQTT)', lot.body.online === true,
    { online: lot.body.online, fw: lot.body.fwVersion, lastSeenAt: lot.body.lastSeenAt });

  const email = `e2e${Date.now()}@test.vn`;
  const reg = await call('POST', '/api/auth/register', { email, password: '123456', fullName: 'E2E Tester' });
  check('dang ky', reg.status === 201);
  const token = reg.body.token;

  const free = lot.body.slots.find((s) => s.state === 'free');
  if (!free) { console.log('Khong con o trong de test'); process.exit(1); }

  const t0 = Date.now();
  const resv = await call('POST', `/api/lots/${LOT}/reservations`, { slotNumber: free.slotNumber, minutes: 5 }, token);
  check(`dat o ${free.slotNumber} -> ESP32 ack (${Date.now() - t0} ms)`, resv.status === 201 && resv.body.status === 'active', resv.body);

  await sleep(1500);
  const after = await call('GET', `/api/lots/${LOT}`);
  check('o chuyen sang reserved trong DB', after.body.slots[free.slotNumber - 1].state === 'reserved');

  const ext = await call('POST', `/api/reservations/${resv.body.id}/extend`, { minutes: 5 }, token);
  check('gia han', ext.status === 200 && ext.body.minutes === 10, ext.body);

  const del = await call('DELETE', `/api/reservations/${resv.body.id}`, null, token);
  check('huy dat cho', del.status === 200 && del.body.status === 'cancelled', del.body);

  if (ADMIN.email) {
    const a = await call('POST', '/api/auth/login', ADMIN);
    check('admin dang nhap', a.status === 200);
    const g = await call('POST', `/api/lots/${LOT}/gates/entry/open`, null, a.body.token);
    check('admin mo barie vao', g.status === 200, g.body);
    await sleep(4500);
    const l2 = await call('GET', `/api/lots/${LOT}`);
    check('barie tu dong dong lai (dong bo tu ESP32)', l2.body.gates.entry === 'closed', l2.body.gates);
    const ev = await call('GET', `/api/lots/${LOT}/events?limit=10`, null, a.body.token);
    check('nhat ky su kien co ghi gate/ack', ev.status === 200 && ev.body.some((e) => e.type === 'gate'),
      ev.body.slice(0, 4).map((e) => `${e.type}:${e.payload.action || e.payload.state || ''}`));
  }

  console.log(`\nKET QUA E2E: ${pass}/${pass + fail} PASS`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
