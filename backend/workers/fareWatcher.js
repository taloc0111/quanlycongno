// workers/fareWatcher.js — worker tự động canh giá vé cho các yêu cầu auto_track.
//
// Nguồn giá (ưu tiên theo thứ tự):
//   1) SerpApi (Google Flights, lib/serpapi.js) — 1 search trả giá MỌI hãng trên
//      chặng, không cần Chromium. Bật bằng SERPAPI_KEY; lỗi/hết hạn mức → rơi xuống (2).
//   2) Adapter scrape từng hãng (Playwright + Chromium stealth) — như trước.
//
// Luồng: lấy danh sách watch bật auto_track + còn theo dõi → lần lượt từng watch:
// lấy giá (SerpApi trước, scrape sau) → lưu fare_snapshots → cập nhật
// last_price/last_checked_at trên ticket_watches → nếu giá ≤ giá mong muốn
// thì gửi email cảnh báo (có cooldown chống spam).
//
// Chạy:
//   - Standalone:  node workers/fareWatcher.js            (chạy 1 vòng rồi thoát)
//   - Loop:        node workers/fareWatcher.js --loop     (lặp theo FARE_WATCH_INTERVAL_MIN)
//   - Trong app:   require + startLoop() khi FARE_WATCHER=true (xem server.js)
//   - Thủ công 1 watch: dùng checkWatchById() (nút "Lấy giá ngay").
const pool = require('../config/database');
const logger = require('../config/logger');
const { sendMail } = require('../config/email');
const { jitter } = require('./lib/util');
const { resolveAdapter, ADAPTERS } = require('./adapters');
const serpapi = require('./lib/serpapi');

const INTERVAL_MIN = parseInt(process.env.FARE_WATCH_INTERVAL_MIN || '60', 10);
const ALERT_COOLDOWN_H = parseInt(process.env.FARE_ALERT_COOLDOWN_H || '12', 10);

// Playwright chỉ được require khi THẬT SỰ cần scrape — nhờ vậy host không cài
// Chromium (vd web service Render) vẫn dùng được nguồn SerpApi bình thường.
function loadBrowserLib() {
  try {
    return require('./lib/browser');
  } catch {
    throw new Error('Máy chủ không có Playwright/Chromium (nguồn scrape không khả dụng)');
  }
}

// Trình duyệt + context mở LƯỜI: chỉ tốn RAM Chromium khi có ít nhất 1 lần phải scrape.
function makeLazyCtx() {
  let browser = null;
  let ctx = null;
  return {
    async get() {
      if (!ctx) {
        const { launchBrowser, newStealthContext } = loadBrowserLib();
        browser = await launchBrowser();
        ctx = await newStealthContext(browser);
      }
      return ctx;
    },
    async close() {
      if (ctx) await ctx.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
      ctx = null;
      browser = null;
    },
  };
}

// Ghi 1 dòng lịch sử giá.
async function insertSnapshot(watchId, result) {
  await pool.query(
    `INSERT INTO fare_snapshots (watch_id, source, airline, price, currency, flight_no, depart_time, ok, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      watchId,
      result.source || null,
      result.airline || null,
      result.ok ? result.price : null,
      result.currency || 'VND',
      result.flightNo || null,
      result.departTime || null,
      result.ok,
      result.ok ? null : (result.error || 'unknown'),
    ]
  );
}

// Cập nhật trạng thái mới nhất trên watch. Trả về row đã cập nhật (để biết có cần alert).
async function updateWatchState(watchId, result) {
  const { rows } = await pool.query(
    `UPDATE ticket_watches SET
       last_price      = CASE WHEN $2 THEN $3 ELSE last_price END,
       last_currency   = COALESCE($4, last_currency),
       last_checked_at = CURRENT_TIMESTAMP,
       last_check_ok   = $2,
       last_error      = $5
     WHERE id = $1
     RETURNING id, user_id, customer_name, route, depart_date, target_price, last_price, alerted_at, airline`,
    [watchId, result.ok, result.ok ? result.price : null, result.currency || 'VND', result.ok ? null : (result.error || 'unknown')]
  );
  return rows[0] || null;
}

// Gửi cảnh báo khi đạt giá. Có cooldown để không spam mỗi vòng.
async function maybeAlert(watch, price) {
  const target = Number(watch.target_price) || 0;
  if (!(target > 0) || !(price <= target)) return false;

  if (watch.alerted_at) {
    const ageH = (Date.now() - new Date(watch.alerted_at).getTime()) / 3600000;
    if (ageH < ALERT_COOLDOWN_H) return false; // vừa báo gần đây — bỏ qua
  }

  await pool.query('UPDATE ticket_watches SET alerted_at = CURRENT_TIMESTAMP WHERE id = $1', [watch.id]);

  // Lấy email chủ tài khoản để gửi.
  const { rows } = await pool.query('SELECT email FROM users WHERE id = $1', [watch.user_id]);
  const to = rows[0]?.email;
  if (!to) return true; // đã đánh dấu alerted, nhưng không có email để gửi

  const fmt = (n) => new Intl.NumberFormat('vi-VN').format(n) + ' ₫';
  const dep = watch.depart_date ? new Date(watch.depart_date).toLocaleDateString('vi-VN') : '—';
  try {
    await sendMail({
      to,
      subject: `✈️ Vé ${watch.route || ''} đã đạt giá mong muốn (${fmt(price)})`,
      html: `<p>Yêu cầu canh vé cho khách <b>${watch.customer_name}</b> đã đạt giá:</p>
             <ul>
               <li>Hành trình: <b>${watch.route || '—'}</b> (${watch.airline || ''})</li>
               <li>Ngày đi: <b>${dep}</b></li>
               <li>Giá hiện tại: <b>${fmt(price)}</b> · Giá mong muốn: ${fmt(target)}</li>
             </ul>
             <p>Mở app Canh vé để chốt đặt.</p>`,
      text: `Vé ${watch.route || ''} đạt giá ${fmt(price)} (mong muốn ${fmt(target)}) cho khách ${watch.customer_name}.`,
    });
  } catch (e) {
    logger.error('Gửi email cảnh báo canh vé lỗi:', e.message);
  }
  return true;
}

// Lấy giá 1 watch (SerpApi trước, scrape sau), lưu snapshot + cập nhật trạng thái
// + alert. Dùng cho cả worker loop lẫn nút "Lấy giá ngay". Không bao giờ ném ra ngoài.
// `lazyCtx` (makeLazyCtx) chỉ mở Chromium khi thật sự rơi vào nhánh scrape.
// `serpCache` (Map, tuỳ chọn): các watch trùng chặng+ngày trong 1 vòng chỉ tốn 1 search.
async function checkAndStore(watch, lazyCtx, { log = () => {}, serpCache = null } = {}) {
  let result = null;

  // Nguồn 1: SerpApi — phủ cả hãng chưa có adapter; watch không ghi hãng thì lấy
  // giá rẻ nhất toàn chặng (mọi hãng).
  if (serpapi.enabled()) {
    try {
      const itins = await serpapi.searchRoute({
        route: watch.route, date: watch.depart_date, pax: watch.pax || 1, cache: serpCache,
      });
      const best = serpapi.lowestForAirline(itins, watch.airline);
      if (best) {
        result = {
          ok: true, source: 'serpapi', airline: best.airline,
          price: best.price, currency: best.currency,
          flightNo: best.flightNo, departTime: best.departTime,
        };
      } else {
        log(`serpapi: không thấy hãng "${watch.airline}" trên ${watch.route} — thử scrape`);
      }
    } catch (e) {
      log(`serpapi lỗi: ${e.message} — thử scrape`);
    }
  }

  // Nguồn 2 (fallback): adapter scrape của đúng hãng.
  if (!result) {
    const adapter = resolveAdapter(watch.airline);
    if (!adapter) {
      result = { ok: false, error: `Chưa hỗ trợ canh giá tự động cho hãng "${watch.airline || '(trống)'}"` };
    } else {
      try {
        const ctx = await lazyCtx.get();
        const fare = await adapter.getLowestFare({
          route: watch.route, date: watch.depart_date, pax: watch.pax || 1, ctx, log,
        });
        result = { ok: true, ...fare, airline: adapter.label };
      } catch (e) {
        result = { ok: false, source: adapter.key, airline: adapter.label, error: e.message };
      }
    }
  }

  await insertSnapshot(watch.id, result);
  const updated = await updateWatchState(watch.id, result);
  if (result.ok && updated) {
    const alerted = await maybeAlert(updated, result.price);
    result.alerted = alerted;
  }
  return result;
}

// Chạy 1 vòng cho tất cả watch auto_track còn theo dõi.
async function runOnce({ log = (m) => logger.info(m) } = {}) {
  const { rows: watches } = await pool.query(
    `SELECT id, user_id, customer_name, route, depart_date, airline, pax, target_price, alerted_at
       FROM ticket_watches
      WHERE auto_track = TRUE
        AND status IN ('watching', 'quoted')
        AND route IS NOT NULL AND depart_date IS NOT NULL
        AND (depart_date >= CURRENT_DATE)
      ORDER BY last_checked_at ASC NULLS FIRST`
  );
  if (!watches.length) { log('fareWatcher: không có yêu cầu nào cần canh.'); return { checked: 0 }; }

  log(`fareWatcher: bắt đầu canh ${watches.length} yêu cầu…`);
  const lazyCtx = makeLazyCtx();
  const serpCache = new Map(); // watch trùng chặng+ngày trong vòng này chỉ tốn 1 search SerpApi
  let ok = 0;
  let fail = 0;
  try {
    for (const w of watches) {
      const r = await checkAndStore(w, lazyCtx, { log, serpCache });
      if (r.ok) { ok++; log(`✔ #${w.id} ${w.route} ${w.airline || r.airline}: ${r.price?.toLocaleString('vi-VN')}₫${r.alerted ? ' (ĐÃ BÁO GIÁ)' : ''}`); }
      else { fail++; log(`✖ #${w.id} ${w.route} ${w.airline}: ${r.error}`); }
      // Nghỉ ngẫu nhiên giữa các lần SCRAPE để trông như người dùng, giảm nguy cơ
      // bị chặn; lần lấy qua SerpApi thì không cần.
      if (r.source !== 'serpapi') await new Promise((res) => setTimeout(res, jitter(4000, 6000)));
    }
  } finally {
    await lazyCtx.close();
  }
  log(`fareWatcher: xong. OK=${ok}, lỗi=${fail}.`);
  return { checked: watches.length, ok, fail };
}

// Lấy giá 1 watch theo id: tự fetch DB + tự mở/đóng trình duyệt. Dùng cho HTTP
// endpoint /internal/check-now (worker) và nút "Lấy giá ngay" chạy in-process.
// `userId` (nếu truyền) ràng buộc watch phải thuộc user đó — phòng thủ chiều sâu
// để dù secret bị lộ cũng không sửa được watch của người khác.
async function checkWatchById(watchId, { userId = null, log = (m) => logger.info(m) } = {}) {
  const { rows } = userId
    ? await pool.query(
        `SELECT id, user_id, customer_name, route, depart_date, airline, pax, target_price, alerted_at
           FROM ticket_watches WHERE id = $1 AND user_id = $2`,
        [watchId, userId]
      )
    : await pool.query(
        `SELECT id, user_id, customer_name, route, depart_date, airline, pax, target_price, alerted_at
           FROM ticket_watches WHERE id = $1`,
        [watchId]
      );
  const watch = rows[0];
  if (!watch) throw new Error('Không tìm thấy yêu cầu canh vé');
  const lazyCtx = makeLazyCtx();
  try {
    return await checkAndStore(watch, lazyCtx, { log });
  } finally {
    await lazyCtx.close();
  }
}

// Tra giá NGAY cho 1 chặng (tính năng "Check vé"). Không lưu DB.
// Có SERPAPI_KEY: 1 search trả mọi hãng trên chặng (kể cả hãng chưa có adapter),
// nhanh và không cần Chromium. Lỗi/hết hạn mức → rơi về chạy lần lượt 5 adapter
// scrape như cũ. Trả mảng kết quả đã sắp theo giá tăng dần.
async function quoteAllAirlines({ route, date, pax = 1 }, { log = () => {} } = {}) {
  if (!route || !date) throw new Error('Cần hành trình và ngày đi');

  if (serpapi.enabled()) {
    try {
      const itins = await serpapi.searchRoute({ route, date, pax });
      const results = serpapi.quoteByAirline(itins);
      if (results.length) {
        results.forEach((r) => log(`✔ ${r.airline}: ${r.price.toLocaleString('vi-VN')}₫`));
        return results;
      }
      log('serpapi: không có chuyến cho chặng/ngày này — thử scrape');
    } catch (e) {
      log(`serpapi lỗi: ${e.message} — thử scrape`);
    }
  }

  const { launchBrowser, newStealthContext } = loadBrowserLib();
  const browser = await launchBrowser();
  const results = [];
  try {
    const ctx = await newStealthContext(browser);
    for (const adapter of Object.values(ADAPTERS)) {
      try {
        const fare = await adapter.getLowestFare({ route, date, pax, ctx, log });
        results.push({ key: adapter.key, airline: adapter.label, ok: true, price: fare.price, currency: fare.currency || 'VND' });
        log(`✔ ${adapter.label}: ${fare.price?.toLocaleString('vi-VN')}₫`);
      } catch (e) {
        results.push({ key: adapter.key, airline: adapter.label, ok: false, error: e.message });
        log(`✖ ${adapter.label}: ${e.message}`);
      }
      // nghỉ ngẫu nhiên giữa các hãng cho giống người dùng
      await new Promise((res) => setTimeout(res, jitter(1500, 2500)));
    }
    await ctx.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }
  // hãng lấy được giá xếp trước (giá tăng dần); hãng lỗi đẩy xuống cuối
  results.sort((a, b) => (a.ok ? a.price : Infinity) - (b.ok ? b.price : Infinity));
  return results;
}

// Vòng lặp định kỳ (cho chế độ --loop hoặc startLoop trong app).
let _timer = null;
function startLoop() {
  if (_timer) return;
  logger.info(`fareWatcher: bật loop mỗi ${INTERVAL_MIN} phút.`);
  const tick = () => runOnce().catch((e) => logger.error('fareWatcher loop lỗi:', e.message));
  tick(); // chạy ngay 1 lần khi bật
  _timer = setInterval(tick, INTERVAL_MIN * 60000);
}
function stopLoop() { if (_timer) { clearInterval(_timer); _timer = null; } }

module.exports = { runOnce, checkAndStore, checkWatchById, quoteAllAirlines, startLoop, stopLoop };

// Chạy trực tiếp từ CLI.
if (require.main === module) {
  const loop = process.argv.includes('--loop');
  if (loop) {
    startLoop();
  } else {
    runOnce()
      .then((r) => { logger.info(`Kết quả: ${JSON.stringify(r)}`); process.exit(0); })
      .catch((e) => { logger.error('fareWatcher lỗi:', e.message); process.exit(1); });
  }
}
