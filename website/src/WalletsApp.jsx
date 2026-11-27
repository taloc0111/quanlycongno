import { useCallback, useEffect, useState } from 'react';
import { PiggyBank, Plus, RefreshCw, Wallet, AlertTriangle, ArrowLeft, Eye, UserRound, Users } from 'lucide-react';
import { useAuth } from './auth/AuthContext';
import { useNavigation } from './hooks/useNavigation.jsx';
import { useTableState } from './hooks/useTableState';
import { walletsApi } from './services/money';
import { formatCurrency, formatDate, num, normalizeYmd } from './utils/format';
import { Badge, Button, DataTable, ErrorBanner, IconButton, PageHeader, SearchInput, StatCard } from './ui';
import WalletPanel, { WalletEntryModal } from './modules/money/WalletPanel';
import { WALLET_LOW, isOwnedBy } from './modules/money/moneyUtils';

/** Trang Ví trả trước: `#wallets` (danh sách) hoặc `#wallets/<customerId>` (chi tiết ví 1 khách). */
export default function WalletsApp({ param }) {
  if (param) return <WalletDetail key={param} customerId={param} />;
  return <WalletsList />;
}

const balanceClass = (b) => (b <= 0 ? 'text-danger-600' : b < WALLET_LOW ? 'text-warning-600' : 'text-ink');

const COLUMNS = [
  { key: 'customer_name', label: 'Khách', sortable: true },
  { key: 'phone', label: 'SĐT', hideBelow: 'md' },
  { key: 'balance', label: 'Số dư', align: 'right', sortable: true },
  { key: 'last_entry_date', label: 'Lần cuối', sortable: true, hideBelow: 'sm' },
  { key: 'entries_count', label: 'Số giao dịch', align: 'right', sortable: true, hideBelow: 'lg' },
  { key: 'actions', label: '', align: 'right' },
];

function WalletsList() {
  const { user } = useAuth();
  const { navigate } = useNavigation();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [topup, setTopup] = useState(null); // null | { customer } (customer null = chọn khách)
  const t = useTableState({ storageKey: 'wallets', columns: COLUMNS, pageSize: 50, defaultSort: { key: 'balance', dir: 'asc' } });

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const data = await walletsApi.list();
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
    searchText: (r) => [r.customer_name, r.phone, r.owner_name].filter(Boolean).join(' '),
    sortValue: (r, key) => {
      if (key === 'customer_name') return (r.customer_name || '').toLowerCase();
      if (key === 'last_entry_date') return normalizeYmd(r.last_entry_date);
      return num(r[key]);
    },
  });

  const total = rows.reduce((s, r) => s + num(r.balance), 0);
  const low = rows.filter((r) => num(r.balance) < WALLET_LOW).length;
  const negative = rows.filter((r) => num(r.balance) < 0).length;

  const actions = (r) => (
    <div className="flex items-center justify-end gap-1">
      {isOwnedBy(r, user) && (
        <Button size="xs" variant="soft" icon={Plus} onClick={(e) => { e.stopPropagation(); setTopup({ customer: { id: r.customer_id, name: r.customer_name }, balance: num(r.balance) }); }}>Nạp tiền</Button>
      )}
      <Button size="xs" variant="secondary" icon={Eye} onClick={(e) => { e.stopPropagation(); navigate('wallets', r.customer_id); }}>Xem</Button>
    </div>
  );

  const columns = [
    {
      ...COLUMNS[0], render: (r) => (
        <div className="min-w-0">
          <span className="font-semibold text-ink">{r.customer_name || '—'}</span>
          {!isOwnedBy(r, user) && r.owner_name && <p className="text-xs text-ink-faint">{r.owner_name}</p>}
        </div>
      ),
    },
    { ...COLUMNS[1], render: (r) => (r.phone ? <a href={`tel:${r.phone}`} onClick={(e) => e.stopPropagation()} className="hover:text-brand-600">{r.phone}</a> : <span className="text-ink-faint">—</span>) },
    { ...COLUMNS[2], render: (r) => <span className={`font-bold ${balanceClass(num(r.balance))}`}>{formatCurrency(r.balance)}</span> },
    { ...COLUMNS[3], render: (r) => formatDate(r.last_entry_date) || <span className="text-ink-faint">—</span> },
    { ...COLUMNS[4], render: (r) => num(r.entries_count) },
    { ...COLUMNS[5], render: actions },
  ];

  return (
    <div>
      <PageHeader
        help="wallets"
        icon={PiggyBank}
        title="Ví trả trước"
        description="Khách/đại lý cấp dưới chuyển trước, xuất vé trừ dần"
        actions={(
          <>
            <IconButton icon={RefreshCw} title="Tải lại" onClick={() => load({ silent: true })} className={refreshing ? 'animate-spin' : ''} />
            <Button icon={Plus} onClick={() => setTopup({ customer: null })}>Nạp ví cho khách mới</Button>
          </>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <StatCard icon={Wallet} label="Tổng số dư ví" value={loading ? '…' : formatCurrency(total)} sub="Tiền khách gửi trước, chưa dùng" tone="success" />
        <StatCard icon={Users} label="Số ví" value={loading ? '…' : rows.length} sub="Khách có giao dịch ví" tone="brand" />
        <StatCard icon={AlertTriangle} label="Ví âm/sắp hết" value={loading ? '…' : low} sub={`Dưới ${formatCurrency(WALLET_LOW)}${negative ? ` · ${negative} ví âm` : ''}`} tone={low ? 'warning' : 'gray'} />
      </div>

      <div className="card mb-4 p-3 flex flex-col sm:flex-row sm:items-center gap-2.5">
        <SearchInput value={t.search} onChange={t.setSearch} placeholder="Tìm tên khách, SĐT…" className="sm:w-80" />
      </div>

      <ErrorBanner message={error} onRetry={() => load()} />

      <DataTable
        columns={columns}
        rows={paged}
        rowKey={(r) => r.customer_id}
        loading={loading}
        sort={t.sort}
        onSort={t.toggleSort}
        onRowClick={(r) => navigate('wallets', r.customer_id)}
        rowClassName={(r) => (num(r.balance) < 0 ? 'bg-danger-50/40' : '')}
        pagination={{ page, totalPages, total: sorted.length, pageSize: t.pageSize, onChange: t.setPage }}
        emptyIcon={PiggyBank}
        emptyTitle={rows.length ? 'Không có ví khớp tìm kiếm' : 'Chưa có ví nào'}
        emptyDescription={rows.length ? undefined : 'Khi khách/đại lý cấp dưới chuyển trước một khoản, bấm "Nạp ví cho khách mới".'}
        emptyAction={rows.length ? undefined : <Button icon={Plus} onClick={() => setTopup({ customer: null })}>Nạp ví cho khách mới</Button>}
        mobileCard={(r) => (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-ink truncate">{r.customer_name || '—'}</p>
              <p className="text-xs text-ink-muted">{[r.phone, r.last_entry_date ? `lần cuối ${formatDate(r.last_entry_date)}` : ''].filter(Boolean).join(' · ')}</p>
              <div className="mt-1.5">{actions(r)}</div>
            </div>
            <span className={`font-bold tabular shrink-0 ${balanceClass(num(r.balance))}`}>{formatCurrency(r.balance)}</span>
          </div>
        )}
      />

      {topup && (
        <WalletEntryModal
          mode="topup"
          customer={topup.customer}
          balance={topup.balance}
          onClose={() => setTopup(null)}
          onSaved={() => load({ silent: true })}
        />
      )}
    </div>
  );
}

function WalletDetail({ customerId }) {
  const { user } = useAuth();
  const { navigate } = useNavigation();
  const [customer, setCustomer] = useState(null);
  const owned = isOwnedBy(customer, user);

  return (
    <div>
      <PageHeader
        help="wallets"
        icon={PiggyBank}
        title={customer?.name ? `Ví · ${customer.name}` : 'Ví trả trước'}
        description={customer ? [customer.phone, !owned && customer.owner_name ? `thuộc ${customer.owner_name}` : ''].filter(Boolean).join(' · ') || 'Lịch sử nạp / trừ / hoàn' : 'Lịch sử nạp / trừ / hoàn'}
        actions={(
          <>
            <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('wallets')}>Danh sách</Button>
            <Button variant="secondary" icon={UserRound} onClick={() => navigate('customer', customerId)}>Xem khách</Button>
          </>
        )}
      />
      {customer && !owned && <div className="mb-3"><Badge tone="outline" icon={Eye}>Chỉ xem</Badge></div>}
      <WalletPanel customerId={customerId} onLoaded={(d) => setCustomer(d?.customer || null)} />
    </div>
  );
}
