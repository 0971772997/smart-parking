const express = require('express');
const cors = require('cors');
const { HttpError } = require('./errors');
const { createGatePass } = require('./gatePass');
const { createLiveHub } = require('./live');
const { createMomoGateway } = require('./paymentGateway');
const { setPushHook } = require('./notifyHub');

// Thao tac lam thay doi bai do / dat cho / phien gui xe -> bao app dang cho cap nhat (long-poll)
const LIVE_PATHS = /^\/api\/(lots|reservations|gates|sessions|payments|support|favorites|reviews|admin)\b/;

const DB_DOWN_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', '57P01', '57P03', '08000', '08001', '08003', '08006']);
const isDbDown = (e) => DB_DOWN_CODES.has(e.code) || /Connection terminated|connect ETIMEDOUT|timeout exceeded when trying to connect/i.test(e.message || '');

function createApp({ db, auth, device, otpDevMode = true, social, gatePass = createGatePass('dev-qr-secret'),
  live = createLiveHub(), gateway = createMomoGateway(), publicUrl = 'http://localhost:3000', receiptSecret = 'dev-receipt-secret',
  allowMockPayments = true, push = null, loginLimits, payee = require('./config').payments.payee }) {
  // Thong bao moi -> day toi dien thoai (push = createPushService; bo trong khi khong can, vd mot so test)
  setPushHook(push ? (row) => push.sendNotification(row) : null);
  const app = express();
  app.disable('x-powered-by');
  // Render dat API sau 1 proxy -> lay IP that cua nguoi dung (gioi han dang nhap theo IP)
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(cors());
  // Header bao mat co ban (API JSON, khong dung cookie)
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && LIVE_PATHS.test(req.path)) res.on('finish', () => res.statusCode < 400 && live.bump());
    next();
  });

  app.get('/', (_req, res) => res.json({ name: 'Smart Parking API', docs: '/api/health' }));
  app.get('/api/health', async (_req, res) => {
    res.json({ ok: true, mqtt: device.connected ? device.connected() : null, time: new Date().toISOString() });
  });

  app.use('/api/auth', require('./routes/auth')({ db, auth, otpDevMode, social, loginLimits }));
  app.use('/api/vehicles', require('./routes/vehicles')({ db, auth }));
  app.use('/api', require('./routes/feedback')({ db, auth })); // /favorites, /lots/:id/reviews (truoc router /lots)
  app.use('/api/lots', require('./routes/lots')({ db, auth, device }));
  app.use('/api/reservations', require('./routes/reservations')({ db, auth, device, gatePass }));
  app.use('/api/gates', require('./routes/gates')({ db, auth, device, gatePass }));
  app.use('/api/schedules', require('./routes/schedules')({ db, auth }));
  app.use('/api', require('./routes/live')({ db, live }));
  app.use('/api', require('./routes/sessions')({ db, auth }));
  app.use('/api', require('./routes/history')({ db, auth }));
  app.use('/api', require('./routes/support')({ db, auth }));
  app.use('/api', require('./routes/push')({ db, auth, push }));
  app.use('/api/admin', require('./routes/admin')({ db, auth, device, publicUrl, receiptSecret }));
  app.use('/api', require('./routes/payments')({
    db, auth, device, gateway, publicUrl, receiptSecret, allowMock: allowMockPayments, live, payee,
  }));

  app.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Khong tim thay API')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'invalid_json', 'Body khong phai JSON hop le');
    if (err.type === 'entity.too.large') err = new HttpError(413, 'payload_too_large', 'Du lieu gui len qua lon');
    // Mat ket noi CSDL (Neon ngu / mang loi) -> 503 de app bao "may chu tam gian doan" va thu lai
    if (!err.status && isDbDown(err)) {
      console.error('[API] CSDL khong san sang:', err.code || err.message);
      err = new HttpError(503, 'service_unavailable', 'May chu tam thoi gian doan, vui long thu lai');
    }
    const status = err.status || 500;
    if (status >= 500 && ![502, 503, 504].includes(status)) console.error('[API] loi:', err);
    res.status(status).json({
      error: err.code || 'internal_error',
      message: status === 500 ? 'Loi may chu' : err.message,
      ...(err.details && { details: err.details }),
    });
  });

  return app;
}

module.exports = { createApp };
