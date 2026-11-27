import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, HandCoins, Truck } from 'lucide-react';
import { useFeedback } from '../../ui/FeedbackContext';
import { Button, Field, Input, MoneyField, DateField, Modal, Select, Textarea } from '../../ui';
import { SUPPLIER_KINDS, accountsApi, accountLabel, suppliersApi } from '../../services/money';
import { formatCurrency, num, today } from '../../utils/format';
import { itemRemaining } from './moneyUtils';

/** Modal thêm/sửa nhà cung cấp. `initial` = dòng NCC (sửa) hoặc null (thêm). */
export function SupplierFormModal({ initial, onClose, onSaved }) {
  const { toast } = useFeedback();
  const [form, setForm] = useState(() => ({
    id: initial?.id,
    name: initial?.name || '',
    kind: initial?.kind || 'other',
    phone: initial?.phone || '',
    notes: initial?.notes || '',
  }));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) { toast.error('Nhập tên nhà cung cấp'); return; }
    setSaving(true);
    try {
      const body = { name: form.name.trim(), kind: form.kind, phone: form.phone.trim(), notes: form.notes };
      const row = form.id ? await suppliersApi.update(form.id, body) : await suppliersApi.create(body);
      toast.success(form.id ? 'Đã cập nhật nhà cung cấp' : 'Đã thêm nhà cung cấp');
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
      icon={Truck}
      title={form.id ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button icon={CheckCircle2} loading={saving} onClick={save}>{form.id ? 'Lưu thay đổi' : 'Thêm mới'}</Button>
        </>
      )}
    >
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <Field label="Tên nhà cung cấp" required htmlFor="sp-name" className="sm:col-span-2">
          <Input id="sp-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="F1 Thùy Dương" />
        </Field>
        <Field label="Loại" htmlFor="sp-kind">
          <Select id="sp-kind" value={form.kind} onChange={(e) => set('kind', e.target.value)}>
            {SUPPLIER_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </Select>
        </Field>
        <Field label="Số điện thoại" htmlFor="sp-phone">
          <Input id="sp-phone" value={form.phone} inputMode="tel" onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Ghi chú" htmlFor="sp-notes" className="sm:col-span-2">
          <Textarea id="sp-notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="STK, cách liên hệ…" />
        </Field>
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}

const itemOptionLabel = (it) => {
  const target = [it.target?.label, it.target?.customer_name].filter(Boolean).join(' · ');
  return `${it.label}${target ? ` (${target})` : ''} — còn ${formatCurrency(itemRemaining(it))}`;
};

/**
 * Modal trả tiền cho nhà cung cấp.
 * Props: supplier ({ id, name, balance }), items (dòng giá vốn — không truyền thì tự tải sổ NCC),
 * initialItemId (chọn sẵn 1 dòng), onClose, onPaid(row).
 */
export function SupplierPayModal({ supplier, items: itemsProp, initialItemId, onClose, onPaid }) {
  const { toast } = useFeedback();
  const [accounts, setAccounts] = useState([]);
  const [loadedItems, setLoadedItems] = useState(null);
  const items = itemsProp || loadedItems;
  const unpaid = useMemo(() => (items || []).filter((it) => itemRemaining(it) > 0), [items]);
  const initialItem = initialItemId ? (itemsProp || []).find((it) => String(it.id) === String(initialItemId)) : null;
  const [form, setForm] = useState(() => ({
    amount: initialItem ? String(itemRemaining(initialItem)) : '',
    payDate: today(),
    accountId: '',
    costItemId: initialItem ? String(initialItem.id) : '',
    notes: '',
  }));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    let alive = true;
    accountsApi.list()
      .then((rows) => { if (alive) setAccounts((rows || []).filter((a) => !a.archived)); })
      .catch(() => {});
    if (!itemsProp) {
      suppliersApi.ledger(supplier.id)
        .then((d) => { if (alive) setLoadedItems(d?.items || []); })
        .catch(() => { if (alive) setLoadedItems([]); });
    }
    return () => { alive = false; };
  }, [supplier.id, itemsProp]);

  const selectedItem = unpaid.find((it) => String(it.id) === String(form.costItemId));
  const balance = num(supplier.balance);
  const payAllAmount = selectedItem ? itemRemaining(selectedItem) : balance;

  const pickItem = (idValue) => {
    const it = unpaid.find((x) => String(x.id) === String(idValue));
    setForm((f) => ({ ...f, costItemId: idValue, amount: it && !num(f.amount) ? String(itemRemaining(it)) : f.amount }));
  };

  const save = async () => {
    const amount = num(form.amount);
    if (amount <= 0) { toast.error('Nhập số tiền trả lớn hơn 0'); return; }
    setSaving(true);
    try {
      const body = {
        amount,
        payDate: form.payDate || today(),
        accountId: form.accountId ? Number(form.accountId) : null,
        costItemId: form.costItemId ? Number(form.costItemId) : null,
        notes: form.notes,
      };
      const row = await suppliersApi.pay(supplier.id, body);
      toast.success(`Đã ghi trả ${formatCurrency(amount)} cho ${supplier.name}`);
      onPaid?.(row);
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
      title={`Trả tiền · ${supplier.name}`}
      subtitle={`Đang nợ ${formatCurrency(balance)}`}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button icon={CheckCircle2} loading={saving} onClick={save}>Ghi trả tiền</Button>
        </>
      )}
    >
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <Field label="Cho dòng giá vốn" htmlFor="pay-item" className="sm:col-span-2" hint={items === null ? 'Đang tải dòng giá vốn…' : unpaid.length ? 'Bỏ trống = trả gộp, không gắn dòng nào.' : 'Không còn dòng giá vốn nào chưa trả.'}>
          <Select id="pay-item" value={form.costItemId} onChange={(e) => pickItem(e.target.value)}>
            <option value="">— Trả gộp —</option>
            {unpaid.map((it) => <option key={it.id} value={it.id}>{itemOptionLabel(it)}</option>)}
          </Select>
        </Field>
        <Field label="Số tiền" required htmlFor="pay-amount">
          <div className="flex gap-2">
            <MoneyField id="pay-amount" value={form.amount} onChange={(v) => set('amount', v)} placeholder="0" />
            <Button variant="soft" size="sm" className="shrink-0 self-center" disabled={payAllAmount <= 0} onClick={() => set('amount', String(payAllAmount))}>Trả hết</Button>
          </div>
        </Field>
        <Field label="Ngày trả">
          <DateField value={form.payDate} onChange={(v) => set('payDate', v)} />
        </Field>
        <Field label="Từ tài khoản" htmlFor="pay-account" className="sm:col-span-2" hint={accounts.length ? undefined : 'Chưa có tài khoản — thêm ở mục Dòng tiền → Tài khoản.'}>
          <Select id="pay-account" value={form.accountId} onChange={(e) => set('accountId', e.target.value)}>
            <option value="">— Không chọn —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
          </Select>
        </Field>
        <Field label="Ghi chú" htmlFor="pay-notes" className="sm:col-span-2">
          <Textarea id="pay-notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}
