import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Edit2, Trash2, X, Search, Download, Train, DollarSign, Eye, Landmark } from 'lucide-react';
import AgencyFilter from './components/AgencyFilter';
import VnDatePicker from './components/VnDatePicker';
import MoneyInput from './components/MoneyInput';
import PaymentModal from './components/PaymentModal';
import ConfirmDialog from './components/ConfirmDialog';
import Toast from './components/Toast';
import { apiGet, apiSend } from './services/client';
import { formatCurrency, formatDate } from './utils/format';
import { exportWorkbook } from './utils/excel';
import { useAuth } from './auth/AuthContext';
import { useToast, useConfirm } from './hooks/useFeedback';

const SEAT_CLASSES = ['Ngồi mềm', 'Ngồi cứng', 'Giường nằm khoang 4', 'Giường nằm khoang 6', 'Ghế phụ'];
const EMPTY = {
  customerName: '', phoneNumber: '', trainNo: '', route: '', seatClass: '',
  departDate: '', issueDate: '', dueDate: '', ticketSource: '',
  ticketAmount: '', costAmount: '', paid: '', notes: '', companyId: '', paymentTarget: 'self',
};

// Cột có thể ẩn/hiện (4 cột lõi luôn hiện: Khách, Số tàu, Hành trình, Ngày đi).
const TOGGLE_COLS = [
  { key: 'seat_class', label: 'Loại chỗ' },
  { key: 'ticket_source', label: 'Nguồn vé' },
  { key: 'issue_date', label: 'Ngày xuất' },
  { key: 'ticket_amount', label: 'Giá bán' },
  { key: 'cost_amount', label: 'Giá gốc' },
  { key: 'profit', label: 'Lợi nhuận' },
  { key: 'paid', label: 'Đã trả' },
  { key: 'remaining', label: 'Còn nợ' },
  { key: 'company', label: 'Công ty' },
];
const DEFAULT_VISIBLE = {
  seat_class: true, ticket_source: false, issue_date: false, ticket_amount: true,
  cost_amount: true, profit: true, paid: true, remaining: true, company: false,
};
const PAGE_SIZE = 50;
const today = () => new Date().toISOString().slice(0, 10);

export default function TrainApp() {
  const { user } = useAuth();
  const currentUserId = user?.id;
  const [tickets, setTickets] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [agencyId, setAgencyId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [paying, setPaying] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [sortBy, setSortBy] = useState('');
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);
  const [showColMenu, setShowColMenu] = useState(false);
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('trainVisibleCols') || 'null');
      return saved ? { ...DEFAULT_VISIBLE, ...saved } : DEFAULT_VISIBLE;
    } catch { return DEFAULT_VISIBLE; }
  });
  const { toast, showToast } = useToast();
  const { confirmState, askConfirm, closeConfirm } = useConfirm();

  useEffect(() => { localStorage.setItem('trainVisibleCols', JSON.stringify(visibleCols)); }, [visibleCols]);

  const load = async () => {
    setLoading(true); setError('');
    try {
      setTickets(await apiGet(`/train-tickets${agencyId ? `?agencyId=${agencyId}` : ''}`));
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [agencyId]);
  useEffect(() => {
    apiGet('/companies').then(setCompanies).catch(() => {});
    apiGet('/customers').then(setCustomers).catch(() => {});
  }, []);

  const getCompany = (id) => companies.find((c) => String(c.id) === String(id));
  const trainNos = [...new Set(tickets.map((t) => t.train_no).filter(Boolean))].sort();
  const sources = [...new Set(tickets.map((t) => t.ticket_source).filter(Boolean))].sort();

  const remainingOf = (t) => (Number(t.ticket_amount) || 0) - (Number(t.paid) || 0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      const matchText = !q || t.customer_name?.toLowerCase().includes(q) || t.phone_number?.includes(q)
        || t.train_no?.toLowerCase().includes(q) || t.route?.toLowerCase().includes(q);
      const rem = remainingOf(t);
      const matchStatus = filterStatus === 'all' || (filterStatus === 'paid' ? rem <= 0 : rem > 0);
      return matchText && matchStatus;
    });
  }, [tickets, search, filterStatus]);

  const sortValue = (t) => {
    switch (sortBy) {
      case 'customer_name': return (t.customer_name || '').toLowerCase();
      case 'depart_date': return t.depart_date || '';
      case 'issue_date': return t.issue_date || '';
      case 'ticket_amount': return Number(t.ticket_amount) || 0;
      case 'cost_amount': return Number(t.cost_amount) || 0;
      case 'profit': return (Number(t.ticket_amount) || 0) - (Number(t.cost_amount) || 0);
      case 'paid': return Number(t.paid) || 0;
      case 'remaining': return remainingOf(t);
      default: return '';
    }
  };
  const sorted = sortBy
    ? [...filtered].sort((a, b) => {
        const va = sortValue(a); const vb = sortValue(b);
        const cmp = va < vb ? -1 : va > vb ? 1 : 0;
        return sortDir === 'desc' ? -cmp : cmp;
      })
    : filtered;
  const toggleSort = (k) => {
    if (sortBy === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(k); setSortDir('asc'); }
  };
  const arrow = (k) => (sortBy === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const paged = sorted.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search, filterStatus, agencyId]);

  const selectableIds = sorted.filter((t) => !currentUserId || t.user_id === currentUserId).map((t) => t.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id));
  const toggleSelectAll = () => setSelectedIds(allSelected ? [] : selectableIds);
  const toggleSelect = (id) => setSelectedIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const openAdd = () => { setForm(EMPTY); setEditingId(null); setShowForm(true); };
  const openEdit = (t) => {
    setForm({
      customerName: t.customer_name || '', phoneNumber: t.phone_number || '', trainNo: t.train_no || '',
      route: t.route || '', seatClass: t.seat_class || '',
      departDate: (t.depart_date || '').slice(0, 10), issueDate: (t.issue_date || '').slice(0, 10),
      dueDate: (t.due_date || '').slice(0, 10), ticketSource: t.ticket_source || '',
      ticketAmount: t.ticket_amount, costAmount: t.cost_amount, paid: t.paid, notes: t.notes || '',
      companyId: t.company_id || '', paymentTarget: Number(t.agency_paid) > 0 ? 'agency' : 'self',
    });
    setEditingId(t.id);
    setShowForm(true);
  };

  const save = async () => {
    if (!form.customerName.trim() || !form.ticketAmount) { showToast('Cần tên khách và giá vé', 'error'); return; }
    const body = {
      customerName: form.customerName, phoneNumber: form.phoneNumber, trainNo: form.trainNo,
      route: form.route, seatClass: form.seatClass,
      departDate: form.departDate || null, issueDate: form.issueDate || today(), dueDate: form.dueDate || null,
      ticketSource: form.ticketSource, ticketAmount: parseFloat(form.ticketAmount) || 0,
      costAmount: parseFloat(form.costAmount) || 0, paid: parseFloat(form.paid) || 0,
      notes: form.notes, companyId: form.companyId, paymentTarget: form.paymentTarget,
    };
    try {
      if (editingId) await apiSend('PUT', `/train-tickets/${editingId}`, body);
      else await apiSend('POST', '/train-tickets', body);
      setShowForm(false);
      showToast(editingId ? 'Cập nhật vé tàu thành công' : 'Đã thêm vé tàu');
      load();
    } catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
  };

  const remove = (t) => {
    askConfirm(`Xóa vé tàu của "${t.customer_name}"?`, async () => {
      try { await apiSend('DELETE', `/train-tickets/${t.id}`); setSelectedIds((p) => p.filter((x) => x !== t.id)); showToast('Đã xóa'); load(); }
      catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
    });
  };
  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    askConfirm(`Xóa ${selectedIds.length} vé tàu đã chọn? Không thể hoàn tác.`, async () => {
      try {
        const data = await apiSend('POST', '/train-tickets/bulk-delete', { ids: selectedIds });
        setSelectedIds([]); showToast(`Đã xóa ${data.deleted} vé`); load();
      } catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
    }, { confirmText: `Xóa ${selectedIds.length} mục` });
  };

  const exportExcel = async () => {
    const headers = ['Khách hàng', 'SĐT', 'Số tàu', 'Hành trình', 'Loại chỗ', 'Ngày đi', 'Ngày xuất', 'Nguồn vé', 'Giá bán', 'Giá gốc', 'Lợi nhuận', 'Đã trả', 'Còn nợ', 'Công ty', 'Ghi chú'];
    const rows = sorted.map((t) => {
      const tk = Number(t.ticket_amount) || 0; const c = Number(t.cost_amount) || 0; const p = Number(t.paid) || 0;
      return [t.customer_name, t.phone_number || '', t.train_no || '', t.route || '', t.seat_class || '',
        formatDate(t.depart_date), formatDate(t.issue_date), t.ticket_source || '',
        tk, c, tk - c, p, tk - p, getCompany(t.company_id)?.name || '', t.notes || ''];
    });
    const byMonth = {};
    sorted.forEach((t) => {
      const m = (t.issue_date || '').slice(0, 7) || 'Không rõ';
      if (!byMonth[m]) byMonth[m] = { n: 0, sell: 0, cost: 0, paid: 0 };
      byMonth[m].n += 1; byMonth[m].sell += Number(t.ticket_amount) || 0;
      byMonth[m].cost += Number(t.cost_amount) || 0; byMonth[m].paid += Number(t.paid) || 0;
    });
    const months = Object.keys(byMonth).sort();
    const sumRows = months.map((m) => { const x = byMonth[m]; return [m, x.n, x.sell, x.cost, x.sell - x.cost, x.paid, x.sell - x.paid]; });
    const tot = months.reduce((a, m) => { const x = byMonth[m]; a.n += x.n; a.sell += x.sell; a.cost += x.cost; a.paid += x.paid; return a; }, { n: 0, sell: 0, cost: 0, paid: 0 });
    sumRows.push(['TỔNG CỘNG', tot.n, tot.sell, tot.cost, tot.sell - tot.cost, tot.paid, tot.sell - tot.paid]);
    try {
      await exportWorkbook(`ve-tau-${today()}.xlsx`, [
        { name: 'Vé tàu', aoa: [headers, ...rows], colWidths: [20, 13, 10, 18, 16, 12, 12, 14, 13, 13, 13, 13, 13, 16, 20], moneyCols: [8, 9, 10, 11, 12] },
        { name: 'Tổng kết tháng', aoa: [['Tháng', 'Số vé', 'Doanh số', 'Giá gốc', 'Lợi nhuận', 'Đã thu', 'Còn nợ'], ...sumRows], colWidths: [12, 8, 16, 16, 16, 16, 16], moneyCols: [2, 3, 4, 5, 6] },
      ]);
    } catch { showToast('Lỗi khi xuất Excel', 'error'); }
  };

  const colSpan = 5 + TOGGLE_COLS.filter((c) => visibleCols[c.key]).length;

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><Train /> Công nợ vé tàu</h2>
          <div className="flex flex-wrap gap-2">
            <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold text-sm"><Plus size={18} /> Thêm vé tàu</button>
            <button onClick={exportExcel} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-semibold text-sm"><Download size={18} /> Excel</button>
            <div className="relative">
              <button onClick={() => setShowColMenu((v) => !v)} className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-semibold text-sm"><Eye size={18} /> Cột</button>
              {showColMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowColMenu(false)} />
                  <div className="absolute right-0 mt-1 w-52 bg-white border rounded-lg shadow-xl z-20 p-2">
                    <p className="text-xs text-gray-400 px-2 py-1">4 cột chính luôn hiện</p>
                    {TOGGLE_COLS.map((c) => (
                      <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer text-sm text-gray-700">
                        <input type="checkbox" checked={!!visibleCols[c.key]} onChange={() => setVisibleCols((v) => ({ ...v, [c.key]: !v[c.key] }))} className="w-4 h-4 rounded" />
                        {c.label}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm khách, SĐT, số tàu, hành trình…" className="w-full pl-10 pr-4 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none" />
          </div>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none text-sm bg-white">
            <option value="all">Tất cả</option>
            <option value="unpaid">Còn nợ</option>
            <option value="paid">Đã trả đủ</option>
          </select>
          <AgencyFilter value={agencyId} onChange={setAgencyId} />
        </div>

        {selectedIds.length > 0 && (
          <div className="flex items-center justify-between gap-3 mb-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl">
            <span className="text-sm font-medium text-red-700">Đã chọn {selectedIds.length} vé</span>
            <div className="flex gap-2">
              <button onClick={() => setSelectedIds([])} className="px-3 py-1.5 rounded-lg bg-white border text-gray-600 hover:bg-gray-50 text-sm font-semibold">Bỏ chọn</button>
              <button onClick={handleBulkDelete} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 text-sm font-semibold"><Trash2 size={15} /> Xóa đã chọn ({selectedIds.length})</button>
            </div>
          </div>
        )}

        {loading && <p className="text-gray-500">Đang tải…</p>}
        {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-700">{error}</div>}

        {!loading && !error && (
          <div className="bg-white rounded-2xl shadow overflow-hidden">
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white sticky top-0 z-10 [&_th]:bg-blue-600">
                  <tr className="text-xs sm:text-sm font-semibold">
                    <th className="px-4 py-3 text-left whitespace-nowrap sticky left-0 z-20">
                      <span className="inline-flex items-center gap-2">
                        <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="w-4 h-4 rounded cursor-pointer accent-white" />
                        <span onClick={() => toggleSort('customer_name')} className="cursor-pointer select-none">Khách hàng{arrow('customer_name')}</span>
                      </span>
                    </th>
                    <th className="px-4 py-3 text-left whitespace-nowrap">Số tàu</th>
                    <th className="px-4 py-3 text-left whitespace-nowrap">Hành trình</th>
                    <th onClick={() => toggleSort('depart_date')} className="px-4 py-3 text-left whitespace-nowrap cursor-pointer select-none hover:bg-blue-700">Ngày đi{arrow('depart_date')}</th>
                    {visibleCols.seat_class && <th className="px-4 py-3 text-left whitespace-nowrap">Loại chỗ</th>}
                    {visibleCols.ticket_source && <th className="px-4 py-3 text-left whitespace-nowrap">Nguồn vé</th>}
                    {visibleCols.issue_date && <th onClick={() => toggleSort('issue_date')} className="px-4 py-3 text-left whitespace-nowrap cursor-pointer select-none hover:bg-blue-700">Ngày xuất{arrow('issue_date')}</th>}
                    {visibleCols.ticket_amount && <th onClick={() => toggleSort('ticket_amount')} className="px-4 py-3 text-right whitespace-nowrap cursor-pointer select-none hover:bg-blue-700">Giá bán{arrow('ticket_amount')}</th>}
                    {visibleCols.cost_amount && <th onClick={() => toggleSort('cost_amount')} className="px-4 py-3 text-right whitespace-nowrap cursor-pointer select-none hover:bg-blue-700">Giá gốc{arrow('cost_amount')}</th>}
                    {visibleCols.profit && <th onClick={() => toggleSort('profit')} className="px-4 py-3 text-right whitespace-nowrap cursor-pointer select-none hover:bg-blue-700">Lợi nhuận{arrow('profit')}</th>}
                    {visibleCols.paid && <th onClick={() => toggleSort('paid')} className="px-4 py-3 text-right whitespace-nowrap cursor-pointer select-none hover:bg-blue-700">Đã trả{arrow('paid')}</th>}
                    {visibleCols.remaining && <th onClick={() => toggleSort('remaining')} className="px-4 py-3 text-right whitespace-nowrap cursor-pointer select-none hover:bg-blue-700">Còn nợ{arrow('remaining')}</th>}
                    {visibleCols.company && <th className="px-4 py-3 text-left whitespace-nowrap">Công ty</th>}
                    <th className="px-4 py-3 text-center whitespace-nowrap">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {sorted.length === 0 ? (
                    <tr><td colSpan={colSpan} className="px-4 py-10 text-center text-gray-400">🚆 Chưa có vé tàu nào.</td></tr>
                  ) : paged.map((t, idx) => {
                    const rem = remainingOf(t);
                    const isPaid = rem <= 0;
                    const payStatus = isPaid ? 'paid' : ((Number(t.paid) || 0) > 0 ? 'partial' : 'unpaid');
                    const isOverdue = !isPaid && t.due_date && t.due_date.slice(0, 10) < today();
                    const dot = isOverdue ? 'bg-red-600' : payStatus === 'paid' ? 'bg-green-500' : payStatus === 'partial' ? 'bg-amber-500' : 'bg-red-500';
                    const owned = !currentUserId || t.user_id === currentUserId;
                    const profit = (Number(t.ticket_amount) || 0) - (Number(t.cost_amount) || 0);
                    return (
                      <tr key={t.id} className={`hover:bg-gray-50 ${idx % 2 === 0 ? 'bg-gray-50' : ''}`}>
                        <td className={`px-4 py-3 font-semibold whitespace-nowrap sticky left-0 z-10 ${idx % 2 === 0 ? 'bg-gray-50' : 'bg-white'}`}>
                          <span className="inline-flex items-center gap-2">
                            {owned && <input type="checkbox" checked={selectedIds.includes(t.id)} onChange={() => toggleSelect(t.id)} className="w-4 h-4 rounded cursor-pointer shrink-0" />}
                            <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} title={isOverdue ? 'Quá hạn' : payStatus === 'paid' ? 'Đã trả đủ' : payStatus === 'partial' ? 'Trả một phần' : 'Chưa trả'} />
                            <span onClick={owned ? () => openEdit(t) : undefined} className={`${isOverdue || payStatus === 'unpaid' ? 'text-red-600' : 'text-gray-900'} ${owned ? 'cursor-pointer hover:underline' : ''}`}>{t.customer_name}</span>
                            {isOverdue && <span className="ml-1 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold">⚠ Quá hạn</span>}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap"><span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-lg text-xs font-mono">{t.train_no || '—'}</span></td>
                        <td className="px-4 py-3 whitespace-nowrap"><span className="px-2 py-0.5 bg-teal-100 text-teal-800 rounded-full text-xs font-medium">{t.route || '—'}</span></td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-900 font-medium">{formatDate(t.depart_date)}</td>
                        {visibleCols.seat_class && <td className="px-4 py-3 whitespace-nowrap text-gray-600">{t.seat_class || '—'}</td>}
                        {visibleCols.ticket_source && <td className="px-4 py-3 whitespace-nowrap text-gray-600">{t.ticket_source || '—'}</td>}
                        {visibleCols.issue_date && <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDate(t.issue_date)}</td>}
                        {visibleCols.ticket_amount && <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">{formatCurrency(t.ticket_amount)}</td>}
                        {visibleCols.cost_amount && <td className="px-4 py-3 text-right text-gray-500 whitespace-nowrap">{formatCurrency(t.cost_amount)}</td>}
                        {visibleCols.profit && <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(profit)}</td>}
                        {visibleCols.paid && (
                          <td className="px-4 py-3 text-right font-semibold text-green-600 whitespace-nowrap">
                            {formatCurrency(t.paid)}
                            {Number(t.agency_paid) > 0 && <span className="block text-[10px] text-orange-600 font-normal"><Landmark size={10} className="inline mr-0.5" />{formatCurrency(t.agency_paid)}</span>}
                          </td>
                        )}
                        {visibleCols.remaining && <td className={`px-4 py-3 text-right font-bold whitespace-nowrap ${isPaid ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(rem)}</td>}
                        {visibleCols.company && <td className="px-4 py-3 whitespace-nowrap"><span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded-full text-xs font-medium">{getCompany(t.company_id)?.name || 'Khách lẻ'}</span></td>}
                        <td className="px-4 py-3 text-center">
                          {owned ? (
                            <div className="flex gap-1 justify-center">
                              <button onClick={() => setPaying(t)} className="p-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600" title="Thanh toán"><DollarSign size={14} /></button>
                              <button onClick={() => openEdit(t)} className="p-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600" title="Sửa"><Edit2 size={14} /></button>
                              <button onClick={() => remove(t)} className="p-1.5 bg-red-500 text-white rounded-lg hover:bg-red-600" title="Xóa"><Trash2 size={14} /></button>
                            </div>
                          ) : <span className="text-xs text-gray-400 italic">Chỉ xem</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {sorted.length > PAGE_SIZE && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-t bg-gray-50 text-xs sm:text-sm">
                <span className="text-gray-500">{(curPage - 1) * PAGE_SIZE + 1}–{Math.min(curPage * PAGE_SIZE, sorted.length)} / {sorted.length} vé</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={curPage <= 1} className="px-3 py-1.5 rounded-lg border bg-white disabled:opacity-40 hover:bg-gray-100 font-semibold">Trước</button>
                  <span className="px-2 text-gray-600">Trang {curPage}/{totalPages}</span>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={curPage >= totalPages} className="px-3 py-1.5 rounded-lg border bg-white disabled:opacity-40 hover:bg-gray-100 font-semibold">Sau</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h3 className="text-lg font-bold">{editingId ? 'Sửa vé tàu' : 'Thêm vé tàu'}</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700"><X size={22} /></button>
            </div>
            <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Tên khách hàng *</label>
                <input list="train-customers" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
                <datalist id="train-customers">{customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Số điện thoại</label>
                <input value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Số tàu</label>
                <input list="train-nos" value={form.trainNo} onChange={(e) => setForm({ ...form, trainNo: e.target.value })} placeholder="VD: SE7" className="w-full border rounded-lg px-3 py-2" />
                <datalist id="train-nos">{trainNos.map((n) => <option key={n} value={n} />)}</datalist>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Hành trình (ga đi - ga đến)</label>
                <input value={form.route} onChange={(e) => setForm({ ...form, route: e.target.value })} placeholder="VD: Sài Gòn - Hà Nội" className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Loại chỗ / giường</label>
                <input list="train-seats" value={form.seatClass} onChange={(e) => setForm({ ...form, seatClass: e.target.value })} placeholder="VD: Giường nằm khoang 4" className="w-full border rounded-lg px-3 py-2" />
                <datalist id="train-seats">{SEAT_CLASSES.map((s) => <option key={s} value={s} />)}</datalist>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Nguồn xuất vé</label>
                <input list="train-sources" value={form.ticketSource} onChange={(e) => setForm({ ...form, ticketSource: e.target.value })} placeholder="VD: dsvn.vn" className="w-full border rounded-lg px-3 py-2" />
                <datalist id="train-sources">{sources.map((s) => <option key={s} value={s} />)}</datalist>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Ngày đi</label>
                <VnDatePicker value={form.departDate} onChange={(v) => setForm({ ...form, departDate: v })} />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Ngày xuất vé</label>
                <VnDatePicker value={form.issueDate} onChange={(v) => setForm({ ...form, issueDate: v })} />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Hạn thanh toán</label>
                <VnDatePicker value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Công ty</label>
                <select value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })} className="w-full border rounded-lg px-3 py-2">
                  <option value="">— Khách lẻ —</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Giá bán (VNĐ) *</label>
                <MoneyInput value={form.ticketAmount} onChange={(v) => setForm({ ...form, ticketAmount: v })} placeholder="Giá bán cho khách" className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Giá gốc (VNĐ)</label>
                <MoneyInput value={form.costAmount} onChange={(v) => setForm({ ...form, costAmount: v })} placeholder="Giá nhập" className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">{editingId ? 'Đã trả (chỉ đọc)' : 'Trả trước (VNĐ)'}</label>
                <MoneyInput value={form.paid} onChange={(v) => setForm({ ...form, paid: v })} disabled={!!editingId} placeholder="Khách trả trước (nếu có)" className="w-full border rounded-lg px-3 py-2 disabled:bg-gray-100 disabled:text-gray-500" />
                {editingId && <p className="text-xs text-gray-400 mt-1">Dùng nút 💵 Thanh toán để ghi thêm.</p>}
              </div>
              {!editingId && (
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Trả trước vào TK</label>
                  <select value={form.paymentTarget} onChange={(e) => setForm({ ...form, paymentTarget: e.target.value })} className="w-full border rounded-lg px-3 py-2">
                    <option value="self">TK cá nhân</option>
                    <option value="agency">TK cấp trên (nộp quỹ)</option>
                  </select>
                </div>
              )}
              <div className="sm:col-span-2">
                <label className="block text-sm text-gray-600 mb-1">Ghi chú</label>
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t px-6 py-4">
              <button onClick={() => setShowForm(false)} className="px-5 py-2 bg-gray-200 rounded-lg font-semibold text-sm">Huỷ</button>
              <button onClick={save} className="px-5 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm">Lưu</button>
            </div>
          </div>
        </div>
      )}

      {paying && (
        <PaymentModal
          target={{ type: 'train', id: paying.id, name: paying.customer_name, total: paying.ticket_amount, paid: paying.paid }}
          onClose={() => setPaying(null)}
          onChanged={load}
        />
      )}

      <ConfirmDialog open={!!confirmState} message={confirmState?.message} confirmText={confirmState?.confirmText} onCancel={closeConfirm} onConfirm={() => { confirmState?.onConfirm?.(); closeConfirm(); }} />
      <Toast toast={toast} />
    </div>
  );
}
