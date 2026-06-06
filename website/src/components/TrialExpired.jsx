import { LogOut, AlertTriangle } from 'lucide-react';
import { ZALO_URL, ZALO_ENABLED } from '../utils/contact';

// Màn chặn khi tài khoản dùng thử đã hết hạn (thay vì để các trang lỗi 403 lung tung).
export default function TrialExpired({ user, onLogout }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-gray-200 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden text-center">
        <div className="bg-gradient-to-r from-orange-500 to-red-600 px-8 py-8 text-white">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-2xl mb-3">
            <AlertTriangle size={32} />
          </div>
          <h1 className="text-2xl font-bold">Hết hạn dùng thử</h1>
        </div>
        <div className="px-8 py-6 space-y-4">
          <p className="text-gray-600">
            Tài khoản <b>{user?.username}</b> đã hết 14 ngày dùng thử. Vui lòng liên hệ để nâng cấp và tiếp tục sử dụng.
          </p>
          {ZALO_ENABLED && (
            <a
              href={ZALO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-lg bg-[#0068FF] text-white font-semibold hover:brightness-110 transition"
            >
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white text-[#0068FF] text-xs font-extrabold">Za</span>
              Liên hệ nâng cấp qua Zalo
            </a>
          )}
          <button
            onClick={onLogout}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-gray-100 text-gray-600 font-semibold hover:bg-gray-200 transition"
          >
            <LogOut size={16} /> Đăng xuất
          </button>
        </div>
      </div>
    </div>
  );
}
