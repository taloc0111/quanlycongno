import { useState } from 'react';
import { LogOut, Menu } from 'lucide-react';

/**
 * Vỏ ứng dụng với sidebar trái cố định (desktop) + thanh trên có nút menu (mobile).
 * Props:
 *  - nav: [{ key, label, icon, group }]
 *  - activeKey, onSelect(key)
 *  - user: { username, fullName }
 *  - onLogout: () => void
 *  - children: nội dung module đang chọn
 */
export default function Layout({ nav, activeKey, onSelect, user, onLogout, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  // Gom nav theo nhóm, giữ thứ tự xuất hiện.
  const groups = [];
  for (const item of nav) {
    let g = groups.find((x) => x.name === item.group);
    if (!g) { g = { name: item.group, items: [] }; groups.push(g); }
    g.items.push(item);
  }

  const activeLabel = nav.find((n) => n.key === activeKey)?.label || '';
  const ROLE_LABEL = { admin: 'Quản trị viên', agency: 'Đại lý cấp 1', user: 'Đại lý cấp 2' };
  const roleLabel = ROLE_LABEL[user?.role] || 'Đã đăng nhập';

  const NavList = () => (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
      {groups.map((g) => (
        <div key={g.name}>
          <p className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-white/40">{g.name}</p>
          <div className="space-y-1">
            {g.items.map((item) => {
              const Icon = item.icon;
              const active = item.key === activeKey;
              return (
                <button
                  key={item.key}
                  onClick={() => { onSelect(item.key); setMobileOpen(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                    active ? 'bg-white text-indigo-700 shadow' : 'text-white/80 hover:bg-white/10'
                  }`}
                >
                  <Icon size={18} /> {item.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const SidebarInner = () => (
    <>
      <div className="px-5 py-5 border-b border-white/10">
        <h1 className="text-base font-bold text-white leading-tight">Hệ Thống Quản Lý Công Nợ</h1>
        <p className="text-xs text-white/60">{user?.fullName || user?.username || 'Đại Lý Vé Máy Bay'}</p>
      </div>
      <NavList />
      <div className="border-t border-white/10 px-4 py-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-white font-semibold uppercase">
            {(user?.fullName || user?.username || '?').charAt(0)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{user?.fullName || user?.username}</p>
            <p className="text-xs text-white/50">{roleLabel}</p>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition"
        >
          <LogOut size={16} /> Đăng xuất
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar desktop */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-64 flex-col bg-gradient-to-b from-indigo-700 to-purple-800 z-40">
        <SidebarInner />
      </aside>

      {/* Drawer mobile */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="w-64 flex flex-col bg-gradient-to-b from-indigo-700 to-purple-800">
            <SidebarInner />
          </div>
          <div className="flex-1 bg-black/50" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      {/* Vùng nội dung */}
      <div className="md:ml-64">
        {/* Topbar mobile */}
        <header className="md:hidden sticky top-0 z-30 flex items-center gap-3 bg-indigo-700 text-white px-4 py-3 shadow">
          <button onClick={() => setMobileOpen(true)}><Menu size={22} /></button>
          <span className="font-semibold">{activeLabel}</span>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
