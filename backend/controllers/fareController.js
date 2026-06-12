// controllers/fareController.js — "Check vé": tra giá NGAY 1 chặng trên các hãng.
// Không lưu DB, không gắn khách — chỉ trả bảng so giá. Nguồn: SerpApi (Google
// Flights) ưu tiên, fallback adapter HTTP từng hãng — không cần Chromium nên
// chạy thẳng in-process, không phải uỷ thác đi đâu.
const logger = require('../config/logger');
const { quoteAllAirlines } = require('../workers/fareWatcher');

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

    const results = await quoteAllAirlines({ route, date, pax }, { log: (m) => logger.info(m) });
    res.json({ route, date, pax, results });
  } catch (error) {
    logger.error('Fare quote error:', error.message);
    res.status(500).json({ error: 'Tra giá thất bại: ' + error.message });
  }
};

module.exports = { quote };
