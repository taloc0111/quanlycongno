import { ReceiptText, Trash2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useFeedback } from '../../ui/FeedbackContext';
import { Badge, ErrorBanner, IconButton, Skeleton } from '../../ui';
import { methodLabel, receiptsApi } from '../../services/money';
import { formatCurrency, formatDate, num } from '../../utils/format';
import { isOwnedBy } from './moneyUtils';

/** Tóm tắt các vé được chia trong 1 phiếu thu: "VN123 HAN-SGN 1.000.000 ₫ · Hộ chiếu 500.000 ₫". */
const allocationSummary = (r) => (r.allocations || [])
  .map((a) => `${a.label || a.type} ${formatCurrency(a.amount)}`)
  .join(' · ');

/**
 * Danh sách phiếu thu nhiều vé của 1 khách (cha tải bằng receiptsApi.list({ customerId })).
 * Props: receipts (null = đang tải), error, onRetry, onChanged() sau khi xoá.
 */
export default function CustomerReceipts({ receipts, error, onRetry, onChanged }) {
  const { user } = useAuth();
  const { toast, confirm } = useFeedback();

  const remove = async (r) => {
    const ok = await confirm({
      title: 'Xoá phiếu thu',
      message: `Xoá phiếu thu ${formatCurrency(r.amount)} ngày ${formatDate(r.receipt_date)}? Các khoản trả vào vé${num(r.wallet_amount) > 0 ? ' và phần vào ví' : ''} của phiếu cũng bị xoá.`,
      confirmText: 'Xoá',
      danger: true,
    });
    if (!ok) return;
    try {
      await receiptsApi.remove(r.id);
      toast.success('Đã xoá phiếu thu');
      onChanged?.();
    } catch (err) { toast.error(err.message); }
  };

  if (error) return <div className="mb-4"><ErrorBanner message={error} onRetry={onRetry} /></div>;
  if (receipts === null) return <div className="card mb-4 p-4"><Skeleton className="h-4 w-48 mb-2" /><Skeleton className="h-4 w-full" /></div>;
  if (!receipts.length) return null;

  return (
    <div className="card mb-4 overflow-hidden" data-testid="customer-receipts">
      <div className="flex items-center gap-2 border-b border-surface-border px-4 py-2.5">
        <ReceiptText size={15} className="text-ink-muted" />
        <h4 className="text-sm font-semibold text-ink">Phiếu thu nhiều vé</h4>
        <Badge tone="brand">{receipts.length}</Badge>
      </div>
      <ul className="divide-y divide-surface-border">
        {receipts.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
            <div className="min-w-0">
              <p className="font-medium text-ink">
                {formatDate(r.receipt_date)}
                <span className="text-ink-muted font-normal">{[r.account_name, r.method ? methodLabel(r.method) : ''].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>
              </p>
              <p className="text-xs text-ink-muted truncate" title={allocationSummary(r)}>{allocationSummary(r) || 'Không chia vào vé nào'}</p>
              {num(r.wallet_amount) > 0 && <p className="text-xs text-success-700">Vào ví {formatCurrency(r.wallet_amount)}</p>}
              {r.notes && <p className="text-xs text-ink-faint truncate">{r.notes}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="font-bold tabular text-success-600">{formatCurrency(r.amount)}</span>
              {isOwnedBy(r, user) && <IconButton icon={Trash2} title="Xoá phiếu thu" variant="danger" onClick={() => remove(r)} />}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
