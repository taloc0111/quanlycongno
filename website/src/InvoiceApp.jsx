import React, { useEffect, useState } from 'react';
import { Plus, Trash2, X, FileText, Eye } from 'lucide-react';
import AgencyFilter from './components/AgencyFilter';
import { apiGet, apiSend } from './services/client';
import { formatCurrency, formatDate } from './utils/format';
import { useAuth } from './auth/AuthContext';
import { useSort } from './hooks/useSort';

const STATUS = {
  unpaid: { label: 'Chưa thu', cls: 'bg-red-100 text-red-700' },
  partial: { label: 'Thu một phần', cls: 'bg-amber-100 text-amber-700' },
  paid: { label: 'Đã thu đủ', cls: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Đã huỷ', cls: 'bg-gray-200 text-gray-600' },
};

const emptyItem = () => ({ description: '', quantity: 1, unitPrice: '' });

export default function InvoiceApp() {
  const { user } = useAuth();
  const currentUserId = user?.id;
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [agencyId, setAgencyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({
    invoiceNumber: '', customerId: '', issueDate: '', dueDate: '', taxAmount: '', notes: '',
    items: [emptyItem()],
  });
  const sorter = useSort();
  const sortedInvoices = sorter.sort(invoices, (i, k) =>
    k === 'invoice_number' ? (i.invoice_number || '').toLowerCase()
      : k === 'issue_date' ? (i.issue_date || '')
      : k === 'total_amount' ? Number(i.total_amount) || 0 : '');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [inv, cus] = await Promise.all([
        apiGet(`/invoices${agencyId ? `?agencyId=${agencyId}` : ''}`),
        apiGet('/customers'),
      ]);
      setInvoices(inv);
      setCustomers(cus);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [agencyId]);

  const subtotal = form.items.reduce(
    (s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unitPrice) || 0), 0
  );
  const total = subtotal + (parseFloat(form.taxAmount) || 0);

  const openAdd = () => {
    setForm({ invoiceNumber: '', customerId: '', issueDate: '', dueDate: '', taxAmount: '', notes: '', items: [emptyItem()] });
    setShowForm(true);
  };

  const updateItem = (i, key, val) => {
    const items = form.items.map((it, idx) => (idx === i ? { ...it, [key]: val } : it));
    setForm({ ...form, items });
  };

  const save = async () => {
    if (!form.invoiceNumber.trim()) { alert('⚠️ Nhập số hóa đơn'); return; }
    if (form.items.every((it) => !it.description.trim())) { alert('⚠️ Cần ít nhất 1 dòng có mô tả'); return; }
    try {
      await apiSend('POST', '/invoices', {
        ...form,
        customerId: form.customerId || null,
        items: form.items.filter((it) => it.description.trim()),
      });
      setShowForm(false);
      load();
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  };

  const changeStatus = async (id, status) => {
    try { await apiSend('PUT', `/invoices/${id}`, { status }); load(); }
    catch (err) { alert('Lỗi: ' + err.message); }
  };

  const remove = async (id) => {
    if (!confirm('Xóa hóa đơn này?')) return;
    try { await apiSend('DELETE', `/invoices/${id}`); load(); }
    catch (err) { alert('Lỗi: ' + err.message); }
  };

  const view = async (id) => {
    try { setDetail(await apiGet(`/invoices/${id}`)); }
    catch (err) { alert('Lỗi: ' + err.message); }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-6">
          <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><FileText /> Hóa đơn</h2>
          <div className="flex items-center gap-2">
            <AgencyFilter value={agencyId} onChange={setAgencyId} />
            <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-sm">
              <Plus size={18} /> Tạo hóa đơn
            </button>
          </div>
        </div>

        {loading && <p className="text-gray-500">Đang tải…</p>}
        {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-700">{error}</div>}

        {!loading && !error && (
          <div className="bg-white rounded-2xl shadow overflow-auto max-h-[70vh]">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 z-10 [&_th]:bg-gray-50">
                <tr>
                  <th onClick={() => sorter.toggle('invoice_number')} className="px-4 py-3 text-left font-semibold text-gray-600 sticky left-0 z-20 cursor-pointer select-none hover:bg-gray-100">Số HĐ{sorter.arrow('invoice_number')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Khách hàng</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 hidden md:table-cell">Đại lý</th>
                  <th onClick={() => sorter.toggle('issue_date')} className="px-4 py-3 text-left font-semibold text-gray-600 cursor-pointer select-none hover:bg-gray-100">Ngày{sorter.arrow('issue_date')}</th>
                  <th onClick={() => sorter.toggle('total_amount')} className="px-4 py-3 text-right font-semibold text-gray-600 cursor-pointer select-none hover:bg-gray-100">Tổng tiền{sorter.arrow('total_amount')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Trạng thái</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {sortedInvoices.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Chưa có hóa đơn.</td></tr>
                ) : sortedInvoices.map((inv) => {
                  const owned = !currentUserId || inv.user_id === currentUserId;
                  return (
                  <tr key={inv.id} className="border-t hover:bg-gray-50 group">
                    <td className="px-4 py-3 font-medium text-gray-800 sticky left-0 z-10 bg-white group-hover:bg-gray-50">
                      <span onClick={() => view(inv.id)} title="Bấm để xem" className="cursor-pointer hover:underline text-blue-700">{inv.invoice_number}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{inv.customer_name || inv.company_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs hidden md:table-cell">{inv.owner_name || ''}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(inv.issue_date)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatCurrency(inv.total_amount)}</td>
                    <td className="px-4 py-3">
                      {owned ? (
                        <select
                          value={inv.status}
                          onChange={(e) => changeStatus(inv.id, e.target.value)}
                          className={`text-xs font-semibold rounded-full px-2 py-1 border-0 cursor-pointer ${STATUS[inv.status]?.cls || ''}`}
                        >
                          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                      ) : (
                        <span className={`text-xs font-semibold rounded-full px-2 py-1 ${STATUS[inv.status]?.cls || ''}`}>{STATUS[inv.status]?.label}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => view(inv.id)} className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"><Eye size={16} /></button>
                      {owned && <button onClick={() => remove(inv.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h3 className="text-lg font-bold">Tạo hóa đơn</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700"><X size={22} /></button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Số hóa đơn *</label>
                  <input value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Khách hàng</label>
                  <select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} className="w-full border rounded-lg px-3 py-2">
                    <option value="">— chọn —</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Ngày lập</label>
                  <input type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Hạn thanh toán</label>
                  <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">Chi tiết</label>
                  <button onClick={() => setForm({ ...form, items: [...form.items, emptyItem()] })} className="text-sm text-blue-600 font-semibold">+ Thêm dòng</button>
                </div>
                <div className="space-y-2">
                  {form.items.map((it, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input placeholder="Mô tả" value={it.description} onChange={(e) => updateItem(i, 'description', e.target.value)} className="flex-1 border rounded-lg px-2 py-1.5 text-sm" />
                      <input type="number" placeholder="SL" value={it.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)} className="w-16 border rounded-lg px-2 py-1.5 text-sm" />
                      <input type="number" placeholder="Đơn giá" value={it.unitPrice} onChange={(e) => updateItem(i, 'unitPrice', e.target.value)} className="w-32 border rounded-lg px-2 py-1.5 text-sm" />
                      <button onClick={() => setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) })} className="text-red-500 p-1"><X size={16} /></button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-6 text-sm">
                <div className="text-right">
                  <div className="text-gray-500">Tạm tính: <span className="font-semibold text-gray-800">{formatCurrency(subtotal)}</span></div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-gray-500">Thuế:</span>
                    <input type="number" value={form.taxAmount} onChange={(e) => setForm({ ...form, taxAmount: e.target.value })} className="w-28 border rounded-lg px-2 py-1 text-right" />
                  </div>
                  <div className="text-base mt-1 font-bold text-gray-900">Tổng: {formatCurrency(total)}</div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t px-6 py-4">
              <button onClick={() => setShowForm(false)} className="px-5 py-2 bg-gray-200 rounded-lg font-semibold text-sm">Huỷ</button>
              <button onClick={save} className="px-5 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm">Lưu</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl my-8">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h3 className="text-lg font-bold">Hóa đơn {detail.invoice_number}</h3>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-700"><X size={22} /></button>
            </div>
            <div className="px-6 py-4 space-y-3 text-sm">
              <p><b>Khách hàng:</b> {detail.customer_name || detail.company_name || '—'}</p>
              <p><b>Ngày lập:</b> {formatDate(detail.issue_date)} · <b>Hạn:</b> {formatDate(detail.due_date) || '—'}</p>
              <table className="w-full mt-2">
                <thead className="bg-gray-50">
                  <tr><th className="px-2 py-1 text-left">Mô tả</th><th className="px-2 py-1 text-right">SL</th><th className="px-2 py-1 text-right">Đơn giá</th><th className="px-2 py-1 text-right">Thành tiền</th></tr>
                </thead>
                <tbody>
                  {detail.items?.map((it) => (
                    <tr key={it.id} className="border-t">
                      <td className="px-2 py-1">{it.description}</td>
                      <td className="px-2 py-1 text-right">{it.quantity}</td>
                      <td className="px-2 py-1 text-right">{formatCurrency(it.unit_price)}</td>
                      <td className="px-2 py-1 text-right">{formatCurrency(it.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-right space-y-1 pt-2">
                <div>Tạm tính: {formatCurrency(detail.subtotal)}</div>
                <div>Thuế: {formatCurrency(detail.tax_amount)}</div>
                <div className="font-bold text-base">Tổng: {formatCurrency(detail.total_amount)}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
