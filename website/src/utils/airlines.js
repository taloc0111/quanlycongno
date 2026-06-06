// utils/airlines.js — nhận diện hãng bay từ chuỗi tự do + link check-in chính thức.

const strip = (s) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');

// Tên dài để match theo "chứa"; code2 = mã 2 ký tự match theo token riêng.
const AIRLINES = [
  { code: 'VN', name: 'Vietnam Airlines', checkinUrl: 'https://www.vietnamairlines.com/vn/en/travel-information/check-in', names: ['vietnam airlines', 'vietnamairlines', 'vna'], code2: 'vn' },
  { code: 'VJ', name: 'Vietjet Air', checkinUrl: 'https://www.vietjetair.com/en/checkin', names: ['vietjet'], code2: 'vj' },
  { code: 'QH', name: 'Bamboo Airways', checkinUrl: 'https://www.bambooairways.com/vn/en/travel-info/check-in/online-check-in', names: ['bamboo'], code2: 'qh' },
  { code: 'BL', name: 'Pacific Airlines', checkinUrl: 'https://www.pacificairlines.com/', names: ['pacific', 'jetstar'], code2: 'bl' },
  { code: 'VU', name: 'Vietravel Airlines', checkinUrl: 'https://booking.vietravelairlines.com/vi/checkin', names: ['vietravel'], code2: 'vu' },
];

/** Trả về { code, name, checkinUrl } nếu nhận diện được hãng, ngược lại null. */
export function detectAirline(text) {
  const s = strip(text);
  if (!s) return null;
  // 1) Khớp theo tên hãng (chuỗi con).
  for (const a of AIRLINES) {
    if (a.names.some((n) => s.includes(n))) return a;
  }
  // 2) Khớp mã 2 ký tự khi đứng thành token riêng (VD: "VJ123", "VN-216" → token vj/vn).
  const tokens = s.split(/[^a-z0-9]+/).filter(Boolean);
  for (const a of AIRLINES) {
    if (tokens.includes(a.code2)) return a;
    // mã dính số: vj123 → bắt đầu bằng mã + chữ số
    if (tokens.some((t) => t.startsWith(a.code2) && /\d/.test(t.slice(2)))) return a;
  }
  return null;
}
