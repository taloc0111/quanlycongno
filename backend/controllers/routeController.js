// controllers/routeController.js — danh mục hành trình bay (HAN-SGN, ...) riêng theo user.
const pool = require('../config/database');
const logger = require('../config/logger');
const v = require('../utils/validate');

const getRoutes = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT route_name FROM flight_routes WHERE user_id = $1 ORDER BY route_name',
      [req.user.id]
    );
    res.json(result.rows.map((r) => r.route_name));
  } catch (error) {
    logger.error('Get routes error:', error.message);
    res.status(500).json({ error: 'Failed to fetch routes' });
  }
};

const createRoute = async (req, res) => {
  const routeName = v.str(req.body.routeName, { max: 50, required: true, label: 'Hành trình' }).toUpperCase();
  try {
    const result = await pool.query(
      'INSERT INTO flight_routes (user_id, route_name) VALUES ($1, $2) RETURNING route_name',
      [req.user.id, routeName]
    );

    res.status(201).json({ route: result.rows[0].route_name });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Route already exists' });
    }
    logger.error('Create route error:', error.message);
    res.status(500).json({ error: 'Failed to create route' });
  }
};

const deleteRoute = async (req, res) => {
  const routeName = v.str(req.params.routeName, { max: 50, required: true, label: 'Hành trình' }).toUpperCase();
  try {
    await pool.query(
      'DELETE FROM flight_routes WHERE user_id = $1 AND route_name = $2',
      [req.user.id, routeName]
    );

    res.json({ message: 'Route deleted' });
  } catch (error) {
    logger.error('Delete route error:', error.message);
    res.status(500).json({ error: 'Failed to delete route' });
  }
};

module.exports = { getRoutes, createRoute, deleteRoute };
