// Chuyen dong DB (snake_case) -> JSON tra ve cho app (camelCase)
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
  id: s.id, slotNumber: s.slot_number, state: s.state, distanceCm: s.distance_cm, updatedAt: s.updated_at,
});

const reservation = (r) => r && ({
  id: r.id, lotId: r.lot_id, slotNumber: r.slot_number, vehicleId: r.vehicle_id, status: r.status,
  minutes: r.minutes, error: r.error, expiresAt: r.expires_at, createdAt: r.created_at, updatedAt: r.updated_at,
});

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

module.exports = { user, vehicle, lot, slot, reservation, session, schedule };
