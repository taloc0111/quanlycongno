import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Eye, HandCoins, Pencil, Phone, ReceiptText, RefreshCw, Trash2, Truck, Wallet, Scale } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useNavigation } from '../../hooks/useNavigation.jsx';
import { useFeedback } from '../../ui/FeedbackContext';
import { accountsApi, suppliersApi, supplierKindLabel } from '../../services/money';
import { formatCurrency, formatDate, num } from '../../utils/format';
import {
  Badge, Button, DataTable, EmptyState, ErrorBanner, IconButton, PageHeader, Segmented, StatCard,
} from '../../ui';
import ReconcileToggle from './ReconcileToggle';
import { SupplierFormModal, SupplierPayModal } from './SupplierModals';
import { dueBadge, isOwnedBy, itemRemaining } from './moneyUtils';

const KIND_TONE = { f1: 'brand', down: 'purple', other: 'gray' };
const TARGET_LABEL = { debt: 'Vé máy bay', passport: 'Hộ chiếu', train: 'Vé tàu', tour: 'Tour' };

/** Chi tiết 1 nhà cung cấp: các dòng giá vốn + các lần trả tiền. */
export default function SupplierLedger({ id }) {
  const { user } = useAuth();
  const { navigate } = useNavigation();
  const { toast, confirm } = useFeedback();
  const [data, setData] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('items');
  const [paying, setPaying] = useState(null); // null | { itemId }
  const [editing, setEditing] = useState(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const d = await suppliersApi.ledger(id);
      setData(d);
      setPayments(d?.payments || []);
    } catch (err) {
      setError(err.status === 404 ? 'Không tìm thấy nhà cung cấp này (có thể đã bị xoá).' : err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const supplier = data?.supplier;
  const owned = isOwnedBy(supplier, user);
  const items = useMemo(() => data?.items || [], [data]);
  const totalCost = data?.total_cost != null ? num(data.total_cost) : items.reduce((s, it) => s + num(it.amount), 0);
  const totalPaid = data?.total_paid != null ? num(data.total_paid) : payments.reduce((s, p) => s + num(p.amount), 0);
  const balance = data?.balance != null ? num(data.balance) : totalCost - totalPaid;
  const unpaidCount = items.filter((it) => itemRemaining(it) > 0).length;

  const reconcile = async (p, next) => {
    setPayments((ps) => ps.map((x) => (x.id === p.id ? { ...x, reconciled: next } : x)));
    try {
      await accountsApi.reconcile('supplier_payment', p.id, next);
    } catch (err) {
      setPayments((ps) => ps.map((x) => (x.id === p.id ? { ...x, reconciled: !next } : x)));
      toast.error(err.message);
    }
  };

  const removePayment = async (p) => {
    const ok = await confirm({ title: 'Xoá lần trả', message: `Xoá lần trả ${formatCurrency(p.amount)} ngày ${formatDate(p.pay_date)}? Số nợ NCC sẽ tăng lại.` });
    if (!ok) return;
    try {
      await suppliersApi.removePayment(p.id);
      toast.success('Đã xoá lần trả');
      load({ silent: true });
    } catch (err) { toast.error(err.message); }
  };

  const itemColumns = [
    { key: 'created_at', label: 'Ngày', width: 100, render: (it) => formatDate(it.created_at) },
    {
      key: 'target', label: 'Dịch vụ', render: (it) => (
        <div className="min-w-0 max-w-[280px]">
          <p className="font-medium text-ink truncate">{it.target?.label || TARGET_LABEL[it.target?.type] || '—'}</p>
          <p className="text-xs text-ink-muted truncate">{[TARGET_LABEL[it.target?.type], it.target?.customer_name].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    { key: 'label', label: 'Khoản', render: (it) => <span className="text-ink-soft">{it.label}</span> },
    { key: 'amount', label: 'Số tiền', align: 'right', render: (it) => <span className="font-semibold">{formatCurrency(it.amount)}</span> },
    { key: 'paid_amount', label: 'Đã trả', align: 'right', hideBelow: 'md', render: (it) => <span className="text-success-600">{formatCurrency(it.paid_amount)}</span> },
    {
      key: 'remaining', label: 'Còn lại', align: 'right', render: (it) => {
        const rem = itemRemaining(it);
        return <span className={`font-bold ${rem > 0 ? 'text-danger-600' : 'text-success-600'}`}>{rem > 0 ? formatCurrency(rem) : 'Đã trả đủ'}</span>;
      },
    },
    {
      key: 'due_date', label: 'Hạn trả', hideBelow: 'sm', render: (it) => {
        const b = dueBadge(it.due_date, itemRemaining(it));
        return (
          <span className="inline-flex items-center gap-1.5">
            {it.due_date ? formatDate(it.due_date) : <span className="text-ink-faint">—</span>}
            {b && <Badge tone={b.tone}>{b.label}</Badge>}
          </span>
        );
      },
    },
    {
      key: 'actions', label: '', align: 'right', width: 70, render: (it) => (owned && itemRemaining(it) > 0
        ? <Button size="xs" variant="soft" onClick={() => setPaying({ itemId: it.id })}>Trả</Button>
        : null),
    },
  ];

  const paymentColumns = [
    { key: 'pay_date', label: 'Ngày', width: 100, render: (p) => formatDate(p.pay_date) },
    { key: 'amount', label: 'Số tiền', align: 'right', render: (p) => <span className="font-semibold text-danger-600">{formatCurrency(p.amount)}</span> },
    { key: 'account_name', label: 'Từ TK', render: (p) => p.account_name || <span className="text-ink-faint">—</span> },
    { key: 'cost_item_label', label: 'Cho dòng', hideBelow: 'sm', render: (p) => p.cost_item_label || <span className="text-ink-faint">Trả gộp</span> },
    { key: 'notes', label: 'Ghi chú', hideBelow: 'md', render: (p) => <span className="text-ink-muted">{p.notes || ''}</span> },
    { key: 'reconciled', label: 'Đối soát', align: 'center', width: 80, render: (p) => <ReconcileToggle checked={p.reconciled} disabled={!owned} onChange={(v) => reconcile(p, v)} /> },
    { key: 'actions', label: '', align: 'right', width: 50, render: (p) => (owned ? <IconButton icon={Trash2} title="Xoá lần trả" variant="danger" onClick={() => removePayment(p)} /> : null) },
  ];

  return (
    <div>
      <PageHeader
        icon={Truck}
        title={loading && !supplier ? 'Đang tải…' : (supplier?.name || 'Nhà cung cấp')}
        description={supplier ? [supplierKindLabel(supplier.kind), supplier.phone].filter(Boolean).join(' · ') : 'Chi tiết nhà cung cấp'}
        actions={(
          <>
            <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('suppliers')}>Danh sách</Button>
            <IconButton icon={RefreshCw} title="Tải lại" onClick={() => load({ silent: true })} className={refreshing ? 'animate-spin' : ''} />
            {supplier && owned && <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>Sửa</Button>}
            {supplier && owned && <Button icon={HandCoins} onClick={() => setPaying({})}>Trả tiền</Button>}
          </>
        )}
      />

      <ErrorBanner message={error} onRetry={() => load()} />
      {error && !loading && !data && (
        <div className="card mt-4">
          <EmptyState icon={Truck} title="Không tải được nhà cung cấp" description={error} action={<Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('suppliers')}>Về danh sách</Button>} />
        </div>
      )}

      {(data || loading) && (
        <>
          {supplier && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge tone={KIND_TONE[supplier.kind] || 'gray'}>{supplierKindLabel(supplier.kind)}</Badge>
              {supplier.phone && <a href={`tel:${supplier.phone}`} className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-brand-600"><Phone size={13} />{supplier.phone}</a>}
              {!owned && <Badge tone="outline" icon={Eye}>Chỉ xem · {supplier.owner_name || 'đại lý khác'}</Badge>}
              {supplier.notes && <span className="text-sm text-ink-muted whitespace-pre-line">{supplier.notes}</span>}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            <StatCard icon={ReceiptText} label="Tổng giá vốn" value={loading ? '…' : formatCurrency(totalCost)} sub={`${items.length} dòng`} tone="brand" />
            <StatCard icon={Wallet} label="Đã trả" value={loading ? '…' : formatCurrency(totalPaid)} sub={`${payments.length} lần trả`} tone="success" />
            <StatCard icon={Scale} label="Còn nợ" value={loading ? '…' : formatCurrency(balance)} sub={unpaidCount ? `${unpaidCount} dòng chưa trả đủ` : 'Không còn dòng nợ'} tone={balance > 0 ? 'danger' : 'gray'} />
          </div>

          <div className="mb-3">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'items', label: `Dòng giá vốn (${items.length})` },
                { value: 'payments', label: `Lần trả (${payments.length})` },
              ]}
            />
          </div>

          {tab === 'items' ? (
            <DataTable
              columns={itemColumns}
              rows={items}
              loading={loading}
              emptyIcon={ReceiptText}
              emptyTitle="Chưa có dòng giá vốn nào"
              emptyDescription="Khi nhập giá vốn cho vé/hộ chiếu/tour và chọn nhà cung cấp này, các dòng sẽ hiện ở đây."
              rowClassName={(it) => (dueBadge(it.due_date, itemRemaining(it))?.tone === 'danger' ? 'bg-danger-50/40' : '')}
              mobileCard={(it) => {
                const rem = itemRemaining(it);
                const b = dueBadge(it.due_date, rem);
                return (
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink truncate">{it.label} · {it.target?.label || '—'}</p>
                      <p className="text-xs text-ink-muted">{[formatDate(it.created_at), it.target?.customer_name].filter(Boolean).join(' · ')}</p>
                      {b && <Badge tone={b.tone}>{b.label}</Badge>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-semibold tabular">{formatCurrency(it.amount)}</p>
                      <p className={`text-xs font-bold tabular ${rem > 0 ? 'text-danger-600' : 'text-success-600'}`}>{rem > 0 ? `Còn ${formatCurrency(rem)}` : 'Đã trả đủ'}</p>
                    </div>
                  </div>
                );
              }}
            />
          ) : (
            <DataTable
              columns={paymentColumns}
              rows={payments}
              loading={loading}
              emptyIcon={Wallet}
              emptyTitle="Chưa trả lần nào"
              emptyDescription={owned ? 'Bấm "Trả tiền" để ghi lại lần chuyển cho nhà cung cấp.' : undefined}
              mobileCard={(p) => (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{formatDate(p.pay_date)} · {p.account_name || 'Không rõ TK'}</p>
                    <p className="text-xs text-ink-muted truncate">{p.cost_item_label || 'Trả gộp'}{p.notes ? ` · ${p.notes}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-bold tabular text-danger-600">{formatCurrency(p.amount)}</span>
                    <ReconcileToggle checked={p.reconciled} disabled={!owned} onChange={(v) => reconcile(p, v)} />
                  </div>
                </div>
              )}
            />
          )}
        </>
      )}

      {paying && supplier && (
        <SupplierPayModal
          supplier={{ ...supplier, balance }}
          items={items}
          initialItemId={paying.itemId}
          onClose={() => setPaying(null)}
          onPaid={() => load({ silent: true })}
        />
      )}
      {editing && supplier && (
        <SupplierFormModal initial={supplier} onClose={() => setEditing(false)} onSaved={() => load({ silent: true })} />
      )}
    </div>
  );
}
