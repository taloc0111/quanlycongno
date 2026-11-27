import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Eraser, HandCoins, PiggyBank, Wand2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useFeedback } from '../../ui/FeedbackContext';
import {
  Badge, Button, DateField, ErrorBanner, Field, MoneyField, Modal, Select, Skeleton, Textarea,
} from '../../ui';
import { PAYMENT_METHODS, accountLabel, accountsApi, customerOutstanding, receiptsApi } from '../../services/money';
import { formatCurrency, formatDate, num, today } from '../../utils/format';
import { activeAccounts, defaultAccountId, rememberAccount } from '../payState';
import { autoAllocate, isOwnedBy } from './moneyUtils';

const TYPE_LABEL = { debt: 'Vé máy bay', passport: 'Hộ chiếu', train: 'Vé tàu', tour: 'Tour' };
const TYPE_TONE = { debt: 'brand', passport: 'success', train: 'purple', tour: 'warning' };
const METHODS = PAYMENT_METHODS.filter((m) => m.value !== 'wallet');
const keyOf = (r) => `${r.type}-${r.id}`;

/**
 * Phiếu thu nhiều vé: 1 lần khách chuyển tiền, chia cho nhiều dịch vụ còn nợ, phần thừa vào ví khách.
 * Props: { open, onClose, onDone(result), customerId, preselect: [{ type, id }] } — preselect = các dòng tick sẵn.
 */
export default function ReceiptModal({ open, onClose, onDone, customerId, preselect = [] }) {
  const preKey = (preselect || []).map(keyOf).join(',');
  if (!open) return null;
  // Mount lại mỗi lần mở (hoặc đổi khách / dòng chọn sẵn) để form sạch.
  return <ReceiptForm key={`${customerId || ''}|${preKey}`} onClose={onClose} onDone={onDone} customerId={customerId} preKey={preKey} />;
}

function ReceiptForm({ onClose, onDone, customerId, preKey }) {
  const { user } = useAuth();
  const { toast } = useFeedback();
  const [form, setForm] = useState({ amount: '', accountId: '', receiptDate: today(), method: 'bank_transfer', paymentTarget: 'self', notes: '' });
  const [accounts, setAccounts] = useState([]);
  const [rows, setRows] = useState(customerId ? null : []);
  const [loadError, setLoadError] = useState('');
  const [alloc, setAlloc] = useState(() => Object.fromEntries(
    (preKey ? preKey.split(',') : []).map((k) => [k, { checked: true, amount: '' }]),
  ));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    let alive = true;
    accountsApi.list()
      .then((rs) => {
        if (!alive) return;
        const list = activeAccounts(rs || []).filter((a) => isOwnedBy(a, user));
        setAccounts(list);
        setForm((f) => (f.accountId ? f : { ...f, accountId: defaultAccountId(list) }));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [user]);

  const loadOutstanding = useCallback(() => {
    if (!customerId) return undefined;
    let alive = true;
    customerOutstanding(customerId)
      .then((rs) => { if (alive) { setRows(Array.isArray(rs) ? rs : []); setLoadError(''); } })
      .catch((err) => { if (alive) { setRows([]); setLoadError(err.message); } });
    return () => { alive = false; };
  }, [customerId]);
  useEffect(() => loadOutstanding(), [loadOutstanding]);

  const list = useMemo(() => rows || [], [rows]);
  const amount = num(form.amount);
  const allocated = list
    .filter((r) => alloc[keyOf(r)]?.checked)
    .map((r) => ({ r, amt: num(alloc[keyOf(r)].amount) }));
  const totalAlloc = allocated.reduce((s, a) => s + a.amt, 0);
  const remainder = amount - totalAlloc;
  const rowError = (r) => {
    const a = alloc[keyOf(r)];
    if (!a?.checked) return '';
    return num(a.amount) > num(r.remaining) ? `Vượt số còn nợ ${formatCurrency(r.remaining)}` : '';
  };
  const hasRowError = list.some((r) => rowError(r));
  let summaryError = '';
  if (totalAlloc > amount) summaryError = `Tổng chia vượt số tiền khách chuyển ${formatCurrency(totalAlloc - amount)}`;
  else if (amount > 0 && remainder > 0 && !customerId) summaryError = 'Không có khách để nhận phần thừa — hãy chia hết số tiền vào các vé.';

  const setRowAmount = (r, v) => setAlloc((s) => ({ ...s, [keyOf(r)]: { checked: num(v) > 0 || !!s[keyOf(r)]?.checked, amount: v } }));
  const toggleRow = (r, checked) => setAlloc((s) => {
    const k = keyOf(r);
    if (!checked) return { ...s, [k]: { checked: false, amount: '' } };
    // Tick 1 dòng: điền sẵn phần tiền còn chưa chia (tối đa số còn nợ).
    const others = list.filter((x) => keyOf(x) !== k && s[keyOf(x)]?.checked).reduce((sum, x) => sum + num(s[keyOf(x)].amount), 0);
    const fill = Math.min(num(r.remaining), Math.max(0, amount - others));
    return { ...s, [k]: { checked: true, amount: s[k]?.amount || (fill > 0 ? String(fill) : '') } };
  });

  const autoFill = () => {
    if (amount <= 0) { toast.error('Nhập số tiền khách chuyển trước'); return; }
    const anyChecked = list.some((r) => alloc[keyOf(r)]?.checked);
    const candidates = anyChecked ? list.filter((r) => alloc[keyOf(r)]?.checked) : list;
    const res = autoAllocate(candidates.map((r) => ({ key: keyOf(r), remaining: r.remaining })), amount);
    setAlloc(() => {
      const next = {};
      for (const r of candidates) {
        const k = keyOf(r);
        if (anyChecked || res[k] > 0) next[k] = { checked: true, amount: res[k] > 0 ? String(res[k]) : '' };
      }
      return next;
    });
  };
  const clearAlloc = () => setAlloc((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { ...v, amount: '' }])));

  const save = async () => {
    if (amount <= 0) { toast.error('Nhập số tiền khách chuyển'); return; }
    if (hasRowError) { toast.error('Có dòng chia vượt số còn nợ'); return; }
    if (summaryError) { toast.error(summaryError); return; }
    setSaving(true);
    try {
      const body = {
        accountId: form.accountId ? Number(form.accountId) : null,
        receiptDate: form.receiptDate || today(),
        method: form.method,
        paymentTarget: form.paymentTarget,
        notes: form.notes,
        customerId: customerId ? Number(customerId) : null,
        amount,
        allocations: allocated.filter((a) => a.amt > 0).map(({ r, amt }) => ({ type: r.type, id: Number(r.id), amount: amt })),
      };
      const res = await receiptsApi.create(body);
      rememberAccount(form.accountId);
      toast.success(`Đã ghi phiếu thu ${formatCurrency(amount)}${remainder > 0 ? ` · ${formatCurrency(remainder)} vào ví khách` : ''}`);
      onDone?.(res);
      onClose?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={HandCoins}
      size="xl"
      title="Thu tiền nhiều vé"
      subtitle="Một lần khách chuyển tiền, chia cho nhiều dịch vụ còn nợ — phần thừa vào ví khách"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button icon={CheckCircle2} loading={saving} disabled={!!summaryError || hasRowError} onClick={save}>Ghi phiếu thu</Button>
        </>
      )}
    >
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        <Field label="Số tiền khách chuyển" required htmlFor="rc-amount">
          <MoneyField id="rc-amount" value={form.amount} onChange={(v) => set('amount', v)} placeholder="0" />
        </Field>
        <Field label="Vào tài khoản" htmlFor="rc-account" hint={accounts.length ? undefined : 'Chưa có tài khoản — thêm ở mục Dòng tiền → Tài khoản.'}>
          <Select id="rc-account" value={form.accountId} onChange={(e) => set('accountId', e.target.value)}>
            <option value="">— Chưa chọn tài khoản —</option>
            {accounts.map((a) => <option key={a.id} value={String(a.id)}>{accountLabel(a)}</option>)}
          </Select>
        </Field>
        <Field label="Ngày">
          <DateField value={form.receiptDate} onChange={(v) => set('receiptDate', v)} />
        </Field>
        <Field label="Hình thức" htmlFor="rc-method">
          <Select id="rc-method" value={form.method} onChange={(e) => set('method', e.target.value)}>
            {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </Field>
        <Field label="Tiền này tính cho" htmlFor="rc-target" hint="Của cấp trên = khách chuyển thẳng cho đại lý cấp trên">
          <Select id="rc-target" value={form.paymentTarget} onChange={(e) => set('paymentTarget', e.target.value)}>
            <option value="self">Của mình</option>
            <option value="agency">Của cấp trên (tính vào nộp quỹ)</option>
          </Select>
        </Field>
        <Field label="Ghi chú" htmlFor="rc-notes">
          <Textarea id="rc-notes" rows={1} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <button type="submit" className="hidden" aria-hidden />
      </form>

      <div className="mt-5 mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-ink">Các dịch vụ còn nợ {rows ? `(${list.length})` : ''}</h4>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="soft" icon={Wand2} onClick={autoFill} disabled={!list.length}>Chia tự động (cũ trước)</Button>
          <Button size="sm" variant="secondary" icon={Eraser} onClick={clearAlloc} disabled={!list.length}>Xoá chia</Button>
        </div>
      </div>
      <ErrorBanner message={loadError} onRetry={loadOutstanding} />
      {rows === null ? (
        <div className="space-y-2 py-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
      ) : !customerId ? (
        <p className="rounded-lg bg-surface-muted px-3 py-3 text-sm text-ink-muted">Chưa chọn khách hàng — không có danh sách còn nợ.</p>
      ) : list.length === 0 && !loadError ? (
        <p className="rounded-lg bg-surface-muted px-3 py-3 text-sm text-ink-muted">Khách không còn dịch vụ nào đang nợ. Toàn bộ số tiền sẽ vào ví khách.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-surface-border">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="bg-surface-muted text-[11.5px] uppercase tracking-wide text-ink-muted">
                <th className="w-9 px-3 py-2" />
                <th className="px-3 py-2 text-left">Dịch vụ</th>
                <th className="px-3 py-2 text-left">Ngày / hạn</th>
                <th className="px-3 py-2 text-right">Tổng</th>
                <th className="px-3 py-2 text-right">Còn nợ</th>
                <th className="px-3 py-2 text-right w-40">Chia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {list.map((r) => {
                const k = keyOf(r);
                const a = alloc[k];
                const err = rowError(r);
                return (
                  <tr key={k} className={a?.checked ? 'bg-brand-50/40' : ''} data-testid={`out-${k}`}>
                    <td className="px-3 py-2 align-top">
                      <input
                        type="checkbox"
                        aria-label={`Chọn ${r.label || k}`}
                        checked={!!a?.checked}
                        onChange={(e) => toggleRow(r, e.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <p className="font-medium text-ink">{r.label || '—'}</p>
                      <Badge tone={TYPE_TONE[r.type] || 'gray'}>{TYPE_LABEL[r.type] || r.type}</Badge>
                    </td>
                    <td className="px-3 py-2 align-top text-ink-muted whitespace-nowrap">
                      {formatDate(r.issue_date) || '—'}
                      {r.due_date && <span className="block text-xs">hạn {formatDate(r.due_date)}</span>}
                    </td>
                    <td className="px-3 py-2 align-top text-right tabular">{formatCurrency(r.total)}</td>
                    <td className="px-3 py-2 align-top text-right tabular font-semibold text-danger-600">{formatCurrency(r.remaining)}</td>
                    <td className="px-3 py-2 align-top">
                      <MoneyField
                        aria-label={`Chia cho ${r.label || k}`}
                        value={a?.amount || ''}
                        onChange={(v) => setRowAmount(r, v)}
                        placeholder="0"
                        className={`input-sm text-right ${err ? 'input-error' : ''}`}
                      />
                      {err && <p className="mt-1 text-xs text-danger-600">{err}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-xl bg-surface-muted p-3 text-sm" data-testid="receipt-summary">
        <div>
          <p className="text-xs text-ink-muted">Khách chuyển</p>
          <p className="font-bold tabular text-ink">{formatCurrency(amount)}</p>
        </div>
        <div>
          <p className="text-xs text-ink-muted">Tổng chia</p>
          <p className="font-bold tabular text-ink">{formatCurrency(totalAlloc)}</p>
        </div>
        <div>
          <p className="text-xs text-ink-muted">Phần thừa</p>
          <p className={`font-bold tabular ${remainder < 0 ? 'text-danger-600' : remainder > 0 ? 'text-success-600' : 'text-ink'}`}>{formatCurrency(Math.max(0, remainder))}</p>
        </div>
        {summaryError ? (
          <p className="sm:col-span-3 text-danger-600 font-medium" role="alert">{summaryError}</p>
        ) : remainder > 0 ? (
          <p className="sm:col-span-3 inline-flex items-center gap-1.5 text-success-700"><PiggyBank size={15} /> Phần thừa {formatCurrency(remainder)} sẽ vào ví khách</p>
        ) : null}
      </div>
    </Modal>
  );
}
