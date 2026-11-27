// routes/passports.js
const express = require('express');
const {
  getPassports,
  createPassport,
  updatePassport,
  deletePassport,
  bulkDeletePassports,
  importPassports,
} = require('../controllers/passportController');

const router = express.Router();

router.get('/', getPassports);
router.post('/', createPassport);
router.put('/:id', updatePassport);
router.delete('/:id', deletePassport);
router.post('/bulk-delete', bulkDeletePassports);
router.post('/import', importPassports);

module.exports = router;
