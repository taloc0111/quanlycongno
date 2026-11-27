import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, LogOut, Menu, Sparkles, X } from 'lucide-react';
import { ZALO_URL, ZALO_ENABLED } from '../utils/contact';
import { storage } from '../services/client';

const ROLE_LABEL = { admin: 'Quản trị viên', agency: 'Đại lý cấp 1', user: 'Đại lý cấp 2' };

function NavList({ groups, activeKey, onSelect, collapsed }) {
  return (
    <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
      {groups.map((g) => (
        <div key={g.name}>
          {!collapsed && (
            <p className="px-3 mb-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{g.name}</p>
          )}
          <div className="space-y-0.5">
            {g.items.map((item) => {
              const Icon = item.icon;
              const active = item.key === activeKey;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onSelect(item.key)}
                  title={collapsed ? item.label : undefined}
                  className={`relative w-full flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition
                    ${collapsed ? 'justify-center' : ''}
                    ${active ? 'bg-white/10 text-white shadow-inner' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
                >
                  {active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-brand-400" />}
                  <Icon size={18} className={active ? 'text-brand-300' : ''} />
                  {!collapsed && <span className="flex-1 text-left truncate">{item.label}</span>}
                  {item.badge ? (
                    <span className={`inline-flex items-center justify-center rounded-full bg-danger-500 text-white text-[10.5px] font-bold ${collapsed ? 'absolute -top-1 -right-1 h-4 min-w-[16px] px-1' : 'h-5 min-w-[20px] px-1.5'}`}>
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function Brand({ collapsed }) {
  return (
    <div className={`flex items-center gap-2.5 px-4 py-4 ${collapsed ? 'justify-center' : ''}`}>
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow">
        <Sparkles size={18} />
      </span>
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <p className="text-[15px] font-extrabold text-white tracking-tight">Quản Lý Công Nợ</p>
          <p className="text-[11px] text-slate-400">Đại lý vé & dịch vụ</p>
        </div>
      )}
    </div>
  );
}

function UserBox({ user, onLogout, collapsed }) {
  const initials = (user?.fullName || user?.username || '?').trim().charAt(0).toUpperCase();
  return (
    <div className="border-t border-white/10 p-3">
      <div className={`flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/30 text-brand-100 font-bold">
          {initials}
        </span>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-white">{user?.fullName || user?.username}</p>
            <p className="truncate text-[11px] text-slate-400">{ROLE_LABEL[user?.role] || 'Đã đăng nhập'}</p>
          </div>
        )}
        <button
          type="button"
          onClick={onLogout}
          title="Đăng xuất"
          aria-label="Đăng xuất"
          className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white transition"
        >
          <LogOut size={16} />
        </button>
      </div>
    </div>
  );
}

/**
 * Vỏ ứng dụng: sidebar tối (thu gọn được) + topbar mobile + banner dùng thử.
 * Props: nav [{key,label,icon,group,badge}], activeKey, onSelect, user, trialDaysLeft, onLogout, children.
 */
export default function Layout({ nav, activeKey, onSelect, user, trialDaysLeft, onLogout, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => storage.get('sidebar:collapsed') === '1');

  useEffect(() => { storage.set('sidebar:collapsed', collapsed ? '1' : '0'); }, [collapsed]);
  // Chọn trang thì đóng drawer mobile.
  const select = (key) => { setMobileOpen(false); onSelect(key); };

  const groups = [];
  for (const item of nav) {
    let g = groups.find((x) => x.name === item.group);
    if (!g) { g = { name: item.group, items: [] }; groups.push(g); }
    g.items.push(item);
  }
  const activeLabel = nav.find((n) => n.key === activeKey)?.label || '';
  const sideW = collapsed ? 'md:w-[72px]' : 'md:w-64';
  const mainML = collapsed ? 'md:ml-[72px]' : 'md:ml-64';

  return (
    <div className="min-h-screen bg-surface-muted">
      {/* Sidebar desktop */}
      <aside className={`hidden md:flex fixed inset-y-0 left-0 ${sideW} flex-col bg-slate-900 z-40 transition-[width] duration-200`}>
        <Brand collapsed={collapsed} />
        <NavList groups={groups} activeKey={activeKey} onSelect={select} collapsed={collapsed} />
        <UserBox user={user} onLogout={onLogout} collapsed={collapsed} />
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'}
          aria-label={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'}
          className="absolute -right-3 top-6 inline-flex h-6 w-6 items-center justify-center rounded-full border border-surface-border bg-white text-ink-muted shadow hover:text-ink"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </aside>

      {/* Drawer mobile */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="w-72 max-w-[85vw] flex flex-col bg-slate-900 shadow-pop animate-fade-in">
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <button type="button" onClick={() => setMobileOpen(false)} aria-label="Đóng menu" className="p-2 text-slate-400 hover:text-white"><X size={20} /></button>
            </div>
            <NavList groups={groups} activeKey={activeKey} onSelect={select} />
            <UserBox user={user} onLogout={onLogout} />
          </div>
          <div className="flex-1 bg-ink/50 backdrop-blur-[1px]" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      {/* Vùng nội dung */}
      <div className={`${mainML} transition-[margin] duration-200 flex min-h-screen flex-col`}>
        <header className="md:hidden sticky top-0 z-30 flex items-center gap-3 bg-slate-900 text-white px-3 py-2.5 shadow">
          <button type="button" onClick={() => setMobileOpen(true)} aria-label="Mở menu" className="rounded-lg p-1.5 hover:bg-white/10"><Menu size={22} /></button>
          <span className="font-semibold text-[15px]">{activeLabel}</span>
        </header>
        {trialDaysLeft !== null && trialDaysLeft !== undefined && (
          <div className={`px-4 py-1.5 text-[13px] font-medium text-center ${trialDaysLeft <= 0 ? 'bg-danger-600 text-white' : trialDaysLeft <= 3 ? 'bg-warning-500 text-white' : 'bg-brand-50 text-brand-800 border-b border-brand-100'}`}>
            {trialDaysLeft <= 0 ? '⛔ Tài khoản dùng thử đã hết hạn. ' : `🎁 Bản dùng thử — còn ${trialDaysLeft} ngày. `}
            {ZALO_ENABLED && (
              <a href={ZALO_URL} target="_blank" rel="noopener noreferrer" className="underline font-bold">Liên hệ nâng cấp qua Zalo</a>
            )}
          </div>
        )}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
