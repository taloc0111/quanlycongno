import { useEffect, useState } from 'react';
import { CheckCircle2, ReceiptText } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useFeedback } from '../../ui/FeedbackContext';
import { Button, DateField, Field, MoneyField, Modal, Segmented, Select, Textarea } from '../../ui';
import { ENTRY_CATEGORIES, accountLabel, accountsApi, entriesApi } from '../../services/money';
import { formatCurrency, normalizeYmd, num, today } from '../../utils/format';
import { isOwnedBy } from './moneyUtils';

const DIRECTIONS = [
  { value: 'out', label: 'Chi' },
  { value: 'in', label: 'Thu' },
];

const firstCategory = (direction) => ENTRY_CATEGORIES[direction]?.[0]?.value || 'Khác';

const toForm = (initial) => {
  const direction = initial?.direction === 'in' ? 'in' : 'out';
  const cats = ENTRY_CATEGORIES[direction];
  const category = initial?.category && cats.some((c) => c.value === initial.category) ? initial.category : firstCategory(direction);
  const accountId = initial?.account_id ?? initial?.accountId ?? '';
  return {
    id: initial?.id,
    accountId: accountId === '' || accountId === null ? '' : String(accountId),
    direction,
    amount: initial?.amount != null && initial.amount !== '' ? String(Math.round(Math.abs(num(initial.amount)))) : '',
    category,
    entryDate: normalizeYmd(initial?.entry_date || initial?.entryDate) || today(),
    notes: initial?.notes || '',
  };
};

/**
 * Modal thêm/sửa 1 khoản thu/chi khác (phí ngân hàng, lương, góp vốn...).
 * `initial`: dòng entry (có id → sửa) hoặc dữ liệu điền sẵn { accountId, direction, amount, entryDate, notes }.
 * Render khi cần mở (mount lại mỗi lần để form sạch). onSaved(row) sau khi lưu.
 */
export default function EntryModal({ initial, onClose, onSaved }) {
  const { user } = useAuth();
  const { toast } = useFeedback();
  const [form, setForm] = useState(() => toForm(initial));
  const [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isEdit = !!form.id;

  useEffect(() => {
    let alive = true;
    accountsApi.list()
      .then((rows) => { if (alive) setAccounts((rows || []).filter((a) => !a.archived && isOwnedBy(a, user))); })
      .catch(() => {});
    return () => { alive = false; };
  }, [user]);

  const setDirection = (direction) => setForm((f) => ({
    ...f,
    direction,
    category: ENTRY_CATEGORIES[direction].some((c) => c.value === f.category) ? f.category : firstCategory(direction),
  }));

  const categories = ENTRY_CATEGORIES[form.direction];
  const ownerCat = categories.find((c) => c.value === form.category)?.owner;

  const save = async () => {
    if (!form.accountId) { toast.error('Chọn tài khoản'); return; }
    const amount = num(form.amount);
    if (amount <= 0) { toast.error('Nhập số tiền lớn hơn 0'); return; }
    setSaving(true);
    try {
      const body = {
        accountId: Number(form.accountId),
        direction: form.direction,
        amount,
        entryDate: form.entryDate || today(),
        category: form.category,
        notes: form.notes,
      };
      const row = isEdit ? await entriesApi.update(form.id, body) : await entriesApi.create(body);
      toast.success(`${isEdit ? 'Đã cập nhật' : 'Đã ghi'} ${form.direction === 'in' ? 'khoản thu' : 'khoản chi'} ${formatCurrency(amount)}`);
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
      icon={ReceiptText}
      title={isEdit ? 'Sửa khoản thu/chi khác' : 'Thu/chi khác'}
      subtitle="Phí ngân hàng, văn phòng, lương, góp vốn, rút tiền riêng…"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button icon={CheckCircle2} loading={saving} onClick={save}>{isEdit ? 'Lưu thay đổi' : 'Ghi lại'}</Button>
        </>
      )}
    >
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <Field label="Chiều" className="sm:col-span-2">
          <Segmented value={form.direction} onChange={setDirection} options={DIRECTIONS} size="md" />
        </Field>
        <Field label="Tài khoản" required htmlFor="en-account" className="sm:col-span-2" hint={accounts.length ? undefined : 'Chưa có tài khoản — thêm ở mục Dòng tiền → Tài khoản.'}>
          <Select id="en-account" value={form.accountId} onChange={(e) => set('accountId', e.target.value)}>
            <option value="">— Chọn tài khoản —</option>
            {accounts.map((a) => <option key={a.id} value={String(a.id)}>{accountLabel(a)}</option>)}
          </Select>
        </Field>
        <Field label="Số tiền" required htmlFor="en-amount">
          <MoneyField id="en-amount" value={form.amount} onChange={(v) => set('amount', v)} placeholder="0" />
        </Field>
        <Field label="Ngày">
          <DateField value={form.entryDate} onChange={(v) => set('entryDate', v)} />
        </Field>
        <Field label="Danh mục" htmlFor="en-category" className="sm:col-span-2" hint={ownerCat ? 'Dòng tiền của chủ — không tính vào lãi/lỗ.' : undefined}>
          <Select id="en-category" value={form.category} onChange={(e) => set('category', e.target.value)}>
            {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Ghi chú" htmlFor="en-notes" className="sm:col-span-2">
          <Textarea id="en-notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}
