// routes/customers.js
const express = require('express');
const {
  getCustomers,
  getCustomerDetail,
  getCustomerOutstanding,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  bulkDeleteCustomers,
  importCustomers,
} = require('../controllers/customerController');

const router = express.Router();

router.get('/', getCustomers);
router.get('/:id/detail', getCustomerDetail); // mọi giao dịch + sổ thanh toán của 1 khách
router.get('/:id/outstanding', getCustomerOutstanding); // v3.1: dịch vụ còn nợ (chưa huỷ), cũ trước
router.post('/', createCustomer);
router.put('/:id', updateCustomer);
router.delete('/:id', deleteCustomer);
router.post('/bulk-delete', bulkDeleteCustomers);
router.post('/import', importCustomers);

module.exports = router;
