// config/workerClient.js — gọi sang worker canh giá (chạy ở VPS riêng) qua HTTP.
// Web service (Render free 512MB) KHÔNG chạy nổi Chromium, nên uỷ thác việc lấy giá
// sang worker. Khi WORKER_URL chưa cấu hình → workerEnabled=false, caller tự xử lý
// (chạy in-process nếu môi trường có Playwright, hoặc báo lỗi).
const logger = require('./logger');

const WORKER_URL = (process.env.WORKER_URL || '').replace(/\/$/, '');
const WORKER_SECRET = process.env.WORKER_SECRET || '';
// Lấy giá có thể mất vài chục giây (mở trình duyệt + chờ trang render).
const WORKER_TIMEOUT_MS = parseInt(process.env.WORKER_TIMEOUT_MS || '90000', 10);

const workerEnabled = Boolean(WORKER_URL);

// Bí mật worker đi trong header → BẮT BUỘC TLS, trừ khi gọi localhost (dev) hoặc
// chủ động bật WORKER_ALLOW_INSECURE. Tránh lộ secret qua HTTP trần.
function isInsecure(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return false;
    if (['localhost', '127.0.0.1', '::1'].includes(u.hostname)) return false;
    return process.env.WORKER_ALLOW_INSECURE !== 'true';
  } catch {
    return true; // URL không hợp lệ → coi như không an toàn
  }
}
if (workerEnabled && isInsecure(WORKER_URL)) {
  logger.error(`⚠️ WORKER_URL không dùng HTTPS (${WORKER_URL}) — secret sẽ bị lộ. Đặt URL https:// (reverse proxy TLS) hoặc WORKER_ALLOW_INSECURE=true nếu chấp nhận rủi ro.`);
}

// POST tới worker. Trả về JSON đã parse; ném lỗi nếu mạng/timeout/HTTP !ok.
async function callWorker(path, body) {
  if (!WORKER_URL) throw new Error('WORKER_URL chưa cấu hình');
  if (isInsecure(WORKER_URL)) throw new Error('WORKER_URL phải dùng HTTPS (đang gửi secret qua HTTP trần)');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);
  try {
    const res = await fetch(`${WORKER_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-worker-secret': WORKER_SECRET },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `worker trả ${res.status}`);
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Worker phản hồi quá lâu (timeout)');
    logger.error(`Gọi worker ${path} lỗi:`, e.message);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { workerEnabled, callWorker };
