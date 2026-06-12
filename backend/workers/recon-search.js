// workers/recon-search.js — khảo sát LUỒNG TÌM CHUYẾN (không chỉ trang chủ).
// Mở trang chủ booking, điền điểm đi/đến/ngày bằng cách gõ + chọn gợi ý,
// bấm tìm, rồi ghi lại trang kết quả + mọi XHR có chứa giá.
//
// Dùng:  node workers/recon-search.js <out> <homeUrl> <origin> <dest> <yyyy-mm-dd>
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const [, , name, homeUrl, origin, dest, date] = process.argv;
if (!name || !homeUrl) { console.error('Usage: recon-search <out> <homeUrl> <origin> <dest> <date>'); process.exit(1); }
const outDir = path.join(__dirname, 'recon-out', name);
fs.mkdirSync(outDir, { recursive: true });
const PRICE_HINTS = /("(total|fare|amount|price|adultFare|farePrice|fareAmount|totalAmount)"|availab|journey)/i;

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  });
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
  const page = await ctx.newPage();

  let n = 0;
  page.on('response', async (res) => {
    try {
      const ct = res.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      const body = await res.text();
      if (PRICE_HINTS.test(body) && body.length > 300) {
        fs.writeFileSync(path.join(outDir, `avail-${String(++n).padStart(2, '0')}.json`), `// ${res.url()}\n${body}`);
      }
    } catch { /* ignore */ }
  });

  console.log(`→ ${homeUrl}`);
  await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('goto', e.message));
  await page.waitForTimeout(8000);

  // Thử các selector phổ biến cho ô điểm đi/đến. Ghi log để biết cái nào dính.
  const tryFill = async (labels, value) => {
    for (const sel of labels) {
      const el = page.locator(sel).first();
      if (await el.count().catch(() => 0)) {
        try {
          await el.click({ timeout: 3000 });
          await el.fill('').catch(() => {});
          await el.type(value, { delay: 120 });
          await page.waitForTimeout(2500);
          // chọn gợi ý đầu khớp mã sân bay
          const opt = page.locator(`text=/${value}/i`).first();
          if (await opt.count().catch(() => 0)) await opt.click({ timeout: 3000 }).catch(() => {});
          console.log(`filled ${value} via ${sel}`);
          return true;
        } catch (e) { /* thử selector khác */ }
      }
    }
    console.log(`NO selector matched for ${value}`);
    return false;
  };

  await tryFill(['input[placeholder*="đi" i]', 'input[placeholder*="origin" i]', 'input[placeholder*="from" i]', '#originStation', '[data-test*=origin] input'], origin);
  await tryFill(['input[placeholder*="đến" i]', 'input[placeholder*="destination" i]', 'input[placeholder*="to" i]', '#destinationStation', '[data-test*=destination] input'], dest);

  await page.screenshot({ path: path.join(outDir, 'after-fill.png') }).catch(() => {});

  // bấm nút tìm
  for (const sel of ['button:has-text("Tìm")', 'button:has-text("Search")', '#criteria-search-button', 'button[type=submit]']) {
    const b = page.locator(sel).first();
    if (await b.count().catch(() => 0)) { await b.click({ timeout: 3000 }).catch(() => {}); console.log('clicked', sel); break; }
  }
  await page.waitForTimeout(18000);

  await page.screenshot({ path: path.join(outDir, 'results.png'), fullPage: true }).catch(() => {});
  fs.writeFileSync(path.join(outDir, 'results.html'), await page.content().catch(() => ''));
  console.log(`Final URL: ${page.url()}  | avail dumps: ${n}`);
  await browser.close();
})();
