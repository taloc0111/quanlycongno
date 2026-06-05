import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Pin, PinOff, StickyNote } from 'lucide-react';
import { apiGet, apiSend } from './services/client';

// Bảng màu sticky — phải để class đầy đủ (Tailwind không nhận class ghép động).
const COLORS = {
  yellow: { card: 'bg-yellow-100 border-yellow-300', dot: 'bg-yellow-300' },
  green: { card: 'bg-green-100 border-green-300', dot: 'bg-green-300' },
  pink: { card: 'bg-pink-100 border-pink-300', dot: 'bg-pink-300' },
  blue: { card: 'bg-blue-100 border-blue-300', dot: 'bg-blue-300' },
  purple: { card: 'bg-purple-100 border-purple-300', dot: 'bg-purple-300' },
};
const COLOR_KEYS = Object.keys(COLORS);

export default function NotesApp() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setNotes(await apiGet('/notes'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const addNote = async () => {
    try {
      const created = await apiSend('POST', '/notes', { content: '', color: 'yellow' });
      setNotes((prev) => [created, ...prev]);
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  };

  // Cập nhật cục bộ ngay (optimistic), gửi server ngầm.
  const patch = async (id, fields) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...fields } : n)));
    try {
      await apiSend('PUT', `/notes/${id}`, fields);
      if ('pinned' in fields) await load(); // ghim → sắp xếp lại
    } catch (err) {
      alert('Lỗi lưu ghi chú: ' + err.message);
      load();
    }
  };

  const remove = async (id) => {
    if (!confirm('Xóa ghi chú này?')) return;
    const prev = notes;
    setNotes((p) => p.filter((n) => n.id !== id));
    try {
      await apiSend('DELETE', `/notes/${id}`);
    } catch (err) {
      alert('Lỗi: ' + err.message);
      setNotes(prev);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2 text-gray-800">
          <StickyNote className="text-amber-500" /> Ghi chú
        </h1>
        <button
          onClick={addNote}
          className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition font-semibold text-sm shadow"
        >
          <Plus size={18} /> Thêm ghi chú
        </button>
      </div>

      {loading && <p className="text-gray-500">Đang tải…</p>}
      {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-700">{error}</div>}

      {!loading && !error && notes.length === 0 && (
        <div className="text-center text-gray-400 py-16">
          <StickyNote size={48} className="mx-auto mb-3 opacity-40" />
          <p>Chưa có ghi chú nào. Bấm <b>Thêm ghi chú</b> để tạo nhắc nhở nhanh.</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {notes.map((note) => (
          <NoteCard key={note.id} note={note} onPatch={patch} onRemove={remove} />
        ))}
      </div>
    </div>
  );
}

function NoteCard({ note, onPatch, onRemove }) {
  const [text, setText] = useState(note.content || '');
  const color = COLORS[note.color] || COLORS.yellow;

  // Đồng bộ khi note đổi từ ngoài (vd reload sau khi ghim).
  useEffect(() => { setText(note.content || ''); }, [note.content]);

  const saveText = () => {
    if (text !== (note.content || '')) onPatch(note.id, { content: text });
  };

  return (
    <div className={`rounded-xl border shadow-sm p-3 flex flex-col min-h-[180px] ${color.card}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex gap-1.5">
          {COLOR_KEYS.map((c) => (
            <button
              key={c}
              onClick={() => onPatch(note.id, { color: c })}
              title={c}
              className={`w-4 h-4 rounded-full border border-black/10 ${COLORS[c].dot} ${note.color === c ? 'ring-2 ring-gray-500 ring-offset-1' : ''}`}
            />
          ))}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => onPatch(note.id, { pinned: !note.pinned })}
            title={note.pinned ? 'Bỏ ghim' : 'Ghim lên đầu'}
            className={`p-1 rounded hover:bg-black/10 ${note.pinned ? 'text-amber-700' : 'text-gray-400'}`}
          >
            {note.pinned ? <Pin size={15} fill="currentColor" /> : <PinOff size={15} />}
          </button>
          <button
            onClick={() => onRemove(note.id)}
            title="Xóa"
            className="p-1 rounded text-gray-400 hover:bg-black/10 hover:text-red-600"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={saveText}
        placeholder="Nhập ghi chú…"
        className="flex-1 w-full bg-transparent resize-none outline-none text-sm text-gray-800 placeholder-gray-400/70"
      />
    </div>
  );
}
