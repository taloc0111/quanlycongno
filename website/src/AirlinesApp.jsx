import React, { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, X, Plane, ExternalLink } from 'lucide-react';
import { apiGet, apiSend } from './services/client';
import ConfirmDialog from './components/ConfirmDialog';
import Toast from './components/Toast';
import { useToast, useConfirm } from './hooks/useFeedback';
import { DEFAULT_AIRLINES } from './utils/airlines';

const EMPTY = { name: '', code: '', checkinUrl: '' };

export default function AirlinesApp() {
  const [airlines, setAirlines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const { toast, showToast } = useToast();
  const { confirmState, askConfirm, closeConfirm } = useConfirm();

  const load = async () => {
    setLoading(true); setError('');
    try { setAirlines(await apiGet('/airlines')); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openAdd = () => { setForm(EMPTY); setEditingId(null); setShowForm(true); };
  const openEdit = (a) => { setForm({ name: a.name, code: a.code || '', checkinUrl: a.checkin_url }); setEditingId(a.id); setShowForm(true); };

  const save = async () => {
    if (!form.name.trim() || !form.checkinUrl.trim()) { showToast('Cần tên hãng và link check-in', 'error'); return; }
    try {
      if (editingId) await apiSend('PUT', `/airlines/${editingId}`, form);
      else await apiSend('POST', '/airlines', form);
      setShowForm(false);
      showToast(editingId ? 'Đã cập nhật hãng' : 'Đã thêm hãng');
      load();
    } catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
  };

  const remove = (a) => {
    askConfirm(`Xóa hãng "${a.name}"?`, async () => {
      try { await apiSend('DELETE', `/airlines/${a.id}`); showToast('Đã xóa hãng'); load(); }
      catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><Plane /> Hãng bay</h2>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-sm">
            <Plus size={18} /> Thêm hãng
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-5">Khai báo hãng + link check-in để tự hiện nút “Web check-in” ở trang Sắp bay (không cần sửa code).</p>

        {loading && <p className="text-gray-500">Đang tải…</p>}
        {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-700">{error}</div>}

        {!loading && !error && (
          <>
            {/* Hãng tự khai báo */}
            <div className="bg-white rounded-2xl shadow overflow-x-auto mb-6">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Tên hãng</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Mã</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Link check-in</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {airlines.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">Chưa có hãng tự khai báo. Bấm “Thêm hãng”.</td></tr>
                  ) : airlines.map((a) => (
                    <tr key={a.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{a.name}</td>
                      <td className="px-4 py-3 text-gray-500">{a.code || '—'}</td>
                      <td className="px-4 py-3">
                        <a href={a.checkin_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline max-w-[260px] truncate">
                          <ExternalLink size={13} /> <span className="truncate">{a.checkin_url}</span>
                        </a>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button onClick={() => openEdit(a)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"><Edit2 size={16} /></button>
                        <button onClick={() => remove(a)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Hãng mặc định (chỉ tham khảo) */}
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Hãng có sẵn (mặc định)</p>
            <div className="flex flex-wrap gap-2">
              {DEFAULT_AIRLINES.map((a) => (
                <a key={a.name} href={a.checkinUrl} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full bg-white border text-gray-600 hover:bg-gray-50">
                  <Plane size={12} /> {a.name}
                </a>
              ))}
            </div>
          </>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md my-8">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h3 className="text-lg font-bold">{editingId ? 'Sửa hãng' : 'Thêm hãng'}</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700"><X size={22} /></button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Tên hãng * <span className="text-xs text-gray-400">(khớp với ô “Hãng” khi nhập vé)</span></label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="VD: Sun PhuQuoc Airways" className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Mã hãng <span className="text-xs text-gray-400">(2 ký tự, tùy chọn)</span></label>
                <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="VD: SP" maxLength={3} className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Link check-in *</label>
                <input value={form.checkinUrl} onChange={(e) => setForm({ ...form, checkinUrl: e.target.value })} placeholder="https://www.sunphuquocairways.com/vn/en" className="w-full border rounded-lg px-3 py-2" />
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t px-6 py-4">
              <button onClick={() => setShowForm(false)} className="px-5 py-2 bg-gray-200 rounded-lg font-semibold text-sm">Huỷ</button>
              <button onClick={save} className="px-5 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm">Lưu</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmState}
        message={confirmState?.message}
        confirmText={confirmState?.confirmText}
        onCancel={closeConfirm}
        onConfirm={() => { confirmState?.onConfirm?.(); closeConfirm(); }}
      />
      <Toast toast={toast} />
    </div>
  );
}
