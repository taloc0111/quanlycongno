import { useState } from 'react';
import { CheckCircle2, Wallet } from 'lucide-react';
import { useFeedback } from '../../ui/FeedbackContext';
import { Button, Field, Input, MoneyField, Modal, Switch, Textarea } from '../../ui';
import { accountsApi } from '../../services/money';
import { num } from '../../utils/format';
import { BANKS } from './moneyUtils';
import { VN_BANKS, findBank } from '../../utils/vietqr';

const toForm = (a) => ({
  id: a?.id,
  name: a?.name || '',
  bank: a?.bank || '',
  accountNumber: a?.account_number || '',
  holderName: a?.holder_name || '',
  isOwn: a ? a.is_own !== false : true,
  openingBalance: a?.opening_balance != null ? String(a.opening_balance).split('.')[0] : '',
  notes: a?.notes || '',
});

/**
 * Modal thêm/sửa tài khoản tiền. `initial` = dòng tài khoản (sửa) hoặc null (thêm).
 * Mount lại (key) mỗi lần mở để form sạch.
 */
export default function AccountFormModal({ initial, onClose, onSaved }) {
  const { toast } = useFeedback();
  const [form, setForm] = useState(() => toForm(initial));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) { toast.error('Nhập tên tài khoản'); return; }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        bank: form.bank.trim(),
        accountNumber: form.accountNumber.trim(),
        holderName: form.holderName.trim(),
        isOwn: form.isOwn,
        openingBalance: num(form.openingBalance),
        notes: form.notes,
      };
      const row = form.id ? await accountsApi.update(form.id, body) : await accountsApi.create(body);
      toast.success(form.id ? 'Đã cập nhật tài khoản' : 'Đã thêm tài khoản');
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
      icon={Wallet}
      title={form.id ? 'Sửa tài khoản' : 'Thêm tài khoản'}
      subtitle="Ngân hàng, ví điện tử, tiền mặt hoặc TK người khác giữ hộ"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button icon={CheckCircle2} loading={saving} onClick={save}>{form.id ? 'Lưu thay đổi' : 'Thêm tài khoản'}</Button>
        </>
      )}
    >
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <Field label="Tên tài khoản" required htmlFor="ac-name" hint='Vd "TCB chính", "TK chị Lan"' className="sm:col-span-2">
          <Input id="ac-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="TCB chính" />
        </Field>
        <Field label="Ngân hàng / ví" htmlFor="ac-bank" hint={form.bank.trim() ? (findBank(form.bank) ? `Tạo được mã QR · ${findBank(form.bank).name}` : 'Không tạo mã QR được với tên này (vd TCB, VCB, MB, ACB)') : 'Chọn trong danh sách để dùng được mã QR'}>
          <Input id="ac-bank" list="ac-bank-options" value={form.bank} onChange={(e) => set('bank', e.target.value)} placeholder="TCB" />
          <datalist id="ac-bank-options">
            {VN_BANKS.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
            {BANKS.filter((b) => !findBank(b)).map((b) => <option key={b} value={b} />)}
          </datalist>
        </Field>
        <Field label="Số tài khoản" htmlFor="ac-number">
          <Input id="ac-number" value={form.accountNumber} inputMode="numeric" onChange={(e) => set('accountNumber', e.target.value)} />
        </Field>
        <Field label="Chủ tài khoản" htmlFor="ac-holder" className="sm:col-span-2">
          <Input id="ac-holder" value={form.holderName} onChange={(e) => set('holderName', e.target.value)} placeholder="NGUYEN VAN A" />
        </Field>
        <Field
          label="Loại"
          className="sm:col-span-2"
          hint={form.isOwn ? 'Tiền trong TK này là của mình.' : 'TK của người khác nhận tiền giúp — số dư là tiền cần thu về.'}
        >
          <Switch checked={form.isOwn} onChange={(v) => set('isOwn', v)} label={form.isOwn ? 'TK của tôi' : 'TK người khác giữ hộ'} />
        </Field>
        <Field label="Số dư đầu" htmlFor="ac-opening" hint="Số dư lúc bắt đầu theo dõi (có thể âm).">
          <MoneyField id="ac-opening" value={form.openingBalance} allowNegative onChange={(v) => set('openingBalance', v)} placeholder="0" />
        </Field>
        <Field label="Ghi chú" htmlFor="ac-notes">
          <Textarea id="ac-notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}
