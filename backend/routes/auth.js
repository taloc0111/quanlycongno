// routes/auth.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const { login, register, getProfile, updateProfile, changePassword } = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Chống brute-force: tối đa 10 lần thử đăng nhập / 15 phút / IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Quá nhiều lần thử. Vui lòng đợi 15 phút.' },
});

router.post('/login', authLimiter, login);
router.post('/register', authLimiter, register);
router.get('/profile', authenticateToken, getProfile);
router.put('/profile', authenticateToken, updateProfile);
router.put('/password', authenticateToken, changePassword);

module.exports = router;
