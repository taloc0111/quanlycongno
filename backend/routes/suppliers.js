// routes/suppliers.js — Nhà cung cấp + tiền trả NCC (Dòng tiền v3).
const express = require('express');
const {
  getSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getSupplierLedger,
  createSupplierPayment,
  deleteSupplierPayment,
} = require('../controllers/supplierController');

const router = express.Router();

// /payments/:paymentId đặt TRƯỚC /:id để không bị bắt nhầm.
router.delete('/payments/:paymentId', deleteSupplierPayment);
router.get('/', getSuppliers);
router.post('/', createSupplier);
router.get('/:id/ledger', getSupplierLedger);
router.post('/:id/payments', createSupplierPayment);
router.put('/:id', updateSupplier);
router.delete('/:id', deleteSupplier);

module.exports = router;
