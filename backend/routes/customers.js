// routes/customers.js
const express = require('express');
const {
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  bulkDeleteCustomers,
  importCustomers,
} = require('../controllers/customerController');

const router = express.Router();

router.get('/', getCustomers);
router.post('/', createCustomer);
router.put('/:id', updateCustomer);
router.delete('/:id', deleteCustomer);
router.post('/bulk-delete', bulkDeleteCustomers);
router.post('/import', importCustomers);

module.exports = router;
