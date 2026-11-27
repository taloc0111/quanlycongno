import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Trash2, FileText, Eye, Receipt, Wallet, AlertTriangle, RefreshCw, RotateCcw, ChevronDown,
  Printer, Ticket, X, CheckCircle2, Search as SearchIcon,
} from 'lucide-react';
import AgencyFilter from './components/AgencyFilter';
import { api, qs } from './services/client';
import { formatCurrency, formatDate, today, addDays, num } from './utils/format';
import { useAuth } from './auth/AuthContext';
import { useFeedback } from './ui/FeedbackContext';
import { useTableState } from './hooks/useTableState';
import {
  Button, IconButton, Field, Input, Select, MoneyField, DateField, SearchInput, Textarea,
  Modal, Dropdown, MenuItem, Badge, PageHeader, StatCard, DataTable, ErrorBanner, EmptyState, Skeleton,
} from './ui';

const STATUS = {
  unpaid: { label: 'Chưa thu', tone: 'danger' },
  partial: { label: 'Thu một phần', tone: 'warning' },
  paid: { label: 'Đã thu đủ', tone: 'success' },
  cancelled: { label: 'Đã huỷ', tone: 'gray' },
};

const emptyItem = () => ({ description: '', quantity: 1, unitPrice: '', debtId: null });
const emptyForm = () => ({
  invoiceNumber: '', customerId: '', companyId: '', issueDate: today(), dueDate: addDays(today(), 7),
  taxAmount: '', notes: '', items: [emptyItem()],
});

const COLUMNS = [
  { key: 'invoice_number', label: 'Số HĐ', sortable: true, required: true },
  { key: 'party', label: 'Khách / Công ty', sortable: true, required: true },
  { key: 'owner_name', label: 'Đại lý', hideBelow: 'lg' },
  { key: 'issue_date', label: 'Ngày', sortable: true, hideBelow: 'md' },
  { key: 'due_date', label: 'Hạn', sortable: true, hideBelow: 'md' },
  { key: 'total_amount', label: 'Tổng', align: 'right', sortable: true, required: true },
  { key: 'status', label: 'Trạng thái', sortable: true, required: true },
];

function StatusBadge({ status }) {
  const s = STATUS[status] || { label: status, tone: 'gray' };
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

export default function InvoiceApp() {
  const { user } = useAuth();
  const { toast, confirm } = useFeedback();
  const currentUserId = user?.id;

  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [debts, setDebts] = useState(null); // null = chưa tải (tải khi mở "Chọn từ vé")
  const [agencyId, setAgencyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerLoading, setPickerLoading] = useState(false);
  const [detail, setDetail] = useState(null); // { id, loading, data? }
  const [updatingId, setUpdatingId] = useState(null);

  const t = useTableState({ storageKey: 'invoices', columns: COLUMNS, pageSize: 50, defaultSort: { key: 'issue_date', dir: 'desc' } });
  const status = t.filters.status || 'all';

  // ---------- Tải dữ liệu ----------
  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      setInvoices(await api.get(`/invoices${qs({ agencyId })}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [agencyId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get('/customers').then(setCustomers).catch(() => {});
    api.get('/companies').then(setCompanies).catch(() => {});
  }, []);

  const owned = useCallback((inv) => !currentUserId || inv.user_id === currentUserId, [currentUserId]);
  const partyOf = (inv) => inv.customer_name || inv.company_name || '';

  // ---------- Lọc / sắp xếp ----------
  const { filtered, sorted, paged, totalPages, page } = t.process(invoices, {
    searchText: (inv) => `${inv.invoice_number || ''} ${partyOf(inv)} ${inv.owner_name || ''} ${inv.notes || ''}`,
    filterFns: [status !== 'all' ? (inv) => inv.status === status : null],
    sortValue: (inv, key) => {
      if (key === 'total_amount') return num(inv.total_amount);
      if (key === 'party') return partyOf(inv).toLowerCase();
      if (key === 'status') return STATUS[inv.status]?.label || '';
      const v = inv[key];
      return typeof v === 'string' ? v.toLowerCase() : v;
    },
  });

  const stats = useMemo(() => {
    let total = 0; let unpaid = 0; let unpaidCount = 0;
    for (const inv of filtered) {
      if (inv.status === 'cancelled') continue;
      total += num(inv.total_amount);
      if (inv.status === 'unpaid' || inv.status === 'partial') { unpaid += num(inv.total_amount); unpaidCount += 1; }
    }
    return { count: filtered.length, total, unpaid, unpaidCount };
  }, [filtered]);

  // ---------- Form ----------
  const subtotal = form ? form.items.reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unitPrice) || 0), 0) : 0;
  const total = subtotal + (form ? parseFloat(form.taxAmount) || 0 : 0);

  const openAdd = () => setForm(emptyForm());
  const closeForm = () => { setForm(null); setPicker(false); };
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const updateItem = (i, key, val) => setForm((f) => ({ ...f, items: f.items.map((it, idx) => (idx === i ? { ...it, [key]: val } : it)) }));
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, emptyItem()] }));
  const removeItem = (i) => setForm((f) => ({ ...f, items: f.items.length > 1 ? f.items.filter((_, idx) => idx !== i) : [emptyItem()] }));

  const openPicker = async () => {
    setPicker(true);
    setPickerSearch('');
    if (debts === null) {
      setPickerLoading(true);
      try { setDebts(await api.get('/debts')); }
      catch (err) { toast.error('Không tải được danh sách vé: ' + err.message); setDebts([]); }
      finally { setPickerLoading(false); }
    }
  };

  const pickDebt = (d) => {
    const desc = [`Vé máy bay ${d.route || ''}`.trim(), d.flight_date ? formatDate(d.flight_date) : '', d.ticket_code ? `(${d.ticket_code})` : '', d.customer_name ? `- ${d.customer_name}` : '']
      .filter(Boolean).join(' ');
    const row = { description: desc, quantity: 1, unitPrice: String(Math.round(num(d.ticket_amount))), debtId: d.id };
    setForm((f) => {
      const items = [...f.items];
      const emptyIdx = items.findIndex((it) => !it.description.trim() && !(parseFloat(it.unitPrice) > 0));
      if (emptyIdx >= 0) items[emptyIdx] = row; else items.push(row);
      const next = { ...f, items };
      if (!f.customerId && !f.companyId && d.customer_id && customers.some((c) => String(c.id) === String(d.customer_id))) next.customerId = String(d.customer_id);
      return next;
    });
    setPicker(false);
    toast.success('Đã thêm vé vào hoá đơn');
  };

  const pickedDebtIds = useMemo(() => new Set((form?.items || []).map((it) => it.debtId).filter(Boolean)), [form]);
  const pickerRows = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    return (debts || []).filter((d) => !q || `${d.customer_name || ''} ${d.route || ''} ${d.ticket_code || ''} ${d.phone_number || ''}`.toLowerCase().includes(q)).slice(0, 100);
  }, [debts, pickerSearch]);

  const save = async () => {
    if (!form.invoiceNumber.trim()) { toast.error('Nhập số hoá đơn'); return; }
    const items = form.items.filter((it) => it.description.trim());
    if (items.length === 0) { toast.error('Cần ít nhất 1 dòng có mô tả'); return; }
    setSaving(true);
    try {
      const created = await api.post('/invoices', {
        invoiceNumber: form.invoiceNumber.trim(),
        customerId: form.customerId || null,
        companyId: form.companyId || null,
        issueDate: form.issueDate || null,
        dueDate: form.dueDate || null,
        taxAmount: form.taxAmount,
        notes: form.notes,
        items: items.map((it) => ({ description: it.description.trim(), quantity: it.quantity, unitPrice: it.unitPrice, debtId: it.debtId || null })),
      });
      toast.success(`Đã lập hoá đơn ${created?.invoice_number || form.invoiceNumber}`);
      closeForm();
      load({ silent: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ---------- Trạng thái / xoá / xem ----------
  const changeStatus = async (inv, next) => {
    if (inv.status === next) return;
    setUpdatingId(inv.id);
    try {
      await api.put(`/invoices/${inv.id}`, { status: next });
      setInvoices((rows) => rows.map((r) => (r.id === inv.id ? { ...r, status: next } : r)));
      setDetail((d) => (d?.data?.id === inv.id ? { ...d, data: { ...d.data, status: next } } : d));
      toast.success(`${inv.invoice_number}: ${STATUS[next]?.label}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const remove = async (inv) => {
    const ok = await confirm({ title: 'Xoá hoá đơn', message: `Xoá hoá đơn ${inv.invoice_number}? Không thể hoàn tác.` });
    if (!ok) return;
    try {
      await api.del(`/invoices/${inv.id}`);
      setInvoices((rows) => rows.filter((r) => r.id !== inv.id));
      if (detail?.data?.id === inv.id) setDetail(null);
      toast.success('Đã xoá hoá đơn');
    } catch (err) { toast.error(err.message); }
  };

  const view = async (inv) => {
    setDetail({ id: inv.id, loading: true, data: null });
    try {
      const data = await api.get(`/invoices/${inv.id}`);
      setDetail({ id: inv.id, loading: false, data: { ...data, owner_name: inv.owner_name, user_id: inv.user_id } });
    } catch (err) {
      toast.error(err.message);
      setDetail(null);
    }
  };

  // Hàm render (không phải component) để Dropdown giữ state mở/đóng qua các lần render.
  const statusMenu = (inv, trigger) => (
    <Dropdown trigger={trigger} width="w-44">
      {Object.entries(STATUS).map(([k, v]) => (
        <MenuItem key={k} onClick={() => changeStatus(inv, k)} disabled={updatingId === inv.id}>
          <span className={`h-2 w-2 rounded-full ${{ danger: 'bg-danger-500', warning: 'bg-warning-500', success: 'bg-success-500', gray: 'bg-slate-400' }[v.tone]}`} />
          {v.label}
          {inv.status === k && <CheckCircle2 size={13} className="ml-auto text-brand-600" />}
        </MenuItem>
      ))}
    </Dropdown>
  );

  // ---------- Cột ----------
  const columns = [
    ...COLUMNS.filter((c) => c.required || t.isVisible(c.key)).map((c) => ({
      ...c,
      render: (inv) => {
        switch (c.key) {
          case 'invoice_number':
            return <button type="button" onClick={() => view(inv)} className="font-semibold text-brand-600 hover:underline">{inv.invoice_number}</button>;
          case 'party':
            return partyOf(inv) ? <span className="text-ink">{partyOf(inv)}</span> : <span className="text-ink-faint">—</span>;
          case 'owner_name':
            return <span className="text-xs text-ink-muted">{inv.owner_name || ''}</span>;
          case 'issue_date':
            return <span className="whitespace-nowrap">{formatDate(inv.issue_date)}</span>;
          case 'due_date': {
            const overdue = inv.due_date && (inv.status === 'unpaid' || inv.status === 'partial') && inv.due_date.slice(0, 10) < today();
            return inv.due_date ? <span className={`whitespace-nowrap ${overdue ? 'text-danger-600 font-semibold' : ''}`}>{formatDate(inv.due_date)}</span> : <span className="text-ink-faint">—</span>;
          }
          case 'total_amount':
            return <span className="font-semibold tabular text-ink">{formatCurrency(inv.total_amount)}</span>;
          case 'status':
            return owned(inv) ? (
              statusMenu(inv, (
                <button type="button" className="inline-flex items-center gap-1 rounded-full hover:opacity-80" title="Đổi trạng thái" disabled={updatingId === inv.id}>
                  <StatusBadge status={inv.status} /><ChevronDown size={13} className="text-ink-faint" />
                </button>
              ))
            ) : <StatusBadge status={inv.status} />;
          default:
            return inv[c.key];
        }
      },
    })),
    {
      key: '__actions', label: '', align: 'right', width: 90,
      render: (inv) => (
        <div className="flex justify-end gap-0.5 opacity-70 group-hover:opacity-100 transition">
          <IconButton icon={Eye} title="Xem" onClick={() => view(inv)} />
          {owned(inv) ? <IconButton icon={Trash2} title="Xoá" variant="danger" onClick={() => remove(inv)} /> : <Badge tone="outline" icon={Eye}>Chỉ xem</Badge>}
        </div>
      ),
    },
  ];

  const mobileCard = (inv) => (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button type="button" onClick={() => view(inv)} className="font-semibold text-brand-600">{inv.invoice_number}</button>
          <p className="text-xs text-ink-muted truncate">{partyOf(inv) || '—'} · {formatDate(inv.issue_date)}</p>
        </div>
        <StatusBadge status={inv.status} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold tabular text-ink">{formatCurrency(inv.total_amount)}</span>
        <div className="flex gap-1.5">
          <Button size="xs" variant="secondary" icon={Eye} onClick={() => view(inv)}>Xem</Button>
          {owned(inv) && (
            <>
              {statusMenu(inv, <Button size="xs" variant="soft" iconRight={ChevronDown}>Trạng thái</Button>)}
              <Button size="xs" variant="ghost" icon={Trash2} className="text-danger-600" onClick={() => remove(inv)}>Xoá</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  const d = detail?.data;

  return (
    <div>
      <PageHeader
        help="invoices"
        icon={FileText}
        title="Hoá đơn"
        description="Lập hoá đơn cho khách lẻ hoặc công ty, theo dõi trạng thái thu tiền."
        actions={<Button icon={Plus} onClick={openAdd}>Tạo hoá đơn</Button>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <StatCard icon={Receipt} label="Số hoá đơn" value={stats.count} sub="Theo bộ lọc hiện tại" tone="brand" />
        <StatCard icon={Wallet} label="Tổng tiền" value={formatCurrency(stats.total)} sub="Không tính hoá đơn đã huỷ" tone="purple" />
        <StatCard icon={AlertTriangle} label="Chưa thanh toán" value={formatCurrency(stats.unpaid)} sub={`${stats.unpaidCount} hoá đơn`} tone={stats.unpaid > 0 ? 'danger' : 'success'} onClick={() => t.setFilter('status', status === 'unpaid' ? 'all' : 'unpaid')} />
      </div>

      <div className="card mb-4 p-3 flex flex-col lg:flex-row lg:items-center gap-2.5">
        <SearchInput value={t.search} onChange={t.setSearch} placeholder="Tìm số HĐ, khách, công ty…" className="lg:w-80" />
        <div className="flex flex-wrap items-center gap-2">
          <Select size="sm" value={status} onChange={(e) => t.setFilter('status', e.target.value)} className="w-40">
            <option value="all">Mọi trạng thái</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <AgencyFilter value={agencyId} onChange={setAgencyId} />
          {(t.search || status !== 'all') && (
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => { t.setSearch(''); t.setFilters({}); }}>Xoá lọc</Button>
          )}
        </div>
        <div className="lg:ml-auto">
          <IconButton icon={RefreshCw} title="Tải lại" onClick={() => load({ silent: true })} className={refreshing ? 'animate-spin' : ''} />
        </div>
      </div>

      <ErrorBanner message={error} onRetry={load} />

      <DataTable
        className={error ? 'mt-4' : ''}
        columns={columns}
        rows={paged}
        loading={loading}
        sort={t.sort}
        onSort={t.toggleSort}
        emptyIcon={FileText}
        emptyTitle={invoices.length ? 'Không có hoá đơn nào khớp bộ lọc' : 'Chưa có hoá đơn nào'}
        emptyDescription={invoices.length ? 'Thử đổi trạng thái hoặc từ khoá.' : 'Bấm "Tạo hoá đơn" để lập hoá đơn đầu tiên.'}
        emptyAction={!invoices.length && <Button icon={Plus} onClick={openAdd}>Tạo hoá đơn</Button>}
        pagination={{ page, totalPages, total: sorted.length, pageSize: t.pageSize, onChange: t.setPage }}
        mobileCard={mobileCard}
      />

      {/* Tạo hoá đơn */}
      <Modal
        open={!!form}
        onClose={closeForm}
        icon={FileText}
        title="Tạo hoá đơn"
        size="xl"
        footer={(
          <>
            <Button variant="secondary" onClick={closeForm}>Huỷ</Button>
            <Button icon={CheckCircle2} loading={saving} onClick={save}>Lưu hoá đơn</Button>
          </>
        )}
      >
        {form && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              <Field label="Số hoá đơn" required htmlFor="inv-no">
                <Input id="inv-no" value={form.invoiceNumber} onChange={(e) => setField('invoiceNumber', e.target.value)} placeholder="VD: HD-2026-001" />
              </Field>
              <Field label="Ngày lập">
                <DateField value={form.issueDate} onChange={(v) => setField('issueDate', v)} />
              </Field>
              <Field label="Hạn thanh toán">
                <DateField value={form.dueDate} onChange={(v) => setField('dueDate', v)} />
              </Field>
              <Field label="Khách hàng" htmlFor="inv-customer">
                <Select id="inv-customer" value={form.customerId} onChange={(e) => setField('customerId', e.target.value)}>
                  <option value="">— Khách lẻ / không chọn —</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>)}
                </Select>
              </Field>
              <Field label="Công ty" htmlFor="inv-company">
                <Select id="inv-company" value={form.companyId} onChange={(e) => setField('companyId', e.target.value)}>
                  <option value="">— Không —</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Ghi chú" htmlFor="inv-notes">
                <Textarea id="inv-notes" rows={1} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder="Ghi chú in trên hoá đơn" />
              </Field>
            </div>

            {/* Chi tiết dòng */}
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-ink">Chi tiết</h4>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="secondary" icon={Ticket} onClick={openPicker}>Chọn từ vé</Button>
                  <Button type="button" size="sm" variant="soft" icon={Plus} onClick={addItem}>Thêm dòng</Button>
                </div>
              </div>
              <div className="card overflow-hidden">
                <div className="hidden sm:grid grid-cols-[1fr_72px_150px_130px_36px] gap-2 bg-surface-muted px-3 py-2 text-[12px] uppercase tracking-wide text-ink-muted font-semibold">
                  <span>Mô tả</span><span className="text-right">SL</span><span className="text-right">Đơn giá</span><span className="text-right">Thành tiền</span><span />
                </div>
                <div className="divide-y divide-surface-border">
                  {form.items.map((it, i) => {
                    const amount = (parseFloat(it.quantity) || 0) * (parseFloat(it.unitPrice) || 0);
                    return (
                      <div key={i} className="grid grid-cols-2 sm:grid-cols-[1fr_72px_150px_130px_36px] gap-2 items-center px-3 py-2">
                        <div className="col-span-2 sm:col-span-1">
                          <Input size="sm" placeholder={`Mô tả dòng ${i + 1}`} value={it.description} onChange={(e) => updateItem(i, 'description', e.target.value)} />
                          {it.debtId && <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-brand-600"><Ticket size={11} /> Vé #{it.debtId}</span>}
                        </div>
                        <Input size="sm" type="number" min="0" step="1" className="text-right" placeholder="SL" value={it.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)} aria-label="Số lượng" />
                        <MoneyField className="input-sm text-right" placeholder="Đơn giá" value={it.unitPrice} onChange={(v) => updateItem(i, 'unitPrice', v)} />
                        <span className="col-span-2 sm:col-span-1 text-right text-sm font-semibold tabular text-ink">{formatCurrency(amount)}</span>
                        <div className="hidden sm:flex justify-end">
                          <IconButton icon={X} title="Bỏ dòng" variant="danger" size={15} onClick={() => removeItem(i)} />
                        </div>
                        <div className="col-span-2 flex justify-end sm:hidden -mt-1">
                          <Button type="button" size="xs" variant="ghost" icon={X} className="text-danger-600" onClick={() => removeItem(i)}>Bỏ dòng</Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Tổng */}
            <div className="flex justify-end">
              <div className="w-full sm:w-80 space-y-2 rounded-xl bg-surface-subtle px-4 py-3 text-sm">
                <div className="flex items-center justify-between"><span className="text-ink-muted">Tạm tính</span><span className="font-semibold tabular">{formatCurrency(subtotal)}</span></div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink-muted">Thuế</span>
                  <MoneyField className="input-sm w-36 text-right" placeholder="0" value={form.taxAmount} onChange={(v) => setField('taxAmount', v)} />
                </div>
                <div className="flex items-center justify-between border-t border-surface-border pt-2 text-base"><span className="font-semibold text-ink">Tổng</span><span className="font-bold tabular text-brand-700">{formatCurrency(total)}</span></div>
              </div>
            </div>
            <button type="submit" className="hidden" aria-hidden />
          </form>
        )}
      </Modal>

      {/* Chọn vé để đưa vào hoá đơn */}
      <Modal open={picker} onClose={() => setPicker(false)} icon={Ticket} title="Chọn từ vé" subtitle="Bấm một vé để thêm thành 1 dòng hoá đơn" size="lg" footer={<Button variant="secondary" onClick={() => setPicker(false)}>Đóng</Button>}>
        <SearchInput value={pickerSearch} onChange={setPickerSearch} placeholder="Tìm khách, hành trình, mã vé…" autoFocus className="mb-3" />
        {pickerLoading ? (
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : pickerRows.length === 0 ? (
          <EmptyState icon={SearchIcon} title={debts?.length ? 'Không tìm thấy vé' : 'Chưa có vé nào'} compact />
        ) : (
          <ul className="max-h-[50vh] divide-y divide-surface-border overflow-y-auto rounded-xl border border-surface-border">
            {pickerRows.map((dd) => {
              const picked = pickedDebtIds.has(dd.id);
              return (
                <li key={dd.id}>
                  <button type="button" onClick={() => pickDebt(dd)} className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-surface-muted ${picked ? 'bg-brand-50/60' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink truncate">{dd.customer_name} <span className="text-ink-faint font-normal">· {dd.route || '—'}</span></p>
                      <p className="text-xs text-ink-muted">{dd.flight_date ? formatDate(dd.flight_date) : 'Chưa có ngày bay'}{dd.ticket_code ? ` · ${dd.ticket_code}` : ''}{dd.airline ? ` · ${dd.airline}` : ''}</p>
                    </div>
                    <span className="font-semibold tabular text-ink shrink-0">{formatCurrency(dd.ticket_amount)}</span>
                    {picked && <Badge tone="brand">Đã chọn</Badge>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>

      {/* Chi tiết hoá đơn (in được) */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        icon={FileText}
        title={d ? `Hoá đơn ${d.invoice_number}` : 'Hoá đơn'}
        subtitle={d ? (partyOf(d) || 'Khách lẻ') : undefined}
        size="lg"
        footer={(
          <div className="no-print flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {d && owned(d) && (
                statusMenu(d, <Button variant="secondary" size="sm" iconRight={ChevronDown}>Đổi trạng thái</Button>)
              )}
              {d && owned(d) && <Button variant="ghost" size="sm" icon={Trash2} className="text-danger-600" onClick={() => remove(d)}>Xoá</Button>}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setDetail(null)}>Đóng</Button>
              <Button icon={Printer} onClick={() => window.print()} disabled={!d}>In</Button>
            </div>
          </div>
        )}
      >
        <style>{`@media print { body * { visibility: hidden !important; } .print-area, .print-area * { visibility: visible !important; } .print-area { position: fixed; inset: 0; padding: 24px; background: white; overflow: visible; } }`}</style>
        {detail?.loading || !d ? (
          <div className="space-y-3"><Skeleton className="h-5 w-48" /><Skeleton className="h-4 w-64" /><Skeleton className="h-32 w-full" /></div>
        ) : (
          <div className="print-area space-y-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-bold text-ink">HOÁ ĐƠN {d.invoice_number}</p>
                <p className="text-ink-muted">Ngày lập {formatDate(d.issue_date)}{d.due_date ? ` · Hạn thanh toán ${formatDate(d.due_date)}` : ''}</p>
              </div>
              <StatusBadge status={d.status} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl bg-surface-muted p-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Khách hàng</p>
                <p className="font-medium text-ink">{d.customer_name || '—'}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Công ty</p>
                <p className="font-medium text-ink">{d.company_name || '—'}</p>
              </div>
              {d.owner_name && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Đại lý</p>
                  <p className="font-medium text-ink">{d.owner_name}</p>
                </div>
              )}
              {d.notes && (
                <div className="sm:col-span-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Ghi chú</p>
                  <p className="text-ink whitespace-pre-line">{d.notes}</p>
                </div>
              )}
            </div>
            <div className="card overflow-hidden">
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="bg-surface-muted text-[12px] uppercase tracking-wide text-ink-muted">
                    <th className="px-3 py-2 text-left font-semibold">Mô tả</th>
                    <th className="px-3 py-2 text-right font-semibold w-14">SL</th>
                    <th className="px-3 py-2 text-right font-semibold">Đơn giá</th>
                    <th className="px-3 py-2 text-right font-semibold">Thành tiền</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {(d.items || []).map((it) => (
                    <tr key={it.id}>
                      <td className="px-3 py-2 text-ink">{it.description}</td>
                      <td className="px-3 py-2 text-right tabular">{num(it.quantity)}</td>
                      <td className="px-3 py-2 text-right tabular">{formatCurrency(it.unit_price)}</td>
                      <td className="px-3 py-2 text-right tabular font-medium">{formatCurrency(it.amount)}</td>
                    </tr>
                  ))}
                  {(!d.items || d.items.length === 0) && <tr><td colSpan={4} className="px-3 py-4 text-center text-ink-faint">Không có dòng nào</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end">
              <div className="w-full sm:w-72 space-y-1.5">
                <div className="flex justify-between text-ink-muted"><span>Tạm tính</span><span className="tabular">{formatCurrency(d.subtotal)}</span></div>
                <div className="flex justify-between text-ink-muted"><span>Thuế</span><span className="tabular">{formatCurrency(d.tax_amount)}</span></div>
                <div className="flex justify-between border-t border-surface-border pt-1.5 text-base font-bold text-ink"><span>Tổng cộng</span><span className="tabular">{formatCurrency(d.total_amount)}</span></div>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
