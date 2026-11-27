import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Landmark, Pencil, TrendingUp, TrendingDown, Users, Wallet, RefreshCw, RotateCcw, Eye, ArrowDownToLine } from 'lucide-react';
import AgencyFilter from './components/AgencyFilter';
import { api, qs } from './services/client';
import { formatCurrency, formatDate, formatMonth, monthOf, today, num } from './utils/format';
import { useAuth } from './auth/AuthContext';
import { useFeedback } from './ui/FeedbackContext';
import { useTableState } from './hooks/useTableState';
import {
  Button, IconButton, Field, Select, MoneyField, DateField, SearchInput, Textarea,
  Modal, Card, Badge, PageHeader, StatCard, DataTable, ErrorBanner, EmptyState,
} from './ui';

const METHOD = { cash: 'Tiền mặt', bank_transfer: 'Chuyển khoản', momo: 'Momo', adjustment: 'Điều chỉnh đầu kỳ' };
const METHOD_TONE = { cash: 'success', bank_transfer: 'brand', momo: 'purple', adjustment: 'warning' };
const TYPE_LABEL = { debt: 'Vé máy bay', passport: 'Hộ chiếu', train: 'Vé tàu', tour: 'Tour' };
const EMPTY = { amount: '', depositDate: '', method: 'bank_transfer', notes: '' };

const COLUMNS = [
  { key: 'deposit_date', label: 'Ngày nộp', sortable: true, required: true },
  { key: 'amount', label: 'Số tiền', align: 'right', sortable: true, required: true },
  { key: 'method', label: 'Hình thức', sortable: true },
  { key: 'owner_name', label: 'Đại lý', hideBelow: 'md' },
  { key: 'notes', label: 'Ghi chú', hideBelow: 'lg' },
];

export default function DepositApp() {
  const { user } = useAuth();
  const { toast, confirm } = useFeedback();
  const currentUserId = user?.id;

  const [deposits, setDeposits] = useState([]);
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [agencyId, setAgencyId] = useState('');
  const [form, setForm] = useState(null); // null = đóng; { ...EMPTY, id? }
  const [saving, setSaving] = useState(false);

  const t = useTableState({ storageKey: 'deposits', columns: COLUMNS, pageSize: 50, defaultSort: { key: 'deposit_date', dir: 'desc' } });
  const month = t.filters.month || '';

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const [deps, bal] = await Promise.all([
        api.get(`/deposits${qs({ agencyId })}`),
        api.get('/deposits/balance'),
      ]);
      setDeposits(deps);
      setBalance(bal);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [agencyId]);

  useEffect(() => { load(); }, [load]);

  const owned = useCallback((d) => !currentUserId || d.user_id === currentUserId, [currentUserId]);

  const months = useMemo(() => [...new Set(deposits.map((d) => monthOf(d.deposit_date)).filter(Boolean))].sort().reverse(), [deposits]);

  const { filtered, sorted, paged, totalPages, page } = t.process(deposits, {
    searchText: (d) => `${d.notes || ''} ${METHOD[d.method] || ''} ${d.owner_name || ''} ${d.owner_username || ''} ${formatDate(d.deposit_date)}`,
    filterFns: [month ? (d) => monthOf(d.deposit_date) === month : null],
    sortValue: (d, key) => {
      if (key === 'amount') return num(d.amount);
      if (key === 'deposit_date') return monthOf(d.deposit_date) ? d.deposit_date : '';
      if (key === 'method') return METHOD[d.method] || d.method || '';
      return d[key];
    },
  });

  const filteredTotal = useMemo(() => filtered.reduce((s, d) => s + num(d.amount), 0), [filtered]);

  // ---------- Chọn nhiều ----------
  const selectableIds = sorted.filter(owned).map((d) => d.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => t.selected.includes(id));
  const toggleAll = () => t.setSelected(allSelected ? [] : selectableIds);

  // ---------- CRUD ----------
  const openAdd = () => setForm({ ...EMPTY, depositDate: today() });
  const openEdit = (d) => setForm({
    id: d.id,
    amount: d.amount, depositDate: (d.deposit_date || '').slice(0, 10),
    method: d.method || 'bank_transfer', notes: d.notes || '',
  });
  const closeForm = () => setForm(null);
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const amt = parseFloat(form.amount);
    if (!(Number.isFinite(amt) && amt !== 0)) { toast.error('Nhập số tiền hợp lệ (khác 0)'); return; }
    setSaving(true);
    try {
      const body = { amount: form.amount, depositDate: form.depositDate, method: form.method, notes: form.notes };
      if (form.id) await api.put(`/deposits/${form.id}`, body);
      else await api.post('/deposits', body);
      toast.success(form.id ? 'Đã cập nhật' : 'Đã ghi nhận nộp quỹ');
      setForm(null);
      load({ silent: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (d) => {
    const ok = await confirm({ title: 'Xoá lần nộp quỹ', message: `Xoá lần nộp ${formatCurrency(d.amount)} ngày ${formatDate(d.deposit_date)}?` });
    if (!ok) return;
    try {
      await api.del(`/deposits/${d.id}`);
      t.setSelected((s) => s.filter((x) => x !== d.id));
      toast.success('Đã xoá lần nộp quỹ');
      load({ silent: true });
    } catch (err) { toast.error(err.message); }
  };

  const bulkDelete = async () => {
    const n = t.selected.length;
    if (!n) return;
    const ok = await confirm({ title: 'Xoá hàng loạt', message: `Xoá ${n} lần nộp quỹ đã chọn? Không thể hoàn tác.`, confirmText: `Xoá ${n} mục` });
    if (!ok) return;
    try {
      const data = await api.post('/deposits/bulk-delete', { ids: t.selected });
      t.clearSelection();
      toast.success(`Đã xoá ${data.deleted} lần nộp quỹ`);
      load({ silent: true });
    } catch (err) { toast.error(err.message); }
  };

  // ---------- Cột ----------
  const columns = [
    ...COLUMNS.filter((c) => c.required || t.isVisible(c.key)).map((c) => ({
      ...c,
      render: (d) => {
        switch (c.key) {
          case 'deposit_date': return <span className="font-medium text-ink whitespace-nowrap">{formatDate(d.deposit_date)}</span>;
          case 'amount': return <span className={`font-semibold tabular ${num(d.amount) >= 0 ? 'text-success-600' : 'text-danger-600'}`}>{formatCurrency(d.amount)}</span>;
          case 'method': return <Badge tone={METHOD_TONE[d.method] || 'gray'}>{METHOD[d.method] || d.method || '—'}</Badge>;
          case 'owner_name': return <span className="text-xs text-ink-muted">{d.owner_name || d.owner_username || ''}</span>;
          case 'notes': return <span className="text-ink-soft truncate block max-w-[320px]" title={d.notes || ''}>{d.notes || <span className="text-ink-faint">—</span>}</span>;
          default: return d[c.key];
        }
      },
    })),
    {
      key: '__actions', label: '', align: 'right', width: 90,
      render: (d) => owned(d) ? (
        <div className="flex justify-end gap-0.5 opacity-70 group-hover:opacity-100 transition">
          <IconButton icon={Pencil} title="Sửa" variant="primary" onClick={() => openEdit(d)} />
          <IconButton icon={Trash2} title="Xoá" variant="danger" onClick={() => remove(d)} />
        </div>
      ) : <Badge tone="outline" icon={Eye}>Chỉ xem</Badge>,
    },
  ];

  const mobileCard = (d) => (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink">{formatDate(d.deposit_date)}</p>
          <p className="text-xs text-ink-muted truncate">{d.owner_name || d.owner_username || ''}{d.notes ? ` · ${d.notes}` : ''}</p>
        </div>
        <span className={`font-bold tabular shrink-0 ${num(d.amount) >= 0 ? 'text-success-600' : 'text-danger-600'}`}>{formatCurrency(d.amount)}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Badge tone={METHOD_TONE[d.method] || 'gray'}>{METHOD[d.method] || d.method || '—'}</Badge>
        {owned(d) ? (
          <div className="flex gap-1.5">
            <Button size="xs" variant="secondary" icon={Pencil} onClick={() => openEdit(d)}>Sửa</Button>
            <Button size="xs" variant="ghost" icon={Trash2} className="text-danger-600" onClick={() => remove(d)}>Xoá</Button>
          </div>
        ) : <Badge tone="outline" icon={Eye}>Chỉ xem</Badge>}
      </div>
    </div>
  );

  const bal = balance?.balance ?? 0;
  const agencyPayments = balance?.agencyPayments || [];

  return (
    <div>
      <PageHeader
        icon={Landmark}
        title="Nộp quỹ"
        description="Ghi lại các lần nộp tiền lên cấp trên. Cấp 1 xem được các lần nộp của đại lý cấp dưới."
        actions={<Button icon={Plus} onClick={openAdd}>Nộp quỹ</Button>}
      />

      {/* Số dư với cấp trên */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <StatCard icon={ArrowDownToLine} label="Tổng đã nộp" value={balance ? formatCurrency(balance.totalDeposited) : '…'} sub="Gồm điều chỉnh đầu kỳ" tone="brand" />
        <StatCard icon={Users} label="Khách trả cấp trên" value={balance ? formatCurrency(balance.totalCustomerToAgency) : '…'} sub={`${agencyPayments.length} lần`} tone="purple" />
        <StatCard
          icon={bal >= 0 ? TrendingUp : TrendingDown}
          label={bal >= 0 ? 'Số dư với cấp trên' : 'Còn nợ cấp trên'}
          value={balance ? formatCurrency(Math.abs(bal)) : '…'}
          sub={bal >= 0 ? 'Đã nộp đủ / dư' : 'Số tiền cần nộp thêm'}
          tone={bal >= 0 ? 'success' : 'danger'}
        />
      </div>

      {/* Thanh công cụ */}
      <div className="card mb-4 p-3 flex flex-col lg:flex-row lg:items-center gap-2.5">
        <SearchInput value={t.search} onChange={t.setSearch} placeholder="Tìm ghi chú, đại lý, hình thức…" className="lg:w-80" />
        <div className="flex flex-wrap items-center gap-2">
          <Select size="sm" value={month} onChange={(e) => t.setFilter('month', e.target.value)} className="w-36" title="Lọc theo tháng">
            <option value="">Mọi tháng</option>
            {months.map((m) => <option key={m} value={m}>{formatMonth(m)}</option>)}
          </Select>
          <AgencyFilter value={agencyId} onChange={setAgencyId} />
          {(t.search || month) && (
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => { t.setSearch(''); t.setFilters({}); }}>Xoá lọc</Button>
          )}
        </div>
        <div className="flex items-center gap-2 lg:ml-auto text-sm text-ink-muted">
          <span>{filtered.length} lần · <b className={`tabular ${filteredTotal >= 0 ? 'text-success-600' : 'text-danger-600'}`}>{formatCurrency(filteredTotal)}</b></span>
          <IconButton icon={RefreshCw} title="Tải lại" onClick={() => load({ silent: true })} className={refreshing ? 'animate-spin' : ''} />
        </div>
      </div>

      {t.selected.length > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-danger-100 bg-danger-50 px-4 py-2.5 animate-fade-in">
          <span className="text-sm font-medium text-danger-700">Đã chọn {t.selected.length} lần nộp quỹ</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={t.clearSelection}>Bỏ chọn</Button>
            <Button size="sm" variant="danger" icon={Trash2} onClick={bulkDelete}>Xoá đã chọn</Button>
          </div>
        </div>
      )}

      <ErrorBanner message={error} onRetry={load} />

      <DataTable
        className={error ? 'mt-4' : ''}
        columns={columns}
        rows={paged}
        loading={loading}
        sort={t.sort}
        onSort={t.toggleSort}
        selectable
        selectedIds={t.selected}
        onToggleRow={t.toggleSelect}
        onToggleAll={toggleAll}
        allSelected={allSelected}
        canSelect={owned}
        emptyIcon={Landmark}
        emptyTitle={deposits.length ? 'Không có dòng nào khớp bộ lọc' : 'Chưa có lần nộp quỹ nào'}
        emptyDescription={deposits.length ? 'Thử đổi tháng hoặc từ khoá tìm kiếm.' : 'Bấm "Nộp quỹ" để ghi nhận lần nộp đầu tiên.'}
        emptyAction={!deposits.length && <Button icon={Plus} onClick={openAdd}>Nộp quỹ</Button>}
        pagination={{ page, totalPages, total: sorted.length, pageSize: t.pageSize, onChange: t.setPage }}
        mobileCard={mobileCard}
      />

      {/* Khách trả thẳng vào TK cấp trên */}
      <Card padded={false} className="mt-5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border px-4 py-3">
          <h3 className="flex items-center gap-2 font-semibold text-ink"><Wallet size={16} className="text-ink-muted" /> Khách trả thẳng vào TK cấp trên</h3>
          <span className="text-sm text-ink-muted">{agencyPayments.length} lần · <b className="tabular text-ink">{formatCurrency(balance?.totalCustomerToAgency || 0)}</b></span>
        </div>
        {!balance && loading ? (
          <div className="px-4 py-6 text-sm text-ink-muted">Đang tải…</div>
        ) : agencyPayments.length === 0 ? (
          <EmptyState icon={Wallet} title="Chưa có khoản nào" description="Khi ghi thanh toán với “TK cấp trên”, khoản đó sẽ hiện ở đây và được tính vào số dư." compact />
        ) : (
          <div className="max-h-80 overflow-auto">
            <table className="w-full min-w-max text-[13.5px]">
              <thead>
                <tr className="bg-surface-muted text-[12px] uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-2 text-left font-semibold">Ngày</th>
                  <th className="px-3 py-2 text-left font-semibold">Khách hàng</th>
                  <th className="px-3 py-2 text-left font-semibold hidden sm:table-cell">Giao dịch</th>
                  <th className="px-3 py-2 text-right font-semibold">Số tiền</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {agencyPayments.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-muted">
                    <td className="px-3 py-2 text-ink-muted whitespace-nowrap">{formatDate(p.payment_date)}</td>
                    <td className="px-3 py-2 font-medium text-ink">{p.customer_name || '—'}</td>
                    <td className="px-3 py-2 hidden sm:table-cell">
                      <span className="inline-flex items-center gap-1.5">
                        <Badge tone="gray">{TYPE_LABEL[p.type] || p.type || '—'}</Badge>
                        {p.ticket_code && <span className="text-xs text-ink-muted">{p.ticket_code}</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular text-warning-700">{formatCurrency(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Form thêm/sửa */}
      <Modal
        open={!!form}
        onClose={closeForm}
        icon={Landmark}
        title={form?.id ? 'Sửa lần nộp quỹ' : 'Ghi nhận nộp quỹ'}
        size="md"
        footer={(
          <>
            <Button variant="secondary" onClick={closeForm}>Huỷ</Button>
            <Button loading={saving} onClick={save}>{form?.id ? 'Lưu thay đổi' : 'Ghi nhận'}</Button>
          </>
        )}
      >
        {form && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-3.5">
            <Field label="Số tiền" required hint="Số âm = nợ kỳ trước (dùng với hình thức “Điều chỉnh đầu kỳ”)." htmlFor="dp-amount">
              <MoneyField id="dp-amount" value={form.amount} onChange={(v) => setField('amount', v)} allowNegative placeholder="VD: 5.000.000 hoặc -60.000.000" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <Field label="Ngày nộp">
                <DateField value={form.depositDate} onChange={(v) => setField('depositDate', v)} />
              </Field>
              <Field label="Hình thức">
                <Select value={form.method} onChange={(e) => setField('method', e.target.value)}>
                  <option value="bank_transfer">Chuyển khoản</option>
                  <option value="cash">Tiền mặt</option>
                  <option value="momo">Momo</option>
                  <option value="adjustment">Điều chỉnh đầu kỳ</option>
                </Select>
              </Field>
            </div>
            <Field label="Ghi chú">
              <Textarea rows={2} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder="VD: Nộp quỹ tháng 4" />
            </Field>
            <button type="submit" className="hidden" aria-hidden />
          </form>
        )}
      </Modal>
    </div>
  );
}
