// routes/receipts.js — Phiếu thu nhiều vé (Dòng tiền v3.1).
const express = require('express');
const { getReceipts, createReceipt, deleteReceipt } = require('../controllers/receiptController');

const router = express.Router();

router.get('/', getReceipts);
router.post('/', createReceipt);
router.delete('/:id', deleteReceipt);

module.exports = router;
