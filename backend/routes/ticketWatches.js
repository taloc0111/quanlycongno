// routes/ticketWatches.js
const express = require('express');
const {
  getWatches, createWatch, updateWatch, deleteWatch, getSnapshots, checkNow,
} = require('../controllers/ticketWatchController');

const router = express.Router();

router.get('/', getWatches);
router.post('/', createWatch);
router.put('/:id', updateWatch);
router.delete('/:id', deleteWatch);
router.get('/:id/snapshots', getSnapshots);  // lịch sử giá
router.post('/:id/check-now', checkNow);      // lấy giá ngay (thủ công)

module.exports = router;
