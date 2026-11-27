import { useEffect, useState } from 'react';
import { ArrowRightLeft, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useFeedback } from '../../ui/FeedbackContext';
import { Button, DateField, Field, MoneyField, Modal, Select, Textarea } from '../../ui';
import { accountLabel, accountsApi, transfersApi } from '../../services/money';
import { formatCurrency, num, today } from '../../utils/format';
import { isOwnedBy } from './moneyUtils';

/**
 * Modal chuyển tiền giữa 2 tài khoản của mình (vd TK chị Lan trả về TCB, rút tiền mặt).
 * `initial`: { fromAccountId, toAccountId, amount } điền sẵn (tuỳ chọn). onSaved(row) sau khi lưu.
 */
export default function TransferModal({ initial, onClose, onSaved }) {
  const { user } = useAuth();
  const { toast } = useFeedback();
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState(() => ({
    fromAccountId: initial?.fromAccountId ? String(initial.fromAccountId) : '',
    toAccountId: initial?.toAccountId ? String(initial.toAccountId) : '',
    amount: num(initial?.amount) > 0 ? String(Math.round(num(initial.amount))) : '',
    fee: '',
    transferDate: today(),
    notes: '',
  }));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    let alive = true;
    accountsApi.list()
      .then((rows) => { if (alive) setAccounts((rows || []).filter((a) => !a.archived && isOwnedBy(a, user))); })
      .catch(() => {});
    return () => { alive = false; };
  }, [user]);

  const from = accounts.find((a) => String(a.id) === form.fromAccountId);
  const fee = num(form.fee);
  const amount = num(form.amount);

  const save = async () => {
    if (!form.fromAccountId || !form.toAccountId) { toast.error('Chọn tài khoản chuyển và tài khoản nhận'); return; }
    if (form.fromAccountId === form.toAccountId) { toast.error('Tài khoản chuyển và nhận phải khác nhau'); return; }
    if (amount <= 0) { toast.error('Nhập số tiền lớn hơn 0'); return; }
    setSaving(true);
    try {
      const body = {
        fromAccountId: Number(form.fromAccountId),
        toAccountId: Number(form.toAccountId),
        amount,
        fee,
        transferDate: form.transferDate || today(),
        notes: form.notes,
      };
      const row = await transfersApi.create(body);
      toast.success(`Đã chuyển ${formatCurrency(amount)}`);
      onSaved?.(row);
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
      icon={ArrowRightLeft}
      title="Chuyển tiền giữa tài khoản"
      subtitle="Tiền rời TK nguồn và vào TK nhận; phí chuyển trừ ở TK nguồn"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button icon={CheckCircle2} loading={saving} onClick={save}>Ghi chuyển tiền</Button>
        </>
      )}
    >
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <Field label="Từ tài khoản" required htmlFor="tf-from" hint={from ? `Số dư ${formatCurrency(from.balance)}` : undefined}>
          <Select id="tf-from" value={form.fromAccountId} onChange={(e) => set('fromAccountId', e.target.value)}>
            <option value="">— Chọn —</option>
            {accounts.map((a) => <option key={a.id} value={String(a.id)}>{accountLabel(a)}</option>)}
          </Select>
        </Field>
        <Field label="Sang tài khoản" required htmlFor="tf-to">
          <Select id="tf-to" value={form.toAccountId} onChange={(e) => set('toAccountId', e.target.value)}>
            <option value="">— Chọn —</option>
            {accounts.filter((a) => String(a.id) !== form.fromAccountId).map((a) => <option key={a.id} value={String(a.id)}>{accountLabel(a)}</option>)}
          </Select>
        </Field>
        <Field label="Số tiền" required htmlFor="tf-amount">
          <MoneyField id="tf-amount" value={form.amount} onChange={(v) => set('amount', v)} placeholder="0" />
        </Field>
        <Field label="Phí chuyển" htmlFor="tf-fee" hint={fee > 0 && amount > 0 ? `TK nguồn bị trừ ${formatCurrency(amount + fee)}` : 'Trừ ở TK nguồn'}>
          <MoneyField id="tf-fee" value={form.fee} onChange={(v) => set('fee', v)} placeholder="0" />
        </Field>
        <Field label="Ngày">
          <DateField value={form.transferDate} onChange={(v) => set('transferDate', v)} />
        </Field>
        <Field label="Ghi chú" htmlFor="tf-notes" className="sm:col-span-2">
          <Textarea id="tf-notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}
