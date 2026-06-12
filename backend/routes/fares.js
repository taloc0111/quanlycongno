// routes/fares.js — tra giá vé tức thời ("Check vé").
const express = require('express');
const rateLimit = require('express-rate-limit');
const { quote } = require('../controllers/fareController');

const router = express.Router();

// Mỗi lần tra giá mở 5 phiên trình duyệt → giới hạn để tránh quá tải worker.
const quoteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Tra giá quá nhanh, thử lại sau giây lát' },
});

router.post('/quote', quoteLimiter, quote);

module.exports = router;
