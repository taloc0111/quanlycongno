import { useEffect, useMemo, useState } from 'react';
import { Ban, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { accountsApi, suppliersApi, serviceActionsApi, accountLabel, SUPPLIER_KINDS } from '../services/money';
import { activeAccounts, defaultAccountId, rememberAccount, costBySupplier } from './payState';
import { formatCurrency, today, num } from '../utils/format';
import { useFeedback } from '../ui/FeedbackContext';
import { Button, IconButton, Field, Select, MoneyField, DateField, Textarea, Modal, Segmented } from '../ui';

let rowSeq = 0;
const newSupplierRow = (partial = {}) => {
  rowSeq += 1;
  return { _key: `sr-${rowSeq}`, supplierId: '', amount: '', receivedNow: false, accountId: '', ...partial };
};

/**
 * Huỷ / hoàn 1 dịch vụ (vé máy bay / tàu / hộ chiếu / tour) — POST {cfg.endpoint}/:id/cancel.
 * Props: { open, onClose, onDone, row, cfg }
 *  - Khách chịu (phí huỷ) = finalAmount; trả lại khách mặc định = max(0, đã trả − phí), sửa được.
 *  - NCC hoàn lại: mỗi NCC trong giá vốn 1 dòng (mặc định = tổng giá vốn của NCC đó).
 */
export default function CancelModal({ open, onClose, onDone, row, cfg }) {
  const { toast } = useFeedback();
  const [accounts, setAccounts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [cancelDate, setCancelDate] = useState(today());
  const [finalAmount, setFinalAmount] = useState('');
  const [refund, setRefund] = useState(null); // null = tự tính theo phí khách chịu
  const [refundTo, setRefundTo] = useState('wallet');
  const [refundAccountId, setRefundAccountId] = useState('');
  const [supplierRows, setSupplierRows] = useState([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const hasCustomer = !!row?.customer_id;
  const paid = num(row?.[cfg.paidKey]);
  const total = num(row?.[cfg.amountKey]);
  const cost = num(row?.[cfg.costKey || 'cost_amount']);

  // Khởi tạo lại mỗi lần mở cho 1 dòng.
  useEffect(() => {
    if (!open || !row) return;
    setCancelDate(today());
    setFinalAmount('');
    setRefund(null);
    setRefundTo(row.customer_id ? 'wallet' : 'account');
    setNote('');
    setSupplierRows(costBySupplier(row).map((s) => newSupplierRow({ supplierId: s.supplierId, amount: '', costHint: Math.round(s.amount) })));
  }, [open, row]);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    accountsApi.list().then((list) => {
      if (!alive) return;
      const arr = Array.isArray(list) ? list : [];
      setAccounts(arr);
      setRefundAccountId((cur) => cur || defaultAccountId(arr));
    }).catch(() => {});
    suppliersApi.list().then((list) => { if (alive) setSuppliers(Array.isArray(list) ? list : []); }).catch(() => {});
    return () => { alive = false; };
  }, [open]);

  const fee = num(finalAmount);
  const autoRefund = Math.max(0, paid - fee);
  const refundStr = refund === null ? String(autoRefund) : refund;
  const refundAmt = num(refundStr);
  const supplierRefundTotal = supplierRows.reduce((s, r) => s + Math.max(0, num(r.amount)), 0);
  const costLeft = cost - supplierRefundTotal;
  const profit = fee - costLeft;
  const customerBalance = fee - paid + refundAmt; // > 0: khách còn nợ; < 0: mình còn giữ của khách
  const accs = activeAccounts(accounts);

  const supplierName = (id) => suppliers.find((s) => String(s.id) === String(id))?.name
    || costBySupplier(row).find((s) => s.supplierId === String(id))?.supplierName || '';
  const grouped = useMemo(() => SUPPLIER_KINDS
    .map((k) => ({ ...k, list: suppliers.filter((s) => (s.kind || 'other') === k.value) }))
    .filter((g) => g.list.length), [suppliers]);

  const updateRow = (key, patch) => setSupplierRows((rs) => rs.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  const removeRow = (key) => setSupplierRows((rs) => rs.filter((r) => r._key !== key));
  const addRow = () => setSupplierRows((rs) => [...rs, newSupplierRow()]);

  const validate = () => {
    if (fee < 0 || refundAmt < 0) return 'Số tiền không được âm';
    if (refundAmt > paid) return `Không hoàn quá số khách đã trả (${formatCurrency(paid)})`;
    if (refundAmt > 0 && refundTo === 'wallet' && !hasCustomer) return 'Dịch vụ chưa gắn khách hàng, không trả vào ví được';
    if (refundAmt > 0 && refundTo === 'account' && !refundAccountId) return 'Chọn tài khoản chi tiền hoàn cho khách';
    for (const r of supplierRows) {
      if (num(r.amount) < 0) return 'Số tiền NCC hoàn không được âm';
      if (num(r.amount) > 0 && !r.supplierId) return 'Chọn nhà cung cấp cho dòng NCC hoàn';
      if (num(r.amount) > 0 && r.receivedNow && !r.accountId) return 'Chọn tài khoản nhận tiền NCC hoàn';
    }
    return null;
  };

  const submit = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    const body = {
      cancelDate: cancelDate || today(),
      note: note.trim(),
      finalAmount: fee,
      customerRefund: {
        amount: refundAmt,
        to: refundTo,
        accountId: refundAmt > 0 && refundTo === 'account' ? Number(refundAccountId) : null,
      },
      supplierRefunds: supplierRows
        .filter((r) => num(r.amount) > 0)
        .map((r) => ({
          supplierId: Number(r.supplierId),
          amount: num(r.amount),
          receivedNow: !!r.receivedNow,
          accountId: r.receivedNow && r.accountId ? Number(r.accountId) : null,
        })),
    };
    setSaving(true);
    try {
      await serviceActionsApi.cancel(cfg.endpoint, row.id, body);
      if (body.customerRefund.accountId) rememberAccount(body.customerRefund.accountId);
      toast.success(`Đã huỷ ${cfg.itemLabel}${refundAmt > 0 ? `, hoàn khách ${formatCurrency(refundAmt)}` : ''}`);
      onDone?.();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!open || !row) return null;

  return (
    <Modal
      open
      onClose={onClose}
      icon={Ban}
      title={`Huỷ / hoàn ${cfg.itemLabel}`}
      subtitle={cfg.paymentLabel ? cfg.paymentLabel(row) : row.customer_name}
      size="lg"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Đóng</Button>
          <Button variant="danger" icon={CheckCircle2} loading={saving} onClick={submit}>Xác nhận huỷ</Button>
        </>
      )}
    >
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-xl bg-surface-subtle px-3 py-2"><p className="text-[11px] uppercase text-ink-muted">Giá bán</p><b className="tabular">{formatCurrency(total)}</b></div>
          <div className="rounded-xl bg-success-50 px-3 py-2 text-success-700"><p className="text-[11px] uppercase opacity-70">Khách đã trả</p><b className="tabular">{formatCurrency(paid)}</b></div>
          <div className="rounded-xl bg-surface-subtle px-3 py-2"><p className="text-[11px] uppercase text-ink-muted">Giá vốn</p><b className="tabular">{formatCurrency(cost)}</b></div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Ngày huỷ" htmlFor="cx-date">
            <DateField id="cx-date" value={cancelDate} onChange={setCancelDate} />
          </Field>
          <Field label="Khách chịu (phí huỷ/hoàn)" htmlFor="cx-fee" hint="Doanh thu còn lại của dịch vụ sau khi huỷ">
            <MoneyField id="cx-fee" value={finalAmount} onChange={setFinalAmount} placeholder="0" />
          </Field>
          <Field
            label="Trả lại khách"
            htmlFor="cx-refund"
            hint={refund === null ? 'Tự tính = đã trả − phí khách chịu' : undefined}
            error={refundAmt > paid ? `Không hoàn quá số khách đã trả (${formatCurrency(paid)})` : undefined}
          >
            <MoneyField id="cx-refund" value={refundStr} onChange={setRefund} placeholder="0" />
          </Field>
          <Field label="Trả vào">
            {hasCustomer ? (
              <Segmented value={refundTo} onChange={setRefundTo} options={[{ value: 'wallet', label: 'Ví khách' }, { value: 'account', label: 'Tài khoản' }]} />
            ) : (
              <p className="text-xs text-ink-muted py-2">Chưa gắn khách hàng → chi trả từ tài khoản</p>
            )}
          </Field>
          {refundTo === 'account' && (
            <Field label="Chi từ tài khoản" htmlFor="cx-account" className="sm:col-span-2" hint={accs.length ? undefined : 'Chưa có tài khoản nào (thêm ở Dòng tiền › Tài khoản)'}>
              <Select id="cx-account" value={refundAccountId} onChange={(e) => setRefundAccountId(e.target.value)}>
                <option value="">— Chưa chọn tài khoản —</option>
                {accs.map((a) => <option key={a.id} value={String(a.id)}>{accountLabel(a)}</option>)}
              </Select>
            </Field>
          )}
        </div>

        {/* NCC hoàn lại */}
        <div className="rounded-xl border border-surface-border bg-surface-muted p-3 space-y-2">
          <p className="text-[13px] font-semibold text-ink">NCC hoàn lại</p>
          {supplierRows.length === 0 && <p className="text-sm text-ink-muted">Không có NCC nào hoàn tiền.</p>}
          <ul className="space-y-2">
            {supplierRows.map((r, idx) => {
              const n = idx + 1;
              const known = suppliers.some((s) => String(s.id) === String(r.supplierId));
              return (
                <li key={r._key} className="rounded-lg border border-surface-border bg-white p-2.5" data-testid="supplier-refund">
                  <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] gap-2 items-center">
                    <Select size="sm" aria-label={`NCC hoàn ${n}`} value={r.supplierId} onChange={(e) => updateRow(r._key, { supplierId: e.target.value })}>
                      <option value="">— Chọn NCC —</option>
                      {r.supplierId && !known && <option value={r.supplierId}>{supplierName(r.supplierId) || `NCC #${r.supplierId}`}</option>}
                      {grouped.map((g) => (
                        <optgroup key={g.value} label={g.label}>
                          {g.list.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                        </optgroup>
                      ))}
                    </Select>
                    <MoneyField aria-label={`Số tiền NCC hoàn ${n}`} value={r.amount} onChange={(v) => updateRow(r._key, { amount: v })} placeholder={r.costHint ? `Giá vốn ${formatCurrency(r.costHint)} — nhập số NCC thật sự hoàn` : '0'} className="input-sm" />
                    <IconButton icon={Trash2} title={`Xoá dòng NCC ${n}`} variant="danger" size={15} onClick={() => removeRow(r._key)} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer text-[13px] text-ink-soft">
                      <input
                        type="checkbox"
                        aria-label={`Đã nhận tiền ${n}`}
                        checked={r.receivedNow}
                        onChange={(e) => updateRow(r._key, { receivedNow: e.target.checked, accountId: e.target.checked ? (r.accountId || defaultAccountId(accounts)) : '' })}
                        className="h-4 w-4 rounded border-slate-300 text-brand-600"
                      />
                      Đã nhận tiền?
                    </label>
                    {r.receivedNow && (
                      <span className="w-full sm:w-60">
                        <Select size="sm" aria-label={`Nhận vào tài khoản ${n}`} value={r.accountId} onChange={(e) => updateRow(r._key, { accountId: e.target.value })}>
                          <option value="">— Chưa chọn tài khoản —</option>
                          {accs.map((a) => <option key={a.id} value={String(a.id)}>{accountLabel(a)}</option>)}
                        </Select>
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <Button size="sm" variant="soft" icon={Plus} onClick={addRow}>Thêm dòng</Button>
        </div>

        <Field label="Ghi chú" htmlFor="cx-note">
          <Textarea id="cx-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lý do huỷ, điều kiện hoàn…" />
        </Field>

        {/* Xem trước */}
        <div className="rounded-xl bg-surface-subtle px-4 py-3 text-sm grid grid-cols-2 gap-x-4 gap-y-1.5" data-testid="cancel-preview">
          <span className="text-ink-muted">Doanh thu sau huỷ</span>
          <b className="text-right tabular">{formatCurrency(fee)}</b>
          <span className="text-ink-muted">Giá vốn còn lại</span>
          <b className="text-right tabular">{formatCurrency(costLeft)}</b>
          <span className="text-ink-muted">Lãi/lỗ</span>
          <b className={`text-right tabular ${profit >= 0 ? 'text-success-600' : 'text-danger-600'}`} data-testid="cancel-profit">{formatCurrency(profit)}</b>
          {refundAmt > 0 && (
            <>
              <span className="text-ink-muted">Khách sẽ nhận lại</span>
              <b className="text-right tabular text-brand-700">{formatCurrency(refundAmt)} {refundTo === 'wallet' ? '(vào ví)' : '(chuyển khoản)'}</b>
            </>
          )}
          {customerBalance > 0 && (
            <>
              <span className="text-ink-muted">Khách còn nợ</span>
              <b className="text-right tabular text-danger-600">{formatCurrency(customerBalance)}</b>
            </>
          )}
          {customerBalance < 0 && (
            <>
              <span className="text-ink-muted">Mình còn giữ của khách</span>
              <b className="text-right tabular text-warning-700">{formatCurrency(-customerBalance)}</b>
            </>
          )}
        </div>
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}
