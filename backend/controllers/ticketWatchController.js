// controllers/ticketWatchController.js — "canh vé" cho khách (theo dõi vé rẻ).
const pool = require('../config/database');
const logger = require('../config/logger');
const { checkWatchById } = require('../workers/fareWatcher');

const STATUSES = ['watching', 'quoted', 'booked', 'cancelled'];

// Ép về boolean rõ ràng từ giá trị form (true/false/"true"/1/undefined).
const toBool = (v) => v === true || v === 'true' || v === 1 || v === '1';

// Danh sách của chính mình: đang canh trước, sắp theo ngày đi gần nhất.
const getWatches = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM ticket_watches
       WHERE user_id = $1
       ORDER BY (status = 'cancelled') ASC, (status = 'booked') ASC,
                depart_date ASC NULLS LAST, created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get ticket watches error:', error.message);
    res.status(500).json({ error: 'Failed to fetch ticket watches' });
  }
};

const createWatch = async (req, res) => {
  try {
    const { customerName, phoneNumber, route, departDate, returnDate, airline, pax, targetPrice, status, notes, autoTrack } = req.body;
    if (!customerName) return res.status(400).json({ error: 'Tên khách hàng là bắt buộc' });
    const safeStatus = STATUSES.includes(status) ? status : 'watching';
    const result = await pool.query(
      `INSERT INTO ticket_watches
         (user_id, customer_name, phone_number, route, depart_date, return_date, airline, pax, target_price, status, notes, auto_track)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        req.user.id, customerName, phoneNumber || null, route || null,
        departDate || null, returnDate || null, airline || null,
        parseInt(pax, 10) || 1, parseFloat(targetPrice) || 0, safeStatus, notes || null,
        toBool(autoTrack),
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create ticket watch error:', error.message);
    res.status(500).json({ error: 'Failed to create ticket watch' });
  }
};

const updateWatch = async (req, res) => {
  try {
    const { id } = req.params;
    const { customerName, phoneNumber, route, departDate, returnDate, airline, pax, targetPrice, status, notes, autoTrack } = req.body;
    // Cập nhật từng phần: chỉ đổi field nào được gửi (COALESCE giữ giá trị cũ).
    const result = await pool.query(
      `UPDATE ticket_watches SET
         customer_name = COALESCE($2, customer_name),
         phone_number  = $3,
         route         = $4,
         depart_date   = $5,
         return_date   = $6,
         airline       = $7,
         pax           = COALESCE($8, pax),
         target_price  = COALESCE($9, target_price),
         status        = COALESCE($10, status),
         notes         = $11,
         auto_track    = COALESCE($13, auto_track)
       WHERE id = $1 AND user_id = $12
       RETURNING *`,
      [
        id,
        customerName ?? null,
        phoneNumber || null, route || null, departDate || null, returnDate || null, airline || null,
        Number.isInteger(parseInt(pax, 10)) ? parseInt(pax, 10) : null,
        targetPrice !== undefined ? (parseFloat(targetPrice) || 0) : null,
        STATUSES.includes(status) ? status : null,
        notes ?? null,
        req.user.id,
        autoTrack === undefined ? null : toBool(autoTrack),
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Ticket watch not found' });
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update ticket watch error:', error.message);
    res.status(500).json({ error: 'Failed to update ticket watch' });
  }
};

const deleteWatch = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM ticket_watches WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Ticket watch not found' });
    res.json({ message: 'Ticket watch deleted' });
  } catch (error) {
    logger.error('Delete ticket watch error:', error.message);
    res.status(500).json({ error: 'Failed to delete ticket watch' });
  }
};

// Lịch sử giá của 1 yêu cầu (vẽ biểu đồ / xem diễn biến). Mới nhất trước.
const getSnapshots = async (req, res) => {
  try {
    const { id } = req.params;
    // Đảm bảo watch thuộc về user trước khi trả lịch sử.
    const own = await pool.query('SELECT id FROM ticket_watches WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (own.rows.length === 0) return res.status(404).json({ error: 'Ticket watch not found' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 60, 200);
    const result = await pool.query(
      `SELECT id, source, airline, price, currency, flight_no, depart_time, ok, error, created_at
         FROM fare_snapshots WHERE watch_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [id, limit]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get fare snapshots error:', error.message);
    res.status(500).json({ error: 'Failed to fetch fare snapshots' });
  }
};

// Lấy giá NGAY cho 1 yêu cầu (nút bấm tay). Nguồn SerpApi/adapter HTTP — chạy
// in-process, mất vài giây.
const checkNow = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT id, route, depart_date FROM ticket_watches WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );
    const watch = rows[0];
    if (!watch) return res.status(404).json({ error: 'Ticket watch not found' });
    if (!watch.route || !watch.depart_date) {
      return res.status(400).json({ error: 'Cần có hành trình và ngày đi để lấy giá' });
    }

    const result = await checkWatchById(watch.id, { userId: req.user.id, log: (m) => logger.info(m) });
    res.json(result);
  } catch (error) {
    logger.error('Check fare now error:', error.message);
    res.status(500).json({ error: 'Lấy giá thất bại: ' + error.message });
  }
};

module.exports = { getWatches, createWatch, updateWatch, deleteWatch, getSnapshots, checkNow };
