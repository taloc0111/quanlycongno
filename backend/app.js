// app.js — khởi tạo Express app (middleware + routes + error handler), KHÔNG listen.
// server.js import app để chạy thật; test/ import app để chạy trên cổng tạm.
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');

const env = require('./config/env');
const logger = require('./config/logger');
const pool = require('./config/database');
const { ValidationError } = require('./utils/validate');

// Import routes
const authRoutes = require('./routes/auth');
const debtRoutes = require('./routes/debts');
const passportRoutes = require('./routes/passports');
const companyRoutes = require('./routes/companies');
const customerRoutes = require('./routes/customers');
const paymentRoutes = require('./routes/payments');
const invoiceRoutes = require('./routes/invoices');
const depositRoutes = require('./routes/deposits');
const statsRoutes = require('./routes/stats');
const userRoutes = require('./routes/users');
const routeRoutes = require('./routes/routes');
const noteRoutes = require('./routes/notes');
const ticketWatchRoutes = require('./routes/ticketWatches');
const fareRoutes = require('./routes/fares');
const airlineRoutes = require('./routes/airlines');
const trainTicketRoutes = require('./routes/trainTickets');
const tourRoutes = require('./routes/tours');
const auditRoutes = require('./routes/audit');

// Import middleware
const { authenticateToken } = require('./middleware/auth');
const { attachScope } = require('./middleware/scope');
const { requireFeature } = require('./middleware/features');

const app = express();

// Chạy sau proxy (Render/Vercel/Nginx) — tin proxy đầu tiên để rate-limit lấy đúng IP
// từ X-Forwarded-For. Số hop chỉnh qua TRUST_PROXY (mặc định 1).
app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));

// Bảo mật HTTP headers
app.use(helmet());

// CORS — chỉ cho phép các origin khai báo trong env
app.use(
  cors({
    origin: (origin, callback) => {
      // Cho phép request không có origin (Postman, curl, server-to-server)
      if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
      const err = new Error(`Origin không được phép: ${origin}`);
      err.status = 403;
      err.code = 'CORS_ORIGIN';
      return callback(err);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '5mb' })); // giới hạn body để chặn payload quá lớn

// Body luôn là object để controller destructure an toàn (request không có body / không phải JSON).
app.use((req, res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/debts', authenticateToken, attachScope, debtRoutes);
app.use('/api/passports', authenticateToken, attachScope, passportRoutes);
app.use('/api/companies', authenticateToken, companyRoutes);
app.use('/api/customers', authenticateToken, attachScope, customerRoutes);
app.use('/api/payments', authenticateToken, attachScope, paymentRoutes);
app.use('/api/users', authenticateToken, attachScope, userRoutes);
app.use('/api/invoices', authenticateToken, attachScope, invoiceRoutes);
app.use('/api/deposits', authenticateToken, attachScope, depositRoutes);
app.use('/api/stats', authenticateToken, attachScope, statsRoutes);
app.use('/api/routes', authenticateToken, routeRoutes);
app.use('/api/notes', authenticateToken, noteRoutes);
// Canh vé + Check vé: cần cờ fareWatch (admin luôn có).
app.use('/api/ticket-watches', authenticateToken, requireFeature('fareWatch'), ticketWatchRoutes);
app.use('/api/fares', authenticateToken, requireFeature('fareWatch'), fareRoutes);
app.use('/api/airlines', authenticateToken, airlineRoutes);
app.use('/api/train-tickets', authenticateToken, attachScope, trainTicketRoutes);
app.use('/api/tours', authenticateToken, attachScope, tourRoutes);
app.use('/api/audit', authenticateToken, attachScope, auditRoutes);

// Health check (cho Render/uptime monitor)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler — phân loại lỗi đã biết, còn lại 500 (không lộ chi tiết nội bộ).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message });
  }
  if (err.code === 'CORS_ORIGIN') {
    return res.status(403).json({ error: err.message });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Dữ liệu gửi lên quá lớn' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON không hợp lệ' });
  }
  logger.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Tự áp schema (idempotent) khi khởi động — khỏi phải nhớ chạy migrate thủ công.
// Tắt bằng AUTO_MIGRATE=false nếu muốn quản lý migrate riêng.
async function ensureSchema() {
  if (String(process.env.AUTO_MIGRATE || 'true').toLowerCase() === 'false') {
    logger.info('AUTO_MIGRATE=false — bỏ qua áp schema khi khởi động.');
    return;
  }
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema', 'schema.sql'), 'utf8');
    await pool.query(sql);
    logger.info('✅ Schema đã được áp dụng khi khởi động.');
  } catch (err) {
    // Không chặn server chạy — DB có thể đã đúng schema; chỉ ghi log để xử lý sau.
    logger.error('⚠️ Áp schema khi khởi động thất bại:', err.message);
  }
}

module.exports = { app, ensureSchema };
