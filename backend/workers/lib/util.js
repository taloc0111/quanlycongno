// workers/lib/util.js — tiện ích dùng chung cho các adapter canh giá.

// Mã IATA → tên thành phố tiếng Việt (để gõ vào ô autocomplete của các hãng VN —
// nhiều hãng chỉ hiện gợi ý sân bay khi gõ TÊN, gõ mã lại ra "tuyến phổ biến").
// Phủ các sân bay nội địa VN. Thiếu mã nào thì rơi về chính mã đó.
const AIRPORT_VI = {
  SGN: 'Hồ Chí Minh', HAN: 'Hà Nội', DAD: 'Đà Nẵng', CXR: 'Nha Trang', PQC: 'Phú Quốc',
  HPH: 'Hải Phòng', VCA: 'Cần Thơ', HUI: 'Huế', DLI: 'Đà Lạt', VII: 'Vinh',
  BMV: 'Buôn Ma Thuột', PXU: 'Pleiku', UIH: 'Quy Nhơn', TBB: 'Tuy Hòa', VDH: 'Đồng Hới',
  THD: 'Thanh Hóa', VCL: 'Chu Lai', DIN: 'Điện Biên', VKG: 'Rạch Giá', CAH: 'Cà Mau',
  VCS: 'Côn Đảo', NHA: 'Nha Trang',
};
function cityOf(code) {
  return AIRPORT_VI[String(code).toUpperCase()] || code;
}

// Tách "SGN-HAN" / "SGN HAN" / "sgn → han" thành { origin, dest } mã IATA 3 ký tự.
function parseRoute(route) {
  if (!route) return null;
  const codes = String(route).toUpperCase().match(/[A-Z]{3}/g);
  if (!codes || codes.length < 2) return null;
  return { origin: codes[0], dest: codes[1] };
}

// "2026-07-15" hoặc Date/ISO → các mảnh ngày để điền form.
function parseDate(d) {
  let s;
  if (typeof d === 'string') {
    s = d.slice(0, 10);
  } else {
    // Cột DATE của Postgres về dạng Date ở 00:00 GIỜ MÁY — phải lấy thành phần
    // local; toISOString() (UTC) sẽ lùi 1 ngày ở múi giờ dương (VN +7).
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    s = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }
  const [y, m, day] = s.split('-').map((x) => parseInt(x, 10));
  if (!y || !m || !day) return null;
  return { iso: s, year: y, month: m, day, mm: String(m).padStart(2, '0'), dd: String(day).padStart(2, '0') };
}

// Bóc số tiền VND từ chuỗi nhiều định dạng:
//   "1.234.567 ₫"  (dấu chấm ngăn nghìn)        → 1234567
//   "VND 1,688,000.00" (phẩy ngăn nghìn + .00)  → 1688000
//   "1234567 VND"                                → 1234567
// Trả số nguyên đồng, hoặc null nếu không hợp lệ (>= 50k để loại nhiễu "1", "990").
function parsePriceVnd(text) {
  if (text == null) return null;
  // giữ lại số + dấu phân tách (. ,), bỏ ký hiệu tiền & chữ
  let s = String(text).replace(/[^\d.,]/g, '');
  if (!s) return null;
  // bỏ phần thập phân ".00"/",00" ở cuối (VND không có xu thực tế)
  s = s.replace(/[.,]\d{2}$/, '');
  // bỏ mọi dấu ngăn nghìn còn lại
  const digits = s.replace(/[.,]/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n >= 50000 ? n : null;
}

// Lấy số nhỏ nhất hợp lệ từ 1 mảng giá (đã parse).
function minPrice(prices) {
  const valid = prices.filter((p) => Number.isFinite(p) && p > 0);
  return valid.length ? Math.min(...valid) : null;
}

// Delay ngẫu nhiên (ms) — giả lập người dùng, tránh nhịp đều dễ bị chặn.
// Không dùng Math.random ở scope module; nhận seed để test tái lập nếu cần.
function jitter(baseMs, spreadMs) {
  return baseMs + Math.floor(Math.random() * spreadMs);
}

module.exports = { parseRoute, parseDate, parsePriceVnd, minPrice, jitter, cityOf, AIRPORT_VI };
