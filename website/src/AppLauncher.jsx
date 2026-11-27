import { useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard, FileText, BookOpen, Users, Receipt, Network, UserCircle, Landmark, StickyNote,
  PlaneTakeoff, PlaneLanding, Train, Palmtree, Search, History, Wallet, Truck, PiggyBank,
} from 'lucide-react';
import { useAuth } from './auth/AuthContext.jsx';
import { useNavigation } from './hooks/useNavigation.jsx';
import { apiGet } from './services/client';
import { today, addDays, normalizeYmd } from './utils/format';
import LoginPage from './auth/LoginPage.jsx';
import ResetPasswordPage from './auth/ResetPasswordPage.jsx';
import TrialExpired from './components/TrialExpired.jsx';
import Layout from './components/Layout.jsx';
import DashboardApp from './DashboardApp.jsx';
import DebtApp from './DebtApp.jsx';
import PassportApp from './PassportApp.jsx';
import CustomerApp from './CustomerApp.jsx';
import InvoiceApp from './InvoiceApp.jsx';
import DepositApp from './DepositApp.jsx';
import AgencyApp from './AgencyApp.jsx';
import ProfileApp from './ProfileApp.jsx';
import NotesApp from './NotesApp.jsx';
import TicketWatchApp from './TicketWatchApp.jsx';
import FareCheckApp from './FareCheckApp.jsx';
import UpcomingFlightsApp from './UpcomingFlightsApp.jsx';
import AirlinesApp from './AirlinesApp.jsx';
import TrainApp from './TrainApp.jsx';
import TourApp from './TourApp.jsx';
import AuditApp from './AuditApp.jsx';
import AccountsApp from './AccountsApp.jsx';
import SuppliersApp from './SuppliersApp.jsx';
import WalletsApp from './WalletsApp.jsx';

// roles: chỉ hiện với các role này. feature: chỉ hiện khi tài khoản được bật tính năng
// (admin luôn có). Không có → hiện cho tất cả.
const NAV = [
  { key: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard, group: 'Tổng quan', Component: DashboardApp },
  { key: 'notes', label: 'Ghi chú', icon: StickyNote, group: 'Tổng quan', Component: NotesApp },
  { key: 'debt', label: 'Công nợ vé', icon: FileText, group: 'Nghiệp vụ', Component: DebtApp },
  { key: 'train', label: 'Vé tàu hỏa', icon: Train, group: 'Nghiệp vụ', Component: TrainApp },
  { key: 'tour', label: 'Du lịch', icon: Palmtree, group: 'Nghiệp vụ', Component: TourApp },
  { key: 'passport', label: 'Hộ chiếu', icon: BookOpen, group: 'Nghiệp vụ', Component: PassportApp },
  { key: 'upcoming', label: 'Sắp bay', icon: PlaneLanding, group: 'Nghiệp vụ', Component: UpcomingFlightsApp },
  { key: 'ticketWatch', label: 'Canh vé', icon: PlaneTakeoff, group: 'Canh vé', Component: TicketWatchApp, feature: 'fareWatch' },
  { key: 'fareCheck', label: 'Check vé', icon: Search, group: 'Canh vé', Component: FareCheckApp, feature: 'fareWatch' },
  { key: 'accounts', label: 'Tài khoản', icon: Wallet, group: 'Dòng tiền', Component: AccountsApp },
  { key: 'suppliers', label: 'Nhà cung cấp', icon: Truck, group: 'Dòng tiền', Component: SuppliersApp },
  { key: 'wallets', label: 'Ví trả trước', icon: PiggyBank, group: 'Dòng tiền', Component: WalletsApp },
  { key: 'customer', label: 'Khách hàng', icon: Users, group: 'Danh mục', Component: CustomerApp },
  { key: 'airlines', label: 'Hãng bay', icon: PlaneTakeoff, group: 'Danh mục', Component: AirlinesApp },
  { key: 'invoice', label: 'Hóa đơn', icon: Receipt, group: 'Tài chính', Component: InvoiceApp },
  { key: 'deposit', label: 'Nộp quỹ', icon: Landmark, group: 'Tài chính', Component: DepositApp },
  { key: 'agency', label: 'Đại lý', icon: Network, group: 'Hệ thống', Component: AgencyApp, roles: ['admin', 'agency'] },
  { key: 'audit', label: 'Nhật ký', icon: History, group: 'Hệ thống', Component: AuditApp, roles: ['admin', 'agency'] },
  { key: 'profile', label: 'Hồ sơ', icon: UserCircle, group: 'Hệ thống', Component: ProfileApp },
];

export default function AppLauncher() {
  const { isAuthenticated, user, logout, hasFeature, trialDaysLeft, trialExpired } = useAuth();
  const { key: active, param, navigate } = useNavigation();
  const [tomorrowCount, setTomorrowCount] = useState(0);

  // Đếm khách bay NGÀY MAI chưa check-in → badge trên menu "Sắp bay".
  // Chỉ tải 1 lần khi đăng nhập + mỗi 5 phút (không tải lại mỗi lần đổi tab).
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let cancelled = false;
    const tick = () => {
      const tmrw = addDays(today(), 1);
      apiGet('/debts')
        .then((rows) => {
          if (cancelled) return;
          setTomorrowCount(rows.filter((r) => normalizeYmd(r.flight_date) === tmrw && !r.checked_in).length);
        })
        .catch(() => {});
    };
    tick();
    const t = setInterval(tick, 5 * 60 * 1000);
    const onChanged = () => tick();
    window.addEventListener('data:debts-changed', onChanged);
    return () => { cancelled = true; clearInterval(t); window.removeEventListener('data:debts-changed', onChanged); };
  }, [isAuthenticated]);

  const nav = useMemo(() => NAV
    .filter((n) => !n.roles || n.roles.includes(user?.role))
    .filter((n) => !n.feature || hasFeature(n.feature))
    .map((n) => (n.key === 'upcoming' && tomorrowCount ? { ...n, badge: tomorrowCount } : n)), [user?.role, hasFeature, tomorrowCount]);

  // Link đặt lại mật khẩu: /?reset=<token> → hiện trang đổi mật khẩu (kể cả khi chưa đăng nhập).
  const resetToken = new URLSearchParams(window.location.search).get('reset');
  if (resetToken) return <ResetPasswordPage token={resetToken} />;

  if (!isAuthenticated) return <LoginPage />;

  // Chặn app khi hết hạn dùng thử (server vẫn là nguồn chính; đây là UX phía client).
  if (trialExpired) return <TrialExpired user={user} onLogout={logout} />;

  const current = nav.find((n) => n.key === active) || nav[0];
  const ActiveComponent = current.Component;

  return (
    <Layout nav={nav} activeKey={current.key} onSelect={(k) => navigate(k)} user={user} trialDaysLeft={trialDaysLeft} onLogout={logout}>
      <ActiveComponent key={current.key} param={param} />
    </Layout>
  );
}
