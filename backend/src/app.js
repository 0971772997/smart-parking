const express = require('express');
const cors = require('cors');
const { HttpError } = require('./errors');
const { createGatePass } = require('./gatePass');
const { createLiveHub } = require('./live');

// Thao tac lam thay doi bai do / dat cho / phien gui xe -> bao app dang cho cap nhat (long-poll)
const LIVE_PATHS = /^\/api\/(lots|reservations|gates|sessions|payments)\b/;

function createApp({ db, auth, device, otpDevMode = true, social, gatePass = createGatePass('dev-qr-secret'),
  live = createLiveHub() }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && LIVE_PATHS.test(req.path)) res.on('finish', () => res.statusCode < 400 && live.bump());
    next();
  });

  app.get('/', (_req, res) => res.json({ name: 'Smart Parking API', docs: '/api/health' }));
  app.get('/api/health', async (_req, res) => {
    res.json({ ok: true, mqtt: device.connected ? device.connected() : null, time: new Date().toISOString() });
  });

  app.use('/api/auth', require('./routes/auth')({ db, auth, otpDevMode, social }));
  app.use('/api/vehicles', require('./routes/vehicles')({ db, auth }));
  app.use('/api/lots', require('./routes/lots')({ db, auth, device }));
  app.use('/api/reservations', require('./routes/reservations')({ db, auth, device, gatePass }));
  app.use('/api/gates', require('./routes/gates')({ db, auth, device, gatePass }));
  app.use('/api/schedules', require('./routes/schedules')({ db, auth }));
  app.use('/api', require('./routes/live')({ db, live }));
  app.use('/api', require('./routes/sessions')({ db, auth }));
  app.use('/api', require('./routes/payments')({ db, auth }));

  app.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Khong tim thay API')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'invalid_json', 'Body khong phai JSON hop le');
    const status = err.status || 500;
    if (status >= 500 && status !== 503 && status !== 504) console.error('[API] loi:', err);
    res.status(status).json({
      error: err.code || 'internal_error',
      message: status === 500 ? 'Loi may chu' : err.message,
      ...(err.details && { details: err.details }),
    });
  });

  return app;
}

module.exports = { createApp };
