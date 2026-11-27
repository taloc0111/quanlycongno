// middleware/auth.js — xác thực JWT rồi nạp user MỚI NHẤT từ DB cho mỗi request.
// Token chỉ dùng để biết "ai"; role / hạn dùng thử / cờ tính năng đọc từ DB để
// thay đổi (khóa tài khoản, bật Canh vé…) có hiệu lực ngay mà không cần đăng nhập lại.
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const pool = require('../config/database');
const logger = require('../config/logger');
const { resolveFeatures } = require('../utils/features');

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, username, role, parent_id, trial_ends_at, features FROM users WHERE id = $1',
      [payload.id]
    );
    const row = rows[0];
    if (!row) return res.status(401).json({ error: 'Tài khoản không tồn tại' });

    // Chặn token còn hạn nhưng tài khoản dùng thử đã hết hạn (theo giá trị DB).
    if (row.trial_ends_at && new Date(row.trial_ends_at).getTime() < Date.now()) {
      return res.status(403).json({ error: 'Tài khoản dùng thử đã hết hạn', trialExpired: true });
    }

    req.user = {
      id: row.id,
      username: row.username,
      role: row.role || 'user',
      parentId: row.parent_id,
      trialEndsAt: row.trial_ends_at,
      features: resolveFeatures(row),
    };
    next();
  } catch (err) {
    logger.error('Auth lookup error:', err.message);
    next(err);
  }
};

module.exports = { authenticateToken };
