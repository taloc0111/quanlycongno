import React, { useEffect, useState } from 'react';
import { X, Trash2, Plus, Landmark, User } from 'lucide-react';
import VnDatePicker from './VnDatePicker';
import MoneyInput from './MoneyInput';
import { apiGet, apiSend } from '../services/client';
import { formatCurrency, formatDate } from '../utils/format';

/**
 * Modal lịch sử thanh toán cho 1 khoản nợ vé hoặc 1 hộ chiếu.
 * Props:
 *  - target: { type: 'debt'|'passport', id, name, total, paid }
 *  - onClose: () => void
 *  - onChanged: () => void   gọi sau khi thêm/xóa (để cha tải lại danh sách)
 */
export default function PaymentModal({ target, onClose, onChanged }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [method, setMethod] = useState('cash');
  const [paymentTarget, setPaymentTarget] = useState('self');
  const [saving, setSaving] = useState(false);

  const PARAM = { debt: 'debtId', passport: 'passportId', train: 'trainTicketId', tour: 'tourId' };
  const paramKey = PARAM[target.type] || 'debtId';
  const query = `${paramKey}=${target.id}`;
  const paidSum = payments.reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Number(target.total) - paidSum;

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setPayments(await apiGet(`/payments?${query}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [target.id]);

  const add = async () => {
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) { alert('⚠️ Nhập số tiền hợp lệ'); return; }
    setSaving(true);
    try {
      await apiSend('POST', '/payments', {
        [paramKey]: target.id,
        amount: amt, paymentDate: date || undefined, method,
        paymentTarget,
      });
      setAmount('');
      await load();
      onChanged?.();
    } catch (err) {
      alert('Lỗi: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!confirm('Xóa lần thanh toán này?')) return;
    try { await apiSend('DELETE', `/payments/${id}`); await load(); onChanged?.(); }
    catch (err) { alert('Lỗi: ' + err.message); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h3 className="text-lg font-bold">💵 Lịch sử thanh toán</h3>
            <p className="text-sm text-gray-500">{target.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={22} /></button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div className="bg-gray-50 rounded-lg py-2">
              <div className="text-gray-500">Tổng tiền</div>
              <div className="font-bold">{formatCurrency(target.total)}</div>
            </div>
            <div className="bg-green-50 rounded-lg py-2">
              <div className="text-gray-500">Đã trả</div>
              <div className="font-bold text-green-600">{formatCurrency(paidSum)}</div>
            </div>
            <div className="bg-red-50 rounded-lg py-2">
              <div className="text-gray-500">Còn nợ</div>
              <div className="font-bold text-red-600">{formatCurrency(remaining)}</div>
            </div>
          </div>

          {/* Thêm thanh toán */}
          <div className="flex flex-wrap gap-2 items-end border rounded-lg p-3 bg-gray-50">
            <div className="flex-1 min-w-[120px]">
              <label className="block text-xs text-gray-500 mb-1">Số tiền</label>
              <MoneyInput value={amount} onChange={setAmount} className="w-full border rounded-lg px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Ngày</label>
              <VnDatePicker value={date} onChange={setDate} className="border rounded-lg px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Hình thức</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm">
                <option value="cash">Tiền mặt</option>
                <option value="bank_transfer">Chuyển khoản</option>
                <option value="momo">Momo</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Chuyển vào TK</label>
              <select value={paymentTarget} onChange={(e) => setPaymentTarget(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm">
                <option value="self">TK cá nhân</option>
                <option value="agency">TK cấp trên (nộp quỹ)</option>
              </select>
            </div>
            <button onClick={add} disabled={saving} className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-semibold disabled:opacity-50">
              <Plus size={16} /> Thêm
            </button>
          </div>

          {/* Danh sách */}
          {loading && <p className="text-gray-500 text-sm">Đang tải…</p>}
          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
          {!loading && !error && (
            payments.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-3">Chưa có thanh toán nào.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-2 text-gray-600">{formatDate(p.payment_date)}</td>
                      <td className="py-2 text-gray-500">{p.method === 'bank_transfer' ? 'CK' : p.method === 'momo' ? 'Momo' : 'TM'}</td>
                      <td className="py-2">
                        {p.payment_target === 'agency'
                          ? <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700"><Landmark size={10} /> Cấp trên</span>
                          : <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700"><User size={10} /> Cá nhân</span>}
                      </td>
                      <td className="py-2 text-right font-semibold text-green-600">{formatCurrency(p.amount)}</td>
                      <td className="py-2 text-right">
                        <button onClick={() => remove(p.id)} className="text-red-500 p-1 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      </div>
    </div>
  );
}
