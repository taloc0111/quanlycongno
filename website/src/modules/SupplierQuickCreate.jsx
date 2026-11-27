import { useState } from 'react';
import { Store } from 'lucide-react';
import { suppliersApi, SUPPLIER_KINDS } from '../services/money';
import { useFeedback } from '../ui/FeedbackContext';
import { Button, Field, Input, Select } from '../ui';

/**
 * Khung nhỏ (inline, không phải modal lồng modal) để tạo nhanh 1 nhà cung cấp ngay trong form giá vốn.
 * Không dùng <form> vì nằm trong form dịch vụ: Enter = Lưu, Escape = Huỷ (chặn lan ra modal cha).
 * Props: defaultKind, onCreated(supplier), onCancel.
 */
export default function SupplierQuickCreate({ defaultKind = 'other', onCreated, onCancel }) {
  const { toast } = useFeedback();
  const [name, setName] = useState('');
  const [kind, setKind] = useState(defaultKind);
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!name.trim()) { toast.error('Nhập tên nhà cung cấp'); return; }
    setSaving(true);
    try {
      const s = await suppliersApi.create({ name: name.trim(), kind, phone: phone.trim() || undefined });
      toast.success(`Đã thêm nhà cung cấp ${s.name || name.trim()}`);
      onCreated?.(s);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onCancel?.(); }
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); e.stopPropagation(); create(); }
  };

  return (
    <div
      role="group"
      aria-label="Thêm nhà cung cấp"
      onKeyDown={onKeyDown}
      className="rounded-xl border border-brand-200 bg-brand-50/40 p-3 animate-fade-in"
    >
      <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink"><Store size={14} /> Thêm nhà cung cấp</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Field label="Tên" required htmlFor="sqc-name">
          <Input id="sqc-name" size="sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: F1 Thùy Dương" autoFocus />
        </Field>
        <Field label="Loại" htmlFor="sqc-kind">
          <Select id="sqc-kind" size="sm" value={kind} onChange={(e) => setKind(e.target.value)}>
            {SUPPLIER_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </Select>
        </Field>
        <Field label="SĐT" htmlFor="sqc-phone">
          <Input id="sqc-phone" size="sm" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Tuỳ chọn" />
        </Field>
      </div>
      <div className="mt-2.5 flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel}>Huỷ</Button>
        <Button size="sm" loading={saving} onClick={create}>Lưu nhà cung cấp</Button>
      </div>
    </div>
  );
}
