import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Download, Printer, QrCode } from 'lucide-react';
import { buildVietQR, accountQrInfo, cleanContent } from '../utils/vietqr';
import { formatCurrency } from '../utils/format';
import { Button, Modal, Field, MoneyField, Input, Select } from '../ui';
import { useFeedback } from '../ui/FeedbackContext';
import { printQr } from '../utils/printQr';

/**
 * Ảnh QR VietQR của 1 tài khoản (tạo trên máy). Không đủ thông tin → hiện lý do.
 * Props: account ({name,bank,account_number,holder_name}), amount, content, size, showInfo.
 */
export default function BankQR({ account, amount, content, size = 220, showInfo = true, className = '' }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  const bankText = account?.bank;
  const accNo = account?.account_number;
  const { info, payload } = useMemo(() => {
    const inf = accountQrInfo({ bank: bankText, account_number: accNo });
    if (!inf.ok) return { info: inf, payload: '' };
    try { return { info: inf, payload: buildVietQR({ bin: inf.bank.bin, accountNumber: accNo, amount, content }) }; }
    catch (e) { return { info: inf, payload: 'ERR:' + e.message }; }
  }, [bankText, accNo, amount, content]);

  useEffect(() => {
    let cancelled = false;
    if (!payload || payload.startsWith('ERR:')) return undefined;
    QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: size * 2 })
      .then((url) => { if (!cancelled) { setSrc(url); setError(''); } })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [payload, size]);

  const reason = !info.ok ? info.reason : payload.startsWith('ERR:') ? payload.slice(4) : error;
  if (reason) {
    return <div className={`rounded-xl border border-dashed border-surface-border bg-surface-muted p-4 text-center text-sm text-ink-muted ${className}`} style={{ maxWidth: size + 40 }}>{reason}</div>;
  }
  return (
    <figure className={`inline-flex flex-col items-center gap-2 ${className}`} data-qr-payload={payload}>
      {src ? <img src={src} alt={`Mã QR chuyển khoản ${account.name}`} width={size} height={size} className="rounded-lg border border-surface-border bg-white" /> : <div style={{ width: size, height: size }} className="rounded-lg bg-surface-subtle animate-pulse" />}
      {showInfo && (
        <figcaption className="text-center leading-tight">
          <p className="text-[13px] font-bold text-ink">{info.bank.name} · {account.account_number}</p>
          {account.holder_name && <p className="text-xs uppercase text-ink-soft">{account.holder_name}</p>}
          {Number(amount) > 0 && <p className="mt-1 text-sm font-bold text-brand-700 tabular">{formatCurrency(amount)}</p>}
          {cleanContent(content) && <p className="text-xs text-ink-muted">ND: {cleanContent(content)}</p>}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * Modal mã QR: chọn tài khoản (nếu truyền danh sách), sửa số tiền/nội dung, tải ảnh, in, sao chép thông tin.
 * Props: open, onClose, accounts (mảng) hoặc account, amount, content, title.
 */
export function QrModal({ open, onClose, accounts, account: fixedAccount, amount: initAmount = 0, content: initContent = '', title = 'Mã QR chuyển khoản' }) {
  const { toast } = useFeedback();
  const usable = (accounts || []).filter((a) => !a.archived && accountQrInfo(a).ok);
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState(String(Math.round(Number(initAmount) || 0) || ''));
  const [content, setContent] = useState(initContent);

  useEffect(() => {
    if (!open) return;
    setAmount(String(Math.round(Number(initAmount) || 0) || ''));
    setContent(initContent);
    setAccountId((cur) => cur || String(fixedAccount?.id || usable[0]?.id || ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const account = fixedAccount || usable.find((a) => String(a.id) === String(accountId)) || null;

  const download = () => {
    const img = document.querySelector('[data-qr-print] figure img');
    if (!img) return;
    const a = document.createElement('a');
    a.href = img.src;
    a.download = `qr-${(account?.name || 'tai-khoan').replace(/\s+/g, '-')}${Number(amount) > 0 ? `-${amount}` : ''}.png`;
    a.click();
  };
  const copy = async () => {
    const info = accountQrInfo(account);
    const text = [`${info.bank?.name} - ${account.account_number}`, account.holder_name && `Chủ TK: ${account.holder_name}`, Number(amount) > 0 && `Số tiền: ${formatCurrency(amount)}`, cleanContent(content) && `Nội dung: ${cleanContent(content)}`].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(text); toast.success('Đã sao chép thông tin chuyển khoản'); } catch { toast.error('Không sao chép được'); }
  };

  return (
    <Modal open={open} onClose={onClose} icon={QrCode} title={title} size="md"
      footer={account && accountQrInfo(account).ok ? (
        <>
          <Button variant="secondary" icon={Copy} onClick={copy}>Sao chép</Button>
          <Button variant="secondary" icon={Download} onClick={download}>Tải ảnh</Button>
          <Button icon={Printer} onClick={() => printQr({ account, amount, content, title })}>In</Button>
        </>
      ) : null}
    >
      <div className="grid gap-3">
        {!fixedAccount && (
          usable.length ? (
            <Field label="Tài khoản nhận" htmlFor="qr-account">
              <Select id="qr-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {usable.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.account_number}</option>)}
              </Select>
            </Field>
          ) : (
            <p className="rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700">Chưa có tài khoản ngân hàng nào đủ thông tin (ngân hàng + số TK). Thêm ở Dòng tiền › Tài khoản.</p>
          )
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Số tiền (để trống = khách tự nhập)" htmlFor="qr-amount"><MoneyField id="qr-amount" value={amount} onChange={setAmount} /></Field>
          <Field label="Nội dung" htmlFor="qr-content" hint="Không dấu, tối đa 50 ký tự"><Input id="qr-content" value={content} onChange={(e) => setContent(e.target.value)} maxLength={80} /></Field>
        </div>
        <div className="flex justify-center py-2" data-qr-print>
          {account ? <BankQR account={account} amount={Number(amount) || 0} content={content} size={240} /> : null}
        </div>
      </div>
    </Modal>
  );
}
