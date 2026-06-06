// routes/debts.js
const express = require('express');
const {
  getDebts,
  createDebt,
  updateDebt,
  deleteDebt,
  setCheckin,
  bulkDeleteDebts,
  bulkCreateDebts,
  importDebts
} = require('../controllers/debtController');

const router = express.Router();

router.get('/', getDebts);
router.post('/', createDebt);
router.put('/:id', updateDebt);
router.put('/:id/checkin', setCheckin);
router.delete('/:id', deleteDebt);
router.post('/bulk-delete', bulkDeleteDebts);
router.post('/bulk', bulkCreateDebts);
router.post('/import', importDebts);

module.exports = router;