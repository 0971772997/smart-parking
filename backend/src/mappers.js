// Chuyen dong DB (snake_case) -> JSON tra ve cho app (camelCase)
const { RULES } = require('./booking');
const { nextGate } = require('./gatePass');

const user = (u) => u && ({
  id: u.id, username: u.username, email: u.email, fullName: u.full_name, phone: u.phone, role: u.role, avatarUrl: u.avatar_url,
  linked: { google: !!u.google_id, facebook: !!u.facebook_id }, createdAt: u.created_at,
});

const vehicle = (v) => v && ({
  id: v.id, plateNumber: v.plate_number, vehicleType: v.vehicle_type || 'car', brand: v.brand, color: v.color,
  createdAt: v.created_at,
});

const lot = (l) => l && ({
  id: l.id, name: l.name, address: l.address, totalSlots: l.total_slots, pricePerHour: l.price_per_hour,
  online: l.online, gates: { entry: l.entry_gate, exit: l.exit_gate }, fwVersion: l.fw_version,
  lastSeenAt: l.last_seen_at, bookingEnabled: l.booking_enabled !== false,
  ...(l.free_slots !== undefined && { freeSlots: Number(l.free_slots) }),
  ...(l.rating_count !== undefined && {
    rating: { average: l.rating_avg == null ? null : Math.round(Number(l.rating_avg) * 10) / 10, count: Number(l.rating_count) },
  }),
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
    vehicleType: r.vehicle_type ?? null, vehicleBrand: r.vehicle_brand ?? null,
    status: r.status, minutes: r.minutes, holdMinutes: r.minutes, durationMinutes: r.duration_minutes,
    estimatedFee: r.estimated_fee, hourlyRate: r.hourly_rate ?? null, extendCount: r.extend_count ?? 0, error: r.error,
    confirmedAt: r.confirmed_at, expiresAt: r.expires_at, createdAt: r.created_at, updatedAt: r.updated_at,
    enteredAt: r.entered_at ?? null, exitedAt: r.exited_at ?? null, sessionId: r.session_id ?? null,
    nextGate: nextGate(r), // 'entry' | 'exit' | null -> app hien ma QR qua cong tuong ung
    canCancel: r.status === 'active',
    canExtend: !!live && (r.extend_count ?? 0) < RULES.extend.maxTimes,
  };
};

// Luot do (danh sach quan tri). Chi tiet day du cho tai xe: sessionView trong src/sessions.js
const session = (s) => s && ({
  id: s.id, slotNumber: s.slot_number, reservationId: s.reservation_id, userId: s.user_id ?? null,
  source: s.source, startedAt: s.started_at, parkedAt: s.parked_at ?? null,
  endedAt: s.ended_at, exitedAt: s.exited_at ?? null, plannedEndAt: s.planned_end_at ?? null,
  durationSeconds: s.duration_seconds, fee: s.fee, overtimeFee: s.overtime_fee ?? null, flags: s.flags || [],
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

const payment = (p) => p && ({
  id: p.id, code: p.code, sessionId: p.session_id, userId: p.user_id, amount: p.amount, method: p.method,
  collectedBy: p.collected_by, createdAt: p.created_at,
  lotId: p.lot_id, lotName: p.lot_name, slotNumber: p.slot_number,
  startedAt: p.started_at, endedAt: p.ended_at, durationSeconds: p.duration_seconds,
});

// Nhat ky quet ma tai cong
const gateScan = (g) => g && ({
  id: g.id, lotId: g.lot_id, gate: g.gate, reservationId: g.reservation_id, result: g.result, error: g.error,
  reservationCode: g.reservation_code ?? null, slotNumber: g.slot_number ?? null, vehiclePlate: g.vehicle_plate ?? null,
  vehicleType: g.vehicle_type ?? null, mode: g.mode || 'staff', sessionId: g.session_id ?? null,
  scannedBy: g.scanned_by, createdAt: g.created_at, confirmedAt: g.confirmed_at,
});

module.exports = { gateScan, user, vehicle, lot, slot, reservation, session, schedule, payment };
