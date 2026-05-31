// routes/payments.js
const express = require('express');
const { getPayments, createPayment, deletePayment } = require('../controllers/paymentController');

const router = express.Router();

router.get('/', getPayments);
router.post('/', createPayment);
router.delete('/:id', deletePayment);

module.exports = router;
