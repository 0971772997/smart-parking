// KIEM THU DON VI - BAO MAT LOI: JWT (xac thuc + khoa + doi quyen), ma QR qua cong, chu ky MoMo,
// lien ket bien nhan, gioi han dang nhap. Khong can DB (db gia lap).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { createAuth } = require('../../src/auth');
const { createGatePass } = require('../../src/gatePass');
const { createMomoGateway, outcome, SANDBOX } = require('../../src/paymentGateway');
const { receiptToken } = require('../../src/payments');
const { createLimiter } = require('../../src/rateLimit');

const SECRET = 'unit-secret';
const cfg = { jwtSecret: SECRET, jwtExpiresIn: '1h' };

// Chay middleware Express -> { user, error }
function run(mw, headers = {}) {
  return new Promise((resolve) => {
    const req = { headers };
    mw(req, {}, (err) => resolve({ user: req.user, error: err }));
  });
}
const bearer = (t) => ({ authorization: `Bearer ${t}` });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('JWT - requireAuth', () => {
  const auth = createAuth(cfg);
  const good = auth.sign({ id: 7, role: 'user' });

  test('Token hop le -> req.user', async () => {
    const r = await run(auth.requireAuth, bearer(good));
    assert.deepEqual(r.user, { id: 7, role: 'user' });
    assert.equal(r.error, undefined);
  });

  const bad = {
    'khong co header': {},
    'sai kieu (Basic)': { authorization: `Basic ${good}` },
    'chuoi rac': bearer('abc.def.ghi'),
    'ky bang khoa khac': bearer(jwt.sign({ sub: 7, role: 'admin' }, 'khoa-ke-gian')),
    'het han': bearer(jwt.sign({ sub: 7, role: 'user', exp: Math.floor(Date.now() / 1000) - 10 }, SECRET)),
    'alg none (khong chu ky)': bearer(`${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 7, role: 'admin' })}.`),
    'sua payload (doi role) giu chu ky cu': bearer((() => {
      const [h, , s] = good.split('.');
      return `${h}.${b64({ ...jwt.decode(good), role: 'admin' })}.${s}`;
    })()),
  };
  for (const [name, headers] of Object.entries(bad)) {
    test(`Tu choi: ${name} -> 401`, async () => {
      const r = await run(auth.requireAuth, headers);
      assert.equal(r.error?.status, 401);
      assert.equal(r.user, undefined);
    });
  }

  test('requireAdmin: user -> 403, admin -> qua', async () => {
    const reqU = { user: { id: 1, role: 'user' } };
    await new Promise((ok) => auth.requireAdmin(reqU, {}, (e) => { assert.equal(e.status, 403); ok(); }));
    await new Promise((ok) => auth.requireAdmin({ user: { id: 1, role: 'admin' } }, {}, (e) => { assert.equal(e, undefined); ok(); }));
  });

  test('optionalAuth: token sai -> nhu khach (khong loi)', async () => {
    let r = await run(auth.optionalAuth, bearer('rac'));
    assert.equal(r.user, undefined);
    assert.equal(r.error, undefined);
    r = await run(auth.optionalAuth, bearer(good));
    assert.equal(r.user.id, 7);
  });
});

describe('JWT - kiem tra tai khoan qua DB (khoa / doi quyen / xoa)', () => {
  const rows = new Map([[1, { id: 1, role: 'admin', locked_at: null }], [2, { id: 2, role: 'user', locked_at: new Date() }]]);
  let queries = 0;
  const db = { one: async (_sql, [id]) => { queries += 1; return rows.get(id) || null; } };
  const auth = createAuth(cfg, { db });

  test('Bi khoa -> 403 account_locked; tai khoan da xoa -> 401', async () => {
    let r = await run(auth.requireAuth, bearer(auth.sign({ id: 2, role: 'user' })));
    assert.equal(r.error.status, 403);
    assert.equal(r.error.code, 'account_locked');
    r = await run(auth.requireAuth, bearer(auth.sign({ id: 99, role: 'user' })));
    assert.equal(r.error.status, 401);
  });

  test('Quyen lay tu DB, khong tin role trong token cu; cache 30s; forget() lam moi ngay', async () => {
    const tok = auth.sign({ id: 1, role: 'admin' });
    queries = 0;
    assert.equal((await run(auth.requireAuth, bearer(tok))).user.role, 'admin');
    await run(auth.requireAuth, bearer(tok));
    assert.equal(queries, 1, 'lan 2 phai dung cache');
    rows.set(1, { id: 1, role: 'user', locked_at: null }); // bi ha quyen
    assert.equal((await run(auth.requireAuth, bearer(tok))).user.role, 'admin', 'con trong cache');
    auth.forget(1);
    assert.equal((await run(auth.requireAuth, bearer(tok))).user.role, 'user');
  });

  test('optionalAuth voi tai khoan bi khoa -> nhu khach', async () => {
    const r = await run(auth.optionalAuth, bearer(auth.sign({ id: 2, role: 'user' })));
    assert.equal(r.user, undefined);
    assert.equal(r.error, undefined);
  });
});

describe('Ma QR qua cong', () => {
  const gp = createGatePass('qr-secret');
  test('Ma hop le -> dung dat cho + cong', () => {
    const p = gp.issue(12345, 'exit');
    const v = gp.verify(p.token);
    assert.deepEqual([v.ok, v.reservationId, v.gate], [true, 12345, 'exit']);
  });
  test('Sua bat ky phan nao -> qr_invalid', () => {
    const { token } = gp.issue(5, 'entry');
    const parts = token.split('.');
    const variants = [
      [parts[0], (6).toString(36), ...parts.slice(2)], // doi id dat cho
      [...parts.slice(0, 2), 'X', ...parts.slice(3)], // doi cong
      [...parts.slice(0, 3), (Number.parseInt(parts[3], 36) + 9999).toString(36), ...parts.slice(4)], // keo dai han
      [...parts.slice(0, 5), 'AAAAAAAAAAAAAAAA'], // chu ky gia
      ['SP2', ...parts.slice(1)], // sai phien ban
    ];
    for (const v of variants) assert.equal(gp.verify(v.join('.')).error, 'qr_invalid', v.join('.'));
    for (const junk of ['', null, undefined, 'SP1', 'https://evil.example/?x=1', 'a'.repeat(5000)]) {
      assert.equal(gp.verify(junk).ok, false);
    }
  });
  test('Ma cua khoa khac -> qr_invalid; het han (qua 5s du phong) -> qr_expired', () => {
    assert.equal(gp.verify(createGatePass('khac').issue(5, 'entry').token).error, 'qr_invalid');
    assert.equal(gp.verify(gp.issue(5, 'entry', -10).token).error, 'qr_expired');
    assert.equal(gp.verify(gp.issue(5, 'entry', -2).token).ok, true); // tre 2s van chap nhan
  });
});

describe('Chu ky MoMo (IPN / redirect) + lien ket bien nhan', () => {
  const gw = createMomoGateway({ fetchFn: async () => { throw new Error('khong goi mang'); } });
  const body = { partnerCode: 'MOMO', orderId: 'SP1-X', requestId: 'SP1-X', amount: 10000, orderInfo: 'x', orderType: 'momo_wallet',
    transId: 1, resultCode: 0, message: 'ok', payType: 'qr', responseTime: 1, extraData: '' };
  const signed = { ...body, signature: gw.sign({ accessKey: SANDBOX.accessKey, ...Object.fromEntries(
    ['amount', 'extraData', 'message', 'orderId', 'orderInfo', 'orderType', 'partnerCode', 'payType', 'requestId', 'responseTime', 'resultCode', 'transId']
      .map((k) => [k, body[k]])) }) };

  test('Chu ky dung -> chap nhan', () => assert.equal(gw.verifyResult(signed), true));
  test('Doi so tien / ket qua / ma don, sai doi tac, thieu chu ky -> tu choi', () => {
    for (const tamper of [{ amount: 1 }, { resultCode: 1006 }, { orderId: 'SP2-X' }, { partnerCode: 'KHAC' }, { signature: undefined }, { signature: 'ab' }]) {
      assert.equal(gw.verifyResult({ ...signed, ...tamper }), false, JSON.stringify(tamper));
    }
    assert.equal(gw.verifyResult(null), false);
  });
  test('Ma ket qua -> trang thai don', () => {
    assert.deepEqual([0, 1000, 7000, 9000, 1006, 1001, 99].map(outcome), ['paid', 'pending', 'pending', 'pending', 'failed', 'failed', 'failed']);
  });
  test('Token bien nhan: on dinh, phu thuoc khoa + so bien nhan', () => {
    assert.equal(receiptToken('k', 'BL1'), receiptToken('k', 'BL1'));
    assert.notEqual(receiptToken('k', 'BL1'), receiptToken('k', 'BL2'));
    assert.notEqual(receiptToken('k', 'BL1'), receiptToken('k2', 'BL1'));
  });
});

describe('Gioi han dang nhap sai', () => {
  test('Qua max lan sai -> chan, bao thoi gian cho; het cua so -> mo lai; reset khi dung', () => {
    let t = 0;
    const lim = createLimiter({ max: 3, windowMs: 60000, now: () => t });
    for (let i = 0; i < 3; i += 1) { assert.equal(lim.check('k').allowed, true); lim.fail('k'); }
    const c = lim.check('k');
    assert.equal(c.allowed, false);
    assert.equal(c.retryAfter, 60);
    assert.equal(lim.check('khac').allowed, true, 'khoa khac khong anh huong');
    t = 60001;
    assert.equal(lim.check('k').allowed, true);
    lim.fail('k'); lim.reset('k');
    assert.equal(lim.size(), 0);
  });
});
