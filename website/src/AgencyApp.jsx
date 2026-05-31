import React, { useEffect, useState } from 'react';
import { Plus, Trash2, X, Network, Edit2 } from 'lucide-react';
import { apiGet, apiSend } from './services/client';
import { formatCurrency } from './utils/format';
import { useAuth } from './auth/AuthContext';

const ROLE_LABEL = { admin: 'Quản trị', agency: 'Đại lý cấp 1', user: 'Đại lý cấp 2' };
const EMPTY = { username: '', password: '', fullName: '', email: '', role: 'user' };

export default function AgencyApp() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);

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
    if (!editingId && (!form.username.trim() || !form.password)) { alert('⚠️ Cần tên đăng nhập và mật khẩu'); return; }
    try {
      if (editingId) {
        await apiSend('PUT', `/users/${editingId}`, { fullName: form.fullName, email: form.email, role: isAdmin ? form.role : undefined });
      } else {
        await apiSend('POST', '/users', form);
      }
      setShowForm(false); load();
    } catch (err) { alert('Lỗi: ' + err.message); }
  };

  const remove = async (u) => {
    if (!confirm(`Xóa đại lý "${u.username}"? Toàn bộ dữ liệu (công nợ, hộ chiếu...) của họ cũng bị xóa.`)) return;
    try { await apiSend('DELETE', `/users/${u.id}`); load(); }
    catch (err) { alert('Lỗi: ' + err.message); }
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
                  <th className="px-4 py-3 text-right font-semibold text-gray-600">Công nợ</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Chưa có đại lý cấp dưới nào.</td></tr>
                ) : users.map((u) => (
                  <tr key={u.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">{u.username}</td>
                    <td className="px-4 py-3 text-gray-600">{u.full_name || '—'}</td>
                    <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-semibold">{ROLE_LABEL[u.role] || u.role}</span></td>
                    <td className="px-4 py-3 text-right font-semibold text-red-600">{formatCurrency(u.outstanding)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(u)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"><Edit2 size={16} /></button>
                      <button onClick={() => remove(u)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ))}
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
    </div>
  );
}
