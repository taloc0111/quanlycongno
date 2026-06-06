// routes/ticketWatches.js
const express = require('express');
const { getWatches, createWatch, updateWatch, deleteWatch } = require('../controllers/ticketWatchController');

const router = express.Router();

router.get('/', getWatches);
router.post('/', createWatch);
router.put('/:id', updateWatch);
router.delete('/:id', deleteWatch);

module.exports = router;
