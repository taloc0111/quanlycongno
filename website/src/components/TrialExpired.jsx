import { LogOut, AlertTriangle, MessageCircle } from 'lucide-react';
import { ZALO_URL, ZALO_ENABLED, ZALO_NUMBER } from '../utils/contact';
import { AuthShell } from '../auth/LoginPage';
import { Button, Badge } from '../ui';

// Màn chặn khi tài khoản dùng thử đã hết hạn (thay vì để các trang lỗi 403 lung tung).
export default function TrialExpired({ user, onLogout }) {
  return (
    <AuthShell footer={ZALO_ENABLED ? `Hỗ trợ: Zalo ${ZALO_NUMBER}` : null}>
      <div className="text-center">
        <span className="mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-warning-50 text-warning-600">
          <AlertTriangle size={32} />
        </span>
        <Badge tone="warning" dot>Hết hạn dùng thử</Badge>
        <h1 className="mt-3 text-xl font-bold tracking-tight text-ink">Thời gian dùng thử đã kết thúc</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Tài khoản <b className="text-ink">{user?.username}</b> đã hết 14 ngày dùng thử.
          Dữ liệu của bạn vẫn được giữ nguyên — liên hệ để nâng cấp và tiếp tục sử dụng.
        </p>
        <div className="mt-6 space-y-2">
          {ZALO_ENABLED && (
            <Button
              block
              size="lg"
              icon={MessageCircle}
              className="bg-[#0068FF] hover:bg-[#0054d6] focus-visible:ring-[#0068FF]/40"
              onClick={() => window.open(ZALO_URL, '_blank', 'noopener,noreferrer')}
            >
              Liên hệ nâng cấp qua Zalo
            </Button>
          )}
          <Button block variant="secondary" icon={LogOut} onClick={onLogout}>Đăng xuất</Button>
        </div>
      </div>
    </AuthShell>
  );
}
