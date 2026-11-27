import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Pin, PinOff, StickyNote, RefreshCw } from 'lucide-react';
import { api } from './services/client';
import { useFeedback } from './ui/FeedbackContext';
import { formatDateTime } from './utils/format';
import { Button, IconButton, Badge, EmptyState, Skeleton, PageHeader, ErrorBanner, Card } from './ui';

// Bảng màu sticky pastel — để class đầy đủ vì Tailwind không nhận class ghép động.
const COLORS = {
  yellow: { card: 'bg-amber-50 border-amber-200', dot: 'bg-amber-300', label: 'Vàng' },
  green: { card: 'bg-emerald-50 border-emerald-200', dot: 'bg-emerald-300', label: 'Xanh lá' },
  pink: { card: 'bg-pink-50 border-pink-200', dot: 'bg-pink-300', label: 'Hồng' },
  blue: { card: 'bg-sky-50 border-sky-200', dot: 'bg-sky-300', label: 'Xanh dương' },
  purple: { card: 'bg-violet-50 border-violet-200', dot: 'bg-violet-300', label: 'Tím' },
};
const COLOR_KEYS = Object.keys(COLORS);
const AUTOSAVE_MS = 800;

/** Ghim lên đầu, giữ nguyên thứ tự còn lại (khớp ORDER BY của server). */
const sortNotes = (list) => [...list].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));

export default function NotesApp() {
  const { toast, confirm } = useFeedback();
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [focusId, setFocusId] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      setNotes(await api.get('/notes'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const addNote = async () => {
    setAdding(true);
    try {
      const created = await api.post('/notes', { content: '', color: 'yellow' });
      setNotes((prev) => sortNotes([created, ...prev]));
      setFocusId(created.id);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
  };

  // Cập nhật cục bộ ngay (optimistic), gửi server ngầm; lỗi thì tải lại.
  const patch = useCallback(async (id, fields, { quiet = false } = {}) => {
    setNotes((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, ...fields } : n));
      return 'pinned' in fields ? sortNotes(next) : next;
    });
    try {
      const saved = await api.put(`/notes/${id}`, fields);
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, updated_at: saved?.updated_at ?? n.updated_at } : n)));
      if (!quiet) toast.success('Đã lưu');
      return true;
    } catch (err) {
      toast.error(`Lỗi lưu ghi chú: ${err.message}`);
      load({ silent: true });
      return false;
    }
  }, [toast, load]);

  const remove = async (note) => {
    const preview = (note.content || '').trim().slice(0, 60);
    const ok = await confirm({
      title: 'Xoá ghi chú',
      message: preview ? `Xoá ghi chú "${preview}${note.content.trim().length > 60 ? '…' : ''}"?` : 'Xoá ghi chú trống này?',
      confirmText: 'Xoá',
    });
    if (!ok) return;
    const prev = notes;
    setNotes((p) => p.filter((n) => n.id !== note.id));
    try {
      await api.del(`/notes/${note.id}`);
      toast.success('Đã xoá ghi chú');
    } catch (err) {
      toast.error(err.message);
      setNotes(prev);
    }
  };

  const pinnedCount = notes.filter((n) => n.pinned).length;

  return (
    <div>
      <PageHeader
        help="notes"
        icon={StickyNote}
        title="Ghi chú"
        description={notes.length ? `${notes.length} ghi chú · ${pinnedCount} đã ghim · tự lưu khi gõ` : 'Nhắc việc nhanh, riêng tư, tự lưu khi gõ.'}
        actions={(
          <>
            <Button variant="secondary" icon={RefreshCw} loading={refreshing} onClick={() => load({ silent: true })}>Làm mới</Button>
            <Button icon={Plus} loading={adding} onClick={addNote}>Thêm ghi chú</Button>
          </>
        )}
      />

      <ErrorBanner message={error} onRetry={() => load()} />

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="min-h-[180px] p-4 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </Card>
          ))}
        </div>
      ) : !error && notes.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={StickyNote}
            title="Chưa có ghi chú nào"
            description="Tạo nhắc nhở nhanh: khách cần gọi lại, việc cần làm hôm nay… Ghi chú tự lưu khi bạn gõ."
            action={<Button icon={Plus} loading={adding} onClick={addNote}>Thêm ghi chú</Button>}
          />
        </Card>
      ) : (
        <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              autoFocus={note.id === focusId}
              onPatch={patch}
              onRemove={() => remove(note)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NoteCard({ note, autoFocus, onPatch, onRemove }) {
  const [text, setText] = useState(note.content || '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Đồng bộ khi nội dung từ ngoài đổi (vd tải lại sau lỗi) và người dùng không đang sửa dở.
  const [seenContent, setSeenContent] = useState(note.content || '');
  if ((note.content || '') !== seenContent) {
    setSeenContent(note.content || '');
    if (!dirty) setText(note.content || '');
  }

  const timerRef = useRef(null);
  const textareaRef = useRef(null);
  const color = COLORS[note.color] || COLORS.yellow;

  const commit = useCallback(async (value) => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    if (value === (note.content || '')) { setDirty(false); return; }
    setSaving(true);
    const ok = await onPatch(note.id, { content: value });
    setSaving(false);
    if (ok) setDirty(false);
  }, [note.id, note.content, onPatch]);

  // Textarea tự giãn theo nội dung.
  const autosize = (el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(96, el.scrollHeight)}px`;
  };
  useEffect(() => { autosize(textareaRef.current); }, [text]);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const onChange = (e) => {
    const value = e.target.value;
    setText(value);
    setDirty(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commit(value), AUTOSAVE_MS);
  };

  return (
    <div className={`break-inside-avoid mb-4 rounded-2xl border shadow-card p-3 flex flex-col transition ${color.card} ${note.pinned ? 'ring-1 ring-amber-300/60' : ''}`}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Màu ghi chú">
          {COLOR_KEYS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={note.color === c}
              title={COLORS[c].label}
              onClick={() => note.color !== c && onPatch(note.id, { color: c }, { quiet: true })}
              className={`h-4 w-4 rounded-full border border-black/10 transition ${COLORS[c].dot} ${note.color === c ? 'ring-2 ring-ink/40 ring-offset-1 ring-offset-transparent scale-110' : 'hover:scale-110'}`}
            />
          ))}
        </div>
        <div className="flex items-center gap-0.5">
          {note.pinned && <Badge tone="warning" className="mr-1">Ghim</Badge>}
          <IconButton
            icon={note.pinned ? Pin : PinOff}
            size={15}
            title={note.pinned ? 'Bỏ ghim' : 'Ghim lên đầu'}
            variant={note.pinned ? 'warning' : 'ghost'}
            onClick={() => onPatch(note.id, { pinned: !note.pinned }, { quiet: true })}
            className="hover:bg-black/5"
          />
          <IconButton icon={Trash2} size={15} title="Xoá ghi chú" variant="danger" onClick={onRemove} className="hover:bg-black/5" />
        </div>
      </div>
      <textarea
        ref={textareaRef}
        value={text}
        autoFocus={autoFocus}
        onChange={onChange}
        onBlur={() => { if (dirty) commit(text); }}
        placeholder="Nhập ghi chú…"
        rows={4}
        className="w-full resize-none bg-transparent text-sm text-ink leading-relaxed placeholder:text-ink-faint/70 focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between text-[11px] text-ink-faint">
        <span>{saving ? 'Đang lưu…' : dirty ? 'Chưa lưu' : note.updated_at ? `Sửa ${formatDateTime(note.updated_at)}` : ''}</span>
        <span className="tabular">{text.length ? `${text.length} ký tự` : ''}</span>
      </div>
    </div>
  );
}
