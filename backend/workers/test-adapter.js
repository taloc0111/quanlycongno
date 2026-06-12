// workers/test-adapter.js — thử 1 adapter với chặng thật, không đụng DB.
// Dùng:  node workers/test-adapter.js <vj|vn|qh|9g|vu> <route> <yyyy-mm-dd> [pax]
const { ADAPTERS } = require('./adapters');
const { launchBrowser, newStealthContext } = require('./lib/browser');

const [, , key, route = 'SGN-HAN', date, paxArg] = process.argv;
const adapter = ADAPTERS[key];
if (!adapter) { console.error('Adapter không hợp lệ. Chọn:', Object.keys(ADAPTERS).join(', ')); process.exit(1); }
const day = date || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

(async () => {
  const browser = await launchBrowser({ headless: true });
  const t0 = Date.now();
  try {
    const ctx = await newStealthContext(browser);
    const r = await adapter.getLowestFare({
      route, date: day, pax: parseInt(paxArg, 10) || 1, ctx, log: (m) => console.log('  ', m),
    });
    console.log(`\n✅ ${adapter.label} ${route} ${day}: ${r.price.toLocaleString('vi-VN')} ${r.currency}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    await ctx.close().catch(() => {});
  } catch (e) {
    console.log(`\n❌ ${adapter.label} ${route} ${day}: ${e.message}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } finally {
    await browser.close().catch(() => {});
  }
})();
