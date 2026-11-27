// routes/accounts.js — Tài khoản tiền (Dòng tiền v3).
const express = require('express');
const {
  getAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  getLedger,
  reconcile,
} = require('../controllers/accountController');

const router = express.Router();

// /reconcile đặt TRƯỚC /:id để không bị bắt nhầm thành id.
router.put('/reconcile', reconcile);
router.get('/', getAccounts);
router.post('/', createAccount);
router.get('/:id/ledger', getLedger);
router.put('/:id', updateAccount);
router.delete('/:id', deleteAccount);

module.exports = router;
