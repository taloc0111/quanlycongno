// controllers/noteController.js — sticky notes (ghi chú nhanh, riêng tư theo user).
const pool = require('../config/database');
const logger = require('../config/logger');

const COLORS = ['yellow', 'green', 'pink', 'blue', 'purple'];

// Lấy toàn bộ note của chính mình: ghim lên trước, rồi theo thứ tự kéo, mới nhất sau.
const getNotes = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM sticky_notes
       WHERE user_id = $1
       ORDER BY pinned DESC, position ASC, updated_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get notes error:', error.message);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
};

const createNote = async (req, res) => {
  try {
    const { content, color } = req.body;
    const safeColor = COLORS.includes(color) ? color : 'yellow';
    const result = await pool.query(
      `INSERT INTO sticky_notes (user_id, content, color)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.user.id, (content || '').toString(), safeColor]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create note error:', error.message);
    res.status(500).json({ error: 'Failed to create note' });
  }
};

// Cập nhật từng phần: chỉ đổi field nào được gửi lên (content / color / pinned / position).
const updateNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { content, color, pinned, position } = req.body;
    const result = await pool.query(
      `UPDATE sticky_notes SET
         content  = COALESCE($2, content),
         color    = COALESCE($3, color),
         pinned   = COALESCE($4, pinned),
         position = COALESCE($5, position)
       WHERE id = $1 AND user_id = $6
       RETURNING *`,
      [
        id,
        content !== undefined ? content.toString() : null,
        COLORS.includes(color) ? color : null,
        typeof pinned === 'boolean' ? pinned : null,
        Number.isInteger(position) ? position : null,
        req.user.id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Note not found' });
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update note error:', error.message);
    res.status(500).json({ error: 'Failed to update note' });
  }
};

const deleteNote = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM sticky_notes WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Note not found' });
    res.json({ message: 'Note deleted' });
  } catch (error) {
    logger.error('Delete note error:', error.message);
    res.status(500).json({ error: 'Failed to delete note' });
  }
};

module.exports = { getNotes, createNote, updateNote, deleteNote };
