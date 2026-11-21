// CAP NHAT THOI GIAN THUC cho app (long-poll, khong can WebSocket):
//   app goi GET /api/live?v=<phien ban> -> neu da co thay doi tra ngay, neu chua thi GIU request
//   den khi co thay doi (o do, cong, thiet bi online, dat cho, phien gui xe) hoac het thoi gian cho.
// Moi thay doi -> bump(lotId) tang phien ban. Phien ban gom ma khoi dong may chu de app biet khi server khoi dong lai.
const crypto = require('crypto');

function createLiveHub() {
  const boot = crypto.randomBytes(3).toString('hex');
  let n = 0;
  const waiters = new Set(); // ham resolve cua cac request dang cho

  const version = () => `${boot}-${n}`;

  function bump() {
    n += 1;
    const list = [...waiters];
    waiters.clear();
    for (const wake of list) wake(true);
  }

  // Cho den khi phien ban khac `since` (hoac het timeoutMs) -> true neu co thay doi
  function wait(since, timeoutMs) {
    if (since !== version()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const wake = (changed) => { clearTimeout(timer); waiters.delete(wake); resolve(changed); };
      const timer = setTimeout(() => wake(false), timeoutMs);
      waiters.add(wake);
    });
  }

  return { version, bump, wait, waiting: () => waiters.size };
}

module.exports = { createLiveHub };
