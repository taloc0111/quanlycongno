// controllers/ticketWatchController.js — "canh vé" cho khách (theo dõi vé rẻ).
const pool = require('../config/database');
const logger = require('../config/logger');
const { checkWatchById } = require('../workers/fareWatcher');
const v = require('../utils/validate');

const STATUSES = ['watching', 'quoted', 'booked', 'cancelled'];

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

// Bảng field body → cột DB + hàm kiểm tra (dùng cho cả create lẫn update từng phần).
const FIELDS = {
  customerName: { col: 'customer_name', parse: (x) => v.str(x, { max: 255, required: true, label: 'Tên khách hàng' }) },
  phoneNumber: { col: 'phone_number', parse: (x) => v.str(x, { max: 20, label: 'Số điện thoại' }) },
  route: { col: 'route', parse: (x) => v.str(x, { max: 100, label: 'Hành trình' }) },
  departDate: { col: 'depart_date', parse: (x) => v.dateStr(x, { label: 'Ngày đi' }) },
  returnDate: { col: 'return_date', parse: (x) => v.dateStr(x, { label: 'Ngày về' }) },
  airline: { col: 'airline', parse: (x) => v.str(x, { max: 50, label: 'Hãng bay' }) },
  pax: { col: 'pax', parse: (x) => v.int(x, { min: 1, max: 9, label: 'Số khách' }) ?? 1 },
  targetPrice: { col: 'target_price', parse: (x) => v.amount(x, { label: 'Giá mong muốn' }) ?? 0 },
  status: { col: 'status', parse: (x) => v.oneOf(x, STATUSES, { label: 'Trạng thái', fallback: 'watching' }) },
  notes: { col: 'notes', parse: (x) => v.str(x, { label: 'Ghi chú' }) },
  autoTrack: { col: 'auto_track', parse: (x) => v.bool(x, { label: 'Tự động canh' }) ?? false },
};

const createWatch = async (req, res) => {
  const w = {};
  for (const [key, def] of Object.entries(FIELDS)) w[key] = def.parse(req.body[key]);
  try {
    const result = await pool.query(
      `INSERT INTO ticket_watches
         (user_id, customer_name, phone_number, route, depart_date, return_date, airline, pax, target_price, status, notes, auto_track)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        req.user.id, w.customerName, w.phoneNumber, w.route,
        w.departDate, w.returnDate, w.airline,
        w.pax, w.targetPrice, w.status, w.notes, w.autoTrack,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create ticket watch error:', error.message);
    res.status(500).json({ error: 'Failed to create ticket watch' });
  }
};

// Cập nhật TỪNG PHẦN: field không có trong body = giữ nguyên; field có mặt (kể cả ''
// hoặc null) = ghi đè ('' → NULL với cột nullable). Nút đổi trạng thái chỉ gửi {status}.
const updateWatch = async (req, res) => {
  const id = v.idParam(req.params.id);
  const sets = [];
  const params = [id, req.user.id];
  for (const [key, def] of Object.entries(FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(req.body, key)) continue;
    params.push(def.parse(req.body[key]));
    sets.push(`${def.col} = $${params.length}`);
  }
  if (sets.length === 0) return res.status(400).json({ error: 'Không có trường nào để cập nhật' });

  try {
    const result = await pool.query(
      `UPDATE ticket_watches SET ${sets.join(', ')}
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Ticket watch not found' });
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update ticket watch error:', error.message);
    res.status(500).json({ error: 'Failed to update ticket watch' });
  }
};

const deleteWatch = async (req, res) => {
  const id = v.idParam(req.params.id);
  try {
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
  const id = v.idParam(req.params.id);
  try {
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
// in-process, mất vài giây. Rate-limit 3 lần/phút/user ở routes/ticketWatches.js.
const checkNow = async (req, res) => {
  const id = v.idParam(req.params.id);
  try {
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
