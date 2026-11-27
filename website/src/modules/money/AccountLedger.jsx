import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowDownLeft, ArrowUpRight, Download, Eye, Landmark, RefreshCw, Scale, Wallet, BookOpenCheck,
  ArrowRightLeft, ReceiptText, ScanSearch, Trash2,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useNavigation } from '../../hooks/useNavigation.jsx';
import { useFeedback } from '../../ui/FeedbackContext';
import { accountsApi, entriesApi, receiptsApi, transfersApi } from '../../services/money';
import { exportWorkbook } from '../../utils/excel';
import { formatCurrency, formatDate, num } from '../../utils/format';
import {
  Badge, Button, DataTable, DateField, EmptyState, ErrorBanner, IconButton, PageHeader, Segmented, StatCard,
} from '../../ui';
import ReconcileToggle from './ReconcileToggle';
import TransferModal from './TransferModal';
import EntryModal from './EntryModal';
import StatementMatchModal from './StatementMatchModal';
import { LEDGER_KIND, isOwnedBy, ledgerDeletable, maskNumber, monthRange, reconcileKindOf, withRunningBalance } from './moneyUtils';

const rowKey = (r) => `${r.kind}-${r.id}`;
const isOut = (r) => r.direction === 'out';
const sumOf = (rows) => rows.reduce((s, r) => s + num(r.amount), 0);

/** Sổ chi tiết 1 tài khoản: tiền vào/ra theo ngày, số dư luỹ kế, đối soát. */
export default function AccountLedger({ id }) {
  const { user } = useAuth();
  const { navigate } = useNavigation();
  const { toast, confirm } = useFeedback();
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filter, setFilter] = useState('all');
  const [transfer, setTransfer] = useState(null); // null | giá trị điền sẵn
  const [entry, setEntry] = useState(null); // null | giá trị điền sẵn
  const [matching, setMatching] = useState(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const d = await accountsApi.ledger(id, { from, to });
      setData(d);
      setRows(d?.rows || []);
    } catch (err) {
      setError(err.status === 404 ? 'Không tìm thấy tài khoản này (có thể đã bị xoá).' : err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, from, to]);
  useEffect(() => { load(); }, [load]);

  const account = data?.account;
  const owned = isOwnedBy(account, user);
  const opening = num(data?.opening);
  const withBalance = useMemo(() => withRunningBalance(rows, opening), [rows, opening]);
  const totalIn = data?.total_in != null ? num(data.total_in) : sumOf(rows.filter((r) => !isOut(r)));
  const totalOut = data?.total_out != null ? num(data.total_out) : sumOf(rows.filter(isOut));
  const closing = data?.closing != null ? num(data.closing) : opening + totalIn - totalOut;

  const counts = useMemo(() => ({
    all: rows.length,
    in: rows.filter((r) => !isOut(r)).length,
    out: rows.filter(isOut).length,
    unreconciled: rows.filter((r) => !r.reconciled).length,
  }), [rows]);

  const visible = useMemo(() => withBalance.filter((r) => {
    if (filter === 'in') return !isOut(r);
    if (filter === 'out') return isOut(r);
    if (filter === 'unreconciled') return !r.reconciled;
    return true;
  }), [withBalance, filter]);

  // Cập nhật lạc quan, lỗi thì trả lại trạng thái cũ.
  const reconcile = async (row, next) => {
    const key = rowKey(row);
    setRows((rs) => rs.map((r) => (rowKey(r) === key ? { ...r, reconciled: next } : r)));
    try {
      await accountsApi.reconcile(reconcileKindOf(row.kind), row.id, next);
    } catch (err) {
      setRows((rs) => rs.map((r) => (rowKey(r) === key ? { ...r, reconciled: !next } : r)));
      toast.error(err.message);
    }
  };

  // Xoá chuyển tiền / thu chi khác / phiếu thu ngay trên sổ (hoàn tác thao tác tiền).
  const removeRow = async (row) => {
    const what = row.kind === 'receipt' ? 'phiếu thu' : row.kind.startsWith('transfer') ? 'lần chuyển tiền' : 'khoản thu/chi khác';
    const extra = row.kind === 'receipt' ? ' Các khoản trả vào vé và phần vào ví của phiếu cũng bị xoá.' : '';
    const ok = await confirm({ title: `Xoá ${what}`, message: `Xoá ${what} ${formatCurrency(row.amount)} ngày ${formatDate(row.date)}?${extra}`, confirmText: 'Xoá', danger: true });
    if (!ok) return;
    try {
      if (row.kind === 'receipt') await receiptsApi.remove(row.id);
      else if (row.kind.startsWith('transfer')) await transfersApi.remove(row.id);
      else await entriesApi.remove(row.id);
      toast.success(`Đã xoá ${what}`);
      load({ silent: true });
    } catch (err) { toast.error(err.message); }
  };
  const reloadSilent = () => load({ silent: true });

  const thisMonth = monthRange(0);
  const lastMonth = monthRange(-1);
  const isRange = (r) => from === r.from && to === r.to;
  const setRange = (r) => { setFrom(r.from); setTo(r.to); };
  const periodLabel = from || to ? `${from ? formatDate(from) : '…'} → ${to ? formatDate(to) : '…'}` : 'Tất cả thời gian';

  const exportExcel = async () => {
    try {
      const aoa = [
        ['Ngày', 'Loại', 'Diễn giải', 'Vào', 'Ra', 'Số dư', 'Đối soát'],
        ['', '', 'Số dư đầu kỳ', '', '', opening, ''],
        ...withBalance.map((r) => [
          formatDate(r.date), LEDGER_KIND[r.kind]?.label || r.kind, r.description || '',
          isOut(r) ? '' : num(r.amount), isOut(r) ? num(r.amount) : '', r.running, r.reconciled ? 'x' : '',
        ]),
        ['', '', 'Cộng phát sinh / cuối kỳ', totalIn, totalOut, closing, ''],
      ];
      const safe = (account?.name || 'tai-khoan').replace(/[\\/:*?"<>|]/g, '-');
      await exportWorkbook(`so-tai-khoan-${safe}.xlsx`, [{ name: 'Sổ tài khoản', aoa, colWidths: [12, 12, 50, 15, 15, 16, 9], moneyCols: [3, 4, 5] }]);
    } catch {
      toast.error('Lỗi khi xuất Excel');
    }
  };

  const description = (r) => {
    const kind = LEDGER_KIND[r.kind];
    const supplierId = (r.kind === 'supplier_payment' || r.kind === 'supplier_refund') && r.ref?.type === 'supplier' ? r.ref.id : null;
    const text = r.description || r.customer_name || r.supplier_name || '—';
    return (
      <div className="flex min-w-0 max-w-[460px] items-center gap-1.5">
        <Badge tone={kind?.tone || 'gray'}>{kind?.label || r.kind}</Badge>
        {supplierId ? (
          <button type="button" onClick={() => navigate('suppliers', supplierId)} className="truncate text-left font-medium text-ink hover:text-brand-600 hover:underline" title="Xem nhà cung cấp">
            {text}
          </button>
        ) : (
          <span className="truncate font-medium text-ink" title={text}>{text}</span>
        )}
      </div>
    );
  };

  const columns = [
    { key: 'date', label: 'Ngày', width: 100, render: (r) => formatDate(r.date) },
    { key: 'description', label: 'Diễn giải', render: description },
    { key: 'in', label: 'Vào', align: 'right', render: (r) => (isOut(r) ? '' : <span className="font-semibold text-success-600">+{formatCurrency(r.amount)}</span>) },
    { key: 'out', label: 'Ra', align: 'right', render: (r) => (isOut(r) ? <span className="font-semibold text-danger-600">−{formatCurrency(r.amount)}</span> : '') },
    { key: 'running', label: 'Số dư luỹ kế', align: 'right', hideBelow: 'sm', render: (r) => <span data-testid="running" className={`font-semibold ${r.running < 0 ? 'text-danger-600' : 'text-ink'}`}>{formatCurrency(r.running)}</span> },
    { key: 'reconciled', label: 'Đối soát', align: 'center', width: 80, render: (r) => <ReconcileToggle checked={r.reconciled} disabled={!owned} onChange={(v) => reconcile(r, v)} /> },
    { key: 'actions', label: '', align: 'right', width: 50, render: (r) => (owned && ledgerDeletable(r.kind) ? <IconButton icon={Trash2} title="Xoá" variant="danger" onClick={() => removeRow(r)} /> : null) },
  ];

  const footer = visible.length > 0 && (
    <tr>
      <td className="px-3 py-2.5" colSpan={2}>{visible.length} giao dịch</td>
      <td className="px-3 py-2.5 text-right tabular text-success-600">{formatCurrency(sumOf(visible.filter((r) => !isOut(r))))}</td>
      <td className="px-3 py-2.5 text-right tabular text-danger-600">{formatCurrency(sumOf(visible.filter(isOut)))}</td>
      <td className="hidden sm:table-cell" />
      <td />
      <td />
    </tr>
  );

  return (
    <div>
      <PageHeader
        help="accounts"
        icon={Wallet}
        title={loading && !account ? 'Đang tải…' : (account?.name || 'Tài khoản')}
        description={account ? ([account.bank, maskNumber(account.account_number), account.holder_name].filter(Boolean).join(' · ') || 'Sổ chi tiết tài khoản') : 'Sổ chi tiết tài khoản'}
        actions={(
          <>
            <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('accounts')}>Danh sách</Button>
            <IconButton icon={RefreshCw} title="Tải lại" onClick={() => load({ silent: true })} className={refreshing ? 'animate-spin' : ''} />
            <Button variant="secondary" icon={Download} onClick={exportExcel} disabled={!data}>Excel</Button>
            {account && owned && (
              <>
                <Button variant="secondary" icon={ScanSearch} onClick={() => setMatching(true)}>Khớp sao kê</Button>
                <Button variant="secondary" icon={ReceiptText} onClick={() => setEntry({ accountId: account.id })}>Thu/chi khác</Button>
                <Button icon={ArrowRightLeft} onClick={() => setTransfer({ fromAccountId: account.id })}>Chuyển tiền</Button>
              </>
            )}
          </>
        )}
      />

      <ErrorBanner message={error} onRetry={() => load()} />
      {error && !loading && !data && (
        <div className="card mt-4">
          <EmptyState icon={Landmark} title="Không tải được sổ tài khoản" description={error} action={<Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('accounts')}>Về danh sách</Button>} />
        </div>
      )}

      {(data || loading) && (
        <>
          {account && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {account.is_own === false && <Badge tone="warning">Giữ hộ — tiền cần thu về</Badge>}
              {account.archived && <Badge tone="gray">Đã lưu trữ</Badge>}
              {!owned && <Badge tone="outline" icon={Eye}>Chỉ xem · {account.owner_name || 'đại lý khác'}</Badge>}
              {account.notes && <span className="text-sm text-ink-muted">{account.notes}</span>}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <StatCard icon={Scale} label="Đầu kỳ" value={loading ? '…' : formatCurrency(opening)} sub={periodLabel} tone="gray" />
            <StatCard icon={ArrowDownLeft} label="Tiền vào" value={loading ? '…' : formatCurrency(totalIn)} sub={`${counts.in} giao dịch`} tone="success" />
            <StatCard icon={ArrowUpRight} label="Tiền ra" value={loading ? '…' : formatCurrency(totalOut)} sub={`${counts.out} giao dịch`} tone="danger" />
            <StatCard icon={BookOpenCheck} label="Cuối kỳ" value={loading ? '…' : formatCurrency(closing)} sub={counts.unreconciled ? `${counts.unreconciled} chưa đối soát` : 'Đã đối soát hết'} tone={closing < 0 ? 'danger' : 'brand'} />
          </div>

          <div className="card mb-4 p-3 flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink-muted">Từ</span>
              <DateField value={from} onChange={setFrom} className="w-36 input-sm" placeholder="Từ ngày" />
              <span className="text-sm text-ink-muted">đến</span>
              <DateField value={to} onChange={setTo} className="w-36 input-sm" placeholder="Đến ngày" />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant={isRange(thisMonth) ? 'soft' : 'secondary'} onClick={() => setRange(thisMonth)}>Tháng này</Button>
              <Button size="sm" variant={isRange(lastMonth) ? 'soft' : 'secondary'} onClick={() => setRange(lastMonth)}>Tháng trước</Button>
              <Button size="sm" variant={!from && !to ? 'soft' : 'secondary'} onClick={() => setRange({ from: '', to: '' })}>Tất cả</Button>
            </div>
            <div className="lg:ml-auto overflow-x-auto -mx-1 px-1">
              <Segmented
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: `Tất cả (${counts.all})` },
                  { value: 'in', label: `Tiền vào (${counts.in})` },
                  { value: 'out', label: `Tiền ra (${counts.out})` },
                  { value: 'unreconciled', label: `Chưa đối soát (${counts.unreconciled})` },
                ]}
              />
            </div>
          </div>

          <DataTable
            columns={columns}
            rows={visible}
            rowKey={rowKey}
            loading={loading}
            emptyIcon={Landmark}
            emptyTitle={rows.length ? 'Không có giao dịch nào khớp bộ lọc' : 'Chưa có giao dịch trong kỳ'}
            emptyDescription="Tiền khách trả, phiếu thu, nạp/hoàn ví, trả NCC, chuyển tiền và thu chi khác qua tài khoản này sẽ hiện ở đây."
            rowClassName={(r) => (r.reconciled ? '' : 'bg-warning-50/30')}
            footer={footer}
            mobileCard={(r) => (
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {description(r)}
                  <p className="mt-1 text-xs text-ink-muted">{formatDate(r.date)} · số dư {formatCurrency(r.running)}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`font-bold tabular ${isOut(r) ? 'text-danger-600' : 'text-success-600'}`}>
                    {isOut(r) ? '−' : '+'}{formatCurrency(r.amount)}
                  </span>
                  <div className="flex items-center gap-1">
                    {owned && ledgerDeletable(r.kind) && <IconButton icon={Trash2} title="Xoá" variant="danger" onClick={() => removeRow(r)} />}
                    <ReconcileToggle checked={r.reconciled} disabled={!owned} onChange={(v) => reconcile(r, v)} />
                  </div>
                </div>
              </div>
            )}
          />
        </>
      )}

      {transfer && <TransferModal initial={transfer} onClose={() => setTransfer(null)} onSaved={reloadSilent} />}
      {entry && <EntryModal initial={entry} onClose={() => setEntry(null)} onSaved={reloadSilent} />}
      {matching && account && <StatementMatchModal account={account} onClose={() => setMatching(false)} onDone={reloadSilent} />}
    </div>
  );
}
