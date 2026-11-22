// KIEM THU TUONG THICH NEN TANG: hop thoai xac nhan (xoa xe, xoa bai...) phai chay ca tren web lan dien thoai.
// Alert.alert cua react-native-web la ham rong -> appAlert dung window.confirm / window.alert tren web.
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { appAlert } from '../src/utils/alert.js';

afterEach(() => { globalThis.__RN_OS__ = undefined; delete globalThis.window; globalThis.__nativeAlerts = []; });

describe('appAlert', () => {
  test('Dien thoai (Android / iOS): chuyen nguyen cho Alert.alert goc', () => {
    for (const os of ['android', 'ios']) {
      globalThis.__RN_OS__ = os;
      globalThis.__nativeAlerts = [];
      const buttons = [{ text: 'Huỷ', style: 'cancel' }, { text: 'Xoá' }];
      appAlert('Xoá xe', 'Chắc chắn?', buttons);
      assert.deepEqual(globalThis.__nativeAlerts, [['Xoá xe', 'Chắc chắn?', buttons]]);
    }
  });

  test('Web + nguoi dung dong y -> chay hanh dong (vd xoa xe)', () => {
    globalThis.__RN_OS__ = 'web';
    const asked = [];
    globalThis.window = { confirm: (t) => { asked.push(t); return true; } };
    let deleted = false; let cancelled = false;
    appAlert('Xoá phương tiện', 'Xoá xe 43A-123.45?', [
      { text: 'Huỷ', style: 'cancel', onPress: () => { cancelled = true; } },
      { text: 'Xoá ngay', style: 'destructive', onPress: () => { deleted = true; } },
    ]);
    assert.deepEqual([deleted, cancelled], [true, false]);
    assert.match(asked[0], /Xoá phương tiện[\s\S]*43A-123\.45/);
  });

  test('Web + nguoi dung huy -> khong xoa', () => {
    globalThis.__RN_OS__ = 'web';
    globalThis.window = { confirm: () => false };
    let deleted = false;
    appAlert('Xoá', null, [{ text: 'Huỷ', style: 'cancel' }, { text: 'Xoá', onPress: () => { deleted = true; } }]);
    assert.equal(deleted, false);
  });

  test('Web + thong bao 1 nut (loi / thanh cong) -> window.alert duoc goi (truoc day bi nuot mat)', () => {
    globalThis.__RN_OS__ = 'web';
    const shown = [];
    globalThis.window = { alert: (t) => shown.push(t) };
    appAlert('Lỗi', 'Không thể thêm xe.');
    assert.deepEqual(shown, ['Lỗi\n\nKhông thể thêm xe.']);
  });
});
