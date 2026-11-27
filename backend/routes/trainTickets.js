// routes/trainTickets.js
const express = require('express');
const {
  getTrainTickets, createTrainTicket, updateTrainTicket, deleteTrainTicket, bulkDeleteTrainTickets, importTrainTickets,
} = require('../controllers/trainTicketController');

const router = express.Router();

router.get('/', getTrainTickets);
router.post('/', createTrainTicket);
router.put('/:id', updateTrainTicket);
router.delete('/:id', deleteTrainTicket);
router.post('/bulk-delete', bulkDeleteTrainTickets);
router.post('/import', importTrainTickets);

module.exports = router;
