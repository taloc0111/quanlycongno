// routes/deposits.js
const express = require('express');
const { getDeposits, createDeposit, updateDeposit, deleteDeposit, getBalance } = require('../controllers/depositController');

const router = express.Router();

router.get('/', getDeposits);
router.get('/balance', getBalance);
router.post('/', createDeposit);
router.put('/:id', updateDeposit);
router.delete('/:id', deleteDeposit);

module.exports = router;
