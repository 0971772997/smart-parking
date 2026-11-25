// MO BARIE QUA CONG (dung chung): tai xe quet ma cong, nhan vien quet ma tai xe, admin xac nhan da nhan tien
//   createGateOps({ db, device }) -> { ERRORS, makeDeny, passGate, openExitAfterPayment }
const crypto = require('crypto');
const { HttpError } = require('./errors');
const map = require('./mappers');
const { RESERVATION_SELECT, expireStale } = require('./booking');
const { nextGate, gateBlock, exitBlock, confirmScan } = require('./gatePass');

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

function createGateOps({ db, device }) {
  // Tu choi: ghi nhat ky (khi da biet bai do) roi nem loi kem thong tin de xu ly tai cho
  function makeDeny({ lotId, gate, nonce, userId, mode, getResv }) {
    return async (code, extra = {}) => {
      const resv = getResv();
      const g = typeof gate === 'function' ? gate() : gate;
      let scanId = null;
      if (lotId) {
        const scan = await db.one(
          `INSERT INTO gate_scans (lot_id, gate, reservation_id, nonce, result, error, scanned_by, mode)
           VALUES ($1, $2, $3, $4, 'denied', $5, $6, $7) RETURNING id`,
          [lotId, g || 'entry', resv?.id ?? null, nonce ?? null, code, userId, mode]);
        scanId = scan.id;
      }
      const [status, msg] = ERRORS[code] || [409, 'Thiet bi tu choi'];
      throw Object.assign(new HttpError(status, code, msg), {
        details: { scanId, gate: g || null, reservation: resv ? map.reservation(resv) : null, ...extra },
      });
    };
  }

  // Kiem tra trang thai dat cho + phi, roi mo barie -> body tra ve khi barie da mo
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

  // Admin vua xac nhan da nhan tien -> mo barie cong RA cho xe cua phien (neu xe dang cho ra)
  //   -> { opened: true, ... } | { opened: false, reason, message }
  async function openExitAfterPayment(session, adminId) {
    if (!session.reservation_id) return { opened: false, reason: 'no_reservation', message: 'Xe vang lai: mo barie thu cong' };
    await expireStale(db);
    const resv = await db.one(`${RESERVATION_SELECT} WHERE r.id = $1`, [session.reservation_id]);
    if (!resv || nextGate(resv) !== 'exit') {
      const reason = resv ? gateBlock(resv, 'exit') || 'not_at_exit' : 'reservation_not_found';
      return { opened: false, reason, message: (ERRORS[reason] || [0, 'Xe khong o trang thai cho ra bai'])[1] };
    }
    const lot = await db.one('SELECT * FROM parking_lots WHERE id = $1', [resv.lot_id]);
    const deny = makeDeny({ lotId: lot.id, gate: 'exit', userId: adminId, mode: 'staff', getResv: () => resv });
    try {
      return { opened: true, ...(await passGate({ lot, gate: 'exit', resv, userId: adminId, mode: 'staff', deny })) };
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      return { opened: false, reason: e.code, message: e.message };
    }
  }

  return { ERRORS, makeDeny, passGate, openExitAfterPayment };
}

module.exports = { createGateOps, ERRORS };
