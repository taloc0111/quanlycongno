import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Network, Pencil, Trash2, CalendarClock, KeyRound, MoreHorizontal, Users, Landmark, Hourglass,
  AlertTriangle, RefreshCw, CheckCircle2, PlaneTakeoff,
} from 'lucide-react';
import { useAuth } from './auth/AuthContext';
import { useFeedback } from './ui/FeedbackContext';
import { useTableState } from './hooks/useTableState';
import { api } from './services/client';
import { formatCurrency, formatDateTime, num } from './utils/format';
import {
  Button, IconButton, Field, Input, Select, SearchInput, Switch, Modal, Dropdown, MenuItem, Badge,
  PageHeader, StatCard, DataTable, ErrorBanner,
} from './ui';

const ROLE = {
  admin: { label: 'Quản trị', tone: 'danger' },
  agency: { label: 'Đại lý cấp 1', tone: 'brand' },
  user: { label: 'Đại lý cấp 2', tone: 'gray' },
};

const EMPTY_FORM = { username: '', password: '', fullName: '', email: '', role: 'user', parentId: '' };

/** Trạng thái dùng thử từ trial_ends_at. */
function trialInfo(u) {
  if (!u.trial_ends_at) return { state: 'unlimited', days: null, tone: 'success', label: 'Không giới hạn' };
  const days = Math.ceil((new Date(u.trial_ends_at).getTime() - Date.now()) / 86400000);
  if (days <= 0) return { state: 'expired', days, tone: 'danger', label: 'Hết hạn' };
  return { state: 'trial', days, tone: days <= 3 ? 'warning' : 'brand', label: `Còn ${days} ngày` };
}

const COLUMNS = [
  { key: 'username', label: 'Tài khoản', sortable: true, required: true },
  { key: 'role', label: 'Vai trò', sortable: true },
  { key: 'parent', label: 'Thuộc đại lý', hideBelow: 'lg' },
  { key: 'outstanding', label: 'Còn nợ', align: 'right', sortable: true },
  { key: 'trial', label: 'Dùng thử', sortable: true },
  { key: 'fareWatch', label: 'Canh vé', required: true },
];

export default function AgencyApp() {
  const { user, isAdmin, canManage } = useAuth();
  const { toast, confirm } = useFeedback();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);        // modal thêm/sửa
  const [saving, setSaving] = useState(false);
  const [trialUser, setTrialUser] = useState(null);
  const [trialDays, setTrialDays] = useState('30');
  const [trialBusy, setTrialBusy] = useState('');
  const [pwUser, setPwUser] = useState(null);
  const [pw, setPw] = useState({ a: '', b: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [toggling, setToggling] = useState({});  // { [id]: true } đang gọi API features

  const t = useTableState({ storageKey: 'agencies', columns: COLUMNS, pageSize: 50, defaultSort: { key: 'username', dir: 'asc' } });
  const roleFilter = t.filters.role || 'all';

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try { setRows(await api.get('/users')); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const nameOf = useCallback((id) => {
    if (!id) return '';
    if (String(id) === String(user?.id)) return `${user.fullName || user.username} (tôi)`;
    const p = rows.find((r) => String(r.id) === String(id));
    return p ? (p.full_name || p.username) : `#${id}`;
  }, [rows, user]);

  const { filtered, sorted, paged, totalPages, page } = t.process(rows, {
    searchText: (r) => `${r.username} ${r.full_name || ''} ${r.email || ''} ${nameOf(r.parent_id)}`,
    filterFns: [roleFilter !== 'all' ? (r) => r.role === roleFilter : null],
    sortValue: (r, key) => {
      if (key === 'outstanding') return num(r.outstanding);
      if (key === 'trial') { const i = trialInfo(r); return i.state === 'unlimited' ? 99999 : i.days; }
      return String(r[key] || '').toLowerCase();
    },
  });

  const stats = useMemo(() => {
    const infos = filtered.map(trialInfo);
    return {
      count: filtered.length,
      outstanding: filtered.reduce((s, r) => s + Math.max(0, num(r.outstanding)), 0),
      trial: infos.filter((i) => i.state === 'trial').length,
      expiring: infos.filter((i) => i.state === 'trial' && i.days <= 3).length,
      expired: infos.filter((i) => i.state === 'expired').length,
    };
  }, [filtered]);

  // ---------- Thêm / sửa ----------
  const openAdd = () => setForm({ ...EMPTY_FORM });
  const openEdit = (u) => setForm({ id: u.id, username: u.username, password: '', fullName: u.full_name || '', email: u.email || '', role: u.role, parentId: u.parent_id || '' });
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.id) {
      if (form.username.trim().length < 3) { toast.error('Tên đăng nhập phải có ít nhất 3 ký tự'); return; }
      if (form.password.length < 6) { toast.error('Mật khẩu phải có ít nhất 6 ký tự'); return; }
    }
    setSaving(true);
    try {
      if (form.id) {
        await api.put(`/users/${form.id}`, { fullName: form.fullName, email: form.email, role: isAdmin ? form.role : undefined });
        toast.success('Đã cập nhật tài khoản');
      } else {
        const body = { username: form.username.trim(), password: form.password, fullName: form.fullName, email: form.email };
        if (isAdmin) { body.role = form.role; body.parentId = form.parentId || null; }
        await api.post('/users', body);
        toast.success(`Đã thêm đại lý ${form.username.trim()}`);
      }
      setForm(null);
      await load({ silent: true });
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const remove = async (u) => {
    const ok = await confirm({ title: 'Xoá đại lý', message: `Xoá tài khoản "${u.username}"? Toàn bộ dữ liệu (công nợ, hộ chiếu, khách hàng…) của họ cũng bị xoá.`, confirmText: 'Xoá tài khoản' });
    if (!ok) return;
    try {
      await api.del(`/users/${u.id}`);
      setRows((rs) => rs.filter((r) => r.id !== u.id));
      toast.success('Đã xoá tài khoản');
    } catch (err) { toast.error(err.message); } // 400: còn đại lý con → hiện thông báo của server
  };

  // ---------- Dùng thử ----------
  const applyTrial = async (action, days) => {
    if (action === 'extend' && !(num(days) > 0)) { toast.error('Nhập số ngày gia hạn (> 0)'); return; }
    if (action === 'revoke' && !(await confirm({ title: 'Thu hồi dùng thử', message: `Khoá tài khoản "${trialUser.username}" ngay bây giờ?`, confirmText: 'Thu hồi' }))) return;
    setTrialBusy(action);
    try {
      const res = await api.put(`/users/${trialUser.id}/trial`, { action, days: action === 'extend' ? num(days) : undefined });
      setRows((rs) => rs.map((r) => (r.id === trialUser.id ? { ...r, trial_ends_at: res.trial_ends_at ?? r.trial_ends_at } : r)));
      toast.success(action === 'extend' ? `Đã gia hạn ${num(days)} ngày cho ${trialUser.username}` : action === 'unlimited' ? `${trialUser.username} dùng không giới hạn` : `Đã thu hồi dùng thử của ${trialUser.username}`);
      setTrialUser(null);
      load({ silent: true });
    } catch (err) { toast.error(err.message); }
    finally { setTrialBusy(''); }
  };

  // ---------- Đặt lại mật khẩu ----------
  const resetPassword = async () => {
    if (pw.a.length < 6) { toast.error('Mật khẩu mới phải có ít nhất 6 ký tự'); return; }
    if (pw.a !== pw.b) { toast.error('Hai mật khẩu không khớp'); return; }
    setPwBusy(true);
    try {
      await api.post(`/users/${pwUser.id}/password`, { newPassword: pw.a });
      toast.success(`Đã đặt lại mật khẩu cho ${pwUser.username}`);
      setPwUser(null);
    } catch (err) { toast.error(err.message); }
    finally { setPwBusy(false); }
  };

  // ---------- Bật/tắt Canh vé (admin) — cập nhật lạc quan, lỗi thì hoàn tác ----------
  const toggleFareWatch = async (u, on) => {
    const prev = !!u.features?.fareWatch;
    setToggling((m) => ({ ...m, [u.id]: true }));
    setRows((rs) => rs.map((r) => (r.id === u.id ? { ...r, features: { ...(r.features || {}), fareWatch: on } } : r)));
    try {
      const res = await api.put(`/users/${u.id}/features`, { fareWatch: on });
      if (res?.features) setRows((rs) => rs.map((r) => (r.id === u.id ? { ...r, features: res.features } : r)));
      toast.success(on ? `Đã bật Canh vé cho ${u.full_name || u.username}` : `Đã tắt Canh vé của ${u.full_name || u.username}`);
    } catch (err) {
      setRows((rs) => rs.map((r) => (r.id === u.id ? { ...r, features: { ...(r.features || {}), fareWatch: prev } } : r)));
      toast.error(err.message);
    } finally {
      setToggling((m) => { const n = { ...m }; delete n[u.id]; return n; });
    }
  };

  // ---------- Cột ----------
  const trialBadge = (u) => { const i = trialInfo(u); return <Badge tone={i.tone} dot>{i.label}</Badge>; };
  const fareCell = (u) => (isAdmin ? (
    <Switch size="sm" checked={!!u.features?.fareWatch} disabled={!!toggling[u.id]} onChange={(v) => toggleFareWatch(u, v)} />
  ) : (
    <Badge tone={u.features?.fareWatch ? 'success' : 'gray'} dot>{u.features?.fareWatch ? 'Bật' : 'Tắt'}</Badge>
  ));
  const actions = (u) => (
    <Dropdown align="right" trigger={<IconButton icon={MoreHorizontal} title="Thao tác" />} width="w-52">
      <MenuItem icon={Pencil} onClick={() => openEdit(u)}>Sửa thông tin</MenuItem>
      <MenuItem icon={CalendarClock} onClick={() => { setTrialDays('30'); setTrialUser(u); }}>Gia hạn dùng thử</MenuItem>
      {canManage && <MenuItem icon={KeyRound} onClick={() => { setPw({ a: '', b: '' }); setPwUser(u); }}>Đặt lại mật khẩu</MenuItem>}
      <div className="border-t border-surface-border my-1" />
      <MenuItem icon={Trash2} danger onClick={() => remove(u)}>Xoá tài khoản</MenuItem>
    </Dropdown>
  );

  const columns = [
    ...COLUMNS.filter((c) => c.required || t.isVisible(c.key)).map((c) => ({
      ...c,
      render: {
        username: (u) => (
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 text-xs font-bold">{(u.full_name || u.username || '?').trim().charAt(0).toUpperCase()}</span>
            <span className="min-w-0">
              <span className="block font-semibold text-ink truncate max-w-[200px]">{u.full_name || u.username}</span>
              <span className="block text-xs text-ink-faint truncate max-w-[200px]">@{u.username}{u.email ? ` · ${u.email}` : ''}</span>
            </span>
          </div>
        ),
        role: (u) => <Badge tone={ROLE[u.role]?.tone || 'gray'}>{ROLE[u.role]?.label || u.role}</Badge>,
        parent: (u) => <span className="text-sm text-ink-muted">{nameOf(u.parent_id) || <span className="text-ink-faint">—</span>}</span>,
        outstanding: (u) => <span className={`font-bold tabular ${num(u.outstanding) > 0 ? 'text-danger-600' : 'text-success-600'}`}>{formatCurrency(u.outstanding)}</span>,
        trial: (u) => trialBadge(u),
        fareWatch: (u) => fareCell(u),
      }[c.key],
    })),
    { key: '__actions', label: '', align: 'right', width: 60, render: (u) => actions(u) },
  ];

  const mobileCard = (u) => (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink truncate">{u.full_name || u.username} <span className="text-xs text-ink-faint font-normal">@{u.username}</span></p>
          <p className="text-xs text-ink-muted truncate"><Badge tone={ROLE[u.role]?.tone || 'gray'}>{ROLE[u.role]?.label || u.role}</Badge>{u.parent_id ? ` · thuộc ${nameOf(u.parent_id)}` : ''}</p>
        </div>
        {actions(u)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-ink-muted">Còn nợ <b className={`tabular ${num(u.outstanding) > 0 ? 'text-danger-600' : 'text-success-600'}`}>{formatCurrency(u.outstanding)}</b></span>
        {trialBadge(u)}
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">Canh vé {fareCell(u)}</span>
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader
        icon={Network}
        title="Đại lý"
        description={isAdmin ? 'Quản lý mọi tài khoản: vai trò, dùng thử, mật khẩu và tính năng Canh vé.' : 'Các đại lý cấp dưới bạn quản lý. Bạn xem được công nợ của họ (chỉ xem).'}
        actions={<Button icon={Plus} onClick={openAdd}>Thêm đại lý</Button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard icon={Users} label="Số đại lý" value={stats.count} sub={roleFilter !== 'all' || t.search ? 'theo bộ lọc' : ''} tone="brand" />
        <StatCard icon={Landmark} label="Tổng nợ các đại lý" value={formatCurrency(stats.outstanding)} sub="Khách còn nợ họ" tone="danger" />
        <StatCard icon={Hourglass} label="Đang dùng thử" value={stats.trial} sub={stats.expired ? `${stats.expired} đã hết hạn` : ''} tone="purple" />
        <StatCard icon={AlertTriangle} label="Sắp hết hạn" value={stats.expiring} sub="≤ 3 ngày" tone={stats.expiring ? 'warning' : 'gray'} />
      </div>

      <div className="card mb-4 p-3 flex flex-col lg:flex-row lg:items-center gap-2.5">
        <SearchInput value={t.search} onChange={t.setSearch} placeholder="Tìm tài khoản, họ tên, email…" className="lg:w-80" />
        <Select size="sm" value={roleFilter} onChange={(e) => t.setFilter('role', e.target.value)} className="w-40">
          <option value="all">Mọi vai trò</option>
          <option value="agency">Đại lý cấp 1</option>
          <option value="user">Đại lý cấp 2</option>
          {isAdmin && <option value="admin">Quản trị</option>}
        </Select>
        {isAdmin && (
          <p className="text-xs text-ink-faint inline-flex items-center gap-1.5 lg:ml-2"><PlaneTakeoff size={13} /> Canh vé: khi bật, đại lý thấy menu Canh vé và Check vé; tắt thì ẩn và API chặn.</p>
        )}
        <div className="flex items-center gap-1 lg:ml-auto">
          <IconButton icon={RefreshCw} title="Tải lại" onClick={() => load({ silent: true })} className={refreshing ? 'animate-spin' : ''} />
        </div>
      </div>

      <ErrorBanner message={error} onRetry={load} />

      <DataTable
        columns={columns}
        rows={paged}
        loading={loading}
        sort={t.sort}
        onSort={t.toggleSort}
        emptyIcon={Network}
        emptyTitle={rows.length ? 'Không có đại lý nào khớp bộ lọc' : 'Chưa có đại lý cấp dưới'}
        emptyDescription={rows.length ? 'Thử đổi từ khoá hoặc vai trò.' : 'Thêm tài khoản cho đại lý để họ tự quản lý công nợ, bạn xem tổng hợp.'}
        emptyAction={!rows.length && <Button icon={Plus} onClick={openAdd}>Thêm đại lý</Button>}
        pagination={{ page, totalPages, total: sorted.length, pageSize: t.pageSize, onChange: t.setPage }}
        mobileCard={mobileCard}
      />

      {/* Thêm / sửa */}
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        icon={Network}
        title={form?.id ? 'Sửa đại lý' : 'Thêm đại lý cấp dưới'}
        subtitle={form?.id ? `@${form.username}` : undefined}
        size="md"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>Huỷ</Button>
            <Button icon={CheckCircle2} loading={saving} onClick={save}>{form?.id ? 'Lưu thay đổi' : 'Tạo tài khoản'}</Button>
          </>
        )}
      >
        {form && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Field label="Tên đăng nhập" required htmlFor="ag-username" hint={form.id ? 'Không đổi được tên đăng nhập.' : 'Ít nhất 3 ký tự, không dấu.'}>
              <Input id="ag-username" value={form.username} disabled={!!form.id} autoComplete="off" onChange={(e) => setF('username', e.target.value)} />
            </Field>
            {!form.id && (
              <Field label="Mật khẩu" required htmlFor="ag-password" hint="Ít nhất 6 ký tự.">
                <Input id="ag-password" type="password" value={form.password} autoComplete="new-password" onChange={(e) => setF('password', e.target.value)} />
              </Field>
            )}
            <Field label="Họ và tên" htmlFor="ag-fullname">
              <Input id="ag-fullname" value={form.fullName} onChange={(e) => setF('fullName', e.target.value)} />
            </Field>
            <Field label="Email" htmlFor="ag-email">
              <Input id="ag-email" type="email" value={form.email} onChange={(e) => setF('email', e.target.value)} />
            </Field>
            {isAdmin && (
              <>
                <Field label="Vai trò" htmlFor="ag-role">
                  <Select id="ag-role" value={form.role} onChange={(e) => setF('role', e.target.value)}>
                    <option value="user">Đại lý cấp 2 / Nhân viên</option>
                    <option value="agency">Đại lý cấp 1</option>
                    <option value="admin">Quản trị</option>
                  </Select>
                </Field>
                {!form.id && (
                  <Field label="Thuộc đại lý" htmlFor="ag-parent" hint="Để trống = tài khoản độc lập (không có cấp trên).">
                    <Select id="ag-parent" value={form.parentId} onChange={(e) => setF('parentId', e.target.value)}>
                      <option value="">— Không có —</option>
                      {user?.id && <option value={user.id}>{user.fullName || user.username} (tôi)</option>}
                      {rows.filter((r) => r.role !== 'user').map((r) => <option key={r.id} value={r.id}>{r.full_name || r.username} ({ROLE[r.role]?.label})</option>)}
                    </Select>
                  </Field>
                )}
              </>
            )}
            <button type="submit" className="hidden" aria-hidden />
          </form>
        )}
      </Modal>

      {/* Dùng thử */}
      <Modal
        open={!!trialUser}
        onClose={() => setTrialUser(null)}
        icon={CalendarClock}
        title="Dùng thử"
        subtitle={trialUser ? `@${trialUser.username}` : undefined}
        size="md"
        footer={<Button variant="secondary" onClick={() => setTrialUser(null)}>Đóng</Button>}
      >
        {trialUser && (
          <div className="space-y-4">
            <p className="text-sm text-ink-soft flex flex-wrap items-center gap-2">
              Trạng thái hiện tại: {trialBadge(trialUser)}
              {trialUser.trial_ends_at && <span className="text-xs text-ink-faint">đến {formatDateTime(trialUser.trial_ends_at)}</span>}
            </p>
            <Field label="Gia hạn thêm (ngày)" htmlFor="trial-days" hint="Cộng dồn vào số ngày còn lại. Người dùng cần đăng nhập lại để áp dụng hạn mới.">
              <div className="flex flex-wrap items-center gap-2">
                <Input id="trial-days" type="number" min={1} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} className="w-28" />
                {[14, 30, 90].map((d) => (
                  <Button key={d} size="sm" variant={String(d) === trialDays ? 'soft' : 'secondary'} onClick={() => setTrialDays(String(d))}>+{d}</Button>
                ))}
                <Button size="sm" icon={CalendarClock} loading={trialBusy === 'extend'} onClick={() => applyTrial('extend', trialDays)}>Gia hạn</Button>
              </div>
            </Field>
            <div className="flex flex-wrap gap-2 border-t border-surface-border pt-4">
              <Button variant="success" loading={trialBusy === 'unlimited'} onClick={() => applyTrial('unlimited')}>Không giới hạn</Button>
              <Button variant="danger" loading={trialBusy === 'revoke'} onClick={() => applyTrial('revoke')}>Thu hồi (khoá ngay)</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Đặt lại mật khẩu */}
      <Modal
        open={!!pwUser}
        onClose={() => setPwUser(null)}
        icon={KeyRound}
        title="Đặt lại mật khẩu"
        subtitle={pwUser ? `@${pwUser.username}` : undefined}
        size="sm"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setPwUser(null)}>Huỷ</Button>
            <Button icon={CheckCircle2} loading={pwBusy} onClick={resetPassword}>Đặt lại</Button>
          </>
        )}
      >
        {pwUser && (
          <form onSubmit={(e) => { e.preventDefault(); resetPassword(); }} className="space-y-3.5">
            <Field label="Mật khẩu mới" required htmlFor="pw-a" hint="Ít nhất 6 ký tự. Hãy báo mật khẩu mới cho đại lý qua kênh riêng.">
              <Input id="pw-a" type="password" autoComplete="new-password" value={pw.a} onChange={(e) => setPw((p) => ({ ...p, a: e.target.value }))} />
            </Field>
            <Field label="Nhập lại mật khẩu" required htmlFor="pw-b" error={pw.b && pw.a !== pw.b ? 'Hai mật khẩu không khớp' : ''}>
              <Input id="pw-b" type="password" autoComplete="new-password" value={pw.b} onChange={(e) => setPw((p) => ({ ...p, b: e.target.value }))} />
            </Field>
            <button type="submit" className="hidden" aria-hidden />
          </form>
        )}
      </Modal>
    </div>
  );
}
