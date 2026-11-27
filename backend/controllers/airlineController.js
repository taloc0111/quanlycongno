// controllers/airlineController.js — hãng bay + link check-in tự khai báo (riêng theo user).
const pool = require('../config/database');
const logger = require('../config/logger');
const v = require('../utils/validate');

// Kiểm tra + chuẩn hoá body. Ném ValidationError (→ 400) khi sai.
function parseAirlineBody(body) {
  const checkinUrl = v.str(body.checkinUrl, { required: true, label: 'Link check-in' });
  if (!/^https?:\/\//i.test(checkinUrl)) throw new v.ValidationError('Link check-in phải bắt đầu bằng http:// hoặc https://');
  return {
    name: v.str(body.name, { max: 100, required: true, label: 'Tên hãng' }),
    code: v.str(body.code, { max: 10, label: 'Mã hãng' }),
    checkinUrl,
  };
}

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
  const a = parseAirlineBody(req.body);
  try {
    const result = await pool.query(
      `INSERT INTO airlines (user_id, name, code, checkin_url) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, a.name, a.code, a.checkinUrl]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create airline error:', error.message);
    res.status(500).json({ error: 'Failed to create airline' });
  }
};

const updateAirline = async (req, res) => {
  const id = v.idParam(req.params.id);
  const a = parseAirlineBody(req.body);
  try {
    const result = await pool.query(
      `UPDATE airlines SET name = $2, code = $3, checkin_url = $4
       WHERE id = $1 AND user_id = $5 RETURNING *`,
      [id, a.name, a.code, a.checkinUrl, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Airline not found' });
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update airline error:', error.message);
    res.status(500).json({ error: 'Failed to update airline' });
  }
};

const deleteAirline = async (req, res) => {
  const id = v.idParam(req.params.id);
  try {
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
