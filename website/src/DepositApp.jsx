import React, { useEffect, useState } from 'react';
import { Plus, Trash2, X, Landmark, Edit2, TrendingUp, TrendingDown, DollarSign, Users } from 'lucide-react';
import AgencyFilter from './components/AgencyFilter';
import VnDatePicker from './components/VnDatePicker';
import { apiGet, apiSend } from './services/client';
import { formatCurrency, formatDate } from './utils/format';
import { useAuth } from './auth/AuthContext';

const METHOD = { cash: 'Tiền mặt', bank_transfer: 'Chuyển khoản', momo: 'Momo' };
const EMPTY = { amount: '', depositDate: '', method: 'bank_transfer', notes: '' };

export default function DepositApp() {
  const { user } = useAuth();
  const currentUserId = user?.id;
  const [deposits, setDeposits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [agencyId, setAgencyId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [balance, setBalance] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [deps, bal] = await Promise.all([
        apiGet(`/deposits${agencyId ? `?agencyId=${agencyId}` : ''}`),
        apiGet('/deposits/balance'),
      ]);
      setDeposits(deps);
      setBalance(bal);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [agencyId]);

  const total = deposits.reduce((s, d) => s + Number(d.amount), 0);

  const openAdd = () => { setForm(EMPTY); setEditingId(null); setShowForm(true); };
  const openEdit = (d) => {
    setForm({
      amount: d.amount, depositDate: (d.deposit_date || '').slice(0, 10),
      method: d.method || 'bank_transfer', notes: d.notes || '',
    });
    setEditingId(d.id);
    setShowForm(true);
  };

  const save = async () => {
    if (!(parseFloat(form.amount) > 0)) { alert('⚠️ Nhập số tiền hợp lệ'); return; }
    try {
      if (editingId) await apiSend('PUT', `/deposits/${editingId}`, form);
      else await apiSend('POST', '/deposits', form);
      setShowForm(false);
      load();
    } catch (err) { alert('Lỗi: ' + err.message); }
  };

  const remove = async (id) => {
    if (!confirm('Xóa lần nộp quỹ này?')) return;
    try { await apiSend('DELETE', `/deposits/${id}`); load(); }
    catch (err) { alert('Lỗi: ' + err.message); }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><Landmark /> Nộp quỹ</h2>
          <div className="flex items-center gap-2">
            <AgencyFilter value={agencyId} onChange={setAgencyId} />
            <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold text-sm">
              <Plus size={18} /> Nộp quỹ
            </button>
          </div>
        </div>
        <p className="text-sm text-gray-500 mb-4">Ghi lại các lần nộp tiền lên cấp trên. Cấp 1 xem được các lần nộp của đại lý cấp dưới.</p>

        {/* Tổng quan số dư với cấp trên */}
        {balance && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div className="bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-2xl p-4 shadow">
              <p className="text-xs opacity-90 flex items-center gap-1"><DollarSign size={12} /> Tổng tiền vé (nợ cấp trên)</p>
              <p className="text-xl font-bold mt-1">{formatCurrency(balance.totalTicket)}</p>
            </div>
            <div className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-2xl p-4 shadow">
              <p className="text-xs opacity-90 flex items-center gap-1"><Landmark size={12} /> Đã nộp quỹ</p>
              <p className="text-xl font-bold mt-1">{formatCurrency(balance.totalDeposited)}</p>
            </div>
            <div className="bg-gradient-to-br from-orange-500 to-amber-600 text-white rounded-2xl p-4 shadow">
              <p className="text-xs opacity-90 flex items-center gap-1"><Users size={12} /> Khách trả thẳng cấp trên</p>
              <p className="text-xl font-bold mt-1">{formatCurrency(balance.totalCustomerToAgency)}</p>
            </div>
            <div className={`bg-gradient-to-br ${balance.balance >= 0 ? 'from-green-500 to-emerald-600' : 'from-red-500 to-rose-600'} text-white rounded-2xl p-4 shadow`}>
              <p className="text-xs opacity-90 flex items-center gap-1">
                {balance.balance >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {balance.balance >= 0 ? 'Dư' : 'Còn nợ cấp trên'}
              </p>
              <p className="text-xl font-bold mt-1">{formatCurrency(Math.abs(balance.balance))}</p>
            </div>
          </div>
        )}

        {/* Chi tiết khách trả vào TK cấp trên */}
        {balance && balance.agencyPayments && balance.agencyPayments.length > 0 && (
          <details className="mb-5 bg-orange-50 border border-orange-200 rounded-2xl">
            <summary className="px-5 py-3 cursor-pointer font-semibold text-orange-800 text-sm">
              Chi tiết khách trả thẳng vào TK cấp trên ({balance.agencyPayments.length} lần — {formatCurrency(balance.totalCustomerToAgency)})
            </summary>
            <div className="px-5 pb-4 overflow-auto max-h-60">
              <table className="min-w-full text-sm mt-2">
                <thead>
                  <tr className="text-left text-xs text-gray-500">
                    <th className="py-1">Ngày</th>
                    <th className="py-1">Khách hàng</th>
                    <th className="py-1">Mã vé</th>
                    <th className="py-1 text-right">Số tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {balance.agencyPayments.map((p) => (
                    <tr key={p.id} className="border-t border-orange-100">
                      <td className="py-1.5 text-gray-600">{formatDate(p.payment_date)}</td>
                      <td className="py-1.5 font-medium">{p.customer_name || '—'}</td>
                      <td className="py-1.5 text-gray-500">{p.ticket_code || '—'}</td>
                      <td className="py-1.5 text-right font-semibold text-orange-700">{formatCurrency(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}

        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-2xl p-5 shadow mb-5 inline-block min-w-[240px]">
          <p className="text-sm opacity-90">Tổng đã nộp {agencyId ? '(đại lý đã chọn)' : '(trong phạm vi)'}</p>
          <p className="text-2xl font-bold mt-1">{formatCurrency(total)}</p>
        </div>

        {loading && <p className="text-gray-500">Đang tải…</p>}
        {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-700">{error}</div>}

        {!loading && !error && (
          <div className="bg-white rounded-2xl shadow overflow-auto max-h-[70vh]">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 z-10 [&_th]:bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 sticky left-0 z-20">Ngày nộp</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600">Số tiền</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Hình thức</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 hidden md:table-cell">Đại lý</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Ghi chú</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {deposits.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Chưa có lần nộp quỹ nào.</td></tr>
                ) : deposits.map((d) => {
                  const owned = !currentUserId || d.user_id === currentUserId;
                  return (
                    <tr key={d.id} className="border-t hover:bg-gray-50 group">
                      <td className="px-4 py-3 font-medium text-gray-800 sticky left-0 z-10 bg-white group-hover:bg-gray-50">{formatDate(d.deposit_date)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-600">{formatCurrency(d.amount)}</td>
                      <td className="px-4 py-3 text-gray-600">{METHOD[d.method] || d.method || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs hidden md:table-cell">{d.owner_name || d.owner_username || ''}</td>
                      <td className="px-4 py-3 text-gray-600">{d.notes || ''}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {owned ? (
                          <>
                            <button onClick={() => openEdit(d)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"><Edit2 size={16} /></button>
                            <button onClick={() => remove(d.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                          </>
                        ) : (
                          <span className="text-xs text-gray-400 italic">Chỉ xem</span>
                        )}
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
              <h3 className="text-lg font-bold">{editingId ? 'Sửa lần nộp quỹ' : 'Ghi nhận nộp quỹ'}</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700"><X size={22} /></button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Số tiền *</label>
                <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Ngày nộp</label>
                <VnDatePicker value={form.depositDate} onChange={(v) => setForm({ ...form, depositDate: v })} />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Hình thức</label>
                <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className="w-full border rounded-lg px-3 py-2">
                  <option value="bank_transfer">Chuyển khoản</option>
                  <option value="cash">Tiền mặt</option>
                  <option value="momo">Momo</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Ghi chú</label>
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full border rounded-lg px-3 py-2" placeholder="VD: Nộp quỹ tháng 4" />
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t px-6 py-4">
              <button onClick={() => setShowForm(false)} className="px-5 py-2 bg-gray-200 rounded-lg font-semibold text-sm">Huỷ</button>
              <button onClick={save} className="px-5 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm">Lưu</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
