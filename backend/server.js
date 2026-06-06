// server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const env = require('./config/env');
const logger = require('./config/logger');

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
const airlineRoutes = require('./routes/airlines');

// Import middleware
const { authenticateToken } = require('./middleware/auth');
const { attachScope } = require('./middleware/scope');

const app = express();

// Bảo mật HTTP headers
app.use(helmet());

// CORS — chỉ cho phép các origin khai báo trong env
app.use(
  cors({
    origin: (origin, callback) => {
      // Cho phép request không có origin (Postman, curl, server-to-server)
      if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin không được phép: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '5mb' })); // giới hạn body để chặn payload quá lớn

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
app.use('/api/ticket-watches', authenticateToken, ticketWatchRoutes);
app.use('/api/airlines', authenticateToken, airlineRoutes);

// Health check (cho Render/uptime monitor)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(env.port, () => {
  logger.info(`🚀 Server running on port ${env.port} (${env.nodeEnv})`);
});
