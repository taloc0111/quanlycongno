// workers/recon.js — công cụ khảo sát site hãng bay (dùng 1 lần khi xây adapter).
// Mở 1 URL, đợi trang chạy, ghi lại: screenshot, DOM, danh sách XHR JSON,
// và body của những response trông giống dữ liệu giá vé.
//
// Cách dùng:  node workers/recon.js <tên-thư-mục-out> <url> [thời-gian-đợi-ms]
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const [, , name, url, waitMsArg] = process.argv;
if (!name || !url) {
  console.error('Usage: node workers/recon.js <out-name> <url> [waitMs]');
  process.exit(1);
}
const waitMs = parseInt(waitMsArg, 10) || 20000;
const outDir = path.join(__dirname, 'recon-out', name);
fs.mkdirSync(outDir, { recursive: true });

const PRICE_HINTS = /("price"|"fare"|"amount"|"totalPrice"|"fareAmount"|"totalAmount"|"adultFare"|"farePrice")/i;

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    viewport: { width: 1366, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await ctx.newPage();

  const xhrs = [];
  let dumpCount = 0;
  page.on('response', async (res) => {
    try {
      const ct = res.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      const body = await res.text();
      const entry = { url: res.url(), status: res.status(), size: body.length };
      xhrs.push(entry);
      if (PRICE_HINTS.test(body) && body.length > 200) {
        const f = `xhr-${String(++dumpCount).padStart(2, '0')}.json`;
        fs.writeFileSync(path.join(outDir, f), `// ${res.url()}\n${body}`);
        entry.dumped = f;
      }
    } catch { /* response đã bị huỷ — bỏ qua */ }
  });

  console.log(`→ ${url}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    console.log('goto:', e.message);
  }
  await page.waitForTimeout(waitMs);

  await page.screenshot({ path: path.join(outDir, 'screenshot.png'), fullPage: false }).catch(() => {});
  fs.writeFileSync(path.join(outDir, 'dom.html'), await page.content().catch(() => ''));
  fs.writeFileSync(path.join(outDir, 'xhrs.json'), JSON.stringify(xhrs, null, 2));
  console.log(`Final URL: ${page.url()}`);
  console.log(`JSON XHRs: ${xhrs.length}, dumped (có giá): ${dumpCount}`);
  await browser.close();
})();
