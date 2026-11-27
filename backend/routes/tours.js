// routes/tours.js
const express = require('express');
const { getTours, createTour, updateTour, deleteTour, bulkDeleteTours, importTours } = require('../controllers/tourController');

const { makeCancelHandler, makeUncancelHandler } = require('../utils/cancel');

const router = express.Router();

router.get('/', getTours);
router.post('/', createTour);
router.put('/:id', updateTour);
router.delete('/:id', deleteTour);
router.post('/bulk-delete', bulkDeleteTours);
router.post('/import', importTours);
// Dòng tiền v3.1: huỷ / hoàn tác huỷ
router.post('/:id/cancel', makeCancelHandler('tour'));
router.post('/:id/uncancel', makeUncancelHandler('tour'));

module.exports = router;
