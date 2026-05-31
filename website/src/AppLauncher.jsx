import { useState } from 'react';
import { LayoutDashboard, FileText, BookOpen, Users, Receipt, Network, UserCircle } from 'lucide-react';
import { useAuth } from './auth/AuthContext.jsx';
import LoginPage from './auth/LoginPage.jsx';
import Layout from './components/Layout.jsx';
import DashboardApp from './DashboardApp.jsx';
import DebtApp from './DebtApp.jsx';
import PassportApp from './PassportApp.jsx';
import CustomerApp from './CustomerApp.jsx';
import InvoiceApp from './InvoiceApp.jsx';
import AgencyApp from './AgencyApp.jsx';
import ProfileApp from './ProfileApp.jsx';

// roles: nếu có → chỉ hiện với các role này. Không có → hiện cho tất cả.
const NAV = [
  { key: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard, group: 'Tổng quan', Component: DashboardApp },
  { key: 'debt', label: 'Công nợ vé', icon: FileText, group: 'Nghiệp vụ', Component: DebtApp },
  { key: 'passport', label: 'Hộ chiếu', icon: BookOpen, group: 'Nghiệp vụ', Component: PassportApp },
  { key: 'customer', label: 'Khách hàng', icon: Users, group: 'Danh mục', Component: CustomerApp },
  { key: 'invoice', label: 'Hóa đơn', icon: Receipt, group: 'Tài chính', Component: InvoiceApp },
  { key: 'agency', label: 'Đại lý', icon: Network, group: 'Hệ thống', Component: AgencyApp, roles: ['admin', 'agency'] },
  { key: 'profile', label: 'Hồ sơ', icon: UserCircle, group: 'Hệ thống', Component: ProfileApp },
];

export default function AppLauncher() {
  const { isAuthenticated, user, logout } = useAuth();
  const [active, setActive] = useState('dashboard');

  if (!isAuthenticated) return <LoginPage />;

  const nav = NAV.filter((n) => !n.roles || n.roles.includes(user?.role));
  const ActiveComponent = (nav.find((n) => n.key === active) || nav[0]).Component;

  return (
    <Layout nav={nav} activeKey={active} onSelect={setActive} user={user} onLogout={logout}>
      <ActiveComponent />
    </Layout>
  );
}
