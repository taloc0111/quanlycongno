// routes/invoices.js
const express = require('express');
const {
  getInvoices, getInvoice, createInvoice, updateInvoice, deleteInvoice,
} = require('../controllers/invoiceController');

const router = express.Router();

router.get('/', getInvoices);
router.get('/:id', getInvoice);
router.post('/', createInvoice);
router.put('/:id', updateInvoice);
router.delete('/:id', deleteInvoice);

module.exports = router;
