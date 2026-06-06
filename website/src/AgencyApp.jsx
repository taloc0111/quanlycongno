import React, { useEffect, useState } from 'react';
import { Plus, Trash2, X, Network, Edit2, CalendarClock } from 'lucide-react';
import { apiGet, apiSend } from './services/client';
import { formatCurrency } from './utils/format';
import { useAuth } from './auth/AuthContext';
import ConfirmDialog from './components/ConfirmDialog';
import Toast from './components/Toast';
import { useToast, useConfirm } from './hooks/useFeedback';

const ROLE_LABEL = { admin: 'Quản trị', agency: 'Đại lý cấp 1', user: 'Đại lý cấp 2' };
const EMPTY = { username: '', password: '', fullName: '', email: '', role: 'user' };

// Trạng thái dùng thử hiển thị từ trial_ends_at.
const trialInfo = (u) => {
  if (!u.trial_ends_at) return { text: 'Không giới hạn', cls: 'bg-green-100 text-green-700' };
  const days = Math.ceil((new Date(u.trial_ends_at).getTime() - Date.now()) / 86400000);
  if (days <= 0) return { text: 'Hết hạn', cls: 'bg-red-100 text-red-700' };
  return { text: `Còn ${days} ngày`, cls: days <= 3 ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700' };
};

export default function AgencyApp() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [trialUser, setTrialUser] = useState(null); // user đang mở modal quản lý dùng thử
  const { toast, showToast } = useToast();
  const { confirmState, askConfirm, closeConfirm } = useConfirm();

  const load = async () => {
    setLoading(true); setError('');
    try { setUsers(await apiGet('/users')); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openAdd = () => { setForm(EMPTY); setEditingId(null); setShowForm(true); };
  const openEdit = (u) => {
    setForm({ username: u.username, password: '', fullName: u.full_name || '', email: u.email || '', role: u.role });
    setEditingId(u.id);
    setShowForm(true);
  };

  const save = async () => {
    if (!editingId && (!form.username.trim() || !form.password)) { showToast('Cần tên đăng nhập và mật khẩu', 'error'); return; }
    try {
      if (editingId) {
        await apiSend('PUT', `/users/${editingId}`, { fullName: form.fullName, email: form.email, role: isAdmin ? form.role : undefined });
      } else {
        await apiSend('POST', '/users', form);
      }
      setShowForm(false);
      showToast(editingId ? 'Cập nhật tài khoản thành công' : 'Đã thêm đại lý');
      load();
    } catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
  };

  const remove = (u) => {
    askConfirm(`Xóa đại lý "${u.username}"? Toàn bộ dữ liệu (công nợ, hộ chiếu...) của họ cũng bị xóa.`, async () => {
      try { await apiSend('DELETE', `/users/${u.id}`); showToast('Đã xóa tài khoản'); load(); }
      catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
    });
  };

  // Gia hạn / mở khoá / thu hồi dùng thử cho 1 tài khoản.
  const applyTrial = async (action, days) => {
    try {
      await apiSend('PUT', `/users/${trialUser.id}/trial`, { action, days });
      setTrialUser(null);
      showToast('Đã cập nhật hạn dùng thử');
      load();
    } catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><Network /> Đại lý cấp dưới</h2>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-sm">
            <Plus size={18} /> Thêm đại lý
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-5">
          {isAdmin ? 'Bạn là quản trị viên — quản lý tất cả tài khoản.' : 'Các đại lý cấp dưới bạn quản lý. Bạn xem được công nợ của họ (chỉ xem).'}
        </p>

        {loading && <p className="text-gray-500">Đang tải…</p>}
        {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-700">{error}</div>}

        {!loading && !error && (
          <div className="bg-white rounded-2xl shadow overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Tên đăng nhập</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Họ tên</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Vai trò</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Dùng thử</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600">Công nợ</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Chưa có đại lý cấp dưới nào.</td></tr>
                ) : users.map((u) => {
                  const t = trialInfo(u);
                  return (
                  <tr key={u.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">{u.username}</td>
                    <td className="px-4 py-3 text-gray-600">{u.full_name || '—'}</td>
                    <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-semibold">{ROLE_LABEL[u.role] || u.role}</span></td>
                    <td className="px-4 py-3">
                      <button onClick={() => setTrialUser(u)} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold hover:opacity-80 ${t.cls}`} title="Quản lý dùng thử">
                        <CalendarClock size={12} /> {t.text}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-red-600">{formatCurrency(u.outstanding)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(u)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"><Edit2 size={16} /></button>
                      <button onClick={() => remove(u)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md my-8">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h3 className="text-lg font-bold">{editingId ? 'Sửa đại lý' : 'Thêm đại lý cấp dưới'}</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700"><X size={22} /></button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Tên đăng nhập *</label>
                <input value={form.username} disabled={!!editingId} onChange={(e) => setForm({ ...form, username: e.target.value })} className="w-full border rounded-lg px-3 py-2 disabled:bg-gray-100" />
              </div>
              {!editingId && (
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Mật khẩu * (≥ 6 ký tự)</label>
                  <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
                </div>
              )}
              <div>
                <label className="block text-sm text-gray-600 mb-1">Họ và tên</label>
                <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              </div>
              {isAdmin && (
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Vai trò</label>
                  <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full border rounded-lg px-3 py-2">
                    <option value="user">Đại lý cấp 2 / Nhân viên</option>
                    <option value="agency">Đại lý cấp 1</option>
                    <option value="admin">Quản trị</option>
                  </select>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 border-t px-6 py-4">
              <button onClick={() => setShowForm(false)} className="px-5 py-2 bg-gray-200 rounded-lg font-semibold text-sm">Huỷ</button>
              <button onClick={save} className="px-5 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm">Lưu</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal quản lý dùng thử */}
      {trialUser && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md my-8">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h3 className="text-lg font-bold flex items-center gap-2"><CalendarClock size={20} /> Dùng thử — {trialUser.username}</h3>
              <button onClick={() => setTrialUser(null)} className="text-gray-400 hover:text-gray-700"><X size={22} /></button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <p className="text-sm">
                Trạng thái hiện tại:{' '}
                <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-semibold ${trialInfo(trialUser).cls}`}>{trialInfo(trialUser).text}</span>
                {trialUser.trial_ends_at && (
                  <span className="text-gray-400 text-xs"> · đến {new Date(trialUser.trial_ends_at).toLocaleDateString('vi-VN')}</span>
                )}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => applyTrial('extend', 30)} className="px-3 py-2 rounded-lg bg-blue-50 text-blue-700 font-semibold text-sm hover:bg-blue-100">+ 1 tháng</button>
                <button onClick={() => applyTrial('extend', 365)} className="px-3 py-2 rounded-lg bg-blue-50 text-blue-700 font-semibold text-sm hover:bg-blue-100">+ 1 năm</button>
                <button onClick={() => applyTrial('unlimited')} className="px-3 py-2 rounded-lg bg-green-600 text-white font-semibold text-sm hover:bg-green-700">Không giới hạn</button>
                <button
                  onClick={() => askConfirm(`Thu hồi quyền dùng thử của "${trialUser.username}" ngay bây giờ?`, () => applyTrial('revoke'), { confirmText: 'Thu hồi' })}
                  className="px-3 py-2 rounded-lg bg-red-50 text-red-700 font-semibold text-sm hover:bg-red-100"
                >
                  Thu hồi (khoá ngay)
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Gia hạn cộng dồn vào số ngày còn lại. Người dùng cần <b>đăng nhập lại</b> để áp dụng hạn mới (token làm mới mỗi lần đăng nhập).
              </p>
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
