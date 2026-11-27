// routes/ticketWatches.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  getWatches, createWatch, updateWatch, deleteWatch, getSnapshots, checkNow,
} = require('../controllers/ticketWatchController');

const router = express.Router();

// "Lấy giá ngay" tốn lượt SerpApi → tối đa 3 lần/phút cho MỖI user (khoá theo user id, không theo IP).
const checkNowLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `u:${req.user.id}`,
  message: { error: 'Lấy giá quá nhanh — tối đa 3 lần/phút, thử lại sau' },
});

router.get('/', getWatches);
router.post('/', createWatch);
router.put('/:id', updateWatch);
router.delete('/:id', deleteWatch);
router.get('/:id/snapshots', getSnapshots);               // lịch sử giá
router.post('/:id/check-now', checkNowLimiter, checkNow); // lấy giá ngay (thủ công)

module.exports = router;
