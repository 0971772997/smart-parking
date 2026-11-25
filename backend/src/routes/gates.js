// QUA CONG BANG MA QR
// Luong chinh - TAI XE QUET MA CUA CONG (admin hien ma tren man hinh dat tai cong):
//   GET  /api/gates/display?lotId=&gate=   (admin)  ma QR cua cong, tu doi moi RULES.gate.gateQrTtlSeconds
//   POST /api/gates/checkin { token, reservationId?, vehicleId? }  (tai xe) -> tim dat cho cua tai xe o bai
//        -> kiem tra -> mo barie -> xac nhan. Khong co dat cho -> no_reservation (app goi y dat cho ngay)
// Du phong - nhan vien quet ma tren dien thoai tai xe:
//   POST /api/gates/scan   { lotId, gate: 'entry'|'exit', token }  -> xac thuc -> mo barie -> xac nhan
//   GET  /api/gates/scans?lotId=&gate=&limit=                       nhat ky quet (ca lan loi)
//
// Thu tu kiem tra (loi nao gap truoc tra ve truoc, lan quet co bai do deu ghi vao gate_scans):
//   qr_invalid -> qr_expired -> (tai xe) lot_not_found / no_reservation | (nhan vien) reservation_not_found
//   -> wrong_lot -> wrong_gate -> trang thai dat cho (already_entered / already_exited / not_entered / ...)
//   -> cong ra: still_parked (xe chua roi o) / payment_required (chua tra phi)
//   -> device_offline -> scan_in_progress (quet trung cung luc) -> device_timeout / loi tu ESP32
// Thanh cong = ESP32 tra ack ok cho lenh open_gate -> ghi entered_at / exited_at.
const crypto = require('crypto');
const express = require('express');
const { wrap, badRequest, notFound, HttpError } = require('../errors');
const v = require('../validate');
const map = require('../mappers');
const { RULES, RESERVATION_SELECT, expireStale } = require('../booking');
const { nextGate, gateBlock, exitBlock, confirmScan } = require('../gatePass');

const ERRORS = {
  qr_invalid: [400, 'Ma QR khong hop le (khong phai ma cua he thong hoac bi sua)'],
  qr_expired: [410, 'Ma QR da het han, hay quet ma moi'],
  reservation_not_found: [404, 'Khong tim thay luot dat cho cua ma nay'],
  wrong_lot: [409, 'Ma QR thuoc bai do khac'],
  wrong_gate: [409, 'Ma QR khong dung cong (ma vao dung o cong vao, ma ra dung o cong ra)'],
  already_entered: [409, 'Xe da qua cong vao'],
  already_exited: [409, 'Xe da ra bai'],
  not_entered: [409, 'Xe chua qua cong vao'],
  pass_expired: [409, 'Luot gui xe da qua thoi han ra bai'],
  reservation_expired: [409, 'Dat cho da het gio giu cho'],
  reservation_not_active: [409, 'Dat cho khong con hieu luc'],
  still_parked: [409, 'Xe van dang o trong o do (cam bien chua ghi nhan xe roi o)'],
  payment_required: [402, 'Chua thanh toan phi gui xe'],
  device_offline: [503, 'Thiet bi bai do dang mat ket noi'],
  scan_in_progress: [409, 'Dang xu ly mot lan quet khac'],
  device_timeout: [504, 'Thiet bi khong phan hoi, barie chua mo'],
  lot_not_found: [404, 'Bai do cua ma QR nay khong con ton tai'],
  no_reservation: [404, 'Ban chua co dat cho con hieu luc o bai nay'],
  vehicle_not_found: [400, 'Xe khong thuoc tai khoan nay'],
};

// Dat cho cua tai xe o 1 bai con co the qua cong (chua ra bai), moi nhat truoc
const DRIVER_CANDIDATES = `${RESERVATION_SELECT}
  WHERE r.user_id = $1 AND s.lot_id = $2 AND r.exited_at IS NULL
    AND (r.status = 'active' OR (r.status = 'fulfilled' AND r.created_at > now() - make_interval(hours => $3)))
  ORDER BY r.created_at DESC LIMIT 10`;

module.exports = function gateRoutes({ db, auth, device, gatePass }) {
  const r = express.Router();
  r.use(auth.requireAuth);
  const admin = auth.requireAdmin;

  // Tu choi: ghi nhat ky (khi da biet bai do) roi nem loi kem thong tin de xu ly tai cho
  function makeDeny({ lotId, gate, nonce, userId, mode, getResv }) {
    return async (code, extra = {}) => {
      const resv = getResv();
      let scanId = null;
      if (lotId) {
        const scan = await db.one(
          `INSERT INTO gate_scans (lot_id, gate, reservation_id, nonce, result, error, scanned_by, mode)
           VALUES ($1, $2, $3, $4, 'denied', $5, $6, $7) RETURNING id`,
          [lotId, gate, resv?.id ?? null, nonce ?? null, code, userId, mode]);
        scanId = scan.id;
      }
      const [status, msg] = ERRORS[code] || [409, 'Thiet bi tu choi'];
      throw Object.assign(new HttpError(status, code, msg), {
        details: { scanId, gate, reservation: resv ? map.reservation(resv) : null, ...extra },
      });
    };
  }

  // Kiem tra trang thai dat cho + phi, roi mo barie (dung chung cho tai xe quet ma cong / nhan vien quet ma tai xe)
  async function passGate({ lot, gate, resv, nonce, userId, mode, deny }) {
    const block = gateBlock(resv, gate);
    if (block) await deny(block);
    if (gate === 'exit') {
      const fee = await exitBlock(db, resv.id);
      if (fee) await deny(fee.error, { sessionId: fee.sessionId, fee: fee.fee });
    }
    if (!lot.online) await deny('device_offline');

    // Giu cho lan quet nay (unique theo dat cho + cong) truoc khi ra lenh -> 2 lan quet cung luc chi 1 lan mo
    const requestId = crypto.randomUUID();
    let scan;
    try {
      scan = await db.one(
        `INSERT INTO gate_scans (lot_id, gate, reservation_id, nonce, result, error, request_id, scanned_by, mode)
         VALUES ($1, $2, $3, $4, 'pending', NULL, $5, $6, $7) RETURNING *`,
        [lot.id, gate, resv.id, nonce ?? null, requestId, userId, mode]);
    } catch (e) {
      if (e.code === '23505') await deny('scan_in_progress');
      throw e;
    }

    const ack = await device.sendCommand(lot.id, {
      action: 'open_gate', gate, requestId, slot: resv.slot_number, code: resv.code,
    });
    if (!ack || !ack.ok) {
      const code = ack ? ack.error || 'device_error' : 'device_timeout';
      await db.query(`UPDATE gate_scans SET result = 'denied', error = $2 WHERE id = $1 AND result = 'pending'`,
        [scan.id, code]);
      const [status, msg] = ERRORS[code] || [409, 'Thiet bi tu choi mo barie'];
      throw Object.assign(new HttpError(status, code, msg),
        { details: { scanId: scan.id, gate, reservation: map.reservation(resv) } });
    }

    const confirmed = (await confirmScan(db, requestId)) || scan;
    if (gate === 'exit' && resv.status === 'active') {
      // Ra bai khi chua do: bao thiet bi bo giu o (khong chan neu loi - DB da tra o)
      await device.sendCommand(lot.id, { action: 'cancel_reservation', slot: resv.slot_number });
    }
    const fresh = await db.one(`${RESERVATION_SELECT} WHERE r.id = $1`, [resv.id]);
    return {
      ok: true,
      gate,
      lotId: lot.id,
      lotName: lot.name,
      scanId: scan.id,
      confirmedAt: confirmed.confirmed_at,
      sessionId: confirmed.session?.id ?? fresh.session_id ?? null,
      fee: gate === 'exit' ? confirmed.session?.fee ?? null : null,
      message: gate === 'entry'
        ? `Moi xe vao. Den khu ${resv.zone || '-'}, o so ${resv.slot_number}`
        : 'Hen gap lai!',
      reservation: map.reservation(fresh),
    };
  }

  const readGate = (src) => {
    const gate = v.str(src, 'gate', { max: 5 });
    if (!['entry', 'exit'].includes(gate)) throw badRequest('invalid_gate', "gate phai la 'entry' hoac 'exit'");
    return gate;
  };

  // ===== Ma QR cua cong: admin mo tren may tinh bang / man hinh dat tai cong =====
  r.get('/display', admin, wrap(async (req, res) => {
    const lotId = v.str(req.query, 'lotId', { max: 50 });
    const gate = readGate(req.query);
    const lot = await db.one('SELECT id, name, online FROM parking_lots WHERE id = $1', [lotId]);
    if (!lot) throw notFound('lot_not_found', 'Khong tim thay bai do');
    const p = gatePass.issueGate(lot.id, gate);
    res.json({
      lotId: lot.id, lotName: lot.name, online: lot.online, gate, token: p.token,
      expiresAt: p.expiresAt, ttlSeconds: p.ttlSeconds, refreshBeforeSeconds: 10,
    });
  }));

  // ===== Tai xe quet ma QR cua cong =====
  r.post('/checkin', wrap(async (req, res) => {
    const token = v.str(req.body, 'token', { max: 300 });
    const reservationId = v.int(req.body, 'reservationId', { min: 1, optional: true });
    const vehicleId = v.int(req.body, 'vehicleId', { min: 1, optional: true });
    const pass = gatePass.verifyGate(token);
    let resv = null;
    const base = { gate: pass.gate || 'entry', nonce: pass.nonce, userId: req.user.id, mode: 'driver', getResv: () => resv };

    if (!pass.ok && pass.error === 'qr_invalid') await makeDeny({ ...base, lotId: null })('qr_invalid');
    const lot = await db.one('SELECT * FROM parking_lots WHERE id = $1', [pass.lotId]);
    if (!lot) await makeDeny({ ...base, lotId: null })('lot_not_found');
    const deny = makeDeny({ ...base, lotId: lot.id });
    const { gate } = pass;
    const lotInfo = { lot: { id: lot.id, name: lot.name } };
    if (!pass.ok) await deny(pass.error, { expiredAt: pass.expiresAt, ...lotInfo });

    await expireStale(db);
    const { rows } = await db.query(DRIVER_CANDIDATES, [req.user.id, lot.id, RULES.gate.exitWithinHours]);
    const list = reservationId ? rows.filter((x) => x.id === reservationId) : rows;
    resv = list.find((x) => nextGate(x) === gate) || null;
    if (!resv) {
      // Khong co dat cho dung duoc o cong nay: neu co dat cho gan nhat -> bao ly do cu the (vd da vao roi)
      if (list[0]) {
        resv = list[0];
        await deny(gateBlock(resv, gate) || 'reservation_not_active', lotInfo);
      }
      await deny('no_reservation', lotInfo);
    }

    // Tai xe chon xe luc quet ma ma dat cho chua gan xe -> gan vao dat cho (va phien neu da co)
    if (vehicleId && !resv.vehicle_id) {
      const veh = await db.one('SELECT id FROM vehicles WHERE id = $1 AND user_id = $2', [vehicleId, req.user.id]);
      if (!veh) await deny('vehicle_not_found');
      await db.query('UPDATE reservations SET vehicle_id = $2, updated_at = now() WHERE id = $1 AND vehicle_id IS NULL',
        [resv.id, vehicleId]);
      await db.query('UPDATE parking_sessions SET vehicle_id = $2 WHERE reservation_id = $1 AND vehicle_id IS NULL',
        [resv.id, vehicleId]);
      resv = await db.one(`${RESERVATION_SELECT} WHERE r.id = $1`, [resv.id]);
    }

    res.json(await passGate({ lot, gate, resv, nonce: pass.nonce, userId: req.user.id, mode: 'driver', deny }));
  }));

  // ===== Du phong: nhan vien quet ma tren dien thoai tai xe =====
  r.post('/scan', admin, wrap(async (req, res) => {
    const lotId = v.str(req.body, 'lotId', { max: 50 });
    const gate = readGate(req.body);
    const token = v.str(req.body, 'token', { max: 300 });
    const lot = await db.one('SELECT * FROM parking_lots WHERE id = $1', [lotId]);
    if (!lot) throw notFound('lot_not_found', 'Khong tim thay bai do');

    const pass = gatePass.verify(token);
    let resv = null;
    const deny = makeDeny({ lotId: lot.id, gate, nonce: pass.nonce, userId: req.user.id, mode: 'staff', getResv: () => resv });

    if (!pass.ok && pass.error === 'qr_invalid') await deny('qr_invalid');
    await expireStale(db);
    resv = await db.one(`${RESERVATION_SELECT} WHERE r.id = $1`, [pass.reservationId]);
    if (!resv) await deny('reservation_not_found');
    if (!pass.ok) await deny(pass.error, { expiredAt: pass.expiresAt });
    if (resv.lot_id !== lot.id) await deny('wrong_lot', { expectedLot: { id: resv.lot_id, name: resv.lot_name } });
    if (pass.gate !== gate) await deny('wrong_gate', { qrGate: pass.gate });

    res.json(await passGate({ lot, gate, resv, nonce: pass.nonce, userId: req.user.id, mode: 'staff', deny }));
  }));

  r.get('/scans', admin, wrap(async (req, res) => {
    const lotId = v.str(req.query, 'lotId', { max: 50, optional: true });
    const gate = v.str(req.query, 'gate', { max: 5, optional: true });
    const limit = v.int(req.query, 'limit', { min: 1, max: 200, def: 30 });
    const { rows } = await db.query(
      `SELECT g.*, r.code AS reservation_code, s.slot_number, veh.plate_number AS vehicle_plate, veh.vehicle_type,
              (SELECT ps.id FROM parking_sessions ps WHERE ps.reservation_id = g.reservation_id) AS session_id
       FROM gate_scans g
       LEFT JOIN reservations r ON r.id = g.reservation_id
       LEFT JOIN slots s ON s.id = r.slot_id
       LEFT JOIN vehicles veh ON veh.id = r.vehicle_id
       WHERE ($1::text IS NULL OR g.lot_id = $1) AND ($2::text IS NULL OR g.gate = $2)
       ORDER BY g.id DESC LIMIT $3`, [lotId, gate, limit]);
    res.json(rows.map(map.gateScan));
  }));

  return r;
};
