// Cau noi "co thong bao moi" -> gui day (src/push.js). Tach rieng de sessions.js / booking.js khong phu thuoc vong.
// Gui day KHONG chan luong chinh (loi mang Expo khong lam hong thao tac cua nguoi dung).
let hook = null;

const setPushHook = (fn) => { hook = fn; };

function emitPush(row) {
  if (!hook || !row) return;
  Promise.resolve()
    .then(() => hook(row))
    .catch((e) => console.error('[PUSH] Loi gui thong bao:', e.message));
}

module.exports = { setPushHook, emitPush };
