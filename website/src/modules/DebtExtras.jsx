import { useState } from 'react';
import { Building2, Plus, Route, Trash2, Pencil } from 'lucide-react';
import { api } from '../services/client';
import { useFeedback } from '../ui/FeedbackContext';
import { Button, IconButton, Field, Input, MoneyField, Modal, EmptyState } from '../ui';
import { formatCurrency } from '../utils/format';

/** Quản lý danh mục hành trình bay (HAN-SGN…) của riêng người dùng. */
export function RouteManagerModal({ open, onClose, routes = [], onChanged }) {
  const { toast, confirm } = useFeedback();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const r = value.trim().toUpperCase();
    if (!r) return;
    setBusy(true);
    try {
      await api.post('/routes', { routeName: r });
      setValue('');
      await onChanged();
      toast.success(`Đã thêm ${r}`);
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const remove = async (r) => {
    if (!(await confirm({ title: 'Xoá hành trình', message: `Xoá "${r}" khỏi danh sách gợi ý?` }))) return;
    try { await api.del(`/routes/${encodeURIComponent(r)}`); await onChanged(); toast.success('Đã xoá'); }
    catch (err) { toast.error(err.message); }
  };

  return (
    <Modal open={open} onClose={onClose} icon={Route} title="Hành trình bay" subtitle="Danh sách gợi ý khi nhập vé" size="md">
      <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex gap-2 mb-4">
        <Input value={value} onChange={(e) => setValue(e.target.value.toUpperCase())} placeholder="VD: HAN-SGN" className="uppercase" />
        <Button type="submit" icon={Plus} loading={busy}>Thêm</Button>
      </form>
      {routes.length === 0 ? (
        <EmptyState compact icon={Route} title="Chưa có hành trình" description="Thêm các chặng hay bán để nhập vé nhanh hơn." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {routes.map((r) => (
            <div key={r} className="group flex items-center justify-between rounded-lg border border-surface-border bg-surface-muted px-3 py-2 text-sm font-semibold text-ink">
              {r}
              <IconButton icon={Trash2} size={14} title="Xoá" variant="danger" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => remove(r)} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

const EMPTY_COMPANY = { name: '', taxCode: '', address: '', email: '', contactPerson: '', phone: '', creditLimit: '' };

/** Quản lý công ty (khách doanh nghiệp) gắn với vé. */
export function CompanyManagerModal({ open, onClose, companies = [], onChanged }) {
  const { toast, confirm } = useFeedback();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) { toast.error('Vui lòng nhập tên công ty'); return; }
    setBusy(true);
    try {
      const body = { ...form, name: form.name.trim(), creditLimit: parseFloat(form.creditLimit) || 0 };
      if (form.id) await api.put(`/companies/${form.id}`, body); else await api.post('/companies', body);
      await onChanged();
      setForm(null);
      toast.success(form.id ? 'Đã cập nhật công ty' : 'Đã thêm công ty');
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const remove = async (c) => {
    if (!(await confirm({ title: 'Xoá công ty', message: `Xoá "${c.name}"? Các vé đang gắn sẽ chuyển thành khách lẻ.` }))) return;
    try { await api.del(`/companies/${c.id}`); await onChanged(); toast.success('Đã xoá'); }
    catch (err) { toast.error(err.message); }
  };

  return (
    <Modal open={open} onClose={onClose} icon={Building2} title="Công ty / đối tác" subtitle="Khách doanh nghiệp có hạn mức nợ" size="lg">
      {form ? (
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Tên công ty" required className="sm:col-span-2"><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Mã số thuế"><Input value={form.taxCode} onChange={(e) => set('taxCode', e.target.value)} /></Field>
          <Field label="Người liên hệ"><Input value={form.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} /></Field>
          <Field label="Điện thoại"><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Địa chỉ" className="sm:col-span-2"><Input value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
          <Field label="Hạn mức nợ (VNĐ)"><MoneyField value={form.creditLimit} onChange={(v) => set('creditLimit', v)} /></Field>
          <div className="sm:col-span-2 flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setForm(null)}>Huỷ</Button>
            <Button type="submit" loading={busy}>{form.id ? 'Lưu' : 'Thêm'}</Button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex justify-end mb-3">
            <Button size="sm" icon={Plus} onClick={() => setForm({ ...EMPTY_COMPANY })}>Thêm công ty</Button>
          </div>
          {companies.length === 0 ? (
            <EmptyState compact icon={Building2} title="Chưa có công ty" description="Thêm công ty để gắn vé và theo dõi nợ theo doanh nghiệp." />
          ) : (
            <ul className="divide-y divide-surface-border">
              {companies.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink truncate">{c.name}</p>
                    <p className="text-xs text-ink-muted truncate">
                      {[c.contact_person, c.phone, c.email].filter(Boolean).join(' · ') || 'Chưa có thông tin liên hệ'}
                      {Number(c.credit_limit) > 0 && ` · Hạn mức ${formatCurrency(c.credit_limit)}`}
                    </p>
                  </div>
                  <div className="flex shrink-0">
                    <IconButton icon={Pencil} title="Sửa" variant="primary" onClick={() => setForm({ id: c.id, name: c.name || '', taxCode: c.tax_code || '', address: c.address || '', email: c.email || '', contactPerson: c.contact_person || '', phone: c.phone || '', creditLimit: c.credit_limit || '' })} />
                    <IconButton icon={Trash2} title="Xoá" variant="danger" onClick={() => remove(c)} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}
