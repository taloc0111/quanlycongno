import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReceiptText, Plus, RefreshCw, Download, ArrowUpRight, ArrowDownLeft, UserRoundCog, Pencil, Trash2, Eye,
} from 'lucide-react';
import { useAuth } from './auth/AuthContext';
import { useFeedback } from './ui/FeedbackContext';
import { useTableState } from './hooks/useTableState';
import { ENTRY_CATEGORIES, accountLabel, accountsApi, entriesApi, isOwnerCategory } from './services/money';
import { exportToExcel } from './utils/excel';
import { formatCurrency, formatDate, formatMonth, monthOf, num, today } from './utils/format';
import { Badge, Button, DataTable, ErrorBanner, IconButton, PageHeader, SearchInput, Select, StatCard } from './ui';
import EntryModal from './modules/money/EntryModal';
import ReconcileToggle from './modules/money/ReconcileToggle';
import { isOwnedBy } from './modules/money/moneyUtils';

const COLUMNS = [
  { key: 'entry_date', label: 'Ngày', sortable: true, width: 100 },
  { key: 'direction', label: 'Chiều', width: 80 },
  { key: 'category', label: 'Danh mục', sortable: true },
  { key: 'account', label: 'Tài khoản', hideBelow: 'md' },
  { key: 'amount', label: 'Số tiền', align: 'right', sortable: true },
  { key: 'notes', label: 'Ghi chú', hideBelow: 'lg' },
  { key: 'reconciled', label: 'Đối soát', align: 'center', width: 80, hideBelow: 'sm' },
  { key: 'actions', label: '', align: 'right' },
];

const ALL_CATEGORIES = [...ENTRY_CATEGORIES.out, ...ENTRY_CATEGORIES.in];

/** Trang "Thu chi khác" (`#expenses`): phí ngân hàng, lương, văn phòng, góp vốn, rút tiền riêng… */
export default function ExpensesApp() {
  const { user } = useAuth();
  const { toast, confirm } = useFeedback();
  const [rows, setRows] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [direction, setDirection] = useState('all');
  const [category, setCategory] = useState('all');
  const [accountId, setAccountId] = useState('all');
  const [editing, setEditing] = useState(null); // null | {} | row
  const t = useTableState({ storageKey: 'expenses', columns: COLUMNS, pageSize: 50, defaultSort: { key: 'entry_date', dir: 'desc' } });

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const [entries, accs] = await Promise.all([
        entriesApi.list(),
        accountsApi.list({ includeArchived: true, fresh: true }).catch(() => []),
      ]);
      setRows(Array.isArray(entries) ? entries : []);
      setAccounts(Array.isArray(accs) ? accs : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const accountName = useCallback((r) => {
    if (r.account_name) return r.account_name;
    const a = accounts.find((x) => String(x.id) === String(r.account_id));
    return a ? accountLabel(a) : '';
  }, [accounts]);

  // Tháng có dữ liệu (mới → cũ) + tháng hiện tại.
  const months = useMemo(() => {
    const set = new Set(rows.map((r) => monthOf(r.entry_date)).filter(Boolean));
    set.add(today().slice(0, 7));
    return [...set].sort().reverse();
  }, [rows]);

  const categoryOptions = direction === 'all' ? ALL_CATEGORIES : ENTRY_CATEGORIES[direction];
  const { sorted, paged, totalPages, page } = t.process(rows, {
    searchText: (r) => [r.category, r.notes, accountName(r)].filter(Boolean).join(' '),
    filterFns: [
      month !== 'all' ? (r) => monthOf(r.entry_date) === month : null,
      direction !== 'all' ? (r) => r.direction === direction : null,
      category !== 'all' ? (r) => r.category === category : null,
      accountId !== 'all' ? (r) => String(r.account_id) === accountId : null,
    ],
    sortValue: (r, key) => (key === 'amount' ? num(r.amount) : key === 'category' ? (r.category || '').toLowerCase() : String(r.entry_date || '')),
  });

  // Thẻ số liệu luôn tính theo tháng hiện tại (không theo bộ lọc).
  const stats = useMemo(() => {
    const cur = today().slice(0, 7);
    const s = { expense: 0, income: 0, withdraw: 0, contribute: 0, expenseCount: 0, incomeCount: 0 };
    for (const r of rows) {
      if (monthOf(r.entry_date) !== cur) continue;
      const amt = num(r.amount);
      if (isOwnerCategory(r.category)) {
        if (r.direction === 'out') s.withdraw += amt; else s.contribute += amt;
      } else if (r.direction === 'out') { s.expense += amt; s.expenseCount += 1; } else { s.income += amt; s.incomeCount += 1; }
    }
    return s;
  }, [rows]);

  const reconcile = async (r, next) => {
    setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, reconciled: next } : x)));
    try {
      await accountsApi.reconcile('entry', r.id, next);
    } catch (err) {
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, reconciled: !next } : x)));
      toast.error(err.message);
    }
  };

  const remove = async (r) => {
    const ok = await confirm({ title: 'Xoá khoản thu/chi', message: `Xoá "${r.category}" ${formatCurrency(r.amount)} ngày ${formatDate(r.entry_date)}?`, confirmText: 'Xoá', danger: true });
    if (!ok) return;
    try {
      await entriesApi.remove(r.id);
      toast.success('Đã xoá');
      load({ silent: true });
    } catch (err) { toast.error(err.message); }
  };

  const exportExcel = async () => {
    try {
      const aoa = [
        ['Ngày', 'Chiều', 'Danh mục', 'Tài khoản', 'Số tiền', 'Ghi chú', 'Đối soát', 'Không tính lãi/lỗ'],
        ...sorted.map((r) => [
          formatDate(r.entry_date), r.direction === 'in' ? 'Thu' : 'Chi', r.category || '', accountName(r),
          num(r.amount), r.notes || '', r.reconciled ? 'x' : '', isOwnerCategory(r.category) ? 'x' : '',
        ]),
      ];
      await exportToExcel(`thu-chi-khac${month !== 'all' ? `-${month}` : ''}.xlsx`, aoa, { sheetName: 'Thu chi khác', colWidths: [12, 8, 18, 24, 15, 40, 9, 12], moneyCols: [4] });
    } catch {
      toast.error('Lỗi khi xuất Excel');
    }
  };

  const dirBadge = (r) => (r.direction === 'in'
    ? <Badge tone="success" icon={ArrowDownLeft}>Thu</Badge>
    : <Badge tone="danger" icon={ArrowUpRight}>Chi</Badge>);
  const actions = (r) => (isOwnedBy(r, user) ? (
    <div className="flex items-center justify-end gap-0.5">
      <IconButton icon={Pencil} title="Sửa" onClick={() => setEditing(r)} />
      <IconButton icon={Trash2} title="Xoá" variant="danger" onClick={() => remove(r)} />
    </div>
  ) : <Badge tone="outline" icon={Eye}>Chỉ xem</Badge>);

  const columns = [
    { ...COLUMNS[0], render: (r) => formatDate(r.entry_date) },
    { ...COLUMNS[1], render: dirBadge },
    {
      ...COLUMNS[2], render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-medium text-ink">{r.category || 'Khác'}</span>
          {isOwnerCategory(r.category) && <Badge tone="purple">Của chủ</Badge>}
        </span>
      ),
    },
    { ...COLUMNS[3], render: (r) => accountName(r) || <span className="text-ink-faint">—</span> },
    { ...COLUMNS[4], render: (r) => <span className={`font-semibold ${r.direction === 'in' ? 'text-success-600' : 'text-danger-600'}`}>{r.direction === 'in' ? '+' : '−'}{formatCurrency(r.amount)}</span> },
    { ...COLUMNS[5], render: (r) => <span className="text-ink-muted">{r.notes || ''}</span> },
    { ...COLUMNS[6], render: (r) => <ReconcileToggle checked={r.reconciled} disabled={!isOwnedBy(r, user)} onChange={(v) => reconcile(r, v)} /> },
    { ...COLUMNS[7], render: actions },
  ];

  const filteredIn = sorted.filter((r) => r.direction === 'in').reduce((s, r) => s + num(r.amount), 0);
  const filteredOut = sorted.filter((r) => r.direction !== 'in').reduce((s, r) => s + num(r.amount), 0);

  return (
    <div>
      <PageHeader
        help="expenses"
        icon={ReceiptText}
        title="Thu chi khác"
        description="Chi phí ngoài vé (phí ngân hàng, lương, văn phòng…) và tiền chủ góp/rút"
        actions={(
          <>
            <IconButton icon={RefreshCw} title="Tải lại" onClick={() => load({ silent: true })} className={refreshing ? 'animate-spin' : ''} />
            <Button variant="secondary" icon={Download} onClick={exportExcel} disabled={!sorted.length}>Excel</Button>
            <Button icon={Plus} onClick={() => setEditing({})}>Thêm thu/chi</Button>
          </>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <StatCard icon={ArrowUpRight} label="Tổng chi tháng này" value={loading ? '…' : formatCurrency(stats.expense)} sub={`${stats.expenseCount} khoản · tính vào lãi/lỗ`} tone="danger" />
        <StatCard icon={ArrowDownLeft} label="Tổng thu khác tháng này" value={loading ? '…' : formatCurrency(stats.income)} sub={`${stats.incomeCount} khoản · tính vào lãi/lỗ`} tone="success" />
        <StatCard icon={UserRoundCog} label="Rút/góp của chủ" value={loading ? '…' : formatCurrency(stats.contribute - stats.withdraw)} sub={`Góp ${formatCurrency(stats.contribute)} · Rút ${formatCurrency(stats.withdraw)} — không tính lãi/lỗ`} tone="purple" />
      </div>

      <div className="card mb-4 p-3 flex flex-col lg:flex-row lg:flex-wrap lg:items-center gap-2.5">
        <SearchInput value={t.search} onChange={t.setSearch} placeholder="Tìm danh mục, ghi chú…" className="lg:w-64" />
        <Select size="sm" value={month} onChange={(e) => { setMonth(e.target.value); t.setPage(1); }} aria-label="Lọc tháng" className="lg:w-36">
          <option value="all">Mọi tháng</option>
          {months.map((m) => <option key={m} value={m}>{formatMonth(m)}</option>)}
        </Select>
        <Select
          size="sm"
          value={direction}
          onChange={(e) => {
            const d = e.target.value;
            setDirection(d);
            if (d !== 'all' && category !== 'all' && !ENTRY_CATEGORIES[d].some((c) => c.value === category)) setCategory('all');
            t.setPage(1);
          }}
          aria-label="Lọc chiều"
          className="lg:w-32"
        >
          <option value="all">Thu & chi</option>
          <option value="out">Chi</option>
          <option value="in">Thu</option>
        </Select>
        <Select size="sm" value={category} onChange={(e) => { setCategory(e.target.value); t.setPage(1); }} aria-label="Lọc danh mục" className="lg:w-44">
          <option value="all">Mọi danh mục</option>
          {categoryOptions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
        <Select size="sm" value={accountId} onChange={(e) => { setAccountId(e.target.value); t.setPage(1); }} aria-label="Lọc tài khoản" className="lg:w-52">
          <option value="all">Mọi tài khoản</option>
          {accounts.map((a) => <option key={a.id} value={String(a.id)}>{accountLabel(a)}</option>)}
        </Select>
      </div>

      <ErrorBanner message={error} onRetry={() => load()} />

      <DataTable
        columns={columns}
        rows={paged}
        loading={loading}
        sort={t.sort}
        onSort={t.toggleSort}
        pagination={{ page, totalPages, total: sorted.length, pageSize: t.pageSize, onChange: t.setPage }}
        emptyIcon={ReceiptText}
        emptyTitle={rows.length ? 'Không có khoản nào khớp bộ lọc' : 'Chưa có khoản thu/chi khác'}
        emptyDescription={rows.length ? 'Thử chọn "Mọi tháng" hoặc bỏ bớt bộ lọc.' : 'Ghi phí ngân hàng, lương, văn phòng… để lãi ròng phản ánh đúng thực tế.'}
        emptyAction={rows.length ? undefined : <Button icon={Plus} onClick={() => setEditing({})}>Thêm thu/chi</Button>}
        footer={sorted.length > 0 && (
          <tr>
            <td className="px-3 py-2.5" colSpan={4}>{sorted.length} khoản</td>
            <td className="px-3 py-2.5 text-right tabular">
              <span className="text-success-600">+{formatCurrency(filteredIn)}</span>{' '}
              <span className="text-danger-600">−{formatCurrency(filteredOut)}</span>
            </td>
            <td className="hidden lg:table-cell" /><td className="hidden sm:table-cell" /><td />
          </tr>
        )}
        mobileCard={(r) => (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-ink truncate">{r.category || 'Khác'} {dirBadge(r)}</p>
              <p className="text-xs text-ink-muted truncate">{[formatDate(r.entry_date), accountName(r), r.notes].filter(Boolean).join(' · ')}</p>
              <div className="mt-1">{actions(r)}</div>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <span className={`font-bold tabular ${r.direction === 'in' ? 'text-success-600' : 'text-danger-600'}`}>{r.direction === 'in' ? '+' : '−'}{formatCurrency(r.amount)}</span>
              <ReconcileToggle checked={r.reconciled} disabled={!isOwnedBy(r, user)} onChange={(v) => reconcile(r, v)} />
            </div>
          </div>
        )}
      />

      {editing && (
        <EntryModal initial={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => load({ silent: true })} />
      )}
    </div>
  );
}
