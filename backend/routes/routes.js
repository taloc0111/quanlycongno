// routes/routes.js
const express = require('express');
const { getRoutes, createRoute, deleteRoute } = require('../controllers/routeController');

const router = express.Router();

router.get('/', getRoutes);
router.post('/', createRoute);
router.delete('/:routeName', deleteRoute);

module.exports = router;