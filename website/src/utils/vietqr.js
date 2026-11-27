// utils/vietqr.js — tạo chuỗi VietQR (chuẩn EMVCo/NAPAS) để khách quét chuyển khoản.
// Tạo hoàn toàn trên máy — KHÔNG gửi số tài khoản tới dịch vụ ngoài.
//
// Cấu trúc (mỗi trường = ID 2 số + độ dài 2 số + giá trị):
//   00 "01"                         phiên bản
//   01 "11" | "12"                  11 = mã tĩnh, 12 = mã có số tiền (động)
//   38 {00 "A000000727", 01 {00 BIN, 01 số TK}, 02 "QRIBFTTA"}   thông tin người nhận (NAPAS 247 tới tài khoản)
//   53 "704"                        tiền VND
//   54 số tiền (tuỳ chọn)
//   58 "VN"
//   62 {08 nội dung}                nội dung chuyển khoản (tuỳ chọn)
//   63 CRC16-CCITT-FALSE (4 hex)    tính trên toàn chuỗi kể cả "6304"

/** Danh sách ngân hàng phổ biến: mã viết tắt → BIN NAPAS. */
export const VN_BANKS = [
  { code: 'VCB', bin: '970436', name: 'Vietcombank' },
  { code: 'TCB', bin: '970407', name: 'Techcombank' },
  { code: 'MB', bin: '970422', name: 'MB Bank' },
  { code: 'BIDV', bin: '970418', name: 'BIDV' },
  { code: 'VTB', bin: '970415', name: 'VietinBank' },
  { code: 'AGR', bin: '970405', name: 'Agribank' },
  { code: 'ACB', bin: '970416', name: 'ACB' },
  { code: 'VPB', bin: '970432', name: 'VPBank' },
  { code: 'TPB', bin: '970423', name: 'TPBank' },
  { code: 'VIB', bin: '970441', name: 'VIB' },
  { code: 'STB', bin: '970403', name: 'Sacombank' },
  { code: 'SHB', bin: '970443', name: 'SHB' },
  { code: 'HDB', bin: '970437', name: 'HDBank' },
  { code: 'OCB', bin: '970448', name: 'OCB' },
  { code: 'MSB', bin: '970426', name: 'MSB' },
  { code: 'SEAB', bin: '970440', name: 'SeABank' },
  { code: 'EIB', bin: '970431', name: 'Eximbank' },
  { code: 'LPB', bin: '970449', name: 'LPBank' },
  { code: 'NAB', bin: '970428', name: 'Nam A Bank' },
  { code: 'VAB', bin: '970427', name: 'VietABank' },
  { code: 'BAB', bin: '970409', name: 'Bac A Bank' },
  { code: 'PVCB', bin: '970412', name: 'PVcomBank' },
  { code: 'SCB', bin: '970429', name: 'SCB' },
  { code: 'ABB', bin: '970425', name: 'ABBank' },
  { code: 'KLB', bin: '970452', name: 'KienlongBank' },
  { code: 'BVB', bin: '970438', name: 'BaoVietBank' },
  { code: 'VCCB', bin: '970454', name: 'Viet Capital Bank' },
  { code: 'CAKE', bin: '546034', name: 'CAKE by VPBank' },
  { code: 'TIMO', bin: '963388', name: 'Timo' },
];

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]/g, '');

/**
 * Tìm ngân hàng từ ô "Ngân hàng" người dùng nhập tự do ("TCB", "Techcombank", "techcom", "970407"…).
 * @returns {{code,bin,name}|null}
 */
export function findBank(input) {
  const s = norm(input);
  if (!s) return null;
  if (/^\d{6}$/.test(s)) return VN_BANKS.find((b) => b.bin === s) || { code: s, bin: s, name: s };
  const aliases = { vietin: 'VTB', ctg: 'VTB', agribank: 'AGR', sacom: 'STB', techcom: 'TCB', vietcom: 'VCB', mbbank: 'MB', vpbank: 'VPB', tpbank: 'TPB', hdbank: 'HDB', seabank: 'SEAB', eximbank: 'EIB', lienviet: 'LPB', lpbank: 'LPB', namabank: 'NAB' };
  for (const [k, code] of Object.entries(aliases)) if (s.startsWith(k)) return VN_BANKS.find((b) => b.code === code);
  return VN_BANKS.find((b) => norm(b.code) === s) || VN_BANKS.find((b) => norm(b.name) === s) || VN_BANKS.find((b) => norm(b.name).startsWith(s) || s.startsWith(norm(b.name))) || null;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) → 4 ký tự hex hoa. */
export function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const tlv = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`;

/** Bỏ dấu tiếng Việt, chỉ giữ chữ/số/khoảng trắng — nhiều app ngân hàng không nhận ký tự có dấu trong nội dung QR. */
export function cleanContent(text, max = 50) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

/**
 * Tạo chuỗi VietQR.
 * @param {{ bin:string, accountNumber:string, amount?:number, content?:string }} p
 * @returns {string}
 * @throws Error khi thiếu BIN / số tài khoản sai.
 */
export function buildVietQR({ bin, accountNumber, amount, content }) {
  const acc = String(accountNumber || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(String(bin || ''))) throw new Error('Không nhận ra ngân hàng — chọn ngân hàng trong danh sách');
  if (!/^[0-9A-Za-z]{4,19}$/.test(acc)) throw new Error('Số tài khoản không hợp lệ');
  const amt = Math.round(Number(amount) || 0);
  const beneficiary = tlv('00', bin) + tlv('01', acc);
  const merchant = tlv('00', 'A000000727') + tlv('01', beneficiary) + tlv('02', 'QRIBFTTA');
  const note = cleanContent(content);
  let payload = tlv('00', '01') + tlv('01', amt > 0 ? '12' : '11') + tlv('38', merchant) + tlv('53', '704');
  if (amt > 0) payload += tlv('54', String(amt));
  payload += tlv('58', 'VN');
  if (note) payload += tlv('62', tlv('08', note));
  payload += '6304';
  return payload + crc16(payload);
}

/** Tài khoản này có tạo QR được không (đủ ngân hàng nhận diện được + số TK). */
export function accountQrInfo(account) {
  if (!account) return { ok: false, reason: 'Chưa chọn tài khoản' };
  const bank = findBank(account.bank);
  if (!bank) return { ok: false, reason: 'Chưa rõ ngân hàng của tài khoản (sửa ô "Ngân hàng", vd TCB, VCB, MB)' };
  if (!account.account_number) return { ok: false, reason: 'Tài khoản chưa có số tài khoản' };
  return { ok: true, bank };
}
