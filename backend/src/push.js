// THONG BAO DAY qua Expo Push Service (Expo -> FCM tren Android / APNs tren iOS)
//   POST https://exp.host/--/api/v2/push/send  (toi da 100 tin / lan goi, khong can khoa truy cap mac dinh)
//   - Moi thong bao ghi vao bang notifications (src/sessions.js notify) -> neu loai nay duoc "day"
//     va nguoi dung bat nhom tuong ung -> gui toi moi thiet bi cua nguoi dung.
//   - Expo bao DeviceNotRegistered (go app / token het han) -> xoa token.
//   - Nhac theo gio (sap het gio giu cho / gui xe) do APP hen thong bao cuc bo tren may -> khong day tu may chu
//     (van chay khi may chu Render free dang ngu hoac dien thoai mat mang).
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TOKEN_RE = /^Expo(nent)?PushToken\[[\w-]+\]$/;

// Nhom thong bao (nguoi dung bat/tat tung nhom) + kenh Android tuong ung (app tao san cac kenh nay)
const CATEGORY = {
  reservation_confirmed: 'reservation', reservation_expired: 'reservation', slot_changed: 'reservation',
  session_started: 'arrival', parked: 'arrival', wrong_slot: 'arrival', exited: 'arrival', not_parked: 'arrival',
  near_end: 'reminder', overtime: 'reminder', fee_changed: 'reminder', extended: 'reminder',
  left_slot: 'payment', paid: 'payment', payment_failed: 'payment',
  support_new: 'support', support_reply: 'support', support_status: 'support', review_reply: 'support',
  announcement: 'support', admin_notice: 'support',
};
const CHANNEL = { reservation: 'parking', arrival: 'parking', reminder: 'reminders', payment: 'payment', support: 'parking' };
// Cac loai duoc day tu may chu (su kien tuc thoi). Loai theo gio / do chinh nguoi dung bam -> chi luu trong app.
const PUSH_TYPES = new Set([
  'reservation_confirmed', 'reservation_expired', 'slot_changed',
  'session_started', 'parked', 'wrong_slot', 'exited',
  'left_slot', 'paid', 'payment_failed',
  'support_new', 'support_reply', 'support_status', 'review_reply', 'announcement', 'admin_notice',
]);
const PREF_KEYS = ['reservation', 'arrival', 'reminder', 'payment', 'support'];
const prefsOf = (raw) => Object.fromEntries(PREF_KEYS.map((k) => [k, raw?.[k] !== false]));

function createPushService({ db, fetchFn = globalThis.fetch, accessToken, log = console } = {}) {
  async function post(messages) {
    const r = await fetchFn(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json',
        ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      },
      body: JSON.stringify(messages),
    });
    return r.json();
  }

  // Gui toi danh sach token; xu ly ve (ticket) loi -> { sent, failed }
  async function deliver(rows, msg) {
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      let res;
      try {
        res = await post(batch.map((t) => ({ to: t.token, ...msg })));
      } catch (e) {
        log.error('[PUSH] Loi goi Expo:', e.message);
        failed += batch.length;
        continue;
      }
      const tickets = Array.isArray(res?.data) ? res.data : [];
      for (let j = 0; j < batch.length; j += 1) {
        const tk = tickets[j];
        if (tk && tk.status === 'ok') { sent += 1; continue; }
        failed += 1;
        const err = tk?.details?.error || tk?.message || res?.errors?.[0]?.code || 'unknown';
        if (err === 'DeviceNotRegistered') await db.query('DELETE FROM push_tokens WHERE id = $1', [batch[j].id]);
        else await db.query('UPDATE push_tokens SET last_error = $2 WHERE id = $1', [batch[j].id, String(err).slice(0, 60)]);
      }
    }
    return { sent, failed };
  }

  // n: dong notifications vua tao. force: bo qua PUSH_TYPES / tuy chon (gui thu)
  async function sendNotification(n, { force = false } = {}) {
    if (!n || !n.user_id) return { sent: 0, failed: 0, skipped: 'no_user' };
    const cat = CATEGORY[n.type] || 'reservation';
    if (!force && !PUSH_TYPES.has(n.type)) return { sent: 0, failed: 0, skipped: 'not_push_type' };
    const u = await db.one('SELECT notification_prefs FROM users WHERE id = $1', [n.user_id]);
    if (!force && !prefsOf(u?.notification_prefs)[cat]) return { sent: 0, failed: 0, skipped: 'disabled' };
    const { rows } = await db.query('SELECT id, token FROM push_tokens WHERE user_id = $1', [n.user_id]);
    if (!rows.length) return { sent: 0, failed: 0, skipped: 'no_device' };
    const unread = (await db.one(
      'SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND read_at IS NULL', [n.user_id])).c;
    const r = await deliver(rows, {
      title: n.title, body: n.body || undefined, sound: 'default', priority: 'high',
      channelId: CHANNEL[cat], badge: unread, ttl: 6 * 3600,
      data: {
        notificationId: n.id ? Number(n.id) : null, type: n.type, sessionId: n.session_id ?? null,
        reservationId: n.reservation_id ?? null, paymentId: n.data?.paymentId ?? null,
        ticketId: n.data?.ticketId ?? null, lotId: n.data?.lotId ?? null,
      },
    });
    if (n.id && r.sent) await db.query('UPDATE notifications SET pushed_at = now() WHERE id = $1', [n.id]);
    return r;
  }

  return { sendNotification, deliver };
}

module.exports = { createPushService, CATEGORY, CHANNEL, PUSH_TYPES, PREF_KEYS, prefsOf, TOKEN_RE, EXPO_PUSH_URL };
