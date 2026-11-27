// routes/debts.js
const express = require('express');
const {
  getDebts,
  createDebt,
  updateDebt,
  deleteDebt,
  setCheckin,
  bulkDeleteDebts,
  importDebts,
} = require('../controllers/debtController');

const { makeCancelHandler, makeUncancelHandler, changeDebt } = require('../utils/cancel');

const router = express.Router();

router.get('/', getDebts);
router.post('/', createDebt);
router.put('/:id', updateDebt);
router.put('/:id/checkin', setCheckin);
router.delete('/:id', deleteDebt);
router.post('/bulk-delete', bulkDeleteDebts);
router.post('/import', importDebts);
// Dòng tiền v3.1: huỷ / hoàn tác huỷ / đổi vé
router.post('/:id/cancel', makeCancelHandler('debt'));
router.post('/:id/uncancel', makeUncancelHandler('debt'));
router.post('/:id/change', changeDebt);

module.exports = router;
