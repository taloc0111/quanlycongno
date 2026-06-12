// workers/serve.js — worker canh giá chạy THƯỜNG TRỰC (cho VPS/máy riêng):
//   1) bật vòng lặp canh giá định kỳ (startLoop)
//   2) mở HTTP server để API (Render) uỷ thác việc chạy Chromium sang đây:
//        GET  /health              → kiểm tra sống (cho uptime/monitor)
//        POST /internal/check-now  → { watchId }            → lấy giá 1 watch, lưu DB
//        POST /internal/quote      → { route, date, pax }   → tra giá 5 hãng (Check vé)
//
// Bảo vệ: mọi route /internal/* yêu cầu header `x-worker-secret` khớp WORKER_SECRET.
// Đặt cùng giá trị secret này ở cả worker và API. Khuyến nghị chạy sau reverse proxy
// có TLS (Caddy/nginx) hoặc Cloudflare Tunnel để secret không đi qua HTTP trần.
require('dns').setDefaultResultOrder('ipv4first');
const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('../config/logger');
const { startLoop, checkWatchById, quoteAllAirlines } = require('./fareWatcher');

const PORT = parseInt(process.env.WORKER_PORT || process.env.PORT || '6000', 10);
const SECRET = process.env.WORKER_SECRET || '';
// Cho phép chạy KHÔNG secret chỉ khi khai báo rõ ràng (chỉ dùng khi test local).
const ALLOW_INSECURE = process.env.WORKER_ALLOW_INSECURE === 'true';

// Fail fast: tuyệt đối không chạy production mà thiếu secret (giống env.js với JWT_SECRET).
if (!SECRET && !ALLOW_INSECURE) {
  logger.error('❌ Thiếu WORKER_SECRET — /internal sẽ không có xác thực. Đặt WORKER_SECRET (>=32 ký tự) hoặc WORKER_ALLOW_INSECURE=true nếu CHỈ test local.');
  process.exit(1);
}
if (SECRET && SECRET.length < 32) {
  logger.error('❌ WORKER_SECRET quá ngắn — cần >= 32 ký tự ngẫu nhiên.');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/health', (req, res) => res.json({ ok: true, service: 'fare-worker' }));

// Giới hạn tần suất cho /internal — phòng thủ chiều sâu: mỗi request mở Chromium nên
// chặn dồn dập kể cả khi secret bị lộ. 12 request/phút là dư cho 1 instance API.
const internalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate limited' },
});

// Chặn /internal/* nếu sai secret. Khi ALLOW_INSECURE (secret rỗng) thì bỏ qua —
// chỉ xảy ra khi người chạy chủ động bật cờ test local, production đã exit ở trên.
app.use('/internal', internalLimiter, (req, res, next) => {
  if (SECRET && req.get('x-worker-secret') !== SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

app.post('/internal/check-now', async (req, res) => {
  const watchId = parseInt(req.body?.watchId, 10);
  const userId = parseInt(req.body?.userId, 10) || null; // ràng buộc chủ sở hữu (phòng thủ chiều sâu)
  if (!watchId) return res.status(400).json({ error: 'Thiếu watchId' });
  try {
    const result = await checkWatchById(watchId, { userId, log: (m) => logger.info(m) });
    res.json(result);
  } catch (e) {
    logger.error('worker check-now lỗi:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/internal/quote', async (req, res) => {
  const { route, date, pax } = req.body || {};
  if (!route || !date) return res.status(400).json({ error: 'Cần route và date' });
  try {
    const results = await quoteAllAirlines(
      { route, date, pax: parseInt(pax, 10) || 1 },
      { log: (m) => logger.info(m) }
    );
    res.json({ route, date, pax: parseInt(pax, 10) || 1, results });
  } catch (e) {
    logger.error('worker quote lỗi:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  logger.info(`🛠️  Fare worker HTTP nghe ở cổng ${PORT}${SECRET ? '' : ' (CẢNH BÁO: chưa đặt WORKER_SECRET)'}`);
  startLoop();
});
