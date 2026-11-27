import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Plane, ExternalLink, RefreshCw, CheckCircle2 } from 'lucide-react';
import { api } from './services/client';
import { useFeedback } from './ui/FeedbackContext';
import { useTableState } from './hooks/useTableState';
import { DEFAULT_AIRLINES } from './utils/airlines';
import {
  Button, IconButton, Field, Input, SearchInput, Modal, Badge, PageHeader, DataTable, ErrorBanner, Card,
} from './ui';

const EMPTY = { name: '', code: '', checkinUrl: '' };

/** Rút gọn URL để hiện trong bảng: bỏ giao thức + www. */
const shortUrl = (url) => String(url || '').replace(/^https?:\/\/(www\.)?/i, '');

export default function AirlinesApp() {
  const { toast, confirm } = useFeedback();
  const [airlines, setAirlines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null); // null = đóng; { ...EMPTY, id? }
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const columns = [
    { key: 'name', label: 'Tên hãng', sortable: true, required: true },
    { key: 'code', label: 'Mã', sortable: true, width: 90 },
    { key: 'checkin_url', label: 'Link check-in', hideBelow: 'md' },
  ];
  const t = useTableState({ storageKey: 'airlines', columns, pageSize: 50, defaultSort: { key: 'name', dir: 'asc' } });

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      setAirlines(await api.get('/airlines'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const { sorted, paged, totalPages, page } = t.process(airlines, {
    searchText: (a) => `${a.name} ${a.code || ''} ${a.checkin_url || ''}`,
    sortValue: (a, key) => String(a[key] || '').toLowerCase(),
  });

  const openAdd = () => { setForm({ ...EMPTY }); setFormErrors({}); };
  const openEdit = (a) => { setForm({ id: a.id, name: a.name || '', code: a.code || '', checkinUrl: a.checkin_url || '' }); setFormErrors({}); };
  const closeForm = () => setForm(null);
  const setField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFormErrors((e) => (e[key] ? { ...e, [key]: '' } : e));
  };

  const validate = (f) => {
    const errs = {};
    if (!f.name.trim()) errs.name = 'Nhập tên hãng';
    if (!f.checkinUrl.trim()) errs.checkinUrl = 'Nhập link check-in';
    else if (!/^https?:\/\//i.test(f.checkinUrl.trim())) errs.checkinUrl = 'Link phải bắt đầu bằng http:// hoặc https://';
    if (f.code && f.code.trim().length > 10) errs.code = 'Mã tối đa 10 ký tự';
    return errs;
  };

  const save = async () => {
    const errs = validate(form);
    setFormErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    const body = { name: form.name.trim(), code: form.code.trim().toUpperCase(), checkinUrl: form.checkinUrl.trim() };
    try {
      if (form.id) await api.put(`/airlines/${form.id}`, body);
      else await api.post('/airlines', body);
      toast.success(form.id ? 'Đã cập nhật hãng' : 'Đã thêm hãng');
      setForm(null);
      await load({ silent: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (a) => {
    const ok = await confirm({ title: 'Xoá hãng bay', message: `Xoá hãng "${a.name}"? Vé đã nhập với hãng này vẫn giữ nguyên, chỉ mất nút web check-in tự động.`, confirmText: 'Xoá' });
    if (!ok) return;
    try {
      await api.del(`/airlines/${a.id}`);
      setAirlines((list) => list.filter((x) => x.id !== a.id));
      toast.success('Đã xoá hãng');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const cols = [
    { key: 'name', label: 'Tên hãng', sortable: true, render: (a) => <span className="font-medium text-ink">{a.name}</span> },
    { key: 'code', label: 'Mã', sortable: true, width: 90, render: (a) => (a.code ? <Badge tone="outline" className="font-mono">{a.code}</Badge> : <span className="text-ink-faint">—</span>) },
    {
      key: 'checkin_url', label: 'Link check-in', hideBelow: 'md',
      render: (a) => (
        <a href={a.checkin_url} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1.5 max-w-[320px]" title={a.checkin_url}>
          <span className="truncate">{shortUrl(a.checkin_url)}</span>
          <ExternalLink size={13} className="shrink-0" />
        </a>
      ),
    },
    {
      key: '__actions', label: '', align: 'right', width: 90,
      render: (a) => (
        <div className="flex justify-end gap-0.5 opacity-70 group-hover:opacity-100 transition">
          <IconButton icon={Pencil} title="Sửa" variant="primary" onClick={() => openEdit(a)} />
          <IconButton icon={Trash2} title="Xoá" variant="danger" onClick={() => remove(a)} />
        </div>
      ),
    },
  ];

  const mobileCard = (a) => (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-semibold text-ink truncate">{a.name} {a.code && <Badge tone="outline" className="ml-1 font-mono">{a.code}</Badge>}</p>
        <a href={a.checkin_url} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1 text-xs max-w-full">
          <span className="truncate">{shortUrl(a.checkin_url)}</span><ExternalLink size={11} className="shrink-0" />
        </a>
      </div>
      <div className="flex gap-0.5 shrink-0">
        <IconButton icon={Pencil} title="Sửa" variant="primary" onClick={() => openEdit(a)} />
        <IconButton icon={Trash2} title="Xoá" variant="danger" onClick={() => remove(a)} />
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader
        icon={Plane}
        title="Hãng bay"
        description="Khai báo hãng + link check-in để trang Sắp bay tự hiện nút “Web check-in”."
        actions={(
          <>
            <Button variant="secondary" icon={RefreshCw} loading={refreshing} onClick={() => load({ silent: true })}>Làm mới</Button>
            <Button icon={Plus} onClick={openAdd}>Thêm hãng</Button>
          </>
        )}
      />

      <div className="card mb-4 p-3 flex flex-col sm:flex-row sm:items-center gap-2.5">
        <SearchInput value={t.search} onChange={t.setSearch} placeholder="Tìm tên hãng, mã, link…" className="sm:w-80" />
        {!loading && <span className="text-xs text-ink-muted sm:ml-auto">{sorted.length} hãng tự khai báo</span>}
      </div>

      <ErrorBanner message={error} onRetry={() => load()} />

      <DataTable
        columns={cols}
        rows={paged}
        loading={loading}
        sort={t.sort}
        onSort={t.toggleSort}
        emptyIcon={Plane}
        emptyTitle={airlines.length ? 'Không có hãng nào khớp' : 'Chưa có hãng tự khai báo'}
        emptyDescription={airlines.length ? 'Thử từ khoá khác.' : 'Các hãng phổ biến bên dưới đã có sẵn. Thêm hãng mới nếu bạn bán vé hãng khác.'}
        emptyAction={!airlines.length && <Button icon={Plus} onClick={openAdd}>Thêm hãng</Button>}
        pagination={{ page, totalPages, total: sorted.length, pageSize: t.pageSize, onChange: t.setPage }}
        mobileCard={mobileCard}
        className="mb-5"
      />

      {/* Hãng mặc định (chỉ tham khảo) */}
      <Card padded={false} className="overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-border">
          <h3 className="font-semibold text-ink">Hãng có sẵn</h3>
          <p className="text-xs text-ink-muted mt-0.5">Tự nhận diện khi ô “Hãng” của vé chứa tên hoặc mã hãng. Không cần khai báo lại.</p>
        </div>
        <div className="p-4 flex flex-wrap gap-2">
          {DEFAULT_AIRLINES.map((a) => (
            <a key={a.name} href={a.checkinUrl} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-white px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-surface-subtle hover:text-ink transition">
              <Plane size={12} className="text-ink-faint" /> {a.name}
              <Badge tone="gray" className="font-mono">{a.code2.toUpperCase()}</Badge>
              <ExternalLink size={11} className="text-ink-faint" />
            </a>
          ))}
        </div>
      </Card>

      <Modal
        open={!!form}
        onClose={closeForm}
        icon={Plane}
        title={form?.id ? 'Sửa hãng bay' : 'Thêm hãng bay'}
        subtitle={form?.id ? `#${form.id}` : undefined}
        size="md"
        footer={(
          <>
            <Button variant="secondary" onClick={closeForm}>Huỷ</Button>
            <Button icon={CheckCircle2} loading={saving} onClick={save}>{form?.id ? 'Lưu thay đổi' : 'Thêm hãng'}</Button>
          </>
        )}
      >
        {form && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <Field label="Tên hãng" required hint="Khớp với ô “Hãng” khi nhập vé" error={formErrors.name} htmlFor="al-name" className="sm:col-span-2">
              <Input id="al-name" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="VD: Sun PhuQuoc Airways" error={!!formErrors.name} />
            </Field>
            <Field label="Mã hãng" hint="2 ký tự, tuỳ chọn" error={formErrors.code} htmlFor="al-code">
              <Input id="al-code" value={form.code} onChange={(e) => setField('code', e.target.value.toUpperCase())} placeholder="VD: SP" maxLength={10} className="font-mono uppercase" error={!!formErrors.code} />
            </Field>
            <Field label="Link check-in" required error={formErrors.checkinUrl} htmlFor="al-url" className="sm:col-span-3">
              <Input id="al-url" type="url" value={form.checkinUrl} onChange={(e) => setField('checkinUrl', e.target.value)} placeholder="https://..." error={!!formErrors.checkinUrl} />
            </Field>
            <button type="submit" className="hidden" aria-hidden />
          </form>
        )}
      </Modal>
    </div>
  );
}
