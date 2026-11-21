// QUET MA QR TAI CONG (nhan vien / admin dung app quet ma tren dien thoai tai xe)
//   POST /api/gates/scan   { lotId, gate: 'entry'|'exit', token }  -> xac thuc -> mo barie -> xac nhan
//   GET  /api/gates/scans?lotId=&limit=                             nhat ky quet (ca lan loi)
//
// Thu tu kiem tra (loi nao gap truoc tra ve truoc, MOI lan quet deu ghi vao gate_scans):
//   qr_invalid -> qr_expired -> reservation_not_found -> wrong_lot -> wrong_gate
//   -> trang thai dat cho (already_entered / already_exited / not_entered / reservation_expired / ...)
//   -> cong ra: still_parked (xe chua roi o) / payment_required (chua tra phi)
//   -> device_offline -> scan_in_progress (quet trung cung luc) -> device_timeout / loi tu ESP32
// Thanh cong = ESP32 tra ack ok cho lenh open_gate -> ghi entered_at / exited_at.
const crypto = require('crypto');
const express = require('express');
const { wrap, badRequest, notFound, HttpError } = require('../errors');
const v = require('../validate');
const map = require('../mappers');
const { RESERVATION_SELECT, expireStale } = require('../booking');
const { gateBlock, exitBlock, confirmScan } = require('../gatePass');

const ERRORS = {
  qr_invalid: [400, 'Ma QR khong hop le (khong phai ma cua he thong hoac bi sua)'],
  qr_expired: [410, 'Ma QR da het han, yeu cau tai xe mo lai ma moi tren app'],
  reservation_not_found: [404, 'Khong tim thay luot dat cho cua ma nay'],
  wrong_lot: [409, 'Ma QR thuoc bai do khac'],
  wrong_gate: [409, 'Ma QR khong dung cong (ma vao dung o cong vao, ma ra dung o cong ra)'],
  already_entered: [409, 'Xe da qua cong vao bang ma nay'],
  already_exited: [409, 'Xe da ra bai bang ma nay'],
  not_entered: [409, 'Xe chua qua cong vao'],
  pass_expired: [409, 'Ma ra bai da qua thoi han su dung'],
  reservation_expired: [409, 'Dat cho da het gio giu cho'],
  reservation_not_active: [409, 'Dat cho khong con hieu luc'],
  still_parked: [409, 'Xe van dang o trong o do (cam bien chua ghi nhan xe roi o)'],
  payment_required: [402, 'Chua thanh toan phi gui xe'],
  device_offline: [503, 'Thiet bi bai do dang mat ket noi'],
  scan_in_progress: [409, 'Ma nay dang duoc xu ly o mot lan quet khac'],
  device_timeout: [504, 'Thiet bi khong phan hoi, barie chua mo'],
};

module.exports = function gateRoutes({ db, auth, device, gatePass }) {
  const r = express.Router();
  r.use(auth.requireAuth, auth.requireAdmin);

  r.post('/scan', wrap(async (req, res) => {
    const lotId = v.str(req.body, 'lotId', { max: 50 });
    const gate = v.str(req.body, 'gate', { max: 5 });
    if (!['entry', 'exit'].includes(gate)) throw badRequest('invalid_gate', "gate phai la 'entry' hoac 'exit'");
    const token = v.str(req.body, 'token', { max: 300 });
    const lot = await db.one('SELECT * FROM parking_lots WHERE id = $1', [lotId]);
    if (!lot) throw notFound('lot_not_found', 'Khong tim thay bai do');

    const pass = gatePass.verify(token);
    let resv = null;
    const log = (result, error, requestId = null) => db.one(
      `INSERT INTO gate_scans (lot_id, gate, reservation_id, nonce, result, error, request_id, scanned_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [lot.id, gate, resv?.id ?? null, pass.nonce ?? null, result, error, requestId, req.user.id]);

    // Tu choi: ghi nhat ky roi tra loi kem thong tin de nhan vien xu ly tai cho
    const deny = async (code, extra = {}) => {
      const scan = await log('denied', code);
      const [status, msg] = ERRORS[code] || [409, 'Thiet bi tu choi'];
      throw Object.assign(new HttpError(status, code, msg), {
        details: { scanId: scan.id, gate, reservation: resv ? map.reservation(resv) : null, ...extra },
      });
    };

    if (!pass.ok && pass.error === 'qr_invalid') await deny('qr_invalid');
    await expireStale(db);
    resv = await db.one(`${RESERVATION_SELECT} WHERE r.id = $1`, [pass.reservationId]);
    if (!resv) await deny('reservation_not_found');
    if (!pass.ok) await deny(pass.error, { expiredAt: pass.expiresAt });
    if (resv.lot_id !== lot.id) await deny('wrong_lot', { expectedLot: { id: resv.lot_id, name: resv.lot_name } });
    if (pass.gate !== gate) await deny('wrong_gate', { qrGate: pass.gate });
    const block = gateBlock(resv, gate);
    if (block) await deny(block);
    if (gate === 'exit') {
      const fee = await exitBlock(db, resv.id);
      if (fee) await deny(fee.error, { sessionId: fee.sessionId, fee: fee.fee });
    }
    if (!lot.online) await deny('device_offline');

    // Giu cho lan quet nay (unique theo dat cho + cong) truoc khi ra lenh -> 2 may quet cung luc chi 1 lan mo
    const requestId = crypto.randomUUID();
    let scan;
    try {
      scan = await log('pending', null, requestId);
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
    res.json({
      ok: true,
      gate,
      scanId: scan.id,
      confirmedAt: confirmed.confirmed_at,
      sessionId: confirmed.session?.id ?? fresh.session_id ?? null,
      fee: gate === 'exit' ? confirmed.session?.fee ?? null : null,
      message: gate === 'entry'
        ? `Moi xe vao. Den khu ${resv.zone || '-'}, o so ${resv.slot_number}`
        : 'Hen gap lai!',
      reservation: map.reservation(fresh),
    });
  }));

  r.get('/scans', wrap(async (req, res) => {
    const lotId = v.str(req.query, 'lotId', { max: 50, optional: true });
    const limit = v.int(req.query, 'limit', { min: 1, max: 200, def: 30 });
    const { rows } = await db.query(
      `SELECT g.*, r.code AS reservation_code, s.slot_number, veh.plate_number AS vehicle_plate
       FROM gate_scans g
       LEFT JOIN reservations r ON r.id = g.reservation_id
       LEFT JOIN slots s ON s.id = r.slot_id
       LEFT JOIN vehicles veh ON veh.id = r.vehicle_id
       WHERE ($1::text IS NULL OR g.lot_id = $1)
       ORDER BY g.id DESC LIMIT $2`, [lotId, limit]);
    res.json(rows.map(map.gateScan));
  }));

  return r;
};
