// Vong long-poll cap nhat thoi gian thuc (tach khoi LiveContext de kiem thu duoc):
//  - Goi fetchLive(version) -> may chu giu request den khi co thay doi -> onData khi phien ban moi
//  - Mat mang / may chu loi: bao offline ngay, thu lai voi thoi gian cho tang dan 2s, 4s, 8s, 15s (toi da)
//  - Co mang lai: bao online + tai du lieu moi ngay (phien ban cu -> may chu tra ngay thay doi da bo lo)
//  - App chay nen: tam dung (khong ton pin / du lieu), mo lai thi tiep tuc
export const backoffMs = (fails) => Math.min(15000, 1000 * 2 ** Math.min(fails, 4));

export async function runLivePoll({ fetchLive, onData, onOnline, isActive = () => true, isStopped, sleep, now = () => Date.now() }) {
  let version = '';
  let fails = 0;
  while (!isStopped()) {
    if (!isActive()) { await sleep(1500); continue; }
    try {
      const r = await fetchLive(version);
      if (isStopped()) break;
      fails = 0;
      onOnline(true, now());
      if (r.version !== version) {
        version = r.version;
        onData(r);
      }
    } catch {
      if (isStopped()) break;
      fails += 1;
      onOnline(false, now());
      await sleep(backoffMs(fails));
    }
  }
}
