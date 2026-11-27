import { useEffect, useMemo, useState } from 'react';
import { FileText, Printer, Copy } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useFeedback } from '../ui/FeedbackContext';
import { formatCurrency, formatDate, today, addDays } from '../utils/format';
import { Button, Modal, Field, DateField, Select } from '../ui';
import BankQR from '../components/BankQR';
import { accountQrInfo, cleanContent } from '../utils/vietqr';
import { accountsApi, methodLabel } from '../services/money';
import { storage } from '../services/client';

// Khi in: chỉ hiện .print-area (ẩn mọi thứ khác bằng visibility để không cần sửa Layout).
const PRINT_CSS = `
@media print {
  body { overflow: visible !important; }
  body * { visibility: hidden !important; }
  .print-area, .print-area * { visibility: visible !important; }
  .print-area { position: absolute !important; left: 0; top: 0; width: 100%; max-height: none !important; overflow: visible !important; }
  .print-area table { page-break-inside: auto; }
  .print-area tr { page-break-inside: avoid; }
}`;

/**
 * Bảng kê công nợ in được của 1 khách. Nhận dữ liệu đã chuẩn hoá từ CustomerDetail.
 * Props: open, onClose, customer, transactions (normalizeTransactions), payments, totals, from, to, onCopied.
 */
export default function CustomerStatement({ open, onClose, customer, transactions = [], payments = [], totals, from, to, onCopied }) {
  const { user } = useAuth();
  const { toast } = useFeedback();
  const [dueDate, setDueDate] = useState(() => addDays(today(), 7));

  // Tài khoản dùng cho mã QR: chỉ TK ngân hàng của mình, đủ thông tin; mặc định TK dùng gần nhất.
  const [accounts, setAccounts] = useState([]);
  const [qrAccountId, setQrAccountId] = useState('');
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    accountsApi.list().then((list) => {
      if (cancelled) return;
      const usable = (list || []).filter((a) => !a.archived && a.is_own !== false && accountQrInfo(a).ok);
      setAccounts(usable);
      const last = storage.get('payment:lastAccount');
      setQrAccountId((cur) => cur || String((usable.find((a) => String(a.id) === last) || usable[0])?.id || ''));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open]);
  const qrAccounts = accounts;
  const qrAccount = accounts.find((a) => String(a.id) === String(qrAccountId)) || null;
  const qrBankName = qrAccount ? accountQrInfo(qrAccount).bank?.name : '';
  const qrContent = `${customer.name || ''} ${customer.phone || ''} thanh toan`;

  const shopName = user?.fullName || user?.username || '';
  const outstanding = useMemo(() => transactions.filter((t) => t.remaining > 0), [transactions]);
  const sumOutstanding = outstanding.reduce((s, t) => s + t.remaining, 0);
  const sumSold = outstanding.reduce((s, t) => s + t.sold, 0);
  const sumPaid = outstanding.reduce((s, t) => s + t.paid, 0);
  const sumPayments = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const period = from || to ? `Từ ${from ? formatDate(from) : '…'} đến ${to ? formatDate(to) : '…'}` : 'Toàn bộ thời gian';

  const summaryText = () => {
    const lines = [
      `BẢNG KÊ CÔNG NỢ - ${shopName}`,
      `Khách hàng: ${customer.name}${customer.phone ? ` (${customer.phone})` : ''}`,
      `Kỳ: ${period}`,
      '',
    ];
    if (outstanding.length === 0) lines.push('Khách không còn nợ giao dịch nào. Cảm ơn quý khách!');
    else {
      lines.push('Giao dịch còn nợ:');
      outstanding.forEach((t, i) => {
        lines.push(`${i + 1}. ${formatDate(t.date)} - ${t.typeLabel}: ${t.desc} - ${formatCurrency(t.sold)}${t.paid > 0 ? ` (đã trả ${formatCurrency(t.paid)})` : ''} → còn ${formatCurrency(t.remaining)}`);
      });
      lines.push('', `TỔNG CÒN NỢ: ${formatCurrency(sumOutstanding)}`);
      lines.push(`Vui lòng thanh toán trước ngày ${formatDate(dueDate)}.`);
      if (qrAccount) {
        lines.push(`Chuyển khoản: ${qrBankName} - ${qrAccount.account_number}${qrAccount.holder_name ? ` - ${qrAccount.holder_name}` : ''}`);
        lines.push(`Nội dung: ${cleanContent(qrContent)}`);
      }
    }
    lines.push('', `Tổng mua trong kỳ: ${formatCurrency(totals?.sold)} · Đã trả: ${formatCurrency(totals?.paid)} · Còn nợ: ${formatCurrency(totals?.outstanding)}`);
    return lines.join('\n');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summaryText());
      onCopied ? onCopied() : toast.success('Đã sao chép tóm tắt');
    } catch {
      toast.error('Không sao chép được. Hãy chọn và copy thủ công.');
    }
  };

  const print = () => window.print();

  const td = 'border border-slate-300 px-2 py-1.5 align-top';
  const th = 'border border-slate-300 bg-slate-100 px-2 py-1.5 text-left font-semibold';

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={FileText}
      title="Bảng kê công nợ"
      subtitle={customer.name}
      size="xl"
      footer={(
        <div className="no-print flex flex-wrap items-center gap-2 w-full justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Field label="Hạn thanh toán ghi trên bảng kê" className="flex items-center gap-2 [&>label]:mb-0">
              <DateField value={dueDate} onChange={setDueDate} className="w-36 input-sm" />
            </Field>
            {qrAccounts.length > 0 && (
              <Field label="QR vào TK" htmlFor="stmt-qr-account" className="flex items-center gap-2 [&>label]:mb-0">
                <Select id="stmt-qr-account" size="sm" value={qrAccountId} onChange={(e) => setQrAccountId(e.target.value)} className="w-48">
                  <option value="">Không in QR</option>
                  {qrAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.account_number}</option>)}
                </Select>
              </Field>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Đóng</Button>
            <Button variant="secondary" icon={Copy} onClick={copy}>Sao chép tóm tắt</Button>
            <Button icon={Printer} onClick={print}>In / Lưu PDF</Button>
          </div>
        </div>
      )}
    >
      <style>{PRINT_CSS}</style>
      <div className="print-area bg-white text-[13px] text-slate-900 leading-snug">
        {/* Đầu bảng kê */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 border-b-2 border-slate-800 pb-3">
          <div>
            <p className="text-base font-bold uppercase">{shopName}</p>
            {user?.email && <p className="text-slate-600">{user.email}</p>}
          </div>
          <div className="sm:text-right">
            <p className="text-xl font-extrabold tracking-wide">BẢNG KÊ CÔNG NỢ</p>
            <p className="text-slate-600">Ngày lập: {formatDate(today())}</p>
          </div>
        </div>

        {/* Thông tin khách + kỳ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 py-3">
          <p><span className="text-slate-500">Khách hàng:</span> <b>{customer.name}</b></p>
          <p><span className="text-slate-500">Kỳ đối chiếu:</span> {period}</p>
          {customer.phone && <p><span className="text-slate-500">Điện thoại:</span> {customer.phone}</p>}
          {customer.email && <p><span className="text-slate-500">Email:</span> {customer.email}</p>}
          {customer.address && <p className="sm:col-span-2"><span className="text-slate-500">Địa chỉ:</span> {customer.address}</p>}
          {customer.id_number && <p><span className="text-slate-500">CCCD:</span> {customer.id_number}</p>}
        </div>

        {/* Giao dịch còn nợ */}
        <p className="font-bold mt-1 mb-1.5">1. Giao dịch còn nợ</p>
        {outstanding.length === 0 ? (
          <p className="rounded border border-dashed border-slate-300 px-3 py-3 text-center text-slate-600">Khách không còn nợ giao dịch nào trong kỳ này.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr>
                  <th className={`${th} w-8 text-center`}>#</th>
                  <th className={`${th} w-24`}>Ngày</th>
                  <th className={th}>Nội dung</th>
                  <th className={`${th} text-right w-28`}>Thành tiền</th>
                  <th className={`${th} text-right w-28`}>Đã trả</th>
                  <th className={`${th} text-right w-28`}>Còn lại</th>
                </tr>
              </thead>
              <tbody>
                {outstanding.map((t, i) => (
                  <tr key={t.id}>
                    <td className={`${td} text-center`}>{i + 1}</td>
                    <td className={td}>{formatDate(t.date)}</td>
                    <td className={td}><span className="text-slate-500">{t.typeLabel}:</span> {t.desc}{t.due ? <span className="text-slate-500"> (hạn {formatDate(t.due)})</span> : null}</td>
                    <td className={`${td} text-right tabular`}>{formatCurrency(t.sold)}</td>
                    <td className={`${td} text-right tabular`}>{formatCurrency(t.paid)}</td>
                    <td className={`${td} text-right tabular font-semibold`}>{formatCurrency(t.remaining)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold bg-slate-50">
                  <td className={td} colSpan={3}>Tổng cộng ({outstanding.length} giao dịch)</td>
                  <td className={`${td} text-right tabular`}>{formatCurrency(sumSold)}</td>
                  <td className={`${td} text-right tabular`}>{formatCurrency(sumPaid)}</td>
                  <td className={`${td} text-right tabular text-red-700`}>{formatCurrency(sumOutstanding)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Thanh toán trong kỳ */}
        <p className="font-bold mt-4 mb-1.5">2. Thanh toán đã nhận trong kỳ</p>
        {payments.length === 0 ? (
          <p className="text-slate-600 italic">Chưa ghi nhận thanh toán nào trong kỳ.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${th} w-24`}>Ngày</th>
                <th className={th}>Cho giao dịch</th>
                <th className={`${th} w-28`}>Hình thức</th>
                <th className={`${th} text-right w-28`}>Số tiền</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className={td}>{formatDate(p.payment_date)}</td>
                  <td className={td}>{p.target_label || '—'}{p.notes ? <span className="text-slate-500"> · {p.notes}</span> : null}</td>
                  <td className={td}>{methodLabel(p.method)}</td>
                  <td className={`${td} text-right tabular`}>{formatCurrency(p.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold bg-slate-50">
                <td className={td} colSpan={3}>Tổng đã nhận</td>
                <td className={`${td} text-right tabular`}>{formatCurrency(sumPayments)}</td>
              </tr>
            </tfoot>
          </table>
        )}

        {/* Tổng kết kỳ */}
        <div className="mt-4 grid grid-cols-3 gap-2 rounded border border-slate-300 p-2.5 text-center">
          <div><p className="text-xs text-slate-500 uppercase">Tổng mua</p><p className="font-bold tabular">{formatCurrency(totals?.sold)}</p></div>
          <div><p className="text-xs text-slate-500 uppercase">Đã trả</p><p className="font-bold tabular">{formatCurrency(totals?.paid)}</p></div>
          <div><p className="text-xs text-slate-500 uppercase">Còn nợ</p><p className="font-extrabold tabular text-red-700">{formatCurrency(totals?.outstanding)}</p></div>
        </div>

        {sumOutstanding > 0 && (
          <p className="mt-3 font-semibold">Vui lòng thanh toán trước ngày <u>{formatDate(dueDate)}</u>. Xin cảm ơn quý khách!</p>
        )}

        {/* Mã QR chuyển khoản đúng số còn nợ */}
        {sumOutstanding > 0 && qrAccount && (
          <div className="mt-4 flex items-center gap-4 rounded border border-slate-300 p-3" data-qr-print>
            <BankQR account={qrAccount} amount={sumOutstanding} content={qrContent} size={130} showInfo={false} />
            <div className="text-[13px] leading-relaxed">
              <p className="font-bold">Quét mã để chuyển khoản</p>
              <p>{qrBankName} · <b>{qrAccount.account_number}</b></p>
              {qrAccount.holder_name && <p className="uppercase">{qrAccount.holder_name}</p>}
              <p>Số tiền: <b>{formatCurrency(sumOutstanding)}</b></p>
              <p>Nội dung: {cleanContent(qrContent)}</p>
            </div>
          </div>
        )}

        {/* Ký tên */}
        <div className="mt-8 grid grid-cols-2 gap-6 text-center">
          <div>
            <p className="font-semibold">Khách hàng</p>
            <p className="text-xs text-slate-500">(Ký, ghi rõ họ tên)</p>
            <div className="h-16" />
          </div>
          <div>
            <p className="font-semibold">Người lập</p>
            <p className="text-xs text-slate-500">(Ký, ghi rõ họ tên)</p>
            <div className="h-16" />
            <p>{shopName}</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
