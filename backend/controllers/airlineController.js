// controllers/airlineController.js — hãng bay + link check-in tự khai báo (riêng theo user).
const pool = require('../config/database');
const logger = require('../config/logger');

const getAirlines = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM airlines WHERE user_id = $1 ORDER BY name',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get airlines error:', error.message);
    res.status(500).json({ error: 'Failed to fetch airlines' });
  }
};

const createAirline = async (req, res) => {
  try {
    const { name, code, checkinUrl } = req.body;
    if (!name || !checkinUrl) return res.status(400).json({ error: 'Cần tên hãng và link check-in' });
    const result = await pool.query(
      `INSERT INTO airlines (user_id, name, code, checkin_url) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, name.trim(), (code || '').trim() || null, checkinUrl.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create airline error:', error.message);
    res.status(500).json({ error: 'Failed to create airline' });
  }
};

const updateAirline = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, checkinUrl } = req.body;
    if (!name || !checkinUrl) return res.status(400).json({ error: 'Cần tên hãng và link check-in' });
    const result = await pool.query(
      `UPDATE airlines SET name = $2, code = $3, checkin_url = $4
       WHERE id = $1 AND user_id = $5 RETURNING *`,
      [id, name.trim(), (code || '').trim() || null, checkinUrl.trim(), req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Airline not found' });
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update airline error:', error.message);
    res.status(500).json({ error: 'Failed to update airline' });
  }
};

const deleteAirline = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM airlines WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Airline not found' });
    res.json({ message: 'Airline deleted' });
  } catch (error) {
    logger.error('Delete airline error:', error.message);
    res.status(500).json({ error: 'Failed to delete airline' });
  }
};

module.exports = { getAirlines, createAirline, updateAirline, deleteAirline };
