// workers/adapters/index.js — sổ đăng ký adapter + định tuyến theo tên hãng.
// Thêm hãng mới: viết 1 file adapter rồi đăng ký vào ADAPTERS + bổ sung AIRLINE_MATCHERS.
const { makeSabreAdapter } = require('./sabreEngine');

// Bamboo (QH) và Sun PhuQuoc (9G) dùng chung engine → 2 instance cùng base.
const bamboo = makeSabreAdapter({ key: 'qh', label: 'Bamboo Airways', baseUrl: 'https://digital.bambooairways.com' });
const sunphuquoc = makeSabreAdapter({ key: '9g', label: 'Sun PhuQuoc Airways', baseUrl: 'https://fly.sunphuquocairways.com' });

const ADAPTERS = {
  qh: bamboo,
  '9g': sunphuquoc,
  vj: require('./vietjet'),
  vn: require('./vietnamairlines'),
  vu: require('./vietravel'),
};

// Khớp chuỗi "Hãng" do người dùng nhập (tự do) → key adapter.
// Mỗi mục: [key, danh sách từ khoá viết thường khớp được].
const AIRLINE_MATCHERS = [
  ['vj', ['vietjet', 'viet jet', 'vj']],
  ['vn', ['vietnam airlines', 'vietnam air', 'vna', 'hàng không quốc gia', 'vn']],
  ['qh', ['bamboo', 'qh']],
  ['9g', ['sun phuquoc', 'sun phú quốc', 'sunphuquoc', 'sun air', '9g', 'spq']],
  ['vu', ['vietravel', 'viet travel', 'vu']],
];

// Trả về adapter cho 1 yêu cầu canh vé; null nếu không nhận diện được hãng.
// Quy ước: phải khai rõ hãng (ô "Hãng") thì mới auto canh — vì mỗi hãng 1 site.
function resolveAdapter(airline) {
  if (!airline) return null;
  const a = String(airline).toLowerCase().trim();
  for (const [key, words] of AIRLINE_MATCHERS) {
    if (words.some((w) => a.includes(w))) return ADAPTERS[key];
  }
  return null;
}

module.exports = { ADAPTERS, resolveAdapter };
