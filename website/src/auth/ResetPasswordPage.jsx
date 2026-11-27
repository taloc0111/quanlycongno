import { useState } from 'react';
import { CheckCircle2, KeyRound, ArrowLeft, LogIn } from 'lucide-react';
import { useAuth } from './AuthContext';
import { AuthShell, PasswordInput } from './LoginPage';
import { Button, Field, ErrorBanner } from '../ui';

// Trang đặt lại mật khẩu — hiện khi URL có ?reset=<token>.
export default function ResetPasswordPage({ token }) {
  const { resetPassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const goLogin = () => { window.location.href = window.location.origin + window.location.pathname; };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('Mật khẩu phải có ít nhất 6 ký tự'); return; }
    if (password !== confirm) { setError('Mật khẩu nhập lại không khớp'); return; }
    setLoading(true);
    try { await resetPassword(token, password); setDone(true); }
    catch (err) { setError(err.message || 'Đặt lại mật khẩu thất bại'); }
    finally { setLoading(false); }
  };

  const mismatch = confirm && confirm !== password;

  return (
    <AuthShell>
      {done ? (
        <div className="py-2 text-center">
          <span className="mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-success-50 text-success-600">
            <CheckCircle2 size={34} />
          </span>
          <h1 className="text-xl font-bold tracking-tight text-ink">Đổi mật khẩu thành công</h1>
          <p className="mt-1.5 text-sm text-ink-muted">Hãy đăng nhập lại bằng mật khẩu mới.</p>
          <Button block size="lg" icon={LogIn} className="mt-6" onClick={goLogin}>Đăng nhập</Button>
        </div>
      ) : (
        <>
          <div className="mb-5 flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <KeyRound size={20} />
            </span>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-ink">Đặt lại mật khẩu</h1>
              <p className="mt-0.5 text-sm text-ink-muted">Chọn mật khẩu mới cho tài khoản của bạn.</p>
            </div>
          </div>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Mật khẩu mới" required hint="Ít nhất 6 ký tự" htmlFor="rp-password">
              <PasswordInput id="rp-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Ít nhất 6 ký tự" autoComplete="new-password" autoFocus />
            </Field>
            <Field label="Nhập lại mật khẩu" required htmlFor="rp-confirm" error={mismatch ? 'Mật khẩu nhập lại không khớp' : undefined}>
              <PasswordInput id="rp-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" autoComplete="new-password" error={!!mismatch} />
            </Field>
            <ErrorBanner message={error} />
            <Button type="submit" block size="lg" loading={loading} disabled={!password || !confirm} icon={KeyRound}>Đặt lại mật khẩu</Button>
            <button type="button" onClick={goLogin} className="inline-flex w-full items-center justify-center gap-1 text-sm text-ink-muted hover:text-ink">
              <ArrowLeft size={14} /> Về trang đăng nhập
            </button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
