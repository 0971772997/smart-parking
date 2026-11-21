// Chuyen dong DB (snake_case) -> JSON tra ve cho app (camelCase)
const { RULES } = require('./booking');

const user = (u) => u && ({
  id: u.id, username: u.username, email: u.email, fullName: u.full_name, phone: u.phone, role: u.role, avatarUrl: u.avatar_url,
  linked: { google: !!u.google_id, facebook: !!u.facebook_id }, createdAt: u.created_at,
});

const vehicle = (v) => v && ({
  id: v.id, plateNumber: v.plate_number, brand: v.brand, color: v.color, createdAt: v.created_at,
});

const lot = (l) => l && ({
  id: l.id, name: l.name, address: l.address, totalSlots: l.total_slots, pricePerHour: l.price_per_hour,
  online: l.online, gates: { entry: l.entry_gate, exit: l.exit_gate }, fwVersion: l.fw_version,
  lastSeenAt: l.last_seen_at,
  ...(l.free_slots !== undefined && { freeSlots: Number(l.free_slots) }),
});

const slot = (s) => s && ({
  id: s.id, slotNumber: s.slot_number, zone: s.zone, state: s.state, distanceCm: s.distance_cm, updatedAt: s.updated_at,
});

// Dat cho: kem ma xac nhan, khu vuc, thoi luong du kien, phi du kien va thao tac con duoc phep
// minutes = holdMinutes = tong thoi gian giu cho (ke ca gia han); giu ten 'minutes' cho app cu
const reservation = (r) => {
  if (!r) return r;
  const live = r.status === 'active' && r.expires_at && new Date(r.expires_at) > new Date();
  return {
    id: r.id, code: r.code, lotId: r.lot_id, lotName: r.lot_name, lotAddress: r.lot_address,
    zone: r.zone, slotNumber: r.slot_number, vehicleId: r.vehicle_id, vehiclePlate: r.vehicle_plate ?? null,
    status: r.status, minutes: r.minutes, holdMinutes: r.minutes, durationMinutes: r.duration_minutes,
    estimatedFee: r.estimated_fee, extendCount: r.extend_count ?? 0, error: r.error,
    confirmedAt: r.confirmed_at, expiresAt: r.expires_at, createdAt: r.created_at, updatedAt: r.updated_at,
    canCancel: r.status === 'active',
    canExtend: !!live && (r.extend_count ?? 0) < RULES.extend.maxTimes,
  };
};

const session = (s) => s && ({
  id: s.id, slotNumber: s.slot_number, reservationId: s.reservation_id, startedAt: s.started_at,
  endedAt: s.ended_at, durationSeconds: s.duration_seconds, fee: s.fee,
});

const schedule = (d) => d && ({
  id: d.id, name: d.name, lotId: d.lot_id, vehicleId: d.vehicle_id, arriveTime: d.arrive_time,
  days: (d.days || []).map(Number), minutes: d.minutes, note: d.note, active: d.active,
  lot: d.lot_name === undefined ? undefined : {
    name: d.lot_name, address: d.lot_address, pricePerHour: d.lot_price_per_hour, online: d.lot_online,
    totalSlots: d.lot_total_slots, freeSlots: Number(d.lot_free_slots),
  },
  vehiclePlate: d.vehicle_plate ?? null, createdAt: d.created_at, updatedAt: d.updated_at,
});

// Luot do cua tai xe: trang thai parking (dang do) / unpaid (cho thanh toan) / paid
const mySession = (s) => s && ({
  id: s.id, lotId: s.lot_id, lotName: s.lot_name, slotNumber: s.slot_number, reservationId: s.reservation_id,
  startedAt: s.started_at, endedAt: s.ended_at, durationSeconds: s.duration_seconds,
  fee: s.ended_at ? s.fee : null,
  estimatedFee: s.ended_at ? null : Number(s.running_fee),
  status: !s.ended_at ? 'parking' : s.payment_id ? 'paid' : 'unpaid',
  payment: s.payment_id ? { id: s.payment_id, code: s.payment_code, method: s.payment_method, paidAt: s.paid_at } : null,
});

const payment = (p) => p && ({
  id: p.id, code: p.code, sessionId: p.session_id, userId: p.user_id, amount: p.amount, method: p.method,
  collectedBy: p.collected_by, createdAt: p.created_at,
  lotId: p.lot_id, lotName: p.lot_name, slotNumber: p.slot_number,
  startedAt: p.started_at, endedAt: p.ended_at, durationSeconds: p.duration_seconds,
});

module.exports = { user, vehicle, lot, slot, reservation, session, schedule, mySession, payment };
