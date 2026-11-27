// controllers/noteController.js — sticky notes (ghi chú nhanh, riêng tư theo user).
const pool = require('../config/database');
const logger = require('../config/logger');
const v = require('../utils/validate');

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
  const content = v.str(req.body.content, { label: 'Nội dung', trim: false }) ?? '';
  const color = v.oneOf(req.body.color, COLORS, { label: 'Màu', fallback: 'yellow' });
  try {
    const result = await pool.query(
      `INSERT INTO sticky_notes (user_id, content, color)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.user.id, content, color]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create note error:', error.message);
    res.status(500).json({ error: 'Failed to create note' });
  }
};

// Cập nhật từng phần: chỉ đổi field nào được gửi lên (content / color / pinned / position).
// content gửi null/'' = xoá trắng (cột NOT NULL nên ghi '').
const updateNote = async (req, res) => {
  const id = v.idParam(req.params.id);
  const { content, color, pinned, position } = req.body;
  const hasContent = content !== undefined;
  const newContent = hasContent ? (content === null ? '' : v.str(content, { label: 'Nội dung', trim: false }) ?? '') : null;
  const newColor = color === undefined ? null : v.oneOf(color, COLORS, { label: 'Màu' });
  const newPinned = v.bool(pinned, { label: 'Ghim' });
  const newPosition = v.int(position, { min: 0, label: 'Vị trí' });
  try {
    const result = await pool.query(
      `UPDATE sticky_notes SET
         content  = CASE WHEN $7 THEN $2 ELSE content END,
         color    = COALESCE($3, color),
         pinned   = COALESCE($4, pinned),
         position = COALESCE($5, position)
       WHERE id = $1 AND user_id = $6
       RETURNING *`,
      [id, newContent, newColor, newPinned, newPosition, req.user.id, hasContent]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Note not found' });
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update note error:', error.message);
    res.status(500).json({ error: 'Failed to update note' });
  }
};

const deleteNote = async (req, res) => {
  const id = v.idParam(req.params.id);
  try {
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
