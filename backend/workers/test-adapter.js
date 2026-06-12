// workers/test-adapter.js — thử 1 adapter trực tiếp với chặng thật, không đụng DB.
// Nhánh SerpApi-only: mọi adapter đều đi HTTP thuần (không cần Chromium).
// Dùng:  node workers/test-adapter.js <vn> <route> <yyyy-mm-dd> [pax]
const { ADAPTERS } = require('./adapters');

const [, , key, route = 'SGN-HAN', date, paxArg] = process.argv;
const adapter = ADAPTERS[key];
if (!adapter) { console.error('Adapter không hợp lệ. Chọn:', Object.keys(ADAPTERS).join(', ')); process.exit(1); }
const day = date || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

(async () => {
  const t0 = Date.now();
  try {
    const r = await adapter.getLowestFare({
      route, date: day, pax: parseInt(paxArg, 10) || 1, log: (m) => console.log('  ', m),
    });
    console.log(`\n✅ ${adapter.label} ${route} ${day}: ${r.price.toLocaleString('vi-VN')} ${r.currency}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    process.exit(0);
  } catch (e) {
    console.log(`\n❌ ${adapter.label} ${route} ${day}: ${e.message}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    process.exit(1);
  }
})();
