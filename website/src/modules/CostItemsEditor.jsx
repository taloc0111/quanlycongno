import { useState } from 'react';
import { Plus, Trash2, CalendarClock } from 'lucide-react';
import { formatCurrency, num, today } from '../utils/format';
import { SUPPLIER_KINDS, accountLabel } from '../services/money';
import { Button, IconButton, Select, MoneyField, DateField, Input, Badge } from '../ui';
import {
  COST_LABELS, costTotal, newCostItem, costItemStatus, activeAccounts, defaultAccountId,
} from './payState';
import SupplierQuickCreate from './SupplierQuickCreate';

const NEW_SUPPLIER = '__new';
const PAID_BADGE = {
  paid: { tone: 'success', label: 'Đã trả' },
  partial: { tone: 'warning', label: 'Trả 1 phần' },
  unpaid: { tone: 'gray', label: 'Chưa trả' },
};

/**
 * Trình nhập nhiều dòng giá vốn cho 1 dịch vụ (vé máy bay / tàu / hộ chiếu / tour).
 *
 * Props:
 *  - value: [{ id?, _key?, supplierId, label, amount, dueDate, paidAmount, payNow: false | { accountId, payDate } }]
 *  - onChange(items)
 *  - suppliers: danh sách NCC (GET /suppliers)
 *  - accounts: danh sách tài khoản (GET /accounts)
 *  - readOnlyPaid: dòng đã trả NCC một phần/đủ thì khoá ô NCC (tiền đã trả gắn với NCC đó)
 *  - onSupplierCreated(supplier): báo cha tải lại danh sách NCC
 */
export default function CostItemsEditor({ value = [], onChange, suppliers = [], accounts = [], readOnlyPaid = true, onSupplierCreated }) {
  const [created, setCreated] = useState([]);         // NCC vừa tạo, hiện ngay kể cả khi cha chưa tải lại
  const [creatingFor, setCreatingFor] = useState(null); // key dòng đang mở khung "Thêm NCC"
  const [dueOpen, setDueOpen] = useState({});           // key → hiện ô hạn trả

  const allSuppliers = [...suppliers, ...created.filter((c) => !suppliers.some((s) => String(s.id) === String(c.id)))];
  const accs = activeAccounts(accounts);
  const keyOf = (it, i) => String(it.id ?? it._key ?? i);
  const total = costTotal(value);

  const update = (idx, patch) => onChange(value.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeAt = (idx) => onChange(value.filter((_, i) => i !== idx));
  const addRow = () => onChange([...value, newCostItem()]);

  const onSupplierSelect = (idx, it, v) => {
    if (v === NEW_SUPPLIER) { setCreatingFor(keyOf(it, idx)); return; }
    update(idx, { supplierId: v, ...(v ? {} : { payNow: false }) });
  };

  const onCreated = (idx, s) => {
    setCreated((c) => [...c, s]);
    setCreatingFor(null);
    update(idx, { supplierId: String(s.id) });
    onSupplierCreated?.(s);
  };

  const togglePayNow = (idx, checked) => {
    update(idx, { payNow: checked ? { accountId: defaultAccountId(accounts), payDate: today() } : false });
  };

  const grouped = SUPPLIER_KINDS.map((k) => ({ ...k, list: allSuppliers.filter((s) => (s.kind || 'other') === k.value) })).filter((g) => g.list.length);

  return (
    <div className="space-y-2">
      <datalist id="cost-label-options">{COST_LABELS.map((l) => <option key={l} value={l} />)}</datalist>
      {value.length === 0 && <p className="text-sm text-ink-muted">Chưa có dòng giá vốn nào.</p>}
      <ul className="space-y-2">
        {value.map((it, idx) => {
          const key = keyOf(it, idx);
          const n = idx + 1;
          const status = costItemStatus(it);
          const paid = num(it.paidAmount);
          const lockSupplier = readOnlyPaid && paid > 0;
          const canPayNow = !!it.supplierId && status !== 'paid';
          const showDue = dueOpen[key] || !!it.dueDate;
          return (
            <li key={key} className="rounded-lg border border-surface-border bg-white p-2.5" data-testid="cost-item">
              <div className="grid grid-cols-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto] gap-2 items-center">
                <Input
                  size="sm"
                  aria-label={`Tên khoản ${n}`}
                  list="cost-label-options"
                  autoComplete="off"
                  placeholder="VD: Giá vé F1"
                  value={it.label}
                  onChange={(e) => update(idx, { label: e.target.value })}
                  className="col-span-2 sm:col-span-1"
                />
                <Select
                  size="sm"
                  aria-label={`Nhà cung cấp ${n}`}
                  value={it.supplierId || ''}
                  disabled={lockSupplier}
                  title={lockSupplier ? 'Đã trả tiền cho NCC này, không đổi được' : undefined}
                  onChange={(e) => onSupplierSelect(idx, it, e.target.value)}
                >
                  <option value="">— Không gắn NCC —</option>
                  {grouped.map((g) => (
                    <optgroup key={g.value} label={g.label}>
                      {g.list.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                    </optgroup>
                  ))}
                  <option value={NEW_SUPPLIER}>+ Thêm nhà cung cấp…</option>
                </Select>
                <MoneyField
                  aria-label={`Số tiền ${n}`}
                  value={it.amount}
                  onChange={(v) => update(idx, { amount: v })}
                  placeholder="0"
                  className="input-sm"
                />
                <div className="col-span-2 sm:col-span-1 flex items-center justify-end gap-0.5">
                  <IconButton
                    icon={CalendarClock}
                    title={showDue ? 'Ẩn hạn trả NCC' : 'Đặt hạn trả NCC'}
                    variant={showDue ? 'primary' : 'ghost'}
                    size={15}
                    onClick={() => setDueOpen((d) => ({ ...d, [key]: !showDue }))}
                    disabled={!!it.dueDate && showDue}
                  />
                  <IconButton icon={Trash2} title={`Xoá dòng ${n}`} variant="danger" size={15} onClick={() => removeAt(idx)} />
                </div>
              </div>

              {(showDue || it.id || canPayNow) && (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                  {showDue && (
                    <label className="flex items-center gap-1.5 text-ink-muted">
                      <span className="text-xs">Hạn trả NCC</span>
                      <span className="w-36"><DateField value={it.dueDate || ''} onChange={(v) => update(idx, { dueDate: v })} className="input-sm" /></span>
                    </label>
                  )}
                  {it.id && (
                    <span className="inline-flex items-center gap-1.5">
                      <Badge tone={PAID_BADGE[status].tone} dot>{PAID_BADGE[status].label}</Badge>
                      {status === 'partial' && <span className="text-xs text-ink-muted tabular">đã trả {formatCurrency(paid)}</span>}
                    </span>
                  )}
                  {canPayNow && (
                    <label className="inline-flex items-center gap-1.5 cursor-pointer text-ink-soft">
                      <input
                        type="checkbox"
                        aria-label={`Trả ngay ${n}`}
                        checked={!!it.payNow}
                        onChange={(e) => togglePayNow(idx, e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-brand-600"
                      />
                      <span className="text-[13px]">Trả ngay</span>
                    </label>
                  )}
                  {canPayNow && it.payNow && (
                    <span className="w-full sm:w-56">
                      <Select
                        size="sm"
                        aria-label={`Trả từ tài khoản ${n}`}
                        value={it.payNow.accountId || ''}
                        onChange={(e) => update(idx, { payNow: { ...it.payNow, accountId: e.target.value } })}
                      >
                        <option value="">— Chưa chọn tài khoản —</option>
                        {accs.map((a) => <option key={a.id} value={String(a.id)}>{accountLabel(a)}</option>)}
                      </Select>
                    </span>
                  )}
                </div>
              )}

              {creatingFor === key && (
                <div className="mt-2">
                  <SupplierQuickCreate
                    defaultKind={/f1/i.test(it.label) ? 'f1' : /down/i.test(it.label) ? 'down' : 'other'}
                    onCreated={(s) => onCreated(idx, s)}
                    onCancel={() => setCreatingFor(null)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="soft" icon={Plus} onClick={addRow}>Thêm dòng</Button>
        <span className="text-sm text-ink-muted">Tổng giá vốn: <b className="text-ink tabular" data-testid="cost-total">{formatCurrency(total)}</b></span>
      </div>
    </div>
  );
}
