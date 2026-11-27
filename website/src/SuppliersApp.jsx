import { useCallback, useEffect, useState } from 'react';
import { Truck, Plus, RefreshCw, Scale, Users, ReceiptText, HandCoins, Pencil, Trash2, Eye } from 'lucide-react';
import { useAuth } from './auth/AuthContext';
import { useNavigation } from './hooks/useNavigation.jsx';
import { useFeedback } from './ui/FeedbackContext';
import { useTableState } from './hooks/useTableState';
import { SUPPLIER_KINDS, suppliersApi, supplierKindLabel } from './services/money';
import { formatCurrency, num } from './utils/format';
import { Badge, Button, DataTable, ErrorBanner, IconButton, PageHeader, SearchInput, Select, StatCard } from './ui';
import SupplierLedger from './modules/money/SupplierLedger';
import { SupplierFormModal, SupplierPayModal } from './modules/money/SupplierModals';
import { isOwnedBy } from './modules/money/moneyUtils';

const KIND_TONE = { f1: 'brand', down: 'purple', other: 'gray' };
const KIND_SHORT = { f1: 'F1', down: 'Down', other: 'Khác' };

/** Trang Nhà cung cấp: `#suppliers` (danh sách) hoặc `#suppliers/<id>` (chi tiết). */
export default function SuppliersApp({ param }) {
  if (param) return <SupplierLedger key={param} id={param} />;
  return <SuppliersList />;
}

const COLUMNS = [
  { key: 'name', label: 'Nhà cung cấp', sortable: true },
  { key: 'phone', label: 'SĐT', hideBelow: 'md' },
  { key: 'total_cost', label: 'Tổng giá vốn', align: 'right', sortable: true, hideBelow: 'lg' },
  { key: 'total_paid', label: 'Đã trả', align: 'right', sortable: true, hideBelow: 'md' },
  { key: 'balance', label: 'Còn nợ', align: 'right', sortable: true },
  { key: 'unpaid_items', label: 'Dòng chưa trả', align: 'right', sortable: true, hideBelow: 'sm' },
  { key: 'actions', label: '', align: 'right' },
];

function SuppliersList() {
  const { user } = useAuth();
  const { navigate } = useNavigation();
  const { toast, confirm } = useFeedback();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [kind, setKind] = useState('all');
  const [editing, setEditing] = useState(null); // null | {} | row
  const [paying, setPaying] = useState(null); // null | row
  const t = useTableState({ storageKey: 'suppliers', columns: COLUMNS, pageSize: 50, defaultSort: { key: 'balance', dir: 'desc' } });

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const data = await suppliersApi.list({ fresh: true });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const { sorted, paged, totalPages, page } = t.process(rows, {
    searchText: (r) => [r.name, r.phone, r.notes, r.owner_name].filter(Boolean).join(' '),
    filterFns: [kind !== 'all' ? (r) => (r.kind || 'other') === kind : null],
    sortValue: (r, key) => (key === 'name' ? (r.name || '').toLowerCase() : num(r[key])),
  });

  const totalOwed = rows.reduce((s, r) => s + num(r.balance), 0);
  const unpaidItems = rows.reduce((s, r) => s + num(r.unpaid_items), 0);
  const owingCount = rows.filter((r) => num(r.balance) > 0).length;

  const remove = async (r) => {
    const ok = await confirm({ title: 'Xoá nhà cung cấp', message: `Xoá "${r.name}"?` });
    if (!ok) return;
    try {
      await suppliersApi.remove(r.id);
      toast.success('Đã xoá nhà cung cấp');
      load({ silent: true });
    } catch (err) { toast.error(err.message); }
  };

  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  const actions = (r) => (isOwnedBy(r, user) ? (
    <div className="flex items-center justify-end gap-0.5">
      <Button size="xs" variant="soft" icon={HandCoins} onClick={stop(() => setPaying(r))}>Trả tiền</Button>
      <IconButton icon={Pencil} title="Sửa" onClick={stop(() => setEditing(r))} />
      <IconButton icon={Trash2} title="Xoá" variant="danger" onClick={stop(() => remove(r))} />
    </div>
  ) : <Badge tone="outline" icon={Eye}>Chỉ xem</Badge>);

  const columns = [
    {
      ...COLUMNS[0], render: (r) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-ink truncate">{r.name}</span>
            <Badge tone={KIND_TONE[r.kind] || 'gray'}>{KIND_SHORT[r.kind] || 'Khác'}</Badge>
          </div>
          {!isOwnedBy(r, user) && r.owner_name && <p className="text-xs text-ink-faint">{r.owner_name}</p>}
        </div>
      ),
    },
    { ...COLUMNS[1], render: (r) => (r.phone ? <a href={`tel:${r.phone}`} onClick={(e) => e.stopPropagation()} className="hover:text-brand-600">{r.phone}</a> : <span className="text-ink-faint">—</span>) },
    { ...COLUMNS[2], render: (r) => formatCurrency(r.total_cost) },
    { ...COLUMNS[3], render: (r) => <span className="text-success-600">{formatCurrency(r.total_paid)}</span> },
    { ...COLUMNS[4], render: (r) => <span className={`font-bold ${num(r.balance) > 0 ? 'text-danger-600' : 'text-ink-muted'}`}>{formatCurrency(r.balance)}</span> },
    { ...COLUMNS[5], render: (r) => (num(r.unpaid_items) ? <Badge tone="warning">{num(r.unpaid_items)}</Badge> : <span className="text-ink-faint">0</span>) },
    { ...COLUMNS[6], render: actions },
  ];

  return (
    <div>
      <PageHeader
        icon={Truck}
        title="Nhà cung cấp"
        description="F1, bên down và các nơi lấy vé — còn nợ ai bao nhiêu"
        actions={(
          <>
            <IconButton icon={RefreshCw} title="Tải lại" onClick={() => load({ silent: true })} className={refreshing ? 'animate-spin' : ''} />
            <Button icon={Plus} onClick={() => setEditing({})}>Thêm nhà cung cấp</Button>
          </>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <StatCard icon={Scale} label="Tổng còn nợ NCC" value={loading ? '…' : formatCurrency(totalOwed)} sub={owingCount ? `Đang nợ ${owingCount} nơi` : 'Không nợ ai'} tone={totalOwed > 0 ? 'danger' : 'success'} />
        <StatCard icon={Users} label="Số NCC" value={loading ? '…' : rows.length} sub={SUPPLIER_KINDS.map((k) => `${KIND_SHORT[k.value]} ${rows.filter((r) => (r.kind || 'other') === k.value).length}`).join(' · ')} tone="brand" />
        <StatCard icon={ReceiptText} label="Dòng giá vốn chưa trả" value={loading ? '…' : unpaidItems} sub="Dòng có NCC còn nợ tiền" tone={unpaidItems ? 'warning' : 'gray'} />
      </div>

      <div className="card mb-4 p-3 flex flex-col sm:flex-row sm:items-center gap-2.5">
        <SearchInput value={t.search} onChange={t.setSearch} placeholder="Tìm tên, SĐT, ghi chú…" className="sm:w-80" />
        <Select size="sm" value={kind} onChange={(e) => { setKind(e.target.value); t.setPage(1); }} className="sm:w-52" aria-label="Lọc loại nhà cung cấp">
          <option value="all">Tất cả loại</option>
          {SUPPLIER_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </Select>
      </div>

      <ErrorBanner message={error} onRetry={() => load()} />

      <DataTable
        columns={columns}
        rows={paged}
        loading={loading}
        sort={t.sort}
        onSort={t.toggleSort}
        onRowClick={(r) => navigate('suppliers', r.id)}
        pagination={{ page, totalPages, total: sorted.length, pageSize: t.pageSize, onChange: t.setPage }}
        emptyIcon={Truck}
        emptyTitle={rows.length ? 'Không có nhà cung cấp khớp bộ lọc' : 'Chưa có nhà cung cấp nào'}
        emptyDescription={rows.length ? undefined : 'Thêm F1, người làm down… để theo dõi tiền giá vốn còn nợ từng nơi.'}
        emptyAction={rows.length ? undefined : <Button icon={Plus} onClick={() => setEditing({})}>Thêm nhà cung cấp</Button>}
        mobileCard={(r) => (
          <div className="flex items-start justify-between gap-2" onClick={() => navigate('suppliers', r.id)}>
            <div className="min-w-0">
              <p className="font-semibold text-ink truncate">{r.name} <Badge tone={KIND_TONE[r.kind] || 'gray'}>{supplierKindLabel(r.kind)}</Badge></p>
              <p className="text-xs text-ink-muted">{[r.phone, num(r.unpaid_items) ? `${num(r.unpaid_items)} dòng chưa trả` : ''].filter(Boolean).join(' · ')}</p>
              <div className="mt-1.5">{actions(r)}</div>
            </div>
            <span className={`font-bold tabular shrink-0 ${num(r.balance) > 0 ? 'text-danger-600' : 'text-ink-muted'}`}>{formatCurrency(r.balance)}</span>
          </div>
        )}
      />

      {editing && (
        <SupplierFormModal initial={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => load({ silent: true })} />
      )}
      {paying && (
        <SupplierPayModal supplier={paying} onClose={() => setPaying(null)} onPaid={() => load({ silent: true })} />
      )}
    </div>
  );
}
