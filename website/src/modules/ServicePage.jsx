import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Download, Upload, Columns3, Trash2, Pencil, Wallet, RefreshCw, Users, Landmark,
  TrendingUp, Receipt, AlertTriangle, PiggyBank, CheckCircle2, Eye, RotateCcw, ListPlus, Truck, Hourglass,
  MoreHorizontal, Ban, Undo2, Repeat, HandCoins,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useNavigation } from '../hooks/useNavigation.jsx';
import { useFeedback } from '../ui/FeedbackContext';
import { useTableState } from '../hooks/useTableState';
import { api, qs } from '../services/client';
import { formatCurrency, formatDate, formatMonth, monthOf, today, num, daysUntil } from '../utils/format';
import {
  payState, isCostPending, costUnpaid, costTotal, newCostItem, downTemplate,
  activeAccounts, defaultAccountId, rememberAccount, isCancelled, originalAmount,
} from './payState';
import { accountsApi, suppliersApi, accountLabel, invalidateMoneyCache, serviceActionsApi } from '../services/money';
import CostItemsEditor from './CostItemsEditor';
import CancelModal from './CancelModal';
import ChangeTicketModal from './ChangeTicketModal';
import ReceiptModal from './money/ReceiptModal';
import { exportWorkbook } from '../utils/excel';
import {
  Button, IconButton, Field, Input, Select, MoneyField, DateField, SearchInput, Textarea,
  Modal, Dropdown, MenuItem, Badge, PageHeader, StatCard, DataTable, ErrorBanner, Segmented, Switch,
} from '../ui';
import AgencyFilter from '../components/AgencyFilter';
import PaymentModal from '../components/PaymentModal';
import ImportModal from '../components/ImportModal';

const PAY_FILTER = [
  { value: 'all', label: 'Tất cả' },
  { value: 'unpaid', label: 'Còn nợ' },
  { value: 'overdue', label: 'Quá hạn' },
  { value: 'paid', label: 'Đã trả đủ' },
];

// Trạng thái hiệu lực (huỷ / chưa huỷ) — mặc định ẩn dịch vụ đã huỷ. Tour có bộ lọc tiến độ riêng nên không dùng.
const LIFE_FILTER = [
  { value: 'active', label: 'Đang hiệu lực' },
  { value: 'cancelled', label: 'Đã huỷ' },
  { value: 'all', label: 'Trạng thái: Tất cả' },
];

const STATUS_BADGE = {
  overdue: { tone: 'danger', label: 'Quá hạn' },
  paid: { tone: 'success', label: 'Đã trả đủ' },
  partial: { tone: 'warning', label: 'Trả 1 phần' },
  unpaid: { tone: 'danger', label: 'Chưa trả' },
};

export function PayBadge({ row, cfg }) {
  const s = payState(row, cfg);
  const b = STATUS_BADGE[s.status];
  return <Badge tone={b.tone} dot>{b.label}</Badge>;
}

/** Badge "Đã huỷ" (null nếu dịch vụ còn hiệu lực). */
export function CancelledBadge({ row }) {
  if (!isCancelled(row)) return null;
  return <span title={row.cancel_note || undefined}><Badge tone="gray" icon={Ban}>Đã huỷ</Badge></span>;
}

/** Ô giá bán: dịch vụ đã huỷ hiện giá gốc gạch ngang + giá còn lại. */
export function AmountCell({ row, cfg, amountKey }) {
  const key = amountKey || cfg.amountKey;
  const orig = originalAmount(row, { ...cfg, amountKey: key });
  return (
    <span className="font-semibold">
      {orig !== null && <s className="mr-1.5 text-xs font-normal text-ink-faint" title="Giá bán gốc trước khi huỷ">{formatCurrency(orig)}</s>}
      {formatCurrency(row[key])}
    </span>
  );
}

const COST_FILTER = [
  { value: 'all', label: 'Giá vốn: Tất cả' },
  { value: 'pending', label: 'Chưa đủ giá vốn' },
  { value: 'owed', label: 'Còn nợ NCC' },
];
const TICKET_KINDS = [{ value: 'normal', label: 'Vé thường' }, { value: 'down', label: 'Vé down' }];

/** Badge giá vốn của 1 dòng: Vé down / Chưa đủ giá vốn / Nợ NCC. */
export function CostBadges({ row }) {
  const owed = costUnpaid(row);
  return (
    <>
      {row.ticket_kind === 'down' && <Badge tone="purple">Vé down</Badge>}
      {isCostPending(row) && <Badge tone="warning" icon={Hourglass}>Chưa đủ giá vốn</Badge>}
      {owed > 0 && <span title="Còn nợ nhà cung cấp"><Badge tone="outline" icon={Truck} className="tabular">Nợ NCC {formatCurrency(owed)}</Badge></span>}
    </>
  );
}

/** Gợi ý "Chưa đủ giá vốn": tổng giá vốn = 0, hoặc còn dòng giá vốn chưa nhập tiền. */
const suggestPending = (f) => (f.costItems?.length ? f.costItems.some((it) => num(it.amount) <= 0) : num(f.costAmount) <= 0);
/** Khi tạo mới và người dùng chưa tự bật/tắt công tắc: tự gợi ý theo giá vốn. */
const withAutoPending = (f) => (f.id || f.__costPendingTouched ? f : { ...f, costPending: suggestPending(f) });

/**
 * Trang nghiệp vụ dùng chung cho vé máy bay / vé tàu / hộ chiếu / tour.
 * Mọi khác biệt nằm trong `config` (xem serviceConfigs.jsx).
 */
export default function ServicePage({ config: cfg }) {
  const { user } = useAuth();
  const { navigate } = useNavigation();
  const { toast, confirm } = useFeedback();
  const currentUserId = user?.id;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [agencyId, setAgencyId] = useState('');
  const [companies, setCompanies] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [lists, setLists] = useState({});           // dữ liệu phụ (routes, airlines…) do config.loadLists cung cấp
  const [accounts, setAccounts] = useState([]);     // tài khoản tiền (trả trước / trả NCC ngay)
  const [suppliers, setSuppliers] = useState([]);   // nhà cung cấp (dòng giá vốn)
  const [form, setForm] = useState(null);           // null = đóng modal; { ...fields, id? }
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [showDebtors, setShowDebtors] = useState(false);
  const [extraOpen, setExtraOpen] = useState(null); // modal phụ (routes/companies) do config cung cấp
  const [cancelling, setCancelling] = useState(null); // dòng đang mở modal Huỷ / hoàn
  const [changing, setChanging] = useState(null);     // dòng đang mở modal Đổi vé
  const [receiptOpen, setReceiptOpen] = useState(false);

  const t = useTableState({
    storageKey: cfg.storageKey,
    columns: cfg.columns,
    pageSize: 50,
    defaultSort: cfg.defaultSort || { key: cfg.dateKey, dir: 'desc' },
  });
  const { filters, setFilter } = t;
  const month = filters.month || '';
  const pay = filters.pay || 'all';
  const costFilter = filters.cost || 'all';
  const hasLifeFilter = cfg.lifecycleFilter !== false;
  const life = hasLifeFilter ? (filters.life || 'active') : 'all';

  // ---------- Tải dữ liệu ----------
  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      setRows(await api.get(`${cfg.endpoint}${qs({ agencyId })}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cfg.endpoint, agencyId]);

  useEffect(() => { load(); }, [load]);

  const loadAux = useCallback(async () => {
    const [cs, cu, ac, su] = await Promise.all([
      api.get('/companies').catch(() => []),
      api.get('/customers').catch(() => []),
      accountsApi.list().catch(() => []),
      suppliersApi.list().catch(() => []),
    ]);
    setCompanies(cs);
    setCustomers(cu);
    setAccounts(Array.isArray(ac) ? ac : []);
    setSuppliers(Array.isArray(su) ? su : []);
    if (cfg.loadLists) {
      try { setLists(await cfg.loadLists()); } catch { /* bỏ qua */ }
    }
  }, [cfg]);
  useEffect(() => { loadAux(); }, [loadAux]);

  const notifyChanged = () => {
    if (cfg.changeEvent) window.dispatchEvent(new CustomEvent(cfg.changeEvent));
  };

  // ---------- Ngữ cảnh truyền cho config ----------
  const companyById = useCallback((id) => companies.find((c) => String(c.id) === String(id)), [companies]);
  const sources = useMemo(() => [...new Set(rows.map((r) => r[cfg.sourceKey]).filter(Boolean))].sort(), [rows, cfg.sourceKey]);
  const reloadSuppliers = useCallback(async () => {
    setSuppliers(await suppliersApi.list({ fresh: true }).catch(() => []));
  }, []);
  const ctx = useMemo(() => ({
    companies, customers, lists, sources, companyById, currentUserId, user, navigate, accounts, suppliers,
    reloadLists: async () => { if (cfg.loadLists) setLists(await cfg.loadLists()); },
    reloadCompanies: async () => setCompanies(await api.get('/companies').catch(() => [])),
  }), [companies, customers, lists, sources, companyById, currentUserId, user, navigate, accounts, suppliers, cfg]);

  // ---------- Lọc / sắp xếp / phân trang ----------
  const months = useMemo(() => [...new Set(rows.map((r) => monthOf(r[cfg.dateKey])).filter(Boolean))].sort().reverse(), [rows, cfg.dateKey]);
  const extraFilterFns = (cfg.extraFilters || []).map((f) => {
    const v = filters[f.key];
    return v && v !== 'all' ? (row) => f.fn(row, v) : null;
  });
  const result = t.process(rows, {
    searchText: (row) => cfg.searchText(row, ctx),
    filterFns: [
      month ? (row) => monthOf(row[cfg.dateKey]) === month : null,
      pay !== 'all' ? (row) => {
        const s = payState(row, cfg);
        if (pay === 'paid') return s.isPaid;
        if (pay === 'unpaid') return !s.isPaid;
        if (pay === 'overdue') return s.overdue;
        return true;
      } : null,
      life === 'active' ? (row) => !isCancelled(row) : null,
      life === 'cancelled' ? (row) => isCancelled(row) : null,
      costFilter === 'pending' ? (row) => isCostPending(row) : null,
      costFilter === 'owed' ? (row) => costUnpaid(row) > 0 : null,
      ...extraFilterFns,
    ],
    sortValue: (row, key) => {
      const col = cfg.columns.find((c) => c.key === key);
      if (col?.sortValue) return col.sortValue(row, ctx);
      const v = row[key];
      return typeof v === 'string' ? v.toLowerCase() : v;
    },
  });
  const { filtered, sorted, paged, totalPages, page } = result;

  // ---------- Thống kê theo bộ lọc ----------
  // Lợi nhuận bỏ qua dòng "Chưa đủ giá vốn" (cost_pending); doanh số / đã thu / còn nợ vẫn tính đủ.
  const stats = useMemo(() => {
    let total = 0; let cost = 0; let paid = 0; let overdueAmt = 0; let overdueCount = 0; let profit = 0; let pendingCount = 0;
    for (const r of filtered) {
      const s = payState(r, cfg);
      total += s.total; paid += s.paid;
      if (isCostPending(r)) pendingCount += 1;
      else { cost += num(r[cfg.costKey]); profit += s.total - num(r[cfg.costKey]); }
      if (s.overdue) { overdueAmt += s.remaining; overdueCount += 1; }
    }
    return { total, cost, paid, profit, pendingCount, remaining: total - paid, overdueAmt, overdueCount, count: filtered.length };
  }, [filtered, cfg]);

  const debtors = useMemo(() => {
    const m = new Map();
    for (const r of filtered) {
      const s = payState(r, cfg);
      if (s.remaining <= 0) continue;
      const key = `${(r.customer_name || '—').trim().toLowerCase()}|${r.phone_number || ''}`;
      const cur = m.get(key) || { name: r.customer_name || '—', phone: r.phone_number || '', customerId: r.customer_id, outstanding: 0, count: 0 };
      cur.outstanding += s.remaining; cur.count += 1; m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => b.outstanding - a.outstanding);
  }, [filtered, cfg]);

  // ---------- Chọn nhiều ----------
  const owned = (row) => !currentUserId || row.user_id === currentUserId;
  const selectableIds = sorted.filter(owned).map((r) => r.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => t.selected.includes(id));
  const toggleAll = () => t.setSelected(allSelected ? [] : selectableIds);
  // Thu tiền nhiều vé: chỉ khi mọi dòng chọn cùng 1 khách (customer_id) và chưa huỷ.
  const selectedRows = rows.filter((r) => t.selected.includes(r.id));
  const selCustomerIds = [...new Set(selectedRows.map((r) => r.customer_id ?? null))];
  const selCustomerId = selCustomerIds.length === 1 ? selCustomerIds[0] : null;
  const receiptBlockedReason = !selectedRows.length ? ''
    : selCustomerId === null ? 'Chỉ thu chung được cho cùng 1 khách'
      : selectedRows.some((r) => isCancelled(r) && payState(r, cfg).remaining <= 0) ? 'Có dịch vụ đã huỷ và hết nợ trong các dòng đã chọn'
        : '';

  // ---------- CRUD ----------
  const openAdd = () => setForm({ ...cfg.emptyForm, [cfg.form.dateField || 'issueDate']: today(), accountId: defaultAccountId(accounts) });
  const openEdit = (row) => setForm({ ...cfg.toForm(row), id: row.id });
  const closeForm = () => setForm(null);

  const save = async () => {
    const err = cfg.validate(form);
    if (err) { toast.error(err); return; }
    setSaving(true);
    try {
      const body = cfg.toPayload(form, { editing: !!form.id });
      if (form.id) await api.put(`${cfg.endpoint}/${form.id}`, body);
      else await api.post(cfg.endpoint, body);
      if (body.accountId) rememberAccount(body.accountId);
      if (body.costItems) {
        // Trả NCC ngay / đổi dòng giá vốn làm thay đổi số dư NCC + tài khoản.
        invalidateMoneyCache();
        reloadSuppliers();
      }
      toast.success(form.id ? 'Đã cập nhật' : `Đã thêm ${cfg.itemLabel}`);
      setForm(null);
      await load({ silent: true });
      // Khách hàng mới có thể vừa được tạo tự động.
      api.get('/customers').then(setCustomers).catch(() => {});
      notifyChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    const ok = await confirm({ title: `Xoá ${cfg.itemLabel}`, message: `Xoá ${cfg.itemLabel} của "${row.customer_name}"? Lịch sử thanh toán kèm theo cũng bị xoá.` });
    if (!ok) return;
    try {
      await api.del(`${cfg.endpoint}/${row.id}`);
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      t.setSelected((s) => s.filter((x) => x !== row.id));
      toast.success('Đã xoá');
      notifyChanged();
    } catch (err) { toast.error(err.message); }
  };

  const bulkDelete = async () => {
    const n = t.selected.length;
    const ok = await confirm({ title: 'Xoá hàng loạt', message: `Xoá ${n} ${cfg.itemLabel} đã chọn? Không thể hoàn tác.`, confirmText: `Xoá ${n} mục` });
    if (!ok) return;
    try {
      const data = await api.post(`${cfg.endpoint}/bulk-delete`, { ids: t.selected });
      const removed = new Set(t.selected);
      setRows((rs) => rs.filter((r) => !removed.has(r.id)));
      t.clearSelection();
      toast.success(`Đã xoá ${data.deleted} ${cfg.itemLabel}`);
      notifyChanged();
    } catch (err) { toast.error(err.message); }
  };

  // ---------- Huỷ / hoàn tác huỷ / đổi vé / thu nhiều vé ----------
  const afterMoneyAction = async () => {
    invalidateMoneyCache();
    reloadSuppliers();
    await load({ silent: true });
    notifyChanged();
  };

  const uncancel = async (row) => {
    const ok = await confirm({
      title: 'Hoàn tác huỷ',
      message: `Khôi phục ${cfg.itemLabel} của "${row.customer_name}"? Giá bán về như trước khi huỷ, các khoản hoàn tiền khách / NCC hoàn ghi lúc huỷ sẽ bị xoá.`,
      confirmText: 'Hoàn tác huỷ',
    });
    if (!ok) return;
    try {
      await serviceActionsApi.uncancel(cfg.endpoint, row.id);
      toast.success('Đã hoàn tác huỷ');
      await afterMoneyAction();
    } catch (err) { toast.error(err.message); }
  };

  const onCancelDone = async () => { setCancelling(null); await afterMoneyAction(); };
  const onChangeDone = async () => { setChanging(null); await afterMoneyAction(); };
  const onReceiptDone = async () => { setReceiptOpen(false); t.clearSelection(); await afterMoneyAction(); };

  const moreMenu = (row) => {
    const cancelled = isCancelled(row);
    return (
      <Dropdown trigger={<IconButton icon={MoreHorizontal} title="Thao tác khác" />} width="w-48">
        {!cancelled && <MenuItem icon={Ban} danger onClick={() => setCancelling(row)}>Huỷ / hoàn</MenuItem>}
        {cancelled && <MenuItem icon={Undo2} onClick={() => uncancel(row)}>Hoàn tác huỷ</MenuItem>}
        {cfg.changeTicket && !cancelled && <MenuItem icon={Repeat} onClick={() => setChanging(row)}>Đổi vé</MenuItem>}
      </Dropdown>
    );
  };

  const setField = (key, value) => setForm((f) => withAutoPending({ ...f, [key]: value }));

  // ---------- Giá vốn ----------
  const setCostItems = (items) => setForm((f) => withAutoPending({
    ...f,
    costItems: items,
    // Có dòng → giá gốc = tổng các dòng (server cũng tính lại). Xoá hết dòng → về ô giá gốc đơn.
    costAmount: items.length ? String(costTotal(items)) : '',
  }));
  const splitCost = () => {
    const cur = num(form.costAmount);
    setCostItems([newCostItem({ amount: cur > 0 ? String(Math.round(cur)) : '' })]);
  };
  const setTicketKind = (kind) => setForm((f) => {
    const next = { ...f, ticketKind: kind };
    if (kind !== 'down' || f.costItems?.length) return next;
    const items = downTemplate(suppliers);
    return withAutoPending({ ...next, costItems: items, costAmount: String(costTotal(items)) });
  });

  // ---------- Export ----------
  const exportXlsx = async () => {
    const cols = cfg.exportColumns(ctx);
    const headers = cols.map((c) => c.label);
    const data = sorted.map((r) => cols.map((c) => c.value(r)));
    const moneyCols = cols.map((c, i) => (c.money ? i : -1)).filter((i) => i >= 0);
    const byMonth = {};
    for (const r of filtered) {
      const m = monthOf(r[cfg.dateKey]) || 'Không rõ';
      const s = payState(r, cfg);
      const x = byMonth[m] || (byMonth[m] = { count: 0, total: 0, cost: 0, profit: 0, paid: 0, pending: 0 });
      x.count += 1; x.total += s.total; x.cost += num(r[cfg.costKey]); x.paid += s.paid;
      // Lợi nhuận không tính dòng "Chưa đủ giá vốn".
      if (isCostPending(r)) x.pending += 1; else x.profit += s.total - num(r[cfg.costKey]);
    }
    const ms = Object.keys(byMonth).sort();
    const sumRows = ms.map((m) => { const x = byMonth[m]; return [m, x.count, x.total, x.cost, x.profit, x.paid, x.total - x.paid, x.pending]; });
    const tot = ms.reduce((a, m) => { const x = byMonth[m]; a.count += x.count; a.total += x.total; a.cost += x.cost; a.profit += x.profit; a.paid += x.paid; a.pending += x.pending; return a; }, { count: 0, total: 0, cost: 0, profit: 0, paid: 0, pending: 0 });
    sumRows.push(['TỔNG CỘNG', tot.count, tot.total, tot.cost, tot.profit, tot.paid, tot.total - tot.paid, tot.pending]);
    try {
      await exportWorkbook(`${cfg.exportName}-${today()}.xlsx`, [
        { name: cfg.title, aoa: [headers, ...data], colWidths: cols.map((c) => c.width || 14), moneyCols },
        { name: 'Tổng kết tháng', aoa: [['Tháng', 'Số lượng', 'Doanh số', 'Giá gốc', 'Lợi nhuận', 'Đã thu', 'Còn nợ', 'Chưa đủ giá vốn (không tính lãi)'], ...sumRows], colWidths: [12, 10, 16, 16, 16, 16, 16, 18], moneyCols: [2, 3, 4, 5, 6] },
      ]);
    } catch { toast.error('Lỗi khi xuất Excel'); }
  };

  const importRows = async (importRowsData) => {
    try {
      const data = await api.post(`${cfg.endpoint}/import`, { rows: importRowsData });
      return { inserted: data.inserted || 0, failed: data.failed ?? (data.errors?.length || 0), errors: data.errors || [] };
    } catch (err) {
      if (err.data && (err.data.inserted !== undefined || err.data.errors)) {
        return { inserted: err.data.inserted || 0, failed: err.data.failed ?? (err.data.errors?.length || 0), errors: err.data.errors || (err.data.error ? [{ row: '-', message: err.data.error }] : []) };
      }
      throw err;
    }
  };

  // ---------- Cột ----------
  const actionCol = {
    key: '__actions', label: '', align: 'right', width: 140,
    render: (row) => owned(row) ? (
      <div className="flex justify-end gap-0.5 opacity-70 group-hover:opacity-100 transition">
        {(!isCancelled(row) || payState(row, cfg).remaining > 0) && <IconButton icon={Wallet} title="Thanh toán" variant="success" onClick={(e) => { e.stopPropagation(); setPaying(row); }} />}
        <IconButton icon={Pencil} title="Sửa" variant="primary" onClick={(e) => { e.stopPropagation(); openEdit(row); }} />
        <IconButton icon={Trash2} title="Xoá" variant="danger" onClick={(e) => { e.stopPropagation(); remove(row); }} />
        {moreMenu(row)}
      </div>
    ) : <Badge tone="outline" icon={Eye}>Chỉ xem</Badge>,
  };
  const visibleColumns = [
    ...cfg.columns.filter((c) => c.required || t.isVisible(c.key)).map((c) => ({ ...c, render: (row) => (c.render ? c.render(row, { ...ctx, cfg, payState, reload: () => load({ silent: true }), toast }) : row[c.key]) })),
    actionCol,
  ];

  const Icon = cfg.icon;
  const renderCostSection = (f) => {
    const items = form.costItems || [];
    return (
      <div key={f.key} className="sm:col-span-2 lg:col-span-3 rounded-xl border border-surface-border bg-surface-muted p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] font-semibold text-ink">Giá vốn</p>
          {cfg.form.ticketKind && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-muted">Loại vé</span>
              <Segmented value={form.ticketKind || 'normal'} onChange={setTicketKind} options={TICKET_KINDS} />
            </div>
          )}
        </div>
        {cfg.form.ticketKind && (
          <p className="text-xs text-ink-faint -mt-1.5">Vé down = vé xuất giảm: giá vốn gồm phí bên down + giá vé F1 + phí F1</p>
        )}
        {items.length > 0 ? (
          <CostItemsEditor
            value={items}
            onChange={setCostItems}
            suppliers={suppliers}
            accounts={accounts}
            readOnlyPaid
            onSupplierCreated={reloadSuppliers}
          />
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <Field label={f.label} htmlFor="f-costAmount" className="w-full sm:w-64">
              <MoneyField id="f-costAmount" value={form.costAmount ?? ''} placeholder={f.placeholder} onChange={(v) => setField('costAmount', v)} />
            </Field>
            <Button size="sm" variant="soft" icon={ListPlus} onClick={splitCost} title="Giá vốn gồm nhiều khoản, mỗi khoản trả cho 1 nhà cung cấp">
              Chia nhiều khoản
            </Button>
          </div>
        )}
        <Switch
          checked={!!form.costPending}
          onChange={(v) => setForm((fm) => ({ ...fm, costPending: v, __costPendingTouched: true }))}
          label="Chưa đủ giá vốn (chưa tính lãi)"
        />
      </div>
    );
  };

  const renderField = (f) => {
    if (f.showWhen && !f.showWhen(form, ctx)) return null;
    if (f.type === 'cost') return renderCostSection(f);
    const val = form[f.key] ?? '';
    const common = { id: `f-${f.key}`, value: val, placeholder: f.placeholder };
    let control;
    switch (f.type) {
      case 'money':
        control = <MoneyField {...common} onChange={(v) => setField(f.key, v)} disabled={f.disabled?.(form)} />;
        break;
      case 'date':
        control = <DateField id={common.id} value={val} onChange={(v) => setField(f.key, v)} />;
        break;
      case 'select':
        control = (
          <Select {...common} onChange={(e) => setField(f.key, e.target.value)}>
            {(typeof f.options === 'function' ? f.options(ctx) : f.options).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        );
        break;
      case 'account': {
        const accs = activeAccounts(accounts);
        control = (
          <Select {...common} onChange={(e) => setField(f.key, e.target.value)}>
            <option value="">— Chưa chọn tài khoản —</option>
            {accs.map((a) => <option key={a.id} value={String(a.id)}>{accountLabel(a)}</option>)}
          </Select>
        );
        break;
      }
      case 'company':
        control = (
          <Select {...common} onChange={(e) => setField(f.key, e.target.value)}>
            <option value="">Khách lẻ</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        );
        break;
      case 'customer':
        control = (
          <>
            <Input {...common} list="svc-customer-options" autoComplete="off"
              onChange={(e) => {
                const name = e.target.value;
                const match = customers.find((c) => c.name === name);
                setForm((fm) => ({ ...fm, [f.key]: name, phoneNumber: match?.phone && !fm.phoneNumber ? match.phone : fm.phoneNumber }));
              }} />
            <datalist id="svc-customer-options">
              {[...new Map(customers.map((c) => [c.name, c])).values()].map((c) => <option key={c.id} value={c.name}>{c.phone || ''}</option>)}
            </datalist>
          </>
        );
        break;
      case 'datalist': {
        const opts = typeof f.options === 'function' ? f.options(ctx) : f.options || [];
        control = (
          <>
            <Input {...common} list={`svc-list-${f.key}`} autoComplete="off" onChange={(e) => setField(f.key, f.upper ? e.target.value.toUpperCase() : e.target.value)} />
            <datalist id={`svc-list-${f.key}`}>{opts.map((o) => <option key={o} value={o} />)}</datalist>
          </>
        );
        break;
      }
      case 'number':
        control = <Input {...common} type="number" min={f.min} max={f.max} onChange={(e) => setField(f.key, e.target.value)} />;
        break;
      case 'textarea':
        control = <Textarea {...common} rows={2} onChange={(e) => setField(f.key, e.target.value)} />;
        break;
      default:
        control = <Input {...common} onChange={(e) => setField(f.key, e.target.value)} />;
    }
    const hint = typeof f.hint === 'function' ? f.hint(form, ctx) : f.hint;
    return (
      <Field key={f.key} label={f.label} required={f.required} hint={hint} htmlFor={`f-${f.key}`} className={f.span === 2 ? 'sm:col-span-2' : f.span === 3 ? 'sm:col-span-3' : ''}>
        {control}
      </Field>
    );
  };

  const mobileCard = (row) => {
    const s = payState(row, cfg);
    return (
      <div className={`flex flex-col gap-1.5 ${s.cancelled ? 'opacity-60' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-ink truncate">{row.customer_name}</p>
            <p className="text-xs text-ink-muted truncate">{cfg.mobileSubtitle(row, ctx)}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-1"><CancelledBadge row={row} /><PayBadge row={row} cfg={cfg} /></div>
        </div>
        {(row.ticket_kind === 'down' || isCostPending(row) || costUnpaid(row) > 0) && (
          <div className="flex flex-wrap gap-1"><CostBadges row={row} /></div>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-muted">Giá bán <span className="text-ink tabular"><AmountCell row={row} cfg={cfg} /></span></span>
          <span className={`font-bold tabular ${s.isPaid ? 'text-success-600' : 'text-danger-600'}`}>{s.isPaid ? 'Đã trả đủ' : `Nợ ${formatCurrency(s.remaining)}`}</span>
        </div>
        {owned(row) && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {(!s.cancelled || s.remaining > 0) && <Button size="xs" variant="soft" icon={Wallet} onClick={() => setPaying(row)}>Thanh toán</Button>}
            <Button size="xs" variant="secondary" icon={Pencil} onClick={() => openEdit(row)}>Sửa</Button>
            <Button size="xs" variant="ghost" icon={Trash2} className="text-danger-600" onClick={() => remove(row)}>Xoá</Button>
            {moreMenu(row)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        icon={Icon}
        help={cfg.helpTopic}
        title={cfg.title}
        description={cfg.description}
        actions={(
          <>
            {cfg.extraActions?.(ctx, { open: setExtraOpen })}
            {cfg.importFields && <Button variant="secondary" icon={Upload} onClick={() => setImportOpen(true)}>Import</Button>}
            <Button variant="secondary" icon={Download} onClick={exportXlsx} disabled={!sorted.length}>Excel</Button>
            <Button icon={Plus} onClick={openAdd}>{cfg.addLabel}</Button>
          </>
        )}
      />

      {/* Thẻ số liệu theo bộ lọc */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
        <StatCard icon={Receipt} label="Doanh số" value={formatCurrency(stats.total)} sub={`${stats.count} ${cfg.itemLabel}`} tone="brand" />
        <StatCard
          icon={TrendingUp}
          label="Lợi nhuận"
          value={formatCurrency(stats.profit)}
          sub={stats.pendingCount > 0 ? `Không tính ${stats.pendingCount} dòng chưa đủ giá vốn` : `Giá gốc ${formatCurrency(stats.cost)}`}
          tone={stats.profit >= 0 ? 'success' : 'danger'}
          onClick={stats.pendingCount > 0 ? () => setFilter('cost', costFilter === 'pending' ? 'all' : 'pending') : undefined}
        />
        <StatCard icon={PiggyBank} label="Đã thu" value={formatCurrency(stats.paid)} sub={stats.total ? `${Math.round((stats.paid / stats.total) * 100)}% doanh số` : ''} tone="purple" />
        <StatCard icon={Landmark} label="Còn nợ" value={formatCurrency(stats.remaining)} tone="warning" onClick={() => setShowDebtors((v) => !v)} sub={showDebtors ? 'Bấm để ẩn danh sách' : 'Bấm xem ai còn nợ'} />
        <StatCard icon={AlertTriangle} label="Quá hạn" value={formatCurrency(stats.overdueAmt)} sub={`${stats.overdueCount} ${cfg.itemLabel}`} tone="danger" onClick={() => setFilter('pay', pay === 'overdue' ? 'all' : 'overdue')} />
      </div>

      {/* Ai còn nợ */}
      {showDebtors && (
        <div className="card mb-5 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
            <h3 className="font-semibold text-ink flex items-center gap-2"><Users size={16} className="text-ink-muted" /> Ai còn nợ (theo bộ lọc hiện tại)</h3>
            <span className="text-sm text-ink-muted">{debtors.length} khách · <b className="text-danger-600 tabular">{formatCurrency(debtors.reduce((s, x) => s + x.outstanding, 0))}</b></span>
          </div>
          {debtors.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-muted text-center">Không ai còn nợ trong bộ lọc này 🎉</p>
          ) : (
            <ul className="divide-y divide-surface-border max-h-72 overflow-y-auto">
              {debtors.map((d) => (
                <li key={`${d.name}|${d.phone}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-surface-muted">
                  <button type="button" className="min-w-0 text-left" onClick={() => d.customerId && navigate('customer', d.customerId)}>
                    <span className={`font-medium ${d.customerId ? 'hover:text-brand-600' : ''}`}>{d.name}</span>
                    <span className="text-ink-faint"> · {d.phone || 'không SĐT'} · {d.count} {cfg.itemLabel}</span>
                  </button>
                  <span className="font-semibold text-danger-600 tabular shrink-0">{formatCurrency(d.outstanding)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Thanh công cụ */}
      <div className="card mb-4 p-3 flex flex-col lg:flex-row lg:items-center gap-2.5">
        <SearchInput value={t.search} onChange={t.setSearch} placeholder={cfg.searchPlaceholder} className="lg:w-80" />
        <div className="flex flex-wrap items-center gap-2">
          <Select size="sm" value={month} onChange={(e) => setFilter('month', e.target.value)} className="w-36" title="Lọc theo tháng">
            <option value="">Mọi tháng</option>
            {months.map((m) => <option key={m} value={m}>{formatMonth(m)}</option>)}
          </Select>
          <Select size="sm" value={pay} onChange={(e) => setFilter('pay', e.target.value)} className="w-36">
            {PAY_FILTER.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          {hasLifeFilter && (
            <Select size="sm" value={life} onChange={(e) => setFilter('life', e.target.value)} className="w-44" title="Lọc theo trạng thái huỷ" aria-label="Trạng thái">
              {LIFE_FILTER.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          )}
          <Select size="sm" value={costFilter} onChange={(e) => setFilter('cost', e.target.value)} className="w-44" title="Lọc theo giá vốn" aria-label="Lọc giá vốn">
            {COST_FILTER.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          {(cfg.extraFilters || []).map((f) => (
            <Select key={f.key} size="sm" value={filters[f.key] || 'all'} onChange={(e) => setFilter(f.key, e.target.value)} className="w-36">
              <option value="all">{f.label}</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          ))}
          <AgencyFilter value={agencyId} onChange={setAgencyId} />
          {(t.search || month || pay !== 'all' || Object.entries(filters).some(([k, v]) => v && v !== 'all' && !(k === 'life' && v === 'active'))) && (
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => { t.setSearch(''); t.setFilters({}); }}>Xoá lọc</Button>
          )}
        </div>
        <div className="flex items-center gap-1 lg:ml-auto">
          <IconButton icon={RefreshCw} title="Tải lại" onClick={() => load({ silent: true })} className={refreshing ? 'animate-spin' : ''} />
          <Dropdown
            trigger={<Button size="sm" variant="secondary" icon={Columns3}>Cột</Button>}
            width="w-52"
          >
            {t.toggleable.map((c) => (
              <label key={c.key} className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] hover:bg-surface-subtle cursor-pointer">
                <input type="checkbox" checked={t.isVisible(c.key)} onChange={() => t.toggleCol(c.key)} className="h-4 w-4 rounded border-slate-300 text-brand-600" />
                {c.label}
              </label>
            ))}
            <div className="border-t border-surface-border mt-1 pt-1">
              <MenuItem icon={RotateCcw} onClick={t.resetCols}>Mặc định</MenuItem>
            </div>
          </Dropdown>
        </div>
      </div>

      {/* Thanh xoá hàng loạt */}
      {t.selected.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-100 bg-brand-50 px-4 py-2.5 animate-fade-in">
          <span className="text-sm font-medium text-brand-700">Đã chọn {t.selected.length} {cfg.itemLabel}</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={t.clearSelection}>Bỏ chọn</Button>
            <span title={receiptBlockedReason || undefined}>
              <Button size="sm" variant="success" icon={HandCoins} disabled={!!receiptBlockedReason} title={receiptBlockedReason || undefined} onClick={() => setReceiptOpen(true)}>
                Thu tiền các vé đã chọn
              </Button>
            </span>
            <Button size="sm" variant="danger" icon={Trash2} onClick={bulkDelete}>Xoá đã chọn</Button>
          </div>
        </div>
      )}

      <ErrorBanner message={error} onRetry={load} />

      <DataTable
        columns={visibleColumns}
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
        rowClassName={(row) => (isCancelled(row) ? 'opacity-60' : payState(row, cfg).overdue ? 'bg-danger-50/40' : '')}
        emptyIcon={Icon}
        emptyTitle={rows.length ? 'Không có dòng nào khớp bộ lọc' : `Chưa có ${cfg.itemLabel} nào`}
        emptyDescription={rows.length ? 'Thử đổi tháng, trạng thái hoặc từ khoá tìm kiếm.' : `Bấm "${cfg.addLabel}" để bắt đầu, hoặc Import từ Excel.`}
        emptyAction={!rows.length && <Button icon={Plus} onClick={openAdd}>{cfg.addLabel}</Button>}
        pagination={{ page, totalPages, total: sorted.length, pageSize: t.pageSize, onChange: t.setPage }}
        mobileCard={mobileCard}
        footer={filtered.length > 0 && cfg.footer ? cfg.footer(stats, visibleColumns) : null}
      />

      {/* Form thêm/sửa */}
      <Modal
        open={!!form}
        onClose={closeForm}
        icon={Icon}
        title={form?.id ? `Sửa ${cfg.itemLabel}` : cfg.addLabel}
        subtitle={form?.id ? `#${form.id}` : undefined}
        size="xl"
        footer={(
          <>
            <Button variant="secondary" onClick={closeForm}>Huỷ</Button>
            <Button icon={CheckCircle2} loading={saving} onClick={save}>{form?.id ? 'Lưu thay đổi' : 'Thêm mới'}</Button>
          </>
        )}
      >
        {form && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {cfg.form.fields.map(renderField)}
            {cfg.form.profitPreview !== false && (
              <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl bg-surface-subtle px-4 py-2.5 text-sm">
                <span className="text-ink-muted">Lợi nhuận dự kiến:</span>
                {form.costPending ? (
                  <b className="text-warning-700">Chưa tính (chưa đủ giá vốn)</b>
                ) : (
                  <b className={`tabular ${num(form[cfg.form.amountField]) - num(form.costAmount) >= 0 ? 'text-success-600' : 'text-danger-600'}`}>
                    {formatCurrency(num(form[cfg.form.amountField]) - num(form.costAmount))}
                  </b>
                )}
                {!form.id && num(form.paid) > 0 && (
                  <span className="text-ink-muted">Còn nợ sau trả trước: <b className="text-danger-600 tabular">{formatCurrency(num(form[cfg.form.amountField]) - num(form.paid))}</b></span>
                )}
              </div>
            )}
            <button type="submit" className="hidden" aria-hidden />
          </form>
        )}
      </Modal>

      {paying && (
        <PaymentModal
          target={{ type: cfg.paymentType, id: paying.id, name: cfg.paymentLabel(paying), total: paying[cfg.amountKey], paid: paying[cfg.paidKey], customerId: paying.customer_id, cancelled: isCancelled(paying) }}
          onClose={() => setPaying(null)}
          onChanged={() => { load({ silent: true }); notifyChanged(); }}
        />
      )}

      <CancelModal open={!!cancelling} row={cancelling} cfg={cfg} onClose={() => setCancelling(null)} onDone={onCancelDone} />
      {cfg.changeTicket && (
        <ChangeTicketModal open={!!changing} row={changing} cfg={cfg} onClose={() => setChanging(null)} onDone={onChangeDone} />
      )}
      {receiptOpen && selCustomerId !== null && (
        <ReceiptModal
          open
          onClose={() => setReceiptOpen(false)}
          onDone={onReceiptDone}
          customerId={selCustomerId}
          preselect={selectedRows.map((r) => ({ type: cfg.paymentType, id: r.id }))}
        />
      )}

      {cfg.importFields && (
        <ImportModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          title={`Import ${cfg.title.toLowerCase()} từ Excel`}
          templateName={`mau-import-${cfg.exportName}.xlsx`}
          fields={cfg.importFields}
          sampleRow={cfg.importSample}
          onImport={importRows}
          onSuccess={() => { load({ silent: true }); notifyChanged(); }}
        />
      )}

      {cfg.extraModals?.(ctx, { open: extraOpen, close: () => setExtraOpen(null) })}
    </div>
  );
}

/** Ô ngày bay/đi kèm nhãn "ngày mai", "còn N ngày". */
export function DateCell({ value, soonLabel = true }) {
  if (!value) return <span className="text-ink-faint">—</span>;
  const d = daysUntil(value);
  let tag = null;
  if (soonLabel && d !== null) {
    if (d === 0) tag = <Badge tone="warning">Hôm nay</Badge>;
    else if (d === 1) tag = <Badge tone="warning">Ngày mai</Badge>;
    else if (d > 1 && d <= 7) tag = <Badge tone="brand">{d} ngày</Badge>;
  }
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap">{formatDate(value)}{tag}</span>;
}

