// controllers/fareController.js — "Check vé": tra giá NGAY 1 chặng trên cả 5 hãng.
// Không lưu DB, không gắn khách — chỉ chạy 5 adapter rồi trả bảng so giá.
const logger = require('../config/logger');
const { workerEnabled, callWorker } = require('../config/workerClient');

// Chống lạm dụng: chỉ nhận chặng dạng "SGN-HAN" và ngày yyyy-mm-dd hợp lệ, pax 1..9.
const ROUTE_RE = /^[A-Za-z]{3}\s*[-→\s]\s*[A-Za-z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const quote = async (req, res) => {
  try {
    const { route, date } = req.body || {};
    const pax = Math.min(Math.max(parseInt(req.body?.pax, 10) || 1, 1), 9);
    if (!route || !ROUTE_RE.test(route)) return res.status(400).json({ error: 'Hành trình không hợp lệ (vd: SGN-HAN)' });
    if (!date || !DATE_RE.test(date)) return res.status(400).json({ error: 'Ngày đi không hợp lệ (yyyy-mm-dd)' });
    if (new Date(date) < new Date(new Date().toISOString().slice(0, 10))) {
      return res.status(400).json({ error: 'Ngày đi đã qua' });
    }

    // Đường chính: uỷ thác sang worker (VPS).
    if (workerEnabled) {
      const data = await callWorker('/internal/quote', { route, date, pax });
      return res.json(data);
    }

    // Dự phòng (dev): chạy in-process nếu có Playwright.
    let quoteAllAirlines;
    try {
      ({ quoteAllAirlines } = require('../workers/fareWatcher'));
    } catch {
      return res.status(503).json({ error: 'Tính năng tra giá chưa sẵn sàng (chưa cấu hình WORKER_URL và máy chủ không có Playwright)' });
    }
    const results = await quoteAllAirlines({ route, date, pax }, { log: (m) => logger.info(m) });
    res.json({ route, date, pax, results });
  } catch (error) {
    logger.error('Fare quote error:', error.message);
    res.status(500).json({ error: 'Tra giá thất bại: ' + error.message });
  }
};

module.exports = { quote };
