// routes/airlines.js
const express = require('express');
const { getAirlines, createAirline, updateAirline, deleteAirline } = require('../controllers/airlineController');

const router = express.Router();

router.get('/', getAirlines);
router.post('/', createAirline);
router.put('/:id', updateAirline);
router.delete('/:id', deleteAirline);

module.exports = router;
