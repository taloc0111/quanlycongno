// workers/adapters/index.js — sổ đăng ký adapter + định tuyến theo tên hãng.
//
// Nhánh SerpApi-only: registry chỉ còn adapter KHÔNG cần Chromium (đi HTTP thuần).
// AIRLINE_MATCHERS vẫn giữ đủ 5 hãng VN — serpapi.js dùng resolveKey() để khớp
// tên hãng Google Flights trả về (vd "Sun PhuQuoc Airways" → '9g') với ô "Hãng"
// người dùng nhập tự do (vd "VJ", "Sun Phú Quốc").
const ADAPTERS = {
  vn: require('./vietnamairlines'), // API public VNA — HTTP thuần, không Chromium
};

// Khớp chuỗi "Hãng" viết tự do → key chuẩn.
// Mỗi mục: [key, danh sách từ khoá viết thường khớp được].
const AIRLINE_MATCHERS = [
  ['vj', ['vietjet', 'viet jet', 'vj']],
  ['vn', ['vietnam airlines', 'vietnam air', 'vna', 'hàng không quốc gia', 'vn']],
  ['qh', ['bamboo', 'qh']],
  ['9g', ['sun phuquoc', 'sun phú quốc', 'sunphuquoc', 'sun air', '9g', 'spq']],
  ['vu', ['vietravel', 'viet travel', 'vu']],
];

// Tên hãng tự do → key chuẩn (vj/vn/qh/9g/vu); null nếu không nhận diện được.
function resolveKey(airline) {
  if (!airline) return null;
  const a = String(airline).toLowerCase().trim();
  for (const [key, words] of AIRLINE_MATCHERS) {
    if (words.some((w) => a.includes(w))) return key;
  }
  return null;
}

// Adapter lấy giá TRỰC TIẾP từ hãng (fallback khi SerpApi lỗi/hết hạn mức);
// null nếu hãng chưa có adapter HTTP.
function resolveAdapter(airline) {
  const key = resolveKey(airline);
  return (key && ADAPTERS[key]) || null;
}

module.exports = { ADAPTERS, resolveAdapter, resolveKey };
