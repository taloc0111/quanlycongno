import { useCallback, useEffect, useState } from 'react';
import { Trash2, Plus, Landmark, User, Wallet, Receipt, PiggyBank, AlertCircle, Zap, Banknote, Info, Ban, Undo2, QrCode } from 'lucide-react';
import { api } from '../services/client';
import { accountsApi, walletsApi, PAYMENT_METHODS, methodLabel, accountLabel, invalidateMoneyCache } from '../services/money';
import { activeAccounts, defaultAccountId, rememberAccount } from '../modules/payState';
import { formatCurrency, formatDate, today, num } from '../utils/format';
import { useFeedback } from '../ui/FeedbackContext';
import { Button, IconButton, Field, Select, MoneyField, DateField, Modal, Badge, EmptyState, Skeleton, ErrorBanner } from '../ui';
import { QrModal } from './BankQR';

const PARAM = { debt: 'debtId', passport: 'passportId', train: 'trainTicketId', tour: 'tourId' };

/**
 * Modal lịch sử thanh toán cho 1 khoản nợ (vé máy bay / tàu / hộ chiếu / tour).
 * Props:
 *  - target: { type: 'debt'|'passport'|'train'|'tour', id, name, total, paid, customerId, cancelled }
 *    customerId cần cho hình thức "Trừ ví trả trước" và để phần trả thừa tự vào ví khách (v3.1).
 *    cancelled = dịch vụ đã huỷ → chỉ nhận thêm khi khách còn nợ phí huỷ, tối đa đúng số còn nợ.
 *  - onClose: () => void
 *  - onChanged: () => void   gọi sau khi thêm/xoá (để cha tải lại danh sách)
 */
export default function PaymentModal({ target, onClose, onChanged }) {
  const { toast, confirm } = useFeedback();
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState('cash');
  const [paymentTarget, setPaymentTarget] = useState('self');
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [qrOpen, setQrOpen] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [wallet, setWallet] = useState({ loading: false, balance: null, error: '' });

  const paramKey = PARAM[target.type] || 'debtId';
  const query = `${paramKey}=${target.id}`;
  const total = num(target.total);
  const paidSum = payments.reduce((s, p) => s + num(p.amount), 0);
  const remaining = total - paidSum;
  const amt = num(amount);
  const isWallet = method === 'wallet';
  const customerId = target.customerId;
  const cancelled = !!target.cancelled;
  // Đã huỷ: hết nợ → khoá hẳn; còn nợ phí huỷ → vẫn thu nhưng không vượt số còn nợ (không đẩy thừa vào ví).
  const locked = cancelled && remaining <= 0;
  // Trả thừa (không phải trừ ví) + có khách → server tự đưa phần thừa vào ví khách.
  const overflow = !cancelled && !isWallet && customerId && amt > 0 && amt > Math.max(0, remaining) ? amt - Math.max(0, remaining) : 0;
  const exceeds = !overflow && amt > 0 && remaining > 0 && amt > remaining;
  const walletBalance = wallet.balance === null ? null : num(wallet.balance);
  const overBalance = isWallet && walletBalance !== null && amt > walletBalance;
  const walletBlocked = isWallet && (!customerId || wallet.loading || !!wallet.error || walletBalance === null || overBalance);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPayments(await api.get(`/payments?${query}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { load(); }, [load]);

  // Danh sách tài khoản (cache ngắn trong services/money) + mặc định = TK dùng gần nhất.
  useEffect(() => {
    let alive = true;
    accountsApi.list().then((list) => {
      if (!alive) return;
      const arr = Array.isArray(list) ? list : [];
      setAccounts(arr);
      setAccountId((cur) => cur || defaultAccountId(arr));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const loadWallet = useCallback(async () => {
    if (!customerId) return;
    setWallet({ loading: true, balance: null, error: '' });
    try {
      const w = await walletsApi.get(customerId);
      setWallet({ loading: false, balance: w?.balance ?? 0, error: '' });
    } catch (err) {
      setWallet({ loading: false, balance: null, error: err.message });
    }
  }, [customerId]);

  useEffect(() => { if (isWallet) loadWallet(); }, [isWallet, loadWallet]);

  const add = async () => {
    if (locked) return;
    if (cancelled && amt > remaining) { toast.error(`Dịch vụ đã huỷ: chỉ thu tối đa ${formatCurrency(remaining)}`); return; }
    if (!Number.isFinite(amt) || amt <= 0) { toast.error('Nhập số tiền hợp lệ'); return; }
    if (walletBlocked) return;
    setSaving(true);
    try {
      const res = await api.post('/payments', {
        [paramKey]: target.id,
        amount: amt,
        paymentDate: date || undefined,
        method,
        paymentTarget,
        accountId: !isWallet && accountId ? Number(accountId) : null,
      });
      if (!isWallet && accountId) rememberAccount(accountId);
      invalidateMoneyCache('accounts');
      if (isWallet) loadWallet();
      setAmount('');
      const toWallet = num(res?.overflowToWallet);
      if (toWallet > 0) {
        invalidateMoneyCache();
        toast.success(`Đã ghi ${formatCurrency(amt - toWallet)}, ${formatCurrency(toWallet)} vào ví khách`);
      } else {
        toast.success(`Đã ghi nhận ${formatCurrency(amt)}`);
      }
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p) => {
    const ok = await confirm({
      title: 'Xoá lần thanh toán',
      message: `Xoá khoản ${formatCurrency(p.amount)} ngày ${formatDate(p.payment_date)}?`,
    });
    if (!ok) return;
    try {
      await api.del(`/payments/${p.id}`);
      toast.success(p.method === 'wallet' ? 'Đã xoá, tiền đã trả lại ví khách' : 'Đã xoá');
      invalidateMoneyCache('accounts');
      if (p.method === 'wallet' && isWallet) loadWallet();
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const tiles = [
    { icon: Receipt, label: 'Tổng', value: total, cls: 'bg-surface-subtle text-ink' },
    { icon: PiggyBank, label: 'Đã trả', value: paidSum, cls: 'bg-success-50 text-success-700' },
    { icon: Wallet, label: 'Còn nợ', value: remaining, cls: remaining > 0 ? 'bg-danger-50 text-danger-700' : 'bg-success-50 text-success-700' },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      icon={Wallet}
      title="Thanh toán"
      subtitle={target.name}
      size="lg"
      footer={(
        <>
          {remaining > 0 && (
            <Button variant="soft" icon={QrCode} onClick={() => setQrOpen(true)} title="Tạo mã VietQR đúng số còn nợ để gửi khách quét">
              Mã QR thu tiền
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Đóng</Button>
        </>
      )}
    >
      <QrModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        accounts={accounts.filter((a) => a.is_own !== false)}
        amount={Math.max(0, remaining)}
        content={target.name}
        title={`Thu tiền · ${target.name}`}
      />
      <div className="space-y-4">
        {/* 3 ô số liệu */}
        <div className="grid grid-cols-3 gap-2">
          {tiles.map((t) => (
            <div key={t.label} className={`rounded-xl px-3 py-2.5 ${t.cls}`}>
              <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide opacity-70"><t.icon size={12} /> {t.label}</p>
              <p className="mt-0.5 text-sm sm:text-base font-bold tabular truncate" title={formatCurrency(t.value)}>{formatCurrency(t.value)}</p>
            </div>
          ))}
        </div>

        {cancelled && (
          <div className="flex items-start gap-2 rounded-xl border border-surface-border bg-surface-subtle px-3 py-2.5 text-sm text-ink-soft" data-testid="cancelled-notice">
            <Ban size={16} className="mt-0.5 shrink-0 text-ink-muted" />
            {locked
              ? <span>Dịch vụ đã huỷ và khách không còn nợ — không nhận thanh toán mới.</span>
              : <span>Dịch vụ đã huỷ — chỉ thu phần phí huỷ khách còn nợ: <b className="tabular">{formatCurrency(remaining)}</b>.</span>}
          </div>
        )}

        {/* Thêm thanh toán */}
        <form
          onSubmit={(e) => { e.preventDefault(); add(); }}
          className={`rounded-xl border border-surface-border bg-surface-muted p-3 ${locked ? 'opacity-60' : ''}`}
        >
          <fieldset disabled={locked} className="contents">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <Field label="Số tiền" required htmlFor="pm-amount" className="col-span-2 sm:col-span-1">
                <MoneyField id="pm-amount" value={amount} onChange={setAmount} placeholder="0" />
                {exceeds && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-warning-600"><AlertCircle size={12} /> Vượt số còn nợ {formatCurrency(remaining)}</p>
                )}
                {overflow > 0 && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-brand-700" data-testid="overflow-info"><Info size={12} /> Phần thừa {formatCurrency(overflow)} sẽ vào ví khách</p>
                )}
              </Field>
              <Field label="Ngày" htmlFor="pm-date">
                <DateField id="pm-date" value={date} onChange={setDate} />
              </Field>
              <Field label="Hình thức" htmlFor="pm-method">
                <Select id="pm-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </Select>
              </Field>
              {!isWallet && (
                <Field label="Vào tài khoản" htmlFor="pm-account" hint={activeAccounts(accounts).length ? undefined : 'Chưa có tài khoản nào (thêm ở Dòng tiền › Tài khoản)'}>
                  <Select id="pm-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                    <option value="">— Chưa chọn tài khoản —</option>
                    {activeAccounts(accounts).map((a) => <option key={a.id} value={String(a.id)}>{accountLabel(a)}</option>)}
                  </Select>
                </Field>
              )}
              <Field label="Tiền này tính cho" hint="Của cấp trên = khách chuyển thẳng cho đại lý cấp trên">
                <Select value={paymentTarget} onChange={(e) => setPaymentTarget(e.target.value)}>
                  <option value="self">Của mình</option>
                  <option value="agency">Của cấp trên (tính vào nộp quỹ)</option>
                </Select>
              </Field>
            </div>
            {isWallet && (
              <div className="mt-2.5 rounded-lg bg-white border border-surface-border px-3 py-2 text-sm" data-testid="wallet-info">
                {!customerId ? (
                  <p className="flex items-center gap-1.5 text-warning-700"><AlertCircle size={14} /> Dịch vụ chưa gắn khách hàng, không trừ ví được</p>
                ) : wallet.loading ? (
                  <Skeleton className="h-4 w-40" />
                ) : wallet.error ? (
                  <p className="text-danger-600">{wallet.error} <button type="button" className="underline font-semibold" onClick={loadWallet}>Thử lại</button></p>
                ) : (
                  <>
                    <p className="flex items-center gap-1.5 text-ink-soft"><Banknote size={14} /> Số dư ví: <b className="tabular text-ink">{formatCurrency(walletBalance ?? 0)}</b></p>
                    {overBalance && <p className="mt-1 flex items-center gap-1 text-xs text-danger-600"><AlertCircle size={12} /> Vượt số dư ví, nạp thêm tiền vào ví hoặc chọn hình thức khác</p>}
                  </>
                )}
              </div>
            )}
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                size="sm"
                variant="soft"
                icon={Zap}
                disabled={remaining <= 0 || locked}
                onClick={() => setAmount(String(Math.round(remaining)))}
                title="Điền số còn nợ vào ô Số tiền"
              >
                Trả hết {remaining > 0 ? formatCurrency(remaining) : ''}
              </Button>
              <Button type="submit" size="sm" variant="success" icon={Plus} loading={saving} disabled={walletBlocked || locked}>Thêm thanh toán</Button>
            </div>
          </fieldset>
        </form>

        {/* Danh sách */}
        <div>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Lịch sử ({payments.length})</p>
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : error ? (
            <ErrorBanner message={error} onRetry={load} />
          ) : payments.length === 0 ? (
            <EmptyState icon={AlertCircle} title="Chưa có thanh toán nào" description="Nhập số tiền ở trên để ghi nhận lần trả đầu tiên." compact />
          ) : (
            <ul className="divide-y divide-surface-border rounded-xl border border-surface-border overflow-hidden">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-surface-muted">
                  <span className="w-20 shrink-0 text-ink-muted tabular">{formatDate(p.payment_date)}</span>
                  <div className="flex flex-wrap items-center gap-1 min-w-0 flex-1">
                    {p.kind === 'refund' && <Badge tone="danger" icon={Undo2}>Hoàn tiền{p.method === 'wallet' ? ' vào ví' : ''}</Badge>}
                    {p.kind !== 'refund' && (p.method === 'wallet'
                      ? <Badge tone="purple" icon={Wallet}>Trừ ví</Badge>
                      : <Badge tone="gray">{methodLabel(p.method) || '—'}</Badge>)}
                    {p.receipt_id && <Badge tone="outline" icon={Receipt}>Phiếu thu #{p.receipt_id}</Badge>}
                    {p.account_name && <Badge tone="outline" icon={Banknote}>{p.account_name}</Badge>}
                    {p.payment_target === 'agency'
                      ? <Badge tone="warning" icon={Landmark}>Cấp trên</Badge>
                      : <Badge tone="brand" icon={User}>Cá nhân</Badge>}
                  </div>
                  <span className={`font-semibold tabular shrink-0 ${num(p.amount) < 0 ? 'text-danger-600' : 'text-success-600'}`}>{formatCurrency(p.amount)}</span>
                  {p.kind === 'refund'
                    ? <span className="w-8 shrink-0" title="Khoản hoàn khi huỷ — xoá bằng Hoàn tác huỷ" />
                    : <IconButton icon={Trash2} title="Xoá" variant="danger" size={15} onClick={() => remove(p)} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
