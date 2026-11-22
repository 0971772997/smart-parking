// KIEM THU DON VI APP - cap nhat thoi gian thuc khi mang chap chon:
// bao offline ngay, thu lai lui dan 2s/4s/8s/15s, co mang lai -> online + du lieu moi, tam dung khi app chay nen.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runLivePoll, backoffMs } from '../src/realtime/livePoll.js';

// Kich ban: danh sach ket qua lan luot cho fetchLive ('fail' = mat mang); het kich ban -> dung vong lap
function harness(script, { active = () => true } = {}) {
  const log = [];
  const sleeps = [];
  let i = 0;
  let stopped = false;
  const run = runLivePoll({
    fetchLive: async (v) => {
      if (i >= script.length) { stopped = true; return { version: '__het_kich_ban' }; } // ket qua bi bo vi da dung
      log.push(['fetch', v]);
      const step = script[i++];
      if (step === 'fail') throw new Error('Network request failed');
      return step;
    },
    onData: (r) => log.push(['data', r.version]),
    onOnline: (ok) => log.push(['online', ok]),
    isActive: () => { const a = active(); if (!a && i >= script.length) stopped = true; return a; },
    isStopped: () => stopped,
    sleep: async (ms) => { sleeps.push(ms); },
    now: () => 0,
  });
  return { run, log, sleeps };
}

describe('Vong long-poll', () => {
  test('Thoi gian cho tang dan va gioi han 15s', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 9].map(backoffMs), [2000, 4000, 8000, 15000, 15000, 15000]);
  });

  test('Binh thuong: gui lai phien ban vua nhan; chi bao du lieu khi phien ban doi', async () => {
    const h = harness([{ version: 'a-1' }, { version: 'a-1' }, { version: 'a-2' }]);
    await h.run;
    assert.deepEqual(h.log.filter((x) => x[0] === 'fetch').map((x) => x[1]), ['', 'a-1', 'a-1']);
    assert.deepEqual(h.log.filter((x) => x[0] === 'data').map((x) => x[1]), ['a-1', 'a-2']);
    assert.equal(h.sleeps.length, 0, 'khong cho khi on dinh');
  });

  test('Mat mang 3 lan -> offline ngay lan dau, cho 2s/4s/8s; co mang lai -> online, lay tiep tu phien ban cu', async () => {
    const h = harness([{ version: 'b-5' }, 'fail', 'fail', 'fail', { version: 'b-9' }]);
    await h.run;
    assert.deepEqual(h.sleeps, [2000, 4000, 8000]);
    const online = h.log.filter((x) => x[0] === 'online').map((x) => x[1]);
    assert.deepEqual(online, [true, false, false, false, true]);
    // Sau khi co mang lai van gui phien ban cu 'b-5' -> may chu tra ngay thay doi da bo lo
    assert.deepEqual(h.log.filter((x) => x[0] === 'fetch').map((x) => x[1]), ['', 'b-5', 'b-5', 'b-5', 'b-5']);
    assert.deepEqual(h.log.filter((x) => x[0] === 'data').map((x) => x[1]), ['b-5', 'b-9']);
  });

  test('Co mang lai thi dem lui lai tu dau (lan mat mang sau cho 2s)', async () => {
    const h = harness([{ version: 'c' }, 'fail', 'fail', { version: 'c' }, 'fail', { version: 'c' }]);
    await h.run;
    assert.deepEqual(h.sleeps, [2000, 4000, 2000]);
  });

  test('App chay nen -> khong goi API (tiet kiem pin / du lieu), cho 1,5s roi kiem tra lai', async () => {
    let calls = 0;
    const h = harness([{ version: 'd' }], { active: () => (calls++ < 3 ? false : true) });
    await h.run;
    assert.deepEqual(h.sleeps, [1500, 1500, 1500]);
    assert.equal(h.log.filter((x) => x[0] === 'fetch').length, 1);
  });

  test('Dung (thoat man / dang xuat) trong luc dang cho -> khong cap nhat state nua', async () => {
    let stop = false;
    const log = [];
    await runLivePoll({
      fetchLive: async () => { stop = true; return { version: 'x' }; },
      onData: () => log.push('data'), onOnline: () => log.push('online'),
      isStopped: () => stop, sleep: async () => {},
    });
    assert.deepEqual(log, []);
  });
});
