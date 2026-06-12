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
const { parseRoute } = require('./lib/util');
const { resolveAdapter, ADAPTERS } = require('./adapters');
const serpapi = require('./lib/serpapi');

const INTERVAL_MIN = parseInt(process.env.FARE_WATCH_INTERVAL_MIN || '60', 10);
const ALERT_COOLDOWN_H = parseInt(process.env.FARE_ALERT_COOLDOWN_H || '12', 10);
// Công tắc gửi email cảnh báo (FARE_ALERT_EMAIL=false để tắt — badge "đạt giá"
// trên UI vẫn hiện bình thường vì FE tự so last_price ≤ giá mong muốn).
const ALERT_EMAIL = String(process.env.FARE_ALERT_EMAIL ?? 'true').toLowerCase() !== 'false';

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
     RETURNING id, user_id, customer_name, route, depart_date, return_date, target_price, last_price, alerted_at, airline`,
    [watchId, result.ok, result.ok ? result.price : null, result.currency || 'VND', result.ok ? null : (result.error || 'unknown')]
  );
  return rows[0] || null;
}

// Gửi cảnh báo khi đạt giá. Có cooldown để không spam mỗi vòng.
async function maybeAlert(watch, price) {
  const target = Number(watch.target_price) || 0;
  if (!(target > 0) || !(price <= target)) return false;

  // Tắt email qua env — không đánh dấu alerted_at, để khi bật lại email vẫn bắn.
  if (!ALERT_EMAIL) return false;

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
  const ret = watch.return_date ? new Date(watch.return_date).toLocaleDateString('vi-VN') : null;
  const kind = ret ? 'khứ hồi' : 'một chiều';
  try {
    await sendMail({
      to,
      subject: `✈️ Vé ${watch.route || ''} ${ret ? '(khứ hồi) ' : ''}đã đạt giá mong muốn (${fmt(price)})`,
      html: `<p>Yêu cầu canh vé cho khách <b>${watch.customer_name}</b> đã đạt giá:</p>
             <ul>
               <li>Hành trình: <b>${watch.route || '—'}</b> (${watch.airline || ''}) — ${kind}</li>
               <li>Ngày đi: <b>${dep}</b>${ret ? ` · Ngày về: <b>${ret}</b>` : ''}</li>
               <li>Giá hiện tại${ret ? ' (TỔNG đi + về)' : ''}: <b>${fmt(price)}</b> · Giá mong muốn: ${fmt(target)}</li>
             </ul>
             <p>Mở app Canh vé để chốt đặt.</p>`,
      text: `Vé ${watch.route || ''} (${kind}) đạt giá ${fmt(price)} (mong muốn ${fmt(target)}) cho khách ${watch.customer_name}.`,
    });
  } catch (e) {
    logger.error('Gửi email cảnh báo canh vé lỗi:', e.message);
  }
  return true;
}

// Lấy giá MỘT CHIỀU cho 1 chặng+ngày+hãng (SerpApi trước, adapter HTTP sau).
// Không đụng DB, không ném ra ngoài — luôn trả { ok, ... } hoặc { ok:false, error }.
async function getLegFare({ route, date, pax = 1, airline = null }, { log = () => {}, serpCache = null } = {}) {
  // Nguồn 1: SerpApi — phủ cả hãng chưa có adapter; không ghi hãng thì lấy
  // giá rẻ nhất toàn chặng (mọi hãng).
  if (serpapi.enabled()) {
    try {
      const itins = await serpapi.searchRoute({ route, date, pax, cache: serpCache });
      const best = serpapi.lowestForAirline(itins, airline);
      if (best) {
        return {
          ok: true, source: 'serpapi', airline: best.airline,
          price: best.price, currency: best.currency,
          flightNo: best.flightNo, departTime: best.departTime,
        };
      }
      log(`serpapi: không thấy hãng "${airline}" trên ${route} — thử adapter trực tiếp`);
    } catch (e) {
      log(`serpapi lỗi: ${e.message} — thử adapter trực tiếp`);
    }
  }

  // Nguồn 2 (fallback): adapter HTTP của đúng hãng (nếu có).
  const adapter = resolveAdapter(airline);
  if (!adapter) {
    return {
      ok: false,
      error: `Không lấy được giá cho hãng "${airline || '(trống)'}" (SerpApi không khả dụng và hãng chưa có adapter trực tiếp)`,
    };
  }
  try {
    const fare = await adapter.getLowestFare({ route, date, pax, log });
    return { ok: true, ...fare, airline: adapter.label };
  } catch (e) {
    return { ok: false, source: adapter.key, airline: adapter.label, error: e.message };
  }
}

// Lấy giá 1 watch, lưu snapshot + cập nhật trạng thái + alert. Dùng cho cả worker
// loop lẫn nút "Lấy giá ngay". Không ném ra ngoài.
// - Watch CÓ ngày về = canh KHỨ HỒI: tra cả 2 chiều (chiều về đảo chặng), giá so
//   với mong muốn là TỔNG đi + về → tốn 2 lượt SerpApi/lần canh thay vì 1.
// - `serpCache` (Map, tuỳ chọn): các watch trùng chặng+ngày trong 1 vòng dùng chung search.
async function checkAndStore(watch, { log = () => {}, serpCache = null } = {}) {
  const common = { pax: watch.pax || 1, airline: watch.airline };
  let result;

  const out = await getLegFare({ route: watch.route, date: watch.depart_date, ...common }, { log, serpCache });

  const r = watch.return_date ? parseRoute(watch.route) : null;
  if (!r) {
    // một chiều (hoặc route không đảo được — coi như một chiều)
    result = out;
  } else {
    const back = await getLegFare(
      { route: `${r.dest}-${r.origin}`, date: watch.return_date, ...common },
      { log, serpCache }
    );
    if (out.ok && back.ok) {
      result = {
        ok: true,
        roundTrip: true,
        source: out.source === back.source ? out.source : `${out.source}+${back.source}`.slice(0, 20),
        airline: out.airline === back.airline ? out.airline : `${out.airline} / ${back.airline}`.slice(0, 50),
        price: out.price + back.price, // TỔNG đi + về — đúng nghĩa giá mong muốn khứ hồi
        currency: out.currency,
        flightNo: [out.flightNo, back.flightNo].filter(Boolean).join('|').slice(0, 20) || null,
        departTime: out.departTime,
      };
      log(`khứ hồi #${watch.id}: đi ${out.price?.toLocaleString('vi-VN')} + về ${back.price?.toLocaleString('vi-VN')} = ${result.price.toLocaleString('vi-VN')}₫`);
    } else {
      const misses = [!out.ok && 'chiều đi', !back.ok && 'chiều về'].filter(Boolean).join(' + ');
      result = {
        ok: false,
        source: out.source || back.source || null,
        airline: watch.airline || null,
        error: `Khứ hồi thiếu giá ${misses}: ${out.error || back.error}`,
      };
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
    `SELECT id, user_id, customer_name, route, depart_date, return_date, airline, pax, target_price, alerted_at
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
        `SELECT id, user_id, customer_name, route, depart_date, return_date, airline, pax, target_price, alerted_at
           FROM ticket_watches WHERE id = $1 AND user_id = $2`,
        [watchId, userId]
      )
    : await pool.query(
        `SELECT id, user_id, customer_name, route, depart_date, return_date, airline, pax, target_price, alerted_at
           FROM ticket_watches WHERE id = $1`,
        [watchId]
      );
  const watch = rows[0];
  if (!watch) throw new Error('Không tìm thấy yêu cầu canh vé');
  return checkAndStore(watch, { log });
}

// Tra giá MỘT CHIỀU cho 1 chặng: SerpApi (mọi hãng + danh sách khung giờ) →
// fallback adapter HTTP trực tiếp (hiện chỉ VNA). Trả mảng kết quả sắp theo giá tăng.
async function quoteOneLeg({ route, date, pax = 1 }, { log = () => {} } = {}) {
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

// Tra giá NGAY (tính năng "Check vé"). Không lưu DB. Mặc định 1 chiều = 1 leg;
// truyền `returnDate` = thêm leg chiều về (đảo chặng). MỖI leg tốn 1 search SerpApi.
// Trả { legs: [{ direction:'outbound'|'inbound', route, date, results[] }] }.
async function quoteAllAirlines({ route, date, returnDate = null, pax = 1 }, { log = () => {} } = {}) {
  if (!route || !date) throw new Error('Cần hành trình và ngày đi');
  const r = parseRoute(route);
  if (!r) throw new Error('Hành trình không hợp lệ (vd: SGN-HAN)');

  const legs = [{ direction: 'outbound', route: `${r.origin}-${r.dest}`, date }];
  if (returnDate) legs.push({ direction: 'inbound', route: `${r.dest}-${r.origin}`, date: returnDate });

  for (const leg of legs) {
    log(`Check vé ${leg.direction === 'outbound' ? 'chiều đi' : 'chiều về'}: ${leg.route} ${leg.date}`);
    leg.results = await quoteOneLeg({ route: leg.route, date: leg.date, pax }, { log });
  }
  return { legs };
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
