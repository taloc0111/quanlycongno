// utils/airlines.js — nhận diện hãng bay từ chuỗi tự do + link check-in.
// Ưu tiên danh sách hãng người dùng tự khai báo (từ DB), rồi tới mặc định.

const strip = (s) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');

// Hãng mặc định (có sẵn, không cần khai báo).
export const DEFAULT_AIRLINES = [
  { name: 'Vietnam Airlines', checkinUrl: 'https://www.vietnamairlines.com/vn/en/travel-information/check-in', names: ['vietnam airlines', 'vietnamairlines', 'vna'], code2: 'vn' },
  { name: 'Vietjet Air', checkinUrl: 'https://www.vietjetair.com/en/checkin', names: ['vietjet'], code2: 'vj' },
  { name: 'Bamboo Airways', checkinUrl: 'https://www.bambooairways.com/vn/en/travel-info/check-in/online-check-in', names: ['bamboo'], code2: 'qh' },
  { name: 'Pacific Airlines', checkinUrl: 'https://www.pacificairlines.com/', names: ['pacific', 'jetstar'], code2: 'bl' },
  { name: 'Vietravel Airlines', checkinUrl: 'https://booking.vietravelairlines.com/vi/checkin', names: ['vietravel'], code2: 'vu' },
];

// Chuyển bản ghi DB { name, code, checkin_url } → ứng viên khớp.
const fromCustom = (c) => ({
  name: c.name,
  checkinUrl: c.checkin_url,
  names: [strip(c.name)],
  code2: (c.code || '').toLowerCase(),
});

/**
 * Nhận diện hãng từ ô "Hãng" của vé.
 * @param {string} text  giá trị ô Hãng
 * @param {Array}  custom danh sách hãng tự khai báo từ DB (tùy chọn)
 * @returns {{name, checkinUrl}|null}
 */
export function detectAirline(text, custom = []) {
  const s = strip(text);
  if (!s) return null;
  const list = [...custom.map(fromCustom), ...DEFAULT_AIRLINES];

  // 1) Khớp theo tên (chuỗi con, 2 chiều để linh hoạt).
  for (const a of list) {
    if (a.names.some((n) => n && (s.includes(n) || n.includes(s)))) return a;
  }
  // 2) Khớp mã 2 ký tự khi đứng thành token riêng hoặc dính số (VJ123).
  const tokens = s.split(/[^a-z0-9]+/).filter(Boolean);
  for (const a of list) {
    if (!a.code2) continue;
    if (tokens.includes(a.code2)) return a;
    if (tokens.some((t) => t.startsWith(a.code2) && /\d/.test(t.slice(2)))) return a;
  }
  return null;
}
