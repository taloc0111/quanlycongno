// routes/passports.js
const express = require('express');
const {
  getPassports,
  createPassport,
  updatePassport,
  deletePassport,
  bulkDeletePassports,
  importPassports,
} = require('../controllers/passportController');

const { makeCancelHandler, makeUncancelHandler } = require('../utils/cancel');

const router = express.Router();

router.get('/', getPassports);
router.post('/', createPassport);
router.put('/:id', updatePassport);
router.delete('/:id', deletePassport);
router.post('/bulk-delete', bulkDeletePassports);
router.post('/import', importPassports);
// Dòng tiền v3.1: huỷ / hoàn tác huỷ
router.post('/:id/cancel', makeCancelHandler('passport'));
router.post('/:id/uncancel', makeUncancelHandler('passport'));

module.exports = router;
