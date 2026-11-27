import { useEffect, useMemo, useState } from 'react';
import { Repeat, CheckCircle2 } from 'lucide-react';
import { suppliersApi, serviceActionsApi, SUPPLIER_KINDS } from '../services/money';
import { costBySupplier, isCostPending } from './payState';
import { formatCurrency, today, num } from '../utils/format';
import { useFeedback } from '../ui/FeedbackContext';
import { Button, Field, Input, Select, MoneyField, DateField, Textarea, Modal } from '../ui';

/** NCC gợi ý cho phí đổi: NCC loại F1 trong giá vốn của vé, không có thì NCC đầu tiên. */
function suggestSupplier(row, suppliers) {
  const ids = costBySupplier(row).map((s) => s.supplierId);
  const f1 = ids.find((id) => suppliers.find((s) => String(s.id) === id)?.kind === 'f1');
  return f1 || ids[0] || '';
}

/**
 * Đổi vé máy bay — POST /debts/:id/change.
 * Props: { open, onClose, onDone, row, cfg }
 */
export default function ChangeTicketModal({ open, onClose, onDone, row, cfg }) {
  const { toast } = useFeedback();
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !row) return;
    setForm({
      changeDate: today(),
      newFlightDate: row.flight_date ? String(row.flight_date).slice(0, 10) : '',
      newRoute: row.route || '',
      newTicketCode: row.ticket_code || '',
      customerFee: '',
      supplierFee: '',
      supplierId: suggestSupplier(row, []),
      note: '',
    });
  }, [open, row]);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    suppliersApi.list().then((list) => {
      if (!alive) return;
      const arr = Array.isArray(list) ? list : [];
      setSuppliers(arr);
      // Có danh sách NCC rồi mới biết NCC nào là F1.
      setForm((f) => (f ? { ...f, supplierId: suggestSupplier(row, arr) || f.supplierId } : f));
    }).catch(() => {});
    return () => { alive = false; };
  }, [open, row]);

  const grouped = useMemo(() => SUPPLIER_KINDS
    .map((k) => ({ ...k, list: suppliers.filter((s) => (s.kind || 'other') === k.value) }))
    .filter((g) => g.list.length), [suppliers]);

  if (!open || !row || !form) return null;

  const amountKey = cfg?.amountKey || 'ticket_amount';
  const costKey = cfg?.costKey || 'cost_amount';
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const customerFee = num(form.customerFee);
  const supplierFee = num(form.supplierFee);
  const newSell = num(row[amountKey]) + customerFee;
  const newCost = num(row[costKey]) + supplierFee;
  const newProfit = newSell - newCost;
  const known = suppliers.some((s) => String(s.id) === String(form.supplierId));
  const fallbackName = costBySupplier(row).find((s) => s.supplierId === String(form.supplierId))?.supplierName;

  const submit = async () => {
    if (customerFee < 0 || supplierFee < 0) { toast.error('Số tiền không được âm'); return; }
    const body = {
      changeDate: form.changeDate || today(),
      customerFee,
      supplierFee,
      supplierId: supplierFee > 0 && form.supplierId ? Number(form.supplierId) : null,
      newFlightDate: form.newFlightDate || null,
      newRoute: form.newRoute.trim().toUpperCase() || null,
      newTicketCode: form.newTicketCode.trim() || null,
      note: form.note.trim(),
    };
    setSaving(true);
    try {
      await serviceActionsApi.change(row.id, body);
      toast.success('Đã ghi nhận đổi vé');
      onDone?.();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={Repeat}
      title="Đổi vé"
      subtitle={cfg?.paymentLabel ? cfg.paymentLabel(row) : row.customer_name}
      size="lg"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Đóng</Button>
          <Button icon={CheckCircle2} loading={saving} onClick={submit}>Lưu đổi vé</Button>
        </>
      )}
    >
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Ngày đổi" htmlFor="ch-date">
          <DateField id="ch-date" value={form.changeDate} onChange={(v) => set('changeDate', v)} />
        </Field>
        <Field label="Ngày bay mới" htmlFor="ch-flight">
          <DateField id="ch-flight" value={form.newFlightDate} onChange={(v) => set('newFlightDate', v)} />
        </Field>
        <Field label="Hành trình mới" htmlFor="ch-route">
          <Input id="ch-route" value={form.newRoute} onChange={(e) => set('newRoute', e.target.value.toUpperCase())} placeholder="VD: HAN-SGN" />
        </Field>
        <Field label="Mã vé mới" htmlFor="ch-code">
          <Input id="ch-code" value={form.newTicketCode} onChange={(e) => set('newTicketCode', e.target.value)} />
        </Field>
        <Field label="Phí đổi thu khách" htmlFor="ch-cfee" hint="Cộng vào giá bán">
          <MoneyField id="ch-cfee" value={form.customerFee} onChange={(v) => set('customerFee', v)} placeholder="0" />
        </Field>
        <Field label="Phí đổi trả NCC" htmlFor="ch-sfee" hint="Thêm 1 dòng giá vốn &quot;Phí đổi vé&quot;">
          <MoneyField id="ch-sfee" value={form.supplierFee} onChange={(v) => set('supplierFee', v)} placeholder="0" />
        </Field>
        <Field label="NCC thu phí đổi" htmlFor="ch-supplier" className="sm:col-span-2">
          <Select id="ch-supplier" value={form.supplierId} onChange={(e) => set('supplierId', e.target.value)}>
            <option value="">— Không gắn NCC —</option>
            {form.supplierId && !known && <option value={form.supplierId}>{fallbackName || `NCC #${form.supplierId}`}</option>}
            {grouped.map((g) => (
              <optgroup key={g.value} label={g.label}>
                {g.list.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Ghi chú" htmlFor="ch-note" className="sm:col-span-2">
          <Textarea id="ch-note" rows={2} value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="Lý do đổi, giờ bay mới…" />
        </Field>
        <div className="sm:col-span-2 rounded-xl bg-surface-subtle px-4 py-3 text-sm grid grid-cols-3 gap-2" data-testid="change-preview">
          <div><p className="text-xs text-ink-muted">Giá bán mới</p><b className="tabular">{formatCurrency(newSell)}</b></div>
          <div><p className="text-xs text-ink-muted">Giá vốn mới</p><b className="tabular">{formatCurrency(newCost)}</b></div>
          <div>
            <p className="text-xs text-ink-muted">Lãi</p>
            {isCostPending(row)
              ? <b className="text-warning-700">Chưa tính</b>
              : <b className={`tabular ${newProfit >= 0 ? 'text-success-600' : 'text-danger-600'}`} data-testid="change-profit">{formatCurrency(newProfit)}</b>}
          </div>
        </div>
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}
