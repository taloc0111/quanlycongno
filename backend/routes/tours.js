// routes/tours.js
const express = require('express');
const { getTours, createTour, updateTour, deleteTour, bulkDeleteTours, importTours } = require('../controllers/tourController');

const router = express.Router();

router.get('/', getTours);
router.post('/', createTour);
router.put('/:id', updateTour);
router.delete('/:id', deleteTour);
router.post('/bulk-delete', bulkDeleteTours);
router.post('/import', importTours);

module.exports = router;
