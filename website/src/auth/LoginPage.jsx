import { useState } from 'react';
import { Lock, User, IdCard, Mail, Eye, EyeOff, Sparkles, CheckCircle2, ArrowLeft, LogIn, UserPlus, Send, ShieldCheck, BarChart3, Users } from 'lucide-react';
import { useAuth } from './AuthContext';
import { Button, Field, Input, ErrorBanner } from '../ui';

const BENEFITS = [
  { icon: BarChart3, title: 'Theo dõi công nợ từng khách', text: 'Vé máy bay, vé tàu, hộ chiếu, tour — ai còn nợ bao nhiêu, hạn khi nào, nhìn là thấy.' },
  { icon: Users, title: 'Nhiều đại lý, một hệ thống', text: 'Cấp trên xem được số liệu cấp dưới, nộp quỹ và đối soát tự động.' },
  { icon: ShieldCheck, title: 'Canh vé & báo giá tự động', text: 'Đặt giá mong muốn, hệ thống tự lấy giá và báo khi có vé rẻ.' },
];

/**
 * Khung trang đăng nhập/đặt lại mật khẩu: trái là panel thương hiệu (desktop), phải là thẻ form.
 * Props: children (nội dung thẻ), footer (dòng chữ nhỏ dưới thẻ).
 */
export function AuthShell({ children, footer }) {
  return (
    <div className="min-h-screen bg-surface-muted lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* Panel thương hiệu */}
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-slate-900 px-12 py-10 text-white">
        <div className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-brand-500/40 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-[28rem] w-[28rem] translate-x-1/3 translate-y-1/3 rounded-full bg-purple-500/30 blur-3xl" />
        <div className="pointer-events-none absolute top-1/2 left-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-400/10 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-lg">
            <Sparkles size={22} />
          </span>
          <div className="leading-tight">
            <p className="text-lg font-extrabold tracking-tight">Quản Lý Công Nợ</p>
            <p className="text-xs text-slate-400">Đại lý vé & dịch vụ</p>
          </div>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-bold leading-tight tracking-tight">Quản lý công nợ gọn gàng, không sót một đồng.</h2>
          <ul className="mt-8 space-y-5">
            {BENEFITS.map((b) => (
              <li key={b.title} className="flex gap-3.5">
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-brand-300 ring-1 ring-white/10">
                  <b.icon size={18} />
                </span>
                <div>
                  <p className="font-semibold">{b.title}</p>
                  <p className="mt-0.5 text-sm text-slate-400">{b.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-slate-500">© {new Date().getFullYear()} Quản Lý Công Nợ · Dùng thử miễn phí 14 ngày</p>
      </aside>

      {/* Thẻ form */}
      <main className="flex min-h-screen items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center justify-center gap-2.5 lg:hidden">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow">
              <Sparkles size={20} />
            </span>
            <p className="text-lg font-extrabold tracking-tight text-ink">Quản Lý Công Nợ</p>
          </div>
          <div className="card p-6 sm:p-8 animate-fade-in">{children}</div>
          {footer && <div className="mt-4 text-center text-xs text-ink-faint">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

/** Ô mật khẩu có nút hiện/ẩn. Nhận mọi prop của Input. */
export function PasswordInput({ className = '', ...rest }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
      <Input type={show ? 'text' : 'password'} className={`pl-9 pr-10 ${className}`} {...rest} />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        title={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        tabIndex={-1}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-faint transition hover:bg-surface-subtle hover:text-ink"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

/** Ô nhập có icon bên trái. */
function IconInput({ icon: Icon, className = '', ...rest }) {
  return (
    <div className="relative">
      <Icon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
      <Input className={`pl-9 ${className}`} {...rest} />
    </div>
  );
}

export default function LoginPage() {
  const { login, register, forgotPassword } = useAuth();
  const [mode, setMode] = useState('login'); // login | signup | forgot
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const isSignup = mode === 'signup';
  const isForgot = mode === 'forgot';

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setInfo('');
    if (isSignup) {
      if (password.length < 6) { setError('Mật khẩu phải có ít nhất 6 ký tự'); return; }
      if (password !== confirm) { setError('Mật khẩu nhập lại không khớp'); return; }
    }
    setLoading(true);
    try {
      if (isForgot) {
        const res = await forgotPassword(email.trim());
        setInfo(res.message || 'Nếu email tồn tại, link đặt lại đã được gửi.');
      } else if (isSignup) {
        await register({ username: username.trim(), password, fullName: fullName.trim(), email: email.trim() });
      } else {
        await login(username.trim(), password);
      }
    } catch (err) {
      setError(err.message || 'Có lỗi xảy ra');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (m) => { setMode(m); setError(''); setInfo(''); setPassword(''); setConfirm(''); };

  const canSubmit = isForgot ? !!email : (!!username && !!password && (!isSignup || !!confirm));
  const confirmMismatch = isSignup && confirm && confirm !== password;

  return (
    <AuthShell footer={isSignup ? 'Miễn phí 14 ngày · không cần thẻ tín dụng' : null}>
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight text-ink">
          {isForgot ? 'Khôi phục mật khẩu' : isSignup ? 'Tạo tài khoản dùng thử' : 'Chào mừng trở lại'}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {isForgot ? 'Nhập email đã đăng ký, chúng tôi sẽ gửi link đặt lại mật khẩu.'
            : isSignup ? 'Dùng đầy đủ tính năng trong 14 ngày, không cần thẻ.'
            : 'Đăng nhập để tiếp tục quản lý công nợ.'}
        </p>
      </div>

      {!isForgot && (
        <div className="mb-5 grid grid-cols-2 rounded-lg bg-surface-subtle p-0.5" role="tablist">
          {[{ key: 'login', label: 'Đăng nhập' }, { key: 'signup', label: 'Dùng thử 14 ngày' }].map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={mode === t.key}
              onClick={() => switchMode(t.key)}
              className={`rounded-md py-1.5 text-sm font-medium transition ${mode === t.key ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="space-y-4" noValidate>
        {isForgot ? (
          <Field label="Email đã đăng ký" htmlFor="auth-email">
            <IconInput id="auth-email" icon={Mail} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@cua-ban.com" autoComplete="email" autoFocus />
          </Field>
        ) : (
          <>
            {isSignup && (
              <Field label="Họ tên" htmlFor="auth-fullname">
                <IconInput id="auth-fullname" icon={IdCard} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nguyễn Văn A" autoComplete="name" />
              </Field>
            )}
            <Field label="Tên đăng nhập" required htmlFor="auth-username">
              <IconInput id="auth-username" icon={User} value={username} onChange={(e) => setUsername(e.target.value)} placeholder={isSignup ? 'Chọn tên đăng nhập' : 'Tên đăng nhập'} autoComplete="username" autoCapitalize="none" autoFocus />
            </Field>
            {isSignup && (
              <Field label="Email" hint="Dùng để khôi phục mật khẩu" htmlFor="auth-email2">
                <IconInput id="auth-email2" icon={Mail} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@cua-ban.com" autoComplete="email" />
              </Field>
            )}
            <Field label="Mật khẩu" required htmlFor="auth-password">
              <PasswordInput id="auth-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isSignup ? 'Ít nhất 6 ký tự' : '••••••••'} autoComplete={isSignup ? 'new-password' : 'current-password'} />
            </Field>
            {isSignup && (
              <Field label="Nhập lại mật khẩu" required htmlFor="auth-confirm" error={confirmMismatch ? 'Mật khẩu nhập lại không khớp' : undefined}>
                <PasswordInput id="auth-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" autoComplete="new-password" error={!!confirmMismatch} />
              </Field>
            )}
          </>
        )}

        <ErrorBanner message={error} />
        {info && (
          <div className="flex items-start gap-2 rounded-xl border border-success-100 bg-success-50 px-4 py-3 text-sm text-success-700">
            <CheckCircle2 size={17} className="mt-0.5 shrink-0" /> {info}
          </div>
        )}

        <Button type="submit" block size="lg" loading={loading} disabled={!canSubmit} icon={isForgot ? Send : isSignup ? UserPlus : LogIn}>
          {isForgot ? 'Gửi link đặt lại' : isSignup ? 'Đăng ký dùng thử' : 'Đăng nhập'}
        </Button>

        {!isForgot && !isSignup && (
          <button type="button" onClick={() => switchMode('forgot')} className="link block w-full text-center text-sm">Quên mật khẩu?</button>
        )}
        {isForgot && (
          <button type="button" onClick={() => switchMode('login')} className="inline-flex w-full items-center justify-center gap-1 text-sm text-ink-muted hover:text-ink">
            <ArrowLeft size={14} /> Quay lại đăng nhập
          </button>
        )}
      </form>
    </AuthShell>
  );
}
