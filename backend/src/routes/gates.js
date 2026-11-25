// QUA CONG BANG MA QR
// Luong chinh - TAI XE QUET MA CUA BAI (admin hien 1 ma chung tren man hinh dat tai cong):
//   GET  /api/gates/display?lotId=[&gate=]  (admin)  ma QR cua bai (mac dinh dung chung cho VAO va RA),
//                                                    tu doi moi RULES.gate.gateQrTtlSeconds
//   POST /api/gates/checkin { token, reservationId?, vehicleId? }  (tai xe) -> tim dat cho cua tai xe o bai,
//        tu chon cong: chua vao -> VAO, da vao -> RA -> kiem tra -> mo barie. Khong co dat cho -> no_reservation
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
const express = require('express');
const { wrap, badRequest, notFound } = require('../errors');
const v = require('../validate');
const map = require('../mappers');
const { RULES, RESERVATION_SELECT, expireStale } = require('../booking');
const { nextGate, gateBlock } = require('../gatePass');
const { createGateOps } = require('../gateOps');

// Dat cho cua tai xe o 1 bai con co the qua cong (chua ra bai), moi nhat truoc
const DRIVER_CANDIDATES = `${RESERVATION_SELECT}
  WHERE r.user_id = $1 AND s.lot_id = $2 AND r.exited_at IS NULL
    AND (r.status = 'active' OR (r.status = 'fulfilled' AND r.created_at > now() - make_interval(hours => $3)))
  ORDER BY r.created_at DESC LIMIT 10`;

module.exports = function gateRoutes({ db, auth, device, gatePass }) {
  const r = express.Router();
  r.use(auth.requireAuth);
  const admin = auth.requireAdmin;
  const { makeDeny, passGate } = createGateOps({ db, device });

  const readGate = (src, optional = false) => {
    const gate = v.str(src, 'gate', { max: 5, optional });
    if (gate === null) return null;
    if (!['entry', 'exit', 'any'].includes(gate) || (!optional && gate === 'any')) {
      throw badRequest('invalid_gate', "gate phai la 'entry' hoac 'exit'");
    }
    return gate;
  };

  // ===== Ma QR cua bai: admin mo tren may tinh bang / man hinh dat tai cong =====
  r.get('/display', admin, wrap(async (req, res) => {
    const lotId = v.str(req.query, 'lotId', { max: 50 });
    const gate = readGate(req.query, true) || 'any';
    const lot = await db.one('SELECT id, name, online FROM parking_lots WHERE id = $1', [lotId]);
    if (!lot) throw notFound('lot_not_found', 'Khong tim thay bai do');
    const p = gatePass.issueGate(lot.id, gate);
    res.json({
      lotId: lot.id, lotName: lot.name, online: lot.online, gate, token: p.token,
      expiresAt: p.expiresAt, ttlSeconds: p.ttlSeconds, refreshBeforeSeconds: 10,
    });
  }));

  // ===== Tai xe quet ma QR cua bai =====
  r.post('/checkin', wrap(async (req, res) => {
    const token = v.str(req.body, 'token', { max: 300 });
    const reservationId = v.int(req.body, 'reservationId', { min: 1, optional: true });
    const vehicleId = v.int(req.body, 'vehicleId', { min: 1, optional: true });
    const pass = gatePass.verifyGate(token);
    let resv = null;
    let gate = pass.gate || null; // null = ma chung -> chon theo dat cho
    const base = { gate: () => gate, nonce: pass.nonce, userId: req.user.id, mode: 'driver', getResv: () => resv };

    if (!pass.ok && pass.error === 'qr_invalid') await makeDeny({ ...base, lotId: null })('qr_invalid');
    const lot = await db.one('SELECT * FROM parking_lots WHERE id = $1', [pass.lotId]);
    if (!lot) await makeDeny({ ...base, lotId: null })('lot_not_found');
    const deny = makeDeny({ ...base, lotId: lot.id });
    const lotInfo = { lot: { id: lot.id, name: lot.name } };
    if (!pass.ok) await deny(pass.error, { expiredAt: pass.expiresAt, ...lotInfo });

    await expireStale(db);
    const { rows } = await db.query(DRIVER_CANDIDATES, [req.user.id, lot.id, RULES.gate.exitWithinHours]);
    const list = reservationId ? rows.filter((x) => x.id === reservationId) : rows;
    resv = list.find((x) => (gate ? nextGate(x) === gate : nextGate(x) !== null)) || null;
    if (!resv) {
      // Khong co dat cho dung duoc: neu co dat cho gan nhat -> bao ly do cu the (vd da vao roi)
      if (list[0]) {
        resv = list[0];
        gate = gate || (resv.entered_at || resv.status === 'fulfilled' ? 'exit' : 'entry');
        await deny(gateBlock(resv, gate) || 'reservation_not_active', lotInfo);
      }
      await deny('no_reservation', lotInfo);
    }
    gate = gate || nextGate(resv);

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
