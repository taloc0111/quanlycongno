// routes/trainTickets.js
const express = require('express');
const {
  getTrainTickets, createTrainTicket, updateTrainTicket, deleteTrainTicket, bulkDeleteTrainTickets, importTrainTickets,
} = require('../controllers/trainTicketController');

const { makeCancelHandler, makeUncancelHandler } = require('../utils/cancel');

const router = express.Router();

router.get('/', getTrainTickets);
router.post('/', createTrainTicket);
router.put('/:id', updateTrainTicket);
router.delete('/:id', deleteTrainTicket);
router.post('/bulk-delete', bulkDeleteTrainTickets);
router.post('/import', importTrainTickets);
// Dòng tiền v3.1: huỷ / hoàn tác huỷ
router.post('/:id/cancel', makeCancelHandler('train'));
router.post('/:id/uncancel', makeUncancelHandler('train'));

module.exports = router;
