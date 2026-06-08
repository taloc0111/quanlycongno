// routes/tours.js
const express = require('express');
const { getTours, createTour, updateTour, deleteTour, bulkDeleteTours } = require('../controllers/tourController');

const router = express.Router();

router.get('/', getTours);
router.post('/', createTour);
router.put('/:id', updateTour);
router.delete('/:id', deleteTour);
router.post('/bulk-delete', bulkDeleteTours);

module.exports = router;
