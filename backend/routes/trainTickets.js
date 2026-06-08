// routes/trainTickets.js
const express = require('express');
const {
  getTrainTickets, createTrainTicket, updateTrainTicket, deleteTrainTicket, bulkDeleteTrainTickets,
} = require('../controllers/trainTicketController');

const router = express.Router();

router.get('/', getTrainTickets);
router.post('/', createTrainTicket);
router.put('/:id', updateTrainTicket);
router.delete('/:id', deleteTrainTicket);
router.post('/bulk-delete', bulkDeleteTrainTickets);

module.exports = router;
