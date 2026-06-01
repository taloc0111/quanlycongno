// routes/deposits.js
const express = require('express');
const { getDeposits, createDeposit, updateDeposit, deleteDeposit } = require('../controllers/depositController');

const router = express.Router();

router.get('/', getDeposits);
router.post('/', createDeposit);
router.put('/:id', updateDeposit);
router.delete('/:id', deleteDeposit);

module.exports = router;
