// routes/wallets.js — Ví trả trước theo khách (Dòng tiền v3).
const express = require('express');
const { getWallets, getWallet, topup, refund, adjust, deleteEntry } = require('../controllers/walletController');

const router = express.Router();

// /entries/:id đặt TRƯỚC /:customerId.
router.delete('/entries/:id', deleteEntry);
router.get('/', getWallets);
router.get('/:customerId', getWallet);
router.post('/:customerId/topup', topup);
router.post('/:customerId/refund', refund);
router.post('/:customerId/adjust', adjust);

module.exports = router;
