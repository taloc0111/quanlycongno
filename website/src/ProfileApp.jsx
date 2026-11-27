import { useCallback, useEffect, useState } from 'react';
import { UserCircle, Save, KeyRound, Mail, IdCard, CalendarClock, Users } from 'lucide-react';
import { api } from './services/client';
import { useAuth } from './auth/AuthContext';
import { useFeedback } from './ui/FeedbackContext';
import { PasswordInput } from './auth/LoginPage';
import { formatDate } from './utils/format';
import { Button, Field, Input, Card, Badge, PageHeader, Skeleton, ErrorBanner } from './ui';

const ROLE_LABEL = { admin: 'Quản trị viên', agency: 'Đại lý cấp 1', user: 'Đại lý / Nhân viên' };
const ROLE_TONE = { admin: 'purple', agency: 'brand', user: 'gray' };

export default function ProfileApp() {
  const { user, updateUser, trialDaysLeft } = useAuth();
  const { toast } = useFeedback();
  const [profile, setProfile] = useState({ fullName: '', email: '', username: '', role: '', parentId: null, trialEndsAt: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [pwd, setPwd] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [changing, setChanging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const p = await api.get('/auth/profile');
      setProfile({
        fullName: p.full_name || '', email: p.email || '', username: p.username, role: p.role,
        parentId: p.parent_id ?? null, trialEndsAt: p.trial_ends_at ?? null,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveProfile = async (e) => {
    e?.preventDefault();
    setSaving(true);
    try {
      const updated = await api.put('/auth/profile', { fullName: profile.fullName, email: profile.email });
      updateUser({ fullName: updated.full_name, email: updated.email });
      toast.success('Đã lưu thông tin');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (e) => {
    e?.preventDefault();
    if (!pwd.currentPassword) { toast.error('Nhập mật khẩu hiện tại'); return; }
    if (pwd.newPassword.length < 6) { toast.error('Mật khẩu mới phải có ít nhất 6 ký tự'); return; }
    if (pwd.newPassword !== pwd.confirm) { toast.error('Mật khẩu mới không khớp'); return; }
    setChanging(true);
    try {
      await api.put('/auth/password', { currentPassword: pwd.currentPassword, newPassword: pwd.newPassword });
      setPwd({ currentPassword: '', newPassword: '', confirm: '' });
      toast.success('Đổi mật khẩu thành công');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setChanging(false);
    }
  };

  const initial = (profile.fullName || profile.username || user?.username || '?').trim().charAt(0).toUpperCase();
  const mismatch = pwd.confirm && pwd.confirm !== pwd.newPassword;
  const trialLabel = profile.trialEndsAt
    ? (trialDaysLeft !== null && trialDaysLeft > 0 ? `Dùng thử · còn ${trialDaysLeft} ngày (đến ${formatDate(profile.trialEndsAt)})` : `Dùng thử · hết hạn ${formatDate(profile.trialEndsAt)}`)
    : 'Tài khoản chính thức';

  return (
    <div className="max-w-5xl">
      <PageHeader icon={UserCircle} title="Hồ sơ của tôi" description="Thông tin tài khoản và bảo mật." />
      <ErrorBanner message={error} onRetry={load} />

      <div className={`grid grid-cols-1 lg:grid-cols-2 gap-4 ${error ? 'mt-4' : ''}`}>
        {/* Thông tin */}
        <Card>
          {loading ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Skeleton className="h-16 w-16 rounded-full" />
                <div className="space-y-2"><Skeleton className="h-5 w-32" /><Skeleton className="h-4 w-24" /></div>
              </div>
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : (
            <form onSubmit={saveProfile} className="space-y-4">
              <div className="flex items-center gap-4">
                <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-2xl font-bold text-white shadow">
                  {initial}
                </span>
                <div className="min-w-0">
                  <p className="text-lg font-bold text-ink truncate">{profile.fullName || profile.username}</p>
                  <p className="text-sm text-ink-muted">@{profile.username}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge tone={ROLE_TONE[profile.role] || 'gray'} dot>{ROLE_LABEL[profile.role] || profile.role}</Badge>
                    {profile.parentId && <Badge tone="outline" icon={Users}>Thuộc đại lý #{profile.parentId}</Badge>}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-xl bg-surface-muted px-3 py-2 text-sm text-ink-soft">
                <CalendarClock size={15} className="shrink-0 text-ink-faint" />
                <span>{trialLabel}</span>
              </div>

              <Field label="Họ và tên" htmlFor="pf-name">
                <div className="relative">
                  <IdCard size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                  <Input id="pf-name" className="pl-9" value={profile.fullName} onChange={(e) => setProfile({ ...profile, fullName: e.target.value })} placeholder="Nguyễn Văn A" autoComplete="name" />
                </div>
              </Field>
              <Field label="Email" hint="Dùng để khôi phục mật khẩu" htmlFor="pf-email">
                <div className="relative">
                  <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                  <Input id="pf-email" type="email" className="pl-9" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} placeholder="email@cua-ban.com" autoComplete="email" />
                </div>
              </Field>
              <div className="flex justify-end">
                <Button type="submit" icon={Save} loading={saving}>Lưu thông tin</Button>
              </div>
            </form>
          )}
        </Card>

        {/* Đổi mật khẩu */}
        <Card>
          <form onSubmit={changePassword} className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><KeyRound size={18} /></span>
              <div>
                <h3 className="font-bold text-ink">Đổi mật khẩu</h3>
                <p className="text-xs text-ink-muted">Nên dùng mật khẩu dài, khó đoán.</p>
              </div>
            </div>
            {/* Trình duyệt cần username ẩn để lưu mật khẩu đúng tài khoản */}
            <input type="text" name="username" value={profile.username || ''} autoComplete="username" readOnly hidden />
            <Field label="Mật khẩu hiện tại" required htmlFor="pf-cur">
              <PasswordInput id="pf-cur" value={pwd.currentPassword} onChange={(e) => setPwd({ ...pwd, currentPassword: e.target.value })} autoComplete="current-password" />
            </Field>
            <Field label="Mật khẩu mới" required hint="Ít nhất 6 ký tự" htmlFor="pf-new">
              <PasswordInput id="pf-new" value={pwd.newPassword} onChange={(e) => setPwd({ ...pwd, newPassword: e.target.value })} autoComplete="new-password" />
            </Field>
            <Field label="Nhập lại mật khẩu mới" required htmlFor="pf-confirm" error={mismatch ? 'Mật khẩu mới không khớp' : undefined}>
              <PasswordInput id="pf-confirm" value={pwd.confirm} onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} autoComplete="new-password" error={!!mismatch} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="secondary" icon={KeyRound} loading={changing} disabled={!pwd.currentPassword || !pwd.newPassword || !pwd.confirm}>Đổi mật khẩu</Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
