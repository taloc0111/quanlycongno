// routes/accounts.js — Tài khoản tiền (Dòng tiền v3 + v3.1: chuyển tiền, thu chi khác, khớp sao kê).
const express = require('express');
const {
  getAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  getLedger,
  reconcile,
  reconcileBatch,
} = require('../controllers/accountController');
const {
  getTransfers,
  createTransfer,
  deleteTransfer,
  getEntries,
  createEntry,
  updateEntry,
  deleteEntry,
} = require('../controllers/accountMovesController');

const router = express.Router();

// Các đường dẫn cố định đặt TRƯỚC /:id để không bị bắt nhầm thành id.
router.put('/reconcile', reconcile);
router.put('/reconcile-batch', reconcileBatch);
router.get('/transfers', getTransfers);
router.post('/transfers', createTransfer);
router.delete('/transfers/:id', deleteTransfer);
router.get('/entries', getEntries);
router.post('/entries', createEntry);
router.put('/entries/:id', updateEntry);
router.delete('/entries/:id', deleteEntry);
router.get('/', getAccounts);
router.post('/', createAccount);
router.get('/:id/ledger', getLedger);
router.put('/:id', updateAccount);
router.delete('/:id', deleteAccount);

module.exports = router;
