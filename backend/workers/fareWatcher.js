// workers/fareWatcher.js — worker tự động canh giá vé cho các yêu cầu auto_track.
//
// Nhánh SerpApi-only — KHÔNG dùng Playwright/Chromium. Nguồn giá:
//   1) SerpApi (Google Flights, lib/serpapi.js) — 1 search trả giá MỌI hãng trên
//      chặng. Bật bằng SERPAPI_KEY; lỗi/hết hạn mức → rơi xuống (2).
//   2) Adapter HTTP thuần theo hãng (adapters/) — hiện có Vietnam Airlines
//      (API public, không tốn quota SerpApi).
//
// Luồng: lấy danh sách watch bật auto_track + còn theo dõi → lần lượt từng watch:
// lấy giá → lưu fare_snapshots → cập nhật last_price/last_checked_at trên
// ticket_watches → nếu giá ≤ giá mong muốn thì gửi email cảnh báo (có cooldown).
//
// Chạy:
//   - Standalone:  node workers/fareWatcher.js            (1 vòng rồi thoát — hợp cron job)
//   - Loop:        node workers/fareWatcher.js --loop     (lặp theo FARE_WATCH_INTERVAL_MIN)
//   - Trong app:   require + startLoop() khi FARE_WATCHER=true (xem server.js)
//   - Thủ công 1 watch: checkWatchById() (nút "Lấy giá ngay").
const pool = require('../config/database');
const logger = require('../config/logger');
const { sendMail } = require('../config/email');
const { resolveAdapter, ADAPTERS } = require('./adapters');
const serpapi = require('./lib/serpapi');

const INTERVAL_MIN = parseInt(process.env.FARE_WATCH_INTERVAL_MIN || '60', 10);
const ALERT_COOLDOWN_H = parseInt(process.env.FARE_ALERT_COOLDOWN_H || '12', 10);

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

// Lấy giá 1 watch (SerpApi trước, adapter HTTP sau), lưu snapshot + cập nhật trạng
// thái + alert. Dùng cho cả worker loop lẫn nút "Lấy giá ngay". Không ném ra ngoài.
// `serpCache` (Map, tuỳ chọn): các watch trùng chặng+ngày trong 1 vòng chỉ tốn 1 search.
async function checkAndStore(watch, { log = () => {}, serpCache = null } = {}) {
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
        log(`serpapi: không thấy hãng "${watch.airline}" trên ${watch.route} — thử adapter trực tiếp`);
      }
    } catch (e) {
      log(`serpapi lỗi: ${e.message} — thử adapter trực tiếp`);
    }
  }

  // Nguồn 2 (fallback): adapter HTTP của đúng hãng (nếu có).
  if (!result) {
    const adapter = resolveAdapter(watch.airline);
    if (!adapter) {
      result = {
        ok: false,
        error: `Không lấy được giá cho hãng "${watch.airline || '(trống)'}" (SerpApi không khả dụng và hãng chưa có adapter trực tiếp)`,
      };
    } else {
      try {
        const fare = await adapter.getLowestFare({
          route: watch.route, date: watch.depart_date, pax: watch.pax || 1, log,
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
  const serpCache = new Map(); // watch trùng chặng+ngày trong vòng này chỉ tốn 1 search SerpApi
  let ok = 0;
  let fail = 0;
  for (const w of watches) {
    const r = await checkAndStore(w, { log, serpCache });
    if (r.ok) { ok++; log(`✔ #${w.id} ${w.route} ${w.airline || r.airline}: ${r.price?.toLocaleString('vi-VN')}₫${r.alerted ? ' (ĐÃ BÁO GIÁ)' : ''}`); }
    else { fail++; log(`✖ #${w.id} ${w.route} ${w.airline}: ${r.error}`); }
  }
  log(`fareWatcher: xong. OK=${ok}, lỗi=${fail}.`);
  return { checked: watches.length, ok, fail };
}

// Lấy giá 1 watch theo id (nút "Lấy giá ngay"). `userId` (nếu truyền) ràng buộc
// watch phải thuộc user đó — phòng thủ chiều sâu.
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
  return checkAndStore(watch, { log });
}

// Tra giá NGAY cho 1 chặng (tính năng "Check vé"). Không lưu DB.
// SerpApi: 1 search trả mọi hãng trên chặng. Lỗi/hết hạn mức → chạy các adapter
// HTTP trực tiếp (hiện chỉ VNA). Trả mảng kết quả đã sắp theo giá tăng dần.
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
      log('serpapi: không có chuyến cho chặng/ngày này — thử adapter trực tiếp');
    } catch (e) {
      log(`serpapi lỗi: ${e.message} — thử adapter trực tiếp`);
    }
  }

  const results = [];
  for (const adapter of Object.values(ADAPTERS)) {
    try {
      const fare = await adapter.getLowestFare({ route, date, pax, log });
      results.push({ key: adapter.key, airline: adapter.label, ok: true, price: fare.price, currency: fare.currency || 'VND', source: adapter.key });
      log(`✔ ${adapter.label}: ${fare.price?.toLocaleString('vi-VN')}₫`);
    } catch (e) {
      results.push({ key: adapter.key, airline: adapter.label, ok: false, error: e.message });
      log(`✖ ${adapter.label}: ${e.message}`);
    }
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
