import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2, ChevronDown, ChevronUp, PiggyBank, Plus, Undo2, SlidersHorizontal, Trash2, RefreshCw, Wallet,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useFeedback } from '../../ui/FeedbackContext';
import { api } from '../../services/client';
import { accountsApi, accountLabel, walletsApi } from '../../services/money';
import { formatCurrency, formatDate, num, today } from '../../utils/format';
import {
  Badge, Button, DataTable, DateField, ErrorBanner, Field, IconButton, Input, MoneyField, Modal, Select, Skeleton, Textarea,
} from '../../ui';
import { WALLET_KIND, WALLET_LOW, isOwnedBy } from './moneyUtils';

const MODE = {
  topup: { title: 'Nạp tiền vào ví', icon: Plus, submit: 'Nạp tiền', done: 'Đã nạp' },
  refund: { title: 'Hoàn tiền cho khách', icon: Undo2, submit: 'Hoàn tiền', done: 'Đã hoàn' },
  adjust: { title: 'Điều chỉnh số dư', icon: SlidersHorizontal, submit: 'Điều chỉnh', done: 'Đã điều chỉnh' },
};

const balanceTone = (b) => (b <= 0 ? 'text-danger-600' : b < WALLET_LOW ? 'text-warning-600' : 'text-success-600');

/**
 * Modal nạp / hoàn / điều chỉnh ví.
 * Props: mode ('topup'|'refund'|'adjust'), customer ({ id, name }) — null thì hiện ô chọn khách,
 * balance (số dư hiện tại, để gợi ý), onClose, onSaved(customerId).
 */
export function WalletEntryModal({ mode = 'topup', customer, balance, onClose, onSaved }) {
  const { user } = useAuth();
  const { toast } = useFeedback();
  const m = MODE[mode] || MODE.topup;
  const pick = !customer;
  const [accounts, setAccounts] = useState([]);
  const [customers, setCustomers] = useState(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [form, setForm] = useState({ customerId: customer?.id ? String(customer.id) : '', amount: '', entryDate: today(), accountId: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    let alive = true;
    if (mode !== 'adjust') {
      accountsApi.list()
        .then((rows) => { if (alive) setAccounts((rows || []).filter((a) => !a.archived)); })
        .catch(() => {});
    }
    if (pick) {
      api.get('/customers')
        .then((rows) => { if (alive) setCustomers(Array.isArray(rows) ? rows : []); })
        .catch(() => { if (alive) setCustomers([]); });
    }
    return () => { alive = false; };
  }, [mode, pick]);

  const customerOptions = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    return (customers || [])
      .filter((c) => isOwnedBy(c, user))
      .filter((c) => !q || `${c.name || ''} ${c.phone || ''}`.toLowerCase().includes(q))
      .slice(0, 200);
  }, [customers, customerSearch, user]);

  const save = async () => {
    const cid = customer?.id || form.customerId;
    if (!cid) { toast.error('Chọn khách hàng'); return; }
    const amount = num(form.amount);
    if (mode === 'adjust' ? amount === 0 : amount <= 0) {
      toast.error(mode === 'adjust' ? 'Nhập số tiền điều chỉnh (âm để trừ)' : 'Nhập số tiền lớn hơn 0');
      return;
    }
    setSaving(true);
    try {
      const entryDate = form.entryDate || today();
      if (mode === 'adjust') {
        await walletsApi.adjust(cid, { amount, entryDate, notes: form.notes });
      } else {
        const body = { amount, entryDate, accountId: form.accountId ? Number(form.accountId) : null, notes: form.notes };
        await (mode === 'refund' ? walletsApi.refund(cid, body) : walletsApi.topup(cid, body));
      }
      toast.success(`${m.done} ${formatCurrency(Math.abs(amount))}`);
      onSaved?.(cid);
      onClose?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const hasBalance = balance !== undefined && balance !== null;

  return (
    <Modal
      open
      onClose={onClose}
      icon={m.icon}
      title={m.title}
      subtitle={customer ? `${customer.name || 'Khách'}${hasBalance ? ` · số dư ${formatCurrency(balance)}` : ''}` : 'Chọn khách rồi nhập số tiền'}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button icon={CheckCircle2} variant={mode === 'refund' ? 'danger' : 'primary'} loading={saving} onClick={save}>{m.submit}</Button>
        </>
      )}
    >
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {pick && (
          <>
            <Field label="Tìm khách" htmlFor="wl-search">
              <Input id="wl-search" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Tên hoặc SĐT" />
            </Field>
            <Field label="Khách hàng" required htmlFor="wl-customer" hint={customers === null ? 'Đang tải danh sách khách…' : customerOptions.length ? undefined : 'Không có khách khớp.'}>
              <Select id="wl-customer" value={form.customerId} onChange={(e) => set('customerId', e.target.value)}>
                <option value="">— Chọn khách —</option>
                {customerOptions.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>)}
              </Select>
            </Field>
          </>
        )}
        <Field
          label={mode === 'adjust' ? 'Số tiền (+ cộng / − trừ)' : 'Số tiền'}
          required
          htmlFor="wl-amount"
          hint={mode === 'refund' && hasBalance ? `Tối đa ${formatCurrency(balance)}` : mode === 'adjust' ? 'Gõ dấu - phía trước để trừ.' : undefined}
        >
          <MoneyField id="wl-amount" value={form.amount} allowNegative={mode === 'adjust'} onChange={(v) => set('amount', v)} placeholder="0" />
        </Field>
        <Field label="Ngày">
          <DateField value={form.entryDate} onChange={(v) => set('entryDate', v)} />
        </Field>
        {mode !== 'adjust' && (
          <Field label={mode === 'refund' ? 'Chi từ tài khoản' : 'Vào tài khoản'} htmlFor="wl-account" className="sm:col-span-2">
            <Select id="wl-account" value={form.accountId} onChange={(e) => set('accountId', e.target.value)}>
              <option value="">— Không chọn —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Ghi chú" htmlFor="wl-notes" className="sm:col-span-2">
          <Textarea id="wl-notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}

/**
 * Khối ví trả trước của 1 khách: số dư, nạp/hoàn/điều chỉnh, lịch sử.
 * Props: customerId, readOnly (mặc định: tự suy ra từ chủ sở hữu khách),
 * collapsible (thu gọn thành 1 dòng "Ví trả trước · số dư X", bấm để mở), onLoaded(data).
 */
export default function WalletPanel({ customerId, readOnly, collapsible = false, onLoaded }) {
  const { user } = useAuth();
  const { toast, confirm } = useFeedback();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(!collapsible);
  const [modal, setModal] = useState(null); // 'topup' | 'refund' | 'adjust'
  // onLoaded thường là hàm mới mỗi render → giữ trong ref để không tải lại liên tục.
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => { onLoadedRef.current = onLoaded; }, [onLoaded]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await walletsApi.get(customerId);
      setData(d);
      onLoadedRef.current?.(d);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [customerId]);
  useEffect(() => { load(); }, [load]);

  const balance = num(data?.balance);
  const entries = data?.entries || [];
  const ro = readOnly ?? !isOwnedBy(data?.customer, user);
  const customer = data?.customer ? { id: data.customer.id ?? customerId, name: data.customer.name } : { id: customerId, name: '' };

  const removeEntry = async (e) => {
    const k = WALLET_KIND[e.kind]?.label || e.kind;
    const ok = await confirm({ title: 'Xoá giao dịch ví', message: `Xoá "${k}" ${formatCurrency(Math.abs(num(e.amount)))} ngày ${formatDate(e.entry_date)}?` });
    if (!ok) return;
    try {
      await walletsApi.removeEntry(e.id);
      toast.success('Đã xoá giao dịch ví');
      load();
    } catch (err) { toast.error(err.message); }
  };

  // Backend cũ chưa có API ví → trong trang khách thì ẩn hẳn khối này.
  if (collapsible && error?.status === 404) return null;

  const columns = [
    { key: 'entry_date', label: 'Ngày', width: 100, render: (e) => formatDate(e.entry_date) },
    { key: 'kind', label: 'Loại', width: 100, render: (e) => <Badge tone={WALLET_KIND[e.kind]?.tone || 'gray'}>{WALLET_KIND[e.kind]?.label || e.kind}</Badge> },
    {
      key: 'amount', label: 'Số tiền', align: 'right', render: (e) => {
        const a = num(e.amount);
        return <span className={`font-semibold ${a < 0 ? 'text-danger-600' : 'text-success-600'}`}>{a > 0 ? '+' : a < 0 ? '−' : ''}{formatCurrency(Math.abs(a))}</span>;
      },
    },
    { key: 'account_name', label: 'TK', hideBelow: 'md', render: (e) => e.account_name || <span className="text-ink-faint">—</span> },
    { key: 'target_label', label: 'Cho vé', hideBelow: 'sm', render: (e) => e.target_label || <span className="text-ink-faint">—</span> },
    { key: 'notes', label: 'Ghi chú', hideBelow: 'lg', render: (e) => <span className="text-ink-muted">{e.notes || ''}</span> },
    {
      key: 'actions', label: '', align: 'right', width: 50,
      render: (e) => (!ro && e.kind !== 'charge'
        ? <IconButton icon={Trash2} title="Xoá giao dịch" variant="danger" onClick={() => removeEntry(e)} />
        : null),
    },
  ];

  const header = (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success-50 text-success-600"><PiggyBank size={20} /></span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Ví trả trước</p>
          {loading && !data ? (
            <Skeleton className="h-6 w-32 mt-1" />
          ) : (
            <p className={`font-bold tabular leading-tight ${collapsible ? 'text-lg' : 'text-3xl'} ${balanceTone(balance)}`} data-testid="wallet-balance">{formatCurrency(balance)}</p>
          )}
          {data && <p className="text-xs text-ink-faint">{entries.length} giao dịch{balance > 0 && balance < WALLET_LOW ? ' · sắp hết' : balance < 0 ? ' · đang âm' : ''}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!ro && data && (
          <>
            <Button size="sm" icon={Plus} onClick={() => setModal('topup')}>Nạp tiền</Button>
            <Button size="sm" variant="secondary" icon={Undo2} onClick={() => setModal('refund')} disabled={balance <= 0}>Hoàn tiền</Button>
            <Button size="sm" variant="secondary" icon={SlidersHorizontal} onClick={() => setModal('adjust')}>Điều chỉnh</Button>
          </>
        )}
        {collapsible && (
          <Button size="sm" variant="ghost" iconRight={open ? ChevronUp : ChevronDown} onClick={() => setOpen((v) => !v)}>
            {open ? 'Thu gọn' : 'Lịch sử'}
          </Button>
        )}
        {!collapsible && <IconButton icon={RefreshCw} title="Tải lại" onClick={load} />}
      </div>
    </div>
  );

  return (
    <div className={collapsible ? 'card p-4 mb-5' : ''}>
      {collapsible ? header : <div className="card p-4 sm:p-5 mb-4">{header}</div>}
      {error && !(collapsible && error.status === 404) && (
        <div className={collapsible ? 'mt-3' : 'mb-4'}><ErrorBanner message={error.message} onRetry={load} /></div>
      )}
      {open && (
        <div className={collapsible ? 'mt-4' : ''}>
          <DataTable
            columns={columns}
            rows={entries}
            loading={loading && !data}
            className={collapsible ? 'shadow-none' : ''}
            emptyIcon={Wallet}
            emptyTitle="Ví chưa có giao dịch"
            emptyDescription={ro ? undefined : 'Khách chuyển trước một khoản thì bấm "Nạp tiền"; khi thanh toán vé chọn hình thức "Trừ ví".'}
            mobileCard={(e) => {
              const a = num(e.amount);
              return (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-ink truncate"><Badge tone={WALLET_KIND[e.kind]?.tone || 'gray'}>{WALLET_KIND[e.kind]?.label || e.kind}</Badge> {e.target_label || e.notes || ''}</p>
                    <p className="text-xs text-ink-muted">{[formatDate(e.entry_date), e.account_name].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className={`font-bold tabular ${a < 0 ? 'text-danger-600' : 'text-success-600'}`}>{a > 0 ? '+' : a < 0 ? '−' : ''}{formatCurrency(Math.abs(a))}</span>
                    {!ro && e.kind !== 'charge' && <IconButton icon={Trash2} title="Xoá giao dịch" variant="danger" onClick={() => removeEntry(e)} />}
                  </div>
                </div>
              );
            }}
          />
        </div>
      )}
      {modal && (
        <WalletEntryModal
          mode={modal}
          customer={customer}
          balance={balance}
          onClose={() => setModal(null)}
          onSaved={() => load()}
        />
      )}
    </div>
  );
}
