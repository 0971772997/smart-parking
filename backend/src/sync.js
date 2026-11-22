// Dong bo du lieu tu ESP32 (MQTT) vao database.
// - Chi ghi DB khi co thay doi -> Neon duoc "ngu" (scale to zero) khi bai khong co hoat dong.
// - Ca 'status' (dinh ky 10s) va 'event' deu di qua applySlotState, nen neu server lo mat
//   su kien (vd Render free dang ngu) thi status tiep theo van sua lai dung du lieu.
// - Cam bien o do -> phien gui xe (src/sessions.js): xe vao o = parked, xe roi o = chot phi.
// - Mat ket noi: thiet bi online lai -> gui lai cac lenh giu cho con hieu luc (ESP32 khoi dong lai se mat),
//   bo qua trang thai "o trong" trong vai giay dau sau khi ESP32 khoi dong (cam bien chua doc xong).
// - Moi thay doi -> live.bump() de app dang cho (long-poll /api/live) cap nhat ngay.

const { confirmScan } = require('./gatePass');
const { RULES, notifyExpired } = require('./booking');
const { closeSession, notify, vnd } = require('./sessions');

// Neon free tu "ngu" sau 5 phut khong truy van -> chi cap nhat last_seen 30 phut/lan
// (trang thai online/offline that da co topic 'online' + LWT lo).
const LAST_SEEN_WRITE_MS = 30 * 60 * 1000;
// O "giu cho mo coi" (thiet bi giu nhung DB khong co dat cho) -> gui lenh huy toi da 1 lan / 30s moi o
const ORPHAN_RETRY_MS = 30 * 1000;
// ESP32 vua khoi dong (uptime < 15s): cam bien chua doc on dinh -> khong tin trang thai "het xe"
const BOOT_SETTLE_SECONDS = 15;
// Thiet bi online lai -> doi 3s (cho ban tin status dau tien) roi gui lai lenh giu cho
const RESYNC_DELAY_MS = 3000;

const addFlag = (flag) => `flags = CASE WHEN '${flag}' = ANY(flags) THEN flags ELSE array_append(flags, '${flag}') END`;

// Xe vao o (cam bien) -> gan vao phien gui xe phu hop. effects.release: cac o can bao thiet bi bo giu cho.
async function onParked(q, lotId, slot, effects) {
  const repark = RULES.session.reparkWindowMinutes;
  const resv = (await q.query(
    `SELECT * FROM reservations WHERE slot_id = $1 AND status = 'active' ORDER BY id DESC LIMIT 1`, [slot.id])).rows[0];

  // 1. Phien dang mo tren o nay (xe qua cong vao bang dat cho cua o nay) -> da do
  const open = (await q.query(
    'SELECT * FROM parking_sessions WHERE slot_id = $1 AND ended_at IS NULL ORDER BY id DESC LIMIT 1', [slot.id])).rows[0];
  if (open) {
    if (open.reservation_id) {
      await q.query(`UPDATE reservations SET status = 'fulfilled', updated_at = now() WHERE id = $1 AND status = 'active'`,
        [open.reservation_id]);
    }
    if (!open.parked_at) {
      await q.query('UPDATE parking_sessions SET parked_at = now(), updated_at = now() WHERE id = $1', [open.id]);
      await notify(q, { userId: open.user_id, sessionId: open.id, type: 'parked', key: `s${open.id}:parked`,
        title: 'Xe đã vào ô đỗ', body: `Cảm biến đã ghi nhận xe tại ô #${slot.slot_number}.`, data: { slotNumber: slot.slot_number } });
    }
    return;
  }

  // 2. Phien 'gate' vua chot phi tren o nay (cam bien chap chon / lui xe chinh lai) -> noi tiep phien
  const back = (await q.query(
    `SELECT ps.* FROM parking_sessions ps LEFT JOIN payments p ON p.session_id = ps.id
     WHERE ps.slot_id = $1 AND ps.source = 'gate' AND ps.exited_at IS NULL AND p.id IS NULL
       AND ps.ended_at > now() - make_interval(mins => $2)
     ORDER BY ps.ended_at DESC LIMIT 1`, [slot.id, repark])).rows[0];
  if (back) {
    await q.query(
      `UPDATE parking_sessions SET ended_at = NULL, duration_seconds = NULL, fee = NULL, overtime_fee = NULL,
         ${addFlag('sensor_gap')}, updated_at = now() WHERE id = $1`, [back.id]);
    return;
  }

  // 3. Xe cua 1 phien khac dang "tim cho" (qua cong vao, chua do) do nham vao o nay
  const transit = (await q.query(
    `SELECT ps.*, s.slot_number AS old_slot FROM parking_sessions ps JOIN slots s ON s.id = ps.slot_id
     WHERE s.lot_id = $1 AND s.id <> $2 AND ps.source = 'gate' AND ps.parked_at IS NULL
       AND ps.ended_at IS NULL AND ps.exited_at IS NULL`, [lotId, slot.id])).rows;
  // Chi doan khi chac chan: dung 1 xe dang tim cho, va o nay khong co dat cho cua nguoi DA vao bai
  if (transit.length === 1 && !(resv && resv.entered_at)) {
    const t = transit[0];
    await q.query(
      `UPDATE parking_sessions SET slot_id = $2, parked_at = now(), ${addFlag('wrong_slot')}, updated_at = now() WHERE id = $1`,
      [t.id, slot.id]);
    await q.query(`UPDATE reservations SET status = 'fulfilled', updated_at = now() WHERE id = $1 AND status = 'active'`,
      [t.reservation_id]);
    if (resv) {
      // O nay dang giu cho nguoi khac (chua den) -> doi cho ho sang o cua xe vua do nham (thiet bi van dang giu o do)
      await q.query('UPDATE reservations SET slot_id = $2, updated_at = now() WHERE id = $1', [resv.id, t.slot_id]);
      await notify(q, { userId: resv.user_id, reservationId: resv.id, type: 'slot_changed', key: `r${resv.id}:moved:${t.slot_id}`,
        title: 'Ô đặt chỗ đã thay đổi',
        body: `Ô #${slot.slot_number} vừa có xe khác đỗ nhầm. Chỗ của bạn được chuyển sang ô #${t.old_slot}.`,
        data: { from: slot.slot_number, to: t.old_slot } });
    } else {
      await q.query(`UPDATE slots SET state = 'free', updated_at = now() WHERE id = $1 AND state = 'reserved'`, [t.slot_id]);
      effects.release.push(t.old_slot);
    }
    await notify(q, { userId: t.user_id, sessionId: t.id, type: 'wrong_slot', key: `s${t.id}:wrong:${slot.id}`,
      title: 'Xe đỗ khác ô đã đặt',
      body: `Xe được ghi nhận tại ô #${slot.slot_number} (đã đặt ô #${t.old_slot}). Phiên gửi xe đã chuyển sang ô #${slot.slot_number}.`,
      data: { from: t.old_slot, to: slot.slot_number } });
    return;
  }

  // 4. Dat cho cua o nay nhung xe khong quet ma o cong (vd vao bang nut) -> phien theo dat cho
  if (resv) {
    await q.query(`UPDATE reservations SET status = 'fulfilled', updated_at = now() WHERE id = $1`, [resv.id]);
    const s = (await q.query(
      `INSERT INTO parking_sessions (slot_id, reservation_id, user_id, vehicle_id, source, parked_at, planned_end_at, hourly_rate)
       VALUES ($1, $2, $3, $4, 'sensor', now(), now() + make_interval(mins => $5),
               (SELECT LEAST(r.hourly_rate, l.price_per_hour) FROM reservations r, slots sl JOIN parking_lots l ON l.id = sl.lot_id
                WHERE r.id = $2 AND sl.id = $1))
       ON CONFLICT (reservation_id) WHERE reservation_id IS NOT NULL DO NOTHING RETURNING id`,
      [slot.id, resv.id, resv.user_id, resv.vehicle_id, resv.duration_minutes || 120])).rows[0];
    if (s) {
      await notify(q, { userId: resv.user_id, sessionId: s.id, reservationId: resv.id, type: 'session_started', key: `s${s.id}:start`,
        title: 'Bắt đầu phiên gửi xe', body: `Xe đã vào ô #${slot.slot_number}. Phí được tính từ bây giờ.`,
        data: { slotNumber: slot.slot_number } });
    }
    return;
  }

  // 5. Khach vang lai
  await q.query(
    `INSERT INTO parking_sessions (slot_id, source, parked_at, hourly_rate)
     SELECT $1, 'sensor', now(), (SELECT l.price_per_hour FROM slots sl JOIN parking_lots l ON l.id = sl.lot_id WHERE sl.id = $1)
     WHERE NOT EXISTS (SELECT 1 FROM parking_sessions WHERE slot_id = $1 AND ended_at IS NULL)`, [slot.id]);
}

// Xe roi o -> chot phi phien dang mo tren o
async function onLeftSlot(q, slot) {
  const open = (await q.query(
    'SELECT id FROM parking_sessions WHERE slot_id = $1 AND ended_at IS NULL ORDER BY id DESC LIMIT 1', [slot.id])).rows[0];
  if (!open) return;
  const s = await closeSession(q, open.id);
  if (s && s.user_id) {
    const mins = Math.max(1, Math.round(s.duration_seconds / 60));
    await notify(q, { userId: s.user_id, sessionId: s.id, type: 'left_slot', key: `s${s.id}:left:${Math.floor(new Date(s.ended_at) / 1000)}`,
      title: 'Xe đã rời ô – đã chốt phí',
      body: `Thời gian gửi ${mins} phút. Phí ${vnd(s.fee)}${s.overtime_fee ? ` (gồm phụ phí quá giờ ${vnd(s.overtime_fee)})` : ''}. `
        + (s.fee > 0 ? 'Thanh toán trên app để barie cổng ra tự mở.' : 'Mời ra cổng.'),
      data: { fee: s.fee, overtime: s.overtime_fee, durationSeconds: s.duration_seconds } });
  }
}

// Chuyen trang thai 1 o + cap nhat phien gui xe. Tra ve false neu khong co thay doi.
async function applySlotState(q, lotId, slotNumber, newState, distance, effects = { release: [] }) {
  const cur = (await q.query(
    'SELECT id, slot_number, state, distance_cm FROM slots WHERE lot_id = $1 AND slot_number = $2 FOR UPDATE', [lotId, slotNumber])).rows[0];
  if (!cur) return false;
  if (cur.state === newState) {
    // Trang thai da dung (vd vua cap nhat tu event 'slot_changed' khong kem khoang cach) -> chi bo sung khoang cach
    if (Number.isFinite(distance) && Math.round(distance) !== cur.distance_cm) {
      await q.query('UPDATE slots SET distance_cm = $2 WHERE id = $1', [cur.id, Math.round(distance)]);
    }
    return false;
  }

  await q.query(
    'UPDATE slots SET state = $2, distance_cm = COALESCE($3, distance_cm), updated_at = now() WHERE id = $1',
    [cur.id, newState, Number.isFinite(distance) ? Math.round(distance) : null]);

  if (newState === 'occupied') await onParked(q, lotId, cur, effects);
  else if (cur.state === 'occupied') await onLeftSlot(q, cur);

  if (cur.state === 'reserved' && newState === 'free') {
    // Thiet bi da bo giu cho (het han / huy tai cho) -> dong bo dat cho
    const { rows } = await q.query(
      `UPDATE reservations SET status = 'expired', updated_at = now()
       WHERE slot_id = $1 AND status = 'active' AND entered_at IS NULL AND expires_at <= now() + interval '5 seconds'
       RETURNING id`, [cur.id]);
    await notifyExpired(q, rows.map((r) => r.id));
  }
  return true;
}

function createSync(db, { live } = {}) {
  const cache = new Map(); // lotId -> { slots: {n: state}, gates, fw, lastSeenWrite, orphanTry: {n: ms}, online }
  let device = null; // gan sau (cau MQTT can sync truoc khi tao) -> attachDevice
  const bump = (lotId) => live && live.bump(lotId);

  // Thiet bi dang giu o nhung khong con dat cho 'pending'/'active' nao (vd lenh 'reserve' den tre sau khi API
  // da bao device_timeout -> dat cho 'failed') -> gui lenh huy de nha o, va tra o ve 'free' trong DB.
  async function releaseOrphan(lotId, slotNumber) {
    const c = cache.get(lotId);
    if (!device || !c) return;
    const last = c.orphanTry[slotNumber] || 0;
    if (Date.now() - last < ORPHAN_RETRY_MS) return;
    const live = await db.one(
      `SELECT 1 FROM reservations r JOIN slots s ON s.id = r.slot_id
       WHERE s.lot_id = $1 AND s.slot_number = $2 AND r.status IN ('pending', 'active') LIMIT 1`, [lotId, slotNumber]);
    if (live) return;
    c.orphanTry[slotNumber] = Date.now();
    console.log(`[SYNC] ${lotId} o ${slotNumber}: thiet bi giu cho khong co dat cho -> huy`);
    const ack = await device.sendCommand(lotId, { action: 'cancel_reservation', slot: slotNumber });
    if (ack && (ack.ok || ack.error === 'not_reserved')) {
      await db.query(
        `UPDATE slots s SET state = 'free', updated_at = now()
         WHERE s.lot_id = $1 AND s.slot_number = $2 AND s.state = 'reserved'
           AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.slot_id = s.id AND r.status IN ('pending', 'active'))`,
        [lotId, slotNumber]);
      delete c.orphanTry[slotNumber];
      bump(lotId);
    } else {
      delete c.slots[slotNumber]; // chua huy duoc (mat ket noi) -> ban tin status ke tiep thu lai
    }
  }
  const releaseLater = (lotId, slotNumber) => {
    releaseOrphan(lotId, slotNumber).catch((e) => console.error('[SYNC] Loi nha o:', e.message));
  };

  // Thiet bi online lai (co the vua khoi dong lai -> mat het giu cho trong RAM):
  // gui lai lenh giu cho cho cac dat cho con hieu luc ma xe chua qua cong vao.
  // ESP32 dang giu san o do -> tra 'slot_not_free' -> bo qua (khong tac dung phu).
  async function resyncDevice(lotId) {
    if (!device) return 0;
    const { rows } = await db.query(
      `SELECT r.id, s.id AS slot_id, s.slot_number, CEIL(EXTRACT(EPOCH FROM r.expires_at - now()) / 60)::int AS mins
       FROM reservations r JOIN slots s ON s.id = r.slot_id
       WHERE s.lot_id = $1 AND r.status = 'active' AND r.entered_at IS NULL AND r.expires_at > now() + interval '30 seconds'`,
      [lotId]);
    let restored = 0;
    for (const r of rows) {
      const minutes = Math.min(120, Math.max(1, r.mins));
      const ack = await device.sendCommand(lotId, { action: 'reserve', slot: r.slot_number, minutes });
      if (ack && ack.ok) {
        restored += 1;
        await db.query(`UPDATE slots SET state = 'reserved', updated_at = now() WHERE id = $1 AND state = 'free'`, [r.slot_id]);
      }
    }
    if (restored) {
      console.log(`[SYNC] ${lotId}: khoi phuc ${restored} giu cho sau khi thiet bi ket noi lai`);
      bump(lotId);
    }
    return restored;
  }

  async function lotExists(lotId) {
    if (cache.has(lotId)) return true;
    const lot = await db.one('SELECT id FROM parking_lots WHERE id = $1', [lotId]);
    if (lot) cache.set(lotId, { slots: {}, gates: {}, fw: null, lastSeenWrite: 0, orphanTry: {}, online: null });
    return !!lot;
  }

  async function handleOnline(lotId, value) {
    if (!(await lotExists(lotId))) return;
    const c = cache.get(lotId);
    const online = String(value).trim() === '1';
    await db.query('UPDATE parking_lots SET online = $2, last_seen_at = now() WHERE id = $1', [lotId, online]);
    c.lastSeenWrite = Date.now();
    if (online && c.online !== true && device) {
      setTimeout(() => resyncDevice(lotId).catch((e) => console.error('[SYNC] Loi dong bo lai:', e.message)), RESYNC_DELAY_MS);
    }
    if (!online) c.slots = {}; // ket noi lai -> so lai toan bo trang thai o
    c.online = online;
    bump(lotId);
  }

  async function handleStatus(lotId, st) {
    if (!(await lotExists(lotId)) || !st || !Array.isArray(st.slots)) return;
    const c = cache.get(lotId);
    const justBooted = Number.isFinite(st.uptime) && st.uptime < BOOT_SETTLE_SECONDS;
    let changed = false;

    for (const s of st.slots) {
      if (c.slots[s.id] === s.state) continue;
      // ESP32 vua khoi dong: moi o deu bao 'free' cho den khi cam bien doc xong -> khong chot phi nham
      if (justBooted && s.state !== 'occupied') {
        const cur = await db.one('SELECT state FROM slots WHERE lot_id = $1 AND slot_number = $2', [lotId, s.id]);
        if (cur && cur.state === 'occupied') continue;
      }
      const effects = { release: [] };
      if (await db.tx((q) => applySlotState(q, lotId, s.id, s.state, s.distance, effects))) changed = true;
      c.slots[s.id] = s.state;
      if (s.state === 'reserved') releaseLater(lotId, s.id);
      effects.release.forEach((n) => releaseLater(lotId, n));
    }

    const gates = st.gates || {};
    const gateChanged = gates.entry !== c.gates.entry || gates.exit !== c.gates.exit || st.fw !== c.fw;
    if (gateChanged || Date.now() - c.lastSeenWrite > LAST_SEEN_WRITE_MS) {
      await db.query(
        // KHONG set online o day: status la ban tin "retained" nen co the la ban cu cua thiet bi da tat.
        // Trang thai online/offline chi lay tu topic 'online' (ESP32 gui "1", LWT tu gui "0").
        `UPDATE parking_lots SET last_seen_at = now(),
           entry_gate = COALESCE($2, entry_gate), exit_gate = COALESCE($3, exit_gate),
           fw_version = COALESCE($4, fw_version)
         WHERE id = $1`,
        [lotId, gates.entry || null, gates.exit || null, st.fw || null]);
      c.gates = { ...gates };
      c.fw = st.fw;
      c.lastSeenWrite = Date.now();
    }
    if (changed || gateChanged) bump(lotId);
  }

  async function handleEvent(lotId, ev) {
    if (!(await lotExists(lotId)) || !ev || !ev.type) return;
    const c = cache.get(lotId);
    await db.query('INSERT INTO device_events (lot_id, type, payload) VALUES ($1, $2, $3)', [lotId, ev.type, ev]);

    if (ev.type === 'slot_changed') {
      const effects = { release: [] };
      await db.tx((q) => applySlotState(q, lotId, ev.slot, ev.state, undefined, effects));
      effects.release.forEach((n) => releaseLater(lotId, n));
      // Khong ghi cache: event khong co khoang cach -> de ban tin 'status' ke tiep bo sung (1 lan ghi)
      delete c.slots[ev.slot];
    } else if (ev.type === 'reservation_expired') {
      const { rows } = await db.query(
        `UPDATE reservations r SET status = 'expired', updated_at = now()
         FROM slots s WHERE s.id = r.slot_id AND s.lot_id = $1 AND s.slot_number = $2 AND r.status = 'active'
           AND r.entered_at IS NULL RETURNING r.id`,
        [lotId, ev.slot]);
      await notifyExpired(db, rows.map((r) => r.id));
      await db.query(`UPDATE slots SET state = 'free', updated_at = now()
                      WHERE lot_id = $1 AND slot_number = $2 AND state = 'reserved'`, [lotId, ev.slot]);
      c.slots[ev.slot] = 'free';
    } else if (ev.type === 'gate') {
      const col = ev.gate === 'exit' ? 'exit_gate' : 'entry_gate';
      await db.query(`UPDATE parking_lots SET ${col} = $2 WHERE id = $1`, [lotId, ev.state]);
      c.gates[ev.gate] = ev.state;
    } else if (ev.type === 'ack' && ev.action === 'open_gate' && ev.ok && ev.requestId) {
      // Ack mo barie cho 1 lan quet QR (ca khi den tre, sau khi API da bao device_timeout) -> xac nhan xe vao/ra
      await confirmScan(db, ev.requestId);
    } else if (ev.type === 'ack' && ev.action === 'reserve' && ev.ok && ev.requestId) {
      // Ack giu cho den tre: API da bao that bai cho nguoi dung -> khong de thiet bi giu o
      const r = await db.one('SELECT status FROM reservations WHERE request_id = $1', [ev.requestId]);
      if (r && !['pending', 'active'].includes(r.status) && ev.slot) releaseLater(lotId, ev.slot);
    }
    if (ev.type !== 'ack' || ev.action === 'open_gate') bump(lotId);
  }

  return { handleOnline, handleStatus, handleEvent, resyncDevice, attachDevice: (d) => { device = d; } };
}

module.exports = { createSync, applySlotState };
