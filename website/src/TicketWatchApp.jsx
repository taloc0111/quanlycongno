import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Edit2, Trash2, X, PlaneTakeoff, Search, Ticket } from 'lucide-react';
import VnDatePicker from './components/VnDatePicker';
import MoneyInput from './components/MoneyInput';
import ConfirmDialog from './components/ConfirmDialog';
import Toast from './components/Toast';
import { apiGet, apiSend } from './services/client';
import { formatCurrency } from './utils/format';
import { useToast, useConfirm } from './hooks/useFeedback';

const STATUS = {
  watching: { label: 'Đang canh', cls: 'bg-blue-100 text-blue-700' },
  quoted: { label: 'Đã báo giá', cls: 'bg-amber-100 text-amber-700' },
  booked: { label: 'Đã đặt', cls: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Hủy', cls: 'bg-gray-200 text-gray-500' },
};
const EMPTY = {
  customerName: '', phoneNumber: '', route: '', departDate: '', returnDate: '',
  airline: '', pax: '1', targetPrice: '', status: 'watching', notes: '',
};

const fmtDate = (s) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');
// Số ngày từ hôm nay tới ngày đi (âm = đã qua).
const daysUntil = (s) => {
  if (!s) return null;
  const d = new Date(s.slice(0, 10));
  const today = new Date(new Date().toISOString().slice(0, 10));
  return Math.round((d - today) / 86400000);
};

export default function TicketWatchApp() {
  const [watches, setWatches] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('active'); // active = watching+quoted
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [booking, setBooking] = useState(null); // { watch, ticketAmount, costAmount }
  const { toast, showToast } = useToast();
  const { confirmState, askConfirm, closeConfirm } = useConfirm();

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setWatches(await apiGet('/ticket-watches'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    apiGet('/customers').then(setCustomers).catch(() => {});
    apiGet('/routes').then(setRoutes).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return watches.filter((w) => {
      const matchText = !q || w.customer_name?.toLowerCase().includes(q)
        || w.phone_number?.includes(q) || w.route?.toLowerCase().includes(q);
      const matchStatus = filterStatus === 'all' ? true
        : filterStatus === 'active' ? (w.status === 'watching' || w.status === 'quoted')
        : w.status === filterStatus;
      return matchText && matchStatus;
    });
  }, [watches, search, filterStatus]);

  const openAdd = () => { setForm(EMPTY); setEditingId(null); setShowForm(true); };
  const openEdit = (w) => {
    setForm({
      customerName: w.customer_name || '', phoneNumber: w.phone_number || '', route: w.route || '',
      departDate: (w.depart_date || '').slice(0, 10), returnDate: (w.return_date || '').slice(0, 10),
      airline: w.airline || '', pax: String(w.pax || 1), targetPrice: w.target_price || '',
      status: w.status || 'watching', notes: w.notes || '',
    });
    setEditingId(w.id);
    setShowForm(true);
  };

  // Khi gõ/chọn tên khách trùng danh bạ → tự điền SĐT nếu đang trống.
  const onCustomerName = (name) => {
    const hit = customers.find((c) => c.name === name);
    setForm((f) => ({ ...f, customerName: name, phoneNumber: f.phoneNumber || hit?.phone || '' }));
  };

  const save = async () => {
    if (!form.customerName.trim()) { showToast('Nhập tên khách hàng', 'error'); return; }
    try {
      if (editingId) await apiSend('PUT', `/ticket-watches/${editingId}`, form);
      else await apiSend('POST', '/ticket-watches', form);
      setShowForm(false);
      showToast(editingId ? 'Cập nhật yêu cầu canh vé' : 'Đã thêm yêu cầu canh vé');
      load();
    } catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
  };

  const setStatus = async (w, status) => {
    try {
      await apiSend('PUT', `/ticket-watches/${w.id}`, { status });
      load();
    } catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
  };

  const remove = (w) => {
    askConfirm(`Xóa yêu cầu canh vé của "${w.customer_name}"?`, async () => {
      try { await apiSend('DELETE', `/ticket-watches/${w.id}`); showToast('Đã xóa'); load(); }
      catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
    });
  };

  // "Đã đặt" → mở modal tạo công nợ vé đã điền sẵn.
  const openBooking = (w) => setBooking({ watch: w, ticketAmount: w.target_price || '', costAmount: '' });

  const confirmBooking = async () => {
    const { watch, ticketAmount, costAmount } = booking;
    if (!(parseFloat(ticketAmount) > 0)) { showToast('Nhập giá vé bán hợp lệ', 'error'); return; }
    try {
      await apiSend('POST', '/debts', {
        customerName: watch.customer_name,
        phoneNumber: watch.phone_number || '',
        route: watch.route || '',
        flightDate: watch.depart_date || null,
        ticketAmount: parseFloat(ticketAmount) || 0,
        costAmount: parseFloat(costAmount) || 0,
        paid: 0,
        notes: 'Từ canh vé',
      });
      await apiSend('PUT', `/ticket-watches/${watch.id}`, { status: 'booked' });
      setBooking(null);
      showToast('Đã tạo công nợ vé + đánh dấu Đã đặt');
      load();
    } catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
  };

  const FILTERS = [
    { key: 'active', label: 'Đang theo dõi' },
    { key: 'booked', label: 'Đã đặt' },
    { key: 'cancelled', label: 'Hủy' },
    { key: 'all', label: 'Tất cả' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><PlaneTakeoff /> Canh vé</h2>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-sm">
            <Plus size={18} /> Thêm canh vé
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm khách, SĐT, hành trình…"
              className="w-full pl-10 pr-4 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="flex gap-1 bg-white border-2 border-gray-200 rounded-lg p-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilterStatus(f.key)}
                className={`px-3 py-1.5 rounded-md text-sm font-semibold transition ${filterStatus === f.key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {loading && <p className="text-gray-500">Đang tải…</p>}
        {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-700">{error}</div>}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center text-gray-400 py-16">
            <Ticket size={48} className="mx-auto mb-3 opacity-40" />
            <p>Chưa có yêu cầu canh vé nào. Bấm <b>Thêm canh vé</b> để tạo.</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((w) => {
            const d = daysUntil(w.depart_date);
            const active = w.status === 'watching' || w.status === 'quoted';
            // Tô viền theo độ gấp (chỉ với yêu cầu còn theo dõi).
            const urgency = !active || d === null ? 'border-gray-200'
              : d < 0 ? 'border-gray-300'
              : d <= 2 ? 'border-red-400'
              : d <= 6 ? 'border-amber-400'
              : 'border-emerald-300';
            const urgencyText = d === null ? '' : d < 0 ? `${-d} ngày trước` : d === 0 ? 'Hôm nay' : `còn ${d} ngày`;
            const urgencyCls = d === null ? '' : d < 0 ? 'text-gray-400' : d <= 2 ? 'text-red-600' : d <= 6 ? 'text-amber-600' : 'text-emerald-600';
            return (
              <div key={w.id} className={`bg-white rounded-xl border-2 ${urgency} shadow-sm p-4 flex flex-col`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 truncate">{w.customer_name}</p>
                    {w.phone_number && <p className="text-xs text-gray-500">{w.phone_number}</p>}
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 ${STATUS[w.status]?.cls}`}>{STATUS[w.status]?.label}</span>
                </div>

                <div className="flex items-center gap-2 text-sm text-gray-700 mb-1">
                  <PlaneTakeoff size={15} className="text-blue-500 shrink-0" />
                  <span className="font-semibold">{w.route || '—'}</span>
                  {w.airline && <span className="text-xs text-gray-400">· {w.airline}</span>}
                </div>
                <p className="text-sm text-gray-600">
                  {fmtDate(w.depart_date) || '—'}{w.return_date ? ` → ${fmtDate(w.return_date)}` : ''}
                  {w.pax > 1 && <span className="text-gray-400"> · {w.pax} khách</span>}
                  {active && urgencyText && <span className={`ml-2 font-semibold ${urgencyCls}`}>({urgencyText})</span>}
                </p>
                <p className="text-sm mt-1">Giá mong muốn: <span className="font-semibold text-gray-900">{Number(w.target_price) > 0 ? formatCurrency(w.target_price) : '—'}</span></p>
                {w.notes && <p className="text-xs text-gray-500 mt-1 italic">{w.notes}</p>}

                <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t">
                  {active && (
                    <>
                      {w.status === 'watching' && (
                        <button onClick={() => setStatus(w, 'quoted')} className="px-2 py-1 rounded-md bg-amber-100 text-amber-700 text-xs font-semibold hover:bg-amber-200">Đã báo giá</button>
                      )}
                      <button onClick={() => openBooking(w)} className="px-2 py-1 rounded-md bg-green-600 text-white text-xs font-semibold hover:bg-green-700">Đã đặt → tạo công nợ</button>
                      <button onClick={() => setStatus(w, 'cancelled')} className="px-2 py-1 rounded-md bg-gray-100 text-gray-600 text-xs font-semibold hover:bg-gray-200">Hủy</button>
                    </>
                  )}
                  {!active && (
                    <button onClick={() => setStatus(w, 'watching')} className="px-2 py-1 rounded-md bg-blue-100 text-blue-700 text-xs font-semibold hover:bg-blue-200">Canh lại</button>
                  )}
                  <div className="ml-auto flex gap-1">
                    <button onClick={() => openEdit(w)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="Sửa"><Edit2 size={15} /></button>
                    <button onClick={() => remove(w)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg" title="Xóa"><Trash2 size={15} /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Form thêm/sửa */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h3 className="text-lg font-bold">{editingId ? 'Sửa canh vé' : 'Thêm canh vé'}</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700"><X size={22} /></button>
            </div>
            <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Tên khách hàng *</label>
                <input list="tw-customers" value={form.customerName} onChange={(e) => onCustomerName(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
                <datalist id="tw-customers">{customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Số điện thoại</label>
                <input value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Hành trình</label>
                <input list="tw-routes" value={form.route} onChange={(e) => setForm({ ...form, route: e.target.value })} placeholder="VD: SGN-HAN" className="w-full border rounded-lg px-3 py-2" />
                <datalist id="tw-routes">{routes.map((r) => <option key={r} value={r} />)}</datalist>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Hãng (tùy chọn)</label>
                <input value={form.airline} onChange={(e) => setForm({ ...form, airline: e.target.value })} placeholder="VD: Vietjet" className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Ngày đi</label>
                <VnDatePicker value={form.departDate} onChange={(v) => setForm({ ...form, departDate: v })} />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Ngày về <span className="text-xs text-gray-400">(khứ hồi)</span></label>
                <VnDatePicker value={form.returnDate} onChange={(v) => setForm({ ...form, returnDate: v })} />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Số khách</label>
                <input type="number" min="1" value={form.pax} onChange={(e) => setForm({ ...form, pax: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Giá mong muốn</label>
                <MoneyInput value={form.targetPrice} onChange={(v) => setForm({ ...form, targetPrice: v })} className="w-full border rounded-lg px-3 py-2" placeholder="VD: 2.000.000" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm text-gray-600 mb-1">Trạng thái</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full border rounded-lg px-3 py-2">
                  {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm text-gray-600 mb-1">Ghi chú</label>
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="VD: khách muốn bay sáng, giá dưới 2tr" className="w-full border rounded-lg px-3 py-2" />
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t px-6 py-4">
              <button onClick={() => setShowForm(false)} className="px-5 py-2 bg-gray-200 rounded-lg font-semibold text-sm">Huỷ</button>
              <button onClick={save} className="px-5 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm">Lưu</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal tạo công nợ khi đặt được vé */}
      {booking && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md my-8">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h3 className="text-lg font-bold">Tạo công nợ vé</h3>
              <button onClick={() => setBooking(null)} className="text-gray-400 hover:text-gray-700"><X size={22} /></button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <p className="text-sm text-gray-600">
                <b>{booking.watch.customer_name}</b> · {booking.watch.route || '—'} · {fmtDate(booking.watch.depart_date) || '—'}
              </p>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Giá vé bán *</label>
                <MoneyInput value={booking.ticketAmount} onChange={(v) => setBooking({ ...booking, ticketAmount: v })} className="w-full border rounded-lg px-3 py-2" placeholder="Giá bán cho khách" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Giá gốc (tùy chọn)</label>
                <MoneyInput value={booking.costAmount} onChange={(v) => setBooking({ ...booking, costAmount: v })} className="w-full border rounded-lg px-3 py-2" placeholder="Giá nhập vé" />
              </div>
              <p className="text-xs text-gray-400">Sẽ tạo 1 dòng trong Công nợ vé và đánh dấu yêu cầu là “Đã đặt”.</p>
            </div>
            <div className="flex justify-end gap-3 border-t px-6 py-4">
              <button onClick={() => setBooking(null)} className="px-5 py-2 bg-gray-200 rounded-lg font-semibold text-sm">Huỷ</button>
              <button onClick={confirmBooking} className="px-5 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm">Tạo công nợ</button>
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
