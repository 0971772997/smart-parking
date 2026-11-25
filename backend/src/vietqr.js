// MA VIETQR (chuan EMVCo / NAPAS 247) - tao noi dung QR chuyen khoan ngay tren may chu, khong goi dich vu ngoai.
// App ngan hang va vi MoMo / ZaloPay quet ma -> dien san ngan hang, so tai khoan, so tien, noi dung.
//   buildVietQR({ bin: '970422', accountNo: '0971772997', amount: 10000, content: 'SP12AB34' }) -> chuoi QR

// CRC16-CCITT-FALSE (poly 0x1021, init 0xFFFF) theo yeu cau EMVCo
function crc16(str) {
  let crc = 0xffff;
  for (const byte of Buffer.from(str, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const tlv = (id, value) => {
  const v = String(value);
  return `${id}${String(v.length).padStart(2, '0')}${v}`;
};

// Noi dung chuyen khoan: chi chu khong dau / so / khoang trang (ngan hang hay cat ky tu dac biet)
const cleanContent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 25);

function buildVietQR({ bin, accountNo, amount, content }) {
  const merchant = tlv('00', 'A000000727') + tlv('01', tlv('00', bin) + tlv('01', accountNo)) + tlv('02', 'QRIBFTTA');
  let s = tlv('00', '01') + tlv('01', amount ? '12' : '11') + tlv('38', merchant) + tlv('53', '704');
  if (amount) s += tlv('54', String(Math.round(amount)));
  s += tlv('58', 'VN');
  const c = cleanContent(content);
  if (c) s += tlv('62', tlv('08', c));
  s += '6304';
  return s + crc16(s);
}

module.exports = { buildVietQR, crc16, cleanContent };
