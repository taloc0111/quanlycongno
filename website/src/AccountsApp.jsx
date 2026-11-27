import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  QrCode, Wallet, Plus, RefreshCw, ArrowDownLeft, ArrowUpRight, HandCoins, ListChecks, Pencil, Trash2, Archive, ArchiveRestore, Eye,
  ArrowRightLeft, ReceiptText, Undo2,
} from 'lucide-react';
import { useAuth } from './auth/AuthContext';
import { useNavigation } from './hooks/useNavigation.jsx';
import { useFeedback } from './ui/FeedbackContext';
import { accountsApi } from './services/money';
import { formatCurrency, num } from './utils/format';
import { Badge, Button, Card, EmptyState, ErrorBanner, IconButton, PageHeader, Skeleton, StatCard, Switch } from './ui';
import AccountFormModal from './modules/money/AccountFormModal';
import AccountLedger from './modules/money/AccountLedger';
import TransferModal from './modules/money/TransferModal';
import EntryModal from './modules/money/EntryModal';
import { isOwnedBy, maskNumber } from './modules/money/moneyUtils';
import { QrModal } from './components/BankQR';
import { accountQrInfo } from './utils/vietqr';

/** Trang Tài khoản tiền: `#accounts` (danh sách) hoặc `#accounts/<id>` (sổ chi tiết). */
export default function AccountsApp({ param }) {
  if (param) return <AccountLedger key={param} id={param} />;
  return <AccountsList />;
}

function AccountsList() {
  const { user } = useAuth();
  const { navigate } = useNavigation();
  const { toast, confirm } = useFeedback();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState(null); // null = đóng, {} = thêm, row = sửa
  const [transfer, setTransfer] = useState(null); // null | giá trị điền sẵn
  const [entry, setEntry] = useState(null); // null | giá trị điền sẵn
  const [qrAccount, setQrAccount] = useState(null); // TK đang mở mã QR

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const data = await accountsApi.list({ includeArchived: true, fresh: true });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const active = useMemo(() => rows.filter((a) => !a.archived), [rows]);
  const archivedCount = rows.length - active.length;
  const visible = showArchived ? rows : active;
  const ownTotal = active.filter((a) => a.is_own !== false).reduce((s, a) => s + num(a.balance), 0);
  const othersTotal = active.filter((a) => a.is_own === false).reduce((s, a) => s + num(a.balance), 0);
  const othersCount = active.filter((a) => a.is_own === false).length;
  const unreconciled = rows.reduce((s, a) => s + num(a.unreconciled_count), 0);
  // TK chính = TK của mình (không giữ hộ, chưa lưu trữ) đầu tiên — đích của "Rút về TK chính".
  const mainAccount = active.find((a) => a.is_own !== false && isOwnedBy(a, user));
  const withdrawToMain = (a) => setTransfer({ fromAccountId: a.id, toAccountId: mainAccount?.id, amount: num(a.balance) > 0 ? num(a.balance) : '' });

  const setArchived = async (a, archived) => {
    try {
      await accountsApi.update(a.id, { archived });
      toast.success(archived ? `Đã lưu trữ "${a.name}"` : `Đã bỏ lưu trữ "${a.name}"`);
      load({ silent: true });
    } catch (err) { toast.error(err.message); }
  };

  const remove = async (a) => {
    const ok = await confirm({ title: 'Xoá tài khoản', message: `Xoá tài khoản "${a.name}"?` });
    if (!ok) return;
    try {
      await accountsApi.remove(a.id);
      toast.success('Đã xoá tài khoản');
      load({ silent: true });
    } catch (err) {
      if (err.status !== 400) { toast.error(err.message); return; }
      // Đã có giao dịch → gợi ý lưu trữ thay vì xoá.
      const archive = await confirm({
        title: 'Không xoá được',
        message: `${err.message}\n\nLưu trữ "${a.name}"? TK lưu trữ bị ẩn khỏi danh sách chọn nhưng lịch sử vẫn giữ nguyên.`,
        confirmText: 'Lưu trữ',
        danger: false,
      });
      if (archive) setArchived(a, true);
    }
  };

  return (
    <div>
      <PageHeader
        help="accounts"
        icon={Wallet}
        title="Tài khoản tiền"
        description="Theo dõi tiền vào/ra từng tài khoản để không sót"
        actions={(
          <>
            <IconButton icon={RefreshCw} title="Tải lại" onClick={() => load({ silent: true })} className={refreshing ? 'animate-spin' : ''} />
            <Button variant="secondary" icon={ReceiptText} onClick={() => setEntry({})}>Thu/chi khác</Button>
            <Button variant="secondary" icon={ArrowRightLeft} onClick={() => setTransfer({})}>Chuyển tiền</Button>
            <Button icon={Plus} onClick={() => setEditing({})}>Thêm tài khoản</Button>
          </>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <StatCard icon={Wallet} label="Tổng số dư TK của mình" value={loading ? '…' : formatCurrency(ownTotal)} sub={`${active.length - othersCount} tài khoản`} tone="brand" />
        <StatCard icon={HandCoins} label="Tiền đang ở TK người khác" value={loading ? '…' : formatCurrency(othersTotal)} sub={othersCount ? `${othersCount} TK giữ hộ — cần thu về` : 'Không có TK giữ hộ'} tone={othersTotal > 0 ? 'warning' : 'gray'} />
        <StatCard icon={ListChecks} label="Chưa đối soát" value={loading ? '…' : `${unreconciled} giao dịch`} sub="Mở từng TK để đánh dấu đã khớp sao kê" tone={unreconciled ? 'danger' : 'success'} />
      </div>

      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">{visible.length} tài khoản{archivedCount ? ` · ${archivedCount} đã lưu trữ` : ''}</p>
        <Switch size="sm" checked={showArchived} onChange={setShowArchived} label="Hiện TK đã lưu trữ" />
      </div>

      <ErrorBanner message={error} onRetry={() => load()} />

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="p-4"><Skeleton className="h-4 w-24 mb-3" /><Skeleton className="h-7 w-40 mb-2" /><Skeleton className="h-3 w-32" /></Card>
          ))}
        </div>
      ) : !error && visible.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Wallet}
            title={rows.length ? 'Tất cả tài khoản đã lưu trữ' : 'Chưa có tài khoản nào'}
            description="Thêm các tài khoản nhận/chi tiền (TCB, VIB, MoMo, tiền mặt, TK người khác giữ hộ) để đối chiếu từng đồng."
            action={<Button icon={Plus} onClick={() => setEditing({})}>Thêm tài khoản</Button>}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {visible.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              owned={isOwnedBy(a, user)}
              onOpen={() => navigate('accounts', a.id)}
              onEdit={() => setEditing(a)}
              onArchive={() => setArchived(a, !a.archived)}
              onDelete={() => remove(a)}
              onQr={accountQrInfo(a).ok ? () => setQrAccount(a) : null}
              onWithdraw={a.is_own === false && !a.archived && mainAccount ? () => withdrawToMain(a) : null}
            />
          ))}
        </div>
      )}

      {editing && (
        <AccountFormModal
          initial={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => load({ silent: true })}
        />
      )}
      {transfer && <TransferModal initial={transfer} onClose={() => setTransfer(null)} onSaved={() => load({ silent: true })} />}
      <QrModal open={!!qrAccount} onClose={() => setQrAccount(null)} account={qrAccount} title={qrAccount ? `Mã QR · ${qrAccount.name}` : ''} />
      {entry && <EntryModal initial={entry} onClose={() => setEntry(null)} onSaved={() => load({ silent: true })} />}
    </div>
  );
}

function AccountCard({ account: a, owned, onOpen, onEdit, onArchive, onDelete, onWithdraw, onQr }) {
  const balance = num(a.balance);
  const unrec = num(a.unreconciled_count);
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      data-testid={`account-${a.id}`}
      className={`card group relative p-4 text-left transition hover:shadow-pop cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 ${a.archived ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {a.bank && <Badge tone="brand">{a.bank}</Badge>}
            {a.is_own === false && <Badge tone="warning">Giữ hộ</Badge>}
            {a.archived && <Badge tone="gray" icon={Archive}>Đã lưu trữ</Badge>}
            {!owned && <Badge tone="outline" icon={Eye}>{a.owner_name || 'Chỉ xem'}</Badge>}
          </div>
          <p className="mt-1.5 font-semibold text-ink truncate">{a.name}</p>
          <p className="text-xs text-ink-muted truncate">
            {[a.holder_name, maskNumber(a.account_number)].filter(Boolean).join(' · ') || ' '}
          </p>
        </div>
        {owned && (
          <div className="flex shrink-0 items-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition">
            {onQr && <IconButton icon={QrCode} title="Mã QR nhận tiền" variant="primary" onClick={stop(onQr)} />}
            <IconButton icon={Pencil} title="Sửa" onClick={stop(onEdit)} />
            <IconButton icon={a.archived ? ArchiveRestore : Archive} title={a.archived ? 'Bỏ lưu trữ' : 'Lưu trữ'} onClick={stop(onArchive)} />
            <IconButton icon={Trash2} title="Xoá" variant="danger" onClick={stop(onDelete)} />
          </div>
        )}
      </div>
      <p className={`mt-3 text-2xl font-bold tabular leading-tight ${balance < 0 ? 'text-danger-600' : 'text-ink'}`}>{formatCurrency(balance)}</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-3 text-ink-muted">
          <span className="inline-flex items-center gap-0.5"><ArrowDownLeft size={13} className="text-success-600" /><span className="tabular">{formatCurrency(a.total_in)}</span></span>
          <span className="inline-flex items-center gap-0.5"><ArrowUpRight size={13} className="text-danger-600" /><span className="tabular">{formatCurrency(a.total_out)}</span></span>
        </span>
        {unrec > 0 ? <Badge tone="danger">{unrec} chưa đối soát</Badge> : <Badge tone="success">Đã đối soát</Badge>}
      </div>
      {owned && onWithdraw && (
        <div className="mt-3 border-t border-surface-border pt-2.5">
          <Button size="xs" variant="soft" icon={Undo2} onClick={stop(onWithdraw)}>Rút về TK chính</Button>
        </div>
      )}
    </div>
  );
}
