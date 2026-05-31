import React, { useEffect, useState } from 'react';
import { UserCircle, Save, KeyRound } from 'lucide-react';
import { apiGet, apiSend } from './services/client';
import { useAuth } from './auth/AuthContext';

const ROLE_LABEL = { admin: 'Quản trị viên', agency: 'Đại lý cấp 1', user: 'Đại lý / Nhân viên' };

export default function ProfileApp() {
  const { user, updateUser } = useAuth();
  const [profile, setProfile] = useState({ fullName: '', email: '', username: '', role: '' });
  const [pwd, setPwd] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [msg, setMsg] = useState('');
  const [pwdMsg, setPwdMsg] = useState('');

  useEffect(() => {
    apiGet('/auth/profile')
      .then((p) => setProfile({ fullName: p.full_name || '', email: p.email || '', username: p.username, role: p.role }))
      .catch(() => {});
  }, []);

  const saveProfile = async () => {
    setMsg('');
    try {
      const updated = await apiSend('PUT', '/auth/profile', { fullName: profile.fullName, email: profile.email });
      updateUser({ fullName: updated.full_name });
      setMsg('✅ Đã lưu thông tin.');
    } catch (err) { setMsg('❌ ' + err.message); }
  };

  const changePassword = async () => {
    setPwdMsg('');
    if (pwd.newPassword !== pwd.confirm) { setPwdMsg('❌ Mật khẩu mới không khớp'); return; }
    try {
      await apiSend('PUT', '/auth/password', { currentPassword: pwd.currentPassword, newPassword: pwd.newPassword });
      setPwd({ currentPassword: '', newPassword: '', confirm: '' });
      setPwdMsg('✅ Đổi mật khẩu thành công.');
    } catch (err) { setPwdMsg('❌ ' + err.message); }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><UserCircle /> Hồ sơ của tôi</h2>

        <div className="bg-white rounded-2xl shadow p-6 space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-indigo-600 text-white flex items-center justify-center text-2xl font-bold uppercase">
              {(profile.fullName || profile.username || '?').charAt(0)}
            </div>
            <div>
              <p className="font-bold text-lg">{profile.username}</p>
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-semibold">
                {ROLE_LABEL[profile.role] || profile.role}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">Họ và tên</label>
            <input value={profile.fullName} onChange={(e) => setProfile({ ...profile, fullName: e.target.value })} className="w-full border rounded-lg px-3 py-2 focus:border-indigo-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Email</label>
            <input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} className="w-full border rounded-lg px-3 py-2 focus:border-indigo-500 focus:outline-none" />
          </div>
          {msg && <p className="text-sm">{msg}</p>}
          <button onClick={saveProfile} className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold text-sm">
            <Save size={16} /> Lưu thông tin
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow p-6 space-y-4">
          <h3 className="flex items-center gap-2 font-bold text-gray-800"><KeyRound size={18} /> Đổi mật khẩu</h3>
          <input type="password" placeholder="Mật khẩu hiện tại" value={pwd.currentPassword} onChange={(e) => setPwd({ ...pwd, currentPassword: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
          <input type="password" placeholder="Mật khẩu mới (≥ 6 ký tự)" value={pwd.newPassword} onChange={(e) => setPwd({ ...pwd, newPassword: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
          <input type="password" placeholder="Nhập lại mật khẩu mới" value={pwd.confirm} onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
          {pwdMsg && <p className="text-sm">{pwdMsg}</p>}
          <button onClick={changePassword} className="flex items-center gap-2 px-5 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 font-semibold text-sm">
            <KeyRound size={16} /> Đổi mật khẩu
          </button>
        </div>
      </div>
    </div>
  );
}
