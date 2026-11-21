// Dong bo du lieu tu ESP32 (MQTT) vao database.
// - Chi ghi DB khi co thay doi -> Neon duoc "ngu" (scale to zero) khi bai khong co hoat dong.
// - Ca 'status' (dinh ky 10s) va 'event' deu di qua applySlotState, nen neu server lo mat
//   su kien (vd Render free dang ngu) thi status tiep theo van sua lai dung du lieu.

const { confirmScan } = require('./gatePass');

// Neon free tu "ngu" sau 5 phut khong truy van -> chi cap nhat last_seen 30 phut/lan
// (trang thai online/offline that da co topic 'online' + LWT lo).
const LAST_SEEN_WRITE_MS = 30 * 60 * 1000;

// Chuyen trang thai 1 o + mo/dong luot do. Tra ve false neu khong co thay doi.
async function applySlotState(q, lotId, slotNumber, newState, distance) {
  const cur = (await q.query(
    'SELECT id, state, distance_cm FROM slots WHERE lot_id = $1 AND slot_number = $2 FOR UPDATE', [lotId, slotNumber])).rows[0];
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

  if (newState === 'occupied') {
    // Xe vao o dang co dat cho -> dat cho hoan thanh
    const r = (await q.query(
      `UPDATE reservations SET status = 'fulfilled', updated_at = now()
       WHERE slot_id = $1 AND status = 'active' RETURNING id`, [cur.id])).rows[0];
    await q.query(
      `INSERT INTO parking_sessions (slot_id, reservation_id)
       SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM parking_sessions WHERE slot_id = $1 AND ended_at IS NULL)`,
      [cur.id, r ? r.id : null]);
  } else if (cur.state === 'occupied') {
    // Xe roi o -> dong luot do, tinh phi (lam tron len theo gio, toi thieu 1 gio)
    await q.query(
      `UPDATE parking_sessions ps SET
         ended_at = now(),
         duration_seconds = EXTRACT(EPOCH FROM now() - ps.started_at)::int,
         fee = GREATEST(1, CEIL(EXTRACT(EPOCH FROM now() - ps.started_at) / 3600.0))::int * l.price_per_hour
       FROM slots s JOIN parking_lots l ON l.id = s.lot_id
       WHERE ps.slot_id = $1 AND ps.ended_at IS NULL AND s.id = ps.slot_id`, [cur.id]);
  }
  if (cur.state === 'reserved' && newState === 'free') {
    // Thiet bi da bo giu cho (het han / huy tai cho) -> dong bo dat cho
    await q.query(
      `UPDATE reservations SET status = 'expired', updated_at = now()
       WHERE slot_id = $1 AND status = 'active' AND entered_at IS NULL AND expires_at <= now() + interval '5 seconds'`, [cur.id]);
  }
  return true;
}

function createSync(db) {
  const cache = new Map(); // lotId -> { slots: {n: state}, gates, fw, lastSeenWrite }

  async function lotExists(lotId) {
    if (cache.has(lotId)) return true;
    const lot = await db.one('SELECT id FROM parking_lots WHERE id = $1', [lotId]);
    if (lot) cache.set(lotId, { slots: {}, gates: {}, fw: null, lastSeenWrite: 0 });
    return !!lot;
  }

  async function handleOnline(lotId, value) {
    if (!(await lotExists(lotId))) return;
    const online = String(value).trim() === '1';
    await db.query('UPDATE parking_lots SET online = $2, last_seen_at = now() WHERE id = $1', [lotId, online]);
    cache.get(lotId).lastSeenWrite = Date.now();
  }

  async function handleStatus(lotId, st) {
    if (!(await lotExists(lotId)) || !st || !Array.isArray(st.slots)) return;
    const c = cache.get(lotId);

    for (const s of st.slots) {
      if (c.slots[s.id] === s.state) continue;
      await db.tx((q) => applySlotState(q, lotId, s.id, s.state, s.distance));
      c.slots[s.id] = s.state;
    }

    const gates = st.gates || {};
    const changed = gates.entry !== c.gates.entry || gates.exit !== c.gates.exit || st.fw !== c.fw;
    if (changed || Date.now() - c.lastSeenWrite > LAST_SEEN_WRITE_MS) {
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
  }

  async function handleEvent(lotId, ev) {
    if (!(await lotExists(lotId)) || !ev || !ev.type) return;
    const c = cache.get(lotId);
    await db.query('INSERT INTO device_events (lot_id, type, payload) VALUES ($1, $2, $3)', [lotId, ev.type, ev]);

    if (ev.type === 'slot_changed') {
      await db.tx((q) => applySlotState(q, lotId, ev.slot, ev.state));
      // Khong ghi cache: event khong co khoang cach -> de ban tin 'status' ke tiep bo sung (1 lan ghi)
      delete c.slots[ev.slot];
    } else if (ev.type === 'reservation_expired') {
      await db.query(
        `UPDATE reservations r SET status = 'expired', updated_at = now()
         FROM slots s WHERE s.id = r.slot_id AND s.lot_id = $1 AND s.slot_number = $2 AND r.status = 'active'
           AND r.entered_at IS NULL`,
        [lotId, ev.slot]);
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
    }
  }

  return { handleOnline, handleStatus, handleEvent };
}

module.exports = { createSync, applySlotState };
