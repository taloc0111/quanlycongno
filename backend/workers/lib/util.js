// workers/lib/util.js — tiện ích dùng chung cho các nguồn giá.

// Tách "SGN-HAN" / "SGN HAN" / "sgn → han" thành { origin, dest } mã IATA 3 ký tự.
function parseRoute(route) {
  if (!route) return null;
  const codes = String(route).toUpperCase().match(/[A-Z]{3}/g);
  if (!codes || codes.length < 2) return null;
  return { origin: codes[0], dest: codes[1] };
}

// "2026-07-15" hoặc Date/ISO → các mảnh ngày.
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

// Lấy số nhỏ nhất hợp lệ từ 1 mảng giá.
function minPrice(prices) {
  const valid = prices.filter((p) => Number.isFinite(p) && p > 0);
  return valid.length ? Math.min(...valid) : null;
}

module.exports = { parseRoute, parseDate, minPrice };
