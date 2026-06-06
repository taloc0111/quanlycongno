// middleware/auth.js
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, env.jwtSecret, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    // Chặn token còn hạn nhưng tài khoản dùng thử đã hết hạn.
    if (user.trialEndsAt && Date.now() > user.trialEndsAt) {
      return res.status(403).json({ error: 'Tài khoản dùng thử đã hết hạn', trialExpired: true });
    }
    req.user = user;
    next();
  });
};

module.exports = { authenticateToken };
