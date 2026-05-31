// controllers/routeController.js
const pool = require('../config/database');

const getRoutes = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT route_name FROM flight_routes WHERE user_id = $1 ORDER BY route_name',
      [req.user.id]
    );
    res.json(result.rows.map(r => r.route_name));
  } catch (error) {
    console.error('Get routes error:', error);
    res.status(500).json({ error: 'Failed to fetch routes' });
  }
};

const createRoute = async (req, res) => {
  try {
    const { routeName } = req.body;

    if (!routeName) {
      return res.status(400).json({ error: 'Route name required' });
    }

    const result = await pool.query(
      'INSERT INTO flight_routes (user_id, route_name) VALUES ($1, $2) RETURNING route_name',
      [req.user.id, routeName.toUpperCase()]
    );

    res.status(201).json({ route: result.rows[0].route_name });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Route already exists' });
    }
    console.error('Create route error:', error);
    res.status(500).json({ error: 'Failed to create route' });
  }
};

const deleteRoute = async (req, res) => {
  try {
    const { routeName } = req.params;

    await pool.query(
      'DELETE FROM flight_routes WHERE user_id = $1 AND route_name = $2',
      [req.user.id, routeName.toUpperCase()]
    );

    res.json({ message: 'Route deleted' });
  } catch (error) {
    console.error('Delete route error:', error);
    res.status(500).json({ error: 'Failed to delete route' });
  }
};

module.exports = { getRoutes, createRoute, deleteRoute };