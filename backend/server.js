// server.js — điểm vào khi chạy thật: áp schema → listen → bật worker canh giá (nếu cấu hình).
// Toàn bộ app Express nằm ở app.js (để test import được mà không listen).
// Ưu tiên IPv4 khi resolve DNS — Render không có outbound IPv6, nếu để mặc định
// (IPv6 trước) sẽ lỗi ENETUNREACH khi kết nối SMTP Gmail.
require('dns').setDefaultResultOrder('ipv4first');

const env = require('./config/env');
const logger = require('./config/logger');
const { app, ensureSchema } = require('./app');

// Bật vòng canh giá tự động trong tiến trình app khi FARE_WATCHER=true.
// Nguồn giá là SerpApi/adapter HTTP (không Chromium) nên nhẹ; lưu ý trên Render
// free app ngủ sau 15 phút không có traffic → loop ngừng khi ngủ, canh đều thì
// dùng cron ngoài gọi `npm run fare-watch`.
function maybeStartFareWatcher() {
  if (String(process.env.FARE_WATCHER || 'false').toLowerCase() !== 'true') return;
  try {
    require('./workers/fareWatcher').startLoop();
  } catch (err) {
    logger.error('Không bật được fareWatcher:', err.message);
  }
}

ensureSchema().finally(() => {
  app.listen(env.port, () => {
    logger.info(`🚀 Server running on port ${env.port} (${env.nodeEnv})`);
    maybeStartFareWatcher();
  });
});
