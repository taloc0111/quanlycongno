import { useState } from 'react';
import { Lock, CheckCircle, Plane } from 'lucide-react';
import { useAuth } from './AuthContext';

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-8 text-center text-white">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-2xl mb-3"><Plane size={30} /></div>
          <h1 className="text-xl font-bold">Đặt lại mật khẩu</h1>
        </div>

        {done ? (
          <div className="px-8 py-8 text-center space-y-4">
            <CheckCircle size={48} className="mx-auto text-green-500" />
            <p className="text-gray-700">Đổi mật khẩu thành công! Hãy đăng nhập lại bằng mật khẩu mới.</p>
            <button onClick={goLogin} className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700">Đăng nhập</button>
          </div>
        ) : (
          <form onSubmit={submit} className="px-8 py-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mật khẩu mới</label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 text-gray-400" size={18} />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full pl-10 pr-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none" placeholder="Ít nhất 6 ký tự" autoFocus />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nhập lại mật khẩu</label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 text-gray-400" size={18} />
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full pl-10 pr-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none" placeholder="••••••••" />
              </div>
            </div>
            {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">{error}</div>}
            <button type="submit" disabled={loading || !password || !confirm} className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg font-semibold hover:shadow-lg transition disabled:opacity-50">
              {loading ? 'Đang xử lý…' : 'Đặt lại mật khẩu'}
            </button>
            <button type="button" onClick={goLogin} className="block w-full text-center text-sm text-gray-500 hover:underline">← Về trang đăng nhập</button>
          </form>
        )}
      </div>
    </div>
  );
}
