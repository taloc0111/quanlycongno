import { useState } from 'react';
import { Plane, Lock, User, IdCard, Mail } from 'lucide-react';
import { useAuth } from './AuthContext';

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-10 text-center text-white">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-2xl mb-4">
            <Plane size={32} />
          </div>
          <h1 className="text-2xl font-bold">Hệ Thống Quản Lý Công Nợ</h1>
          <p className="text-blue-100 text-sm mt-1">
            {isSignup ? 'Đăng ký dùng thử miễn phí 14 ngày' : isForgot ? 'Khôi phục mật khẩu qua email' : 'Giải pháp quản lý công nợ thông minh'}
          </p>
        </div>

        {!isForgot && (
          <div className="flex border-b">
            <button type="button" onClick={() => switchMode('login')} className={`flex-1 py-3 text-sm font-semibold transition ${!isSignup ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>Đăng nhập</button>
            <button type="button" onClick={() => switchMode('signup')} className={`flex-1 py-3 text-sm font-semibold transition ${isSignup ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>Dùng thử 14 ngày</button>
          </div>
        )}

        <form onSubmit={submit} className="px-8 py-6 space-y-4">
          {isForgot ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email đã đăng ký</label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 text-gray-400" size={18} />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full pl-10 pr-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none" placeholder="email@cua-ban.com" autoFocus />
              </div>
            </div>
          ) : (
            <>
              {isSignup && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Họ tên</label>
                  <div className="relative">
                    <IdCard className="absolute left-3 top-3 text-gray-400" size={18} />
                    <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full pl-10 pr-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none" placeholder="Nguyễn Văn A" />
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tên đăng nhập</label>
                <div className="relative">
                  <User className="absolute left-3 top-3 text-gray-400" size={18} />
                  <input value={username} onChange={(e) => setUsername(e.target.value)} className="w-full pl-10 pr-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none" placeholder={isSignup ? 'Chọn tên đăng nhập' : 'admin'} autoFocus />
                </div>
              </div>
              {isSignup && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email <span className="text-xs text-gray-400">(để khôi phục mật khẩu)</span></label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 text-gray-400" size={18} />
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full pl-10 pr-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none" placeholder="email@cua-ban.com" />
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mật khẩu</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 text-gray-400" size={18} />
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full pl-10 pr-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none" placeholder={isSignup ? 'Ít nhất 6 ký tự' : '••••••••'} />
                </div>
              </div>
              {isSignup && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nhập lại mật khẩu</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 text-gray-400" size={18} />
                    <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full pl-10 pr-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none" placeholder="••••••••" />
                  </div>
                </div>
              )}
            </>
          )}

          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">{error}</div>}
          {info && <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-2.5 text-sm text-green-700">{info}</div>}

          <button type="submit" disabled={loading || (isForgot ? !email : (!username || !password || (isSignup && !confirm)))} className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50">
            {loading ? 'Đang xử lý…' : isForgot ? 'Gửi link đặt lại' : isSignup ? 'Đăng ký dùng thử' : 'Đăng nhập'}
          </button>

          {!isForgot && !isSignup && (
            <button type="button" onClick={() => switchMode('forgot')} className="block w-full text-center text-sm text-blue-600 hover:underline">Quên mật khẩu?</button>
          )}
          {isForgot && (
            <button type="button" onClick={() => switchMode('login')} className="block w-full text-center text-sm text-gray-500 hover:underline">← Quay lại đăng nhập</button>
          )}
          {isSignup && <p className="text-xs text-center text-gray-400">Miễn phí 14 ngày · không cần thẻ tín dụng</p>}
        </form>
      </div>
    </div>
  );
}
