// utils/printQr.js — mở cửa sổ in chỉ chứa mã QR đang hiện trong vùng [data-qr-print].
import { accountQrInfo, cleanContent } from './vietqr';
import { formatCurrency } from './format';

/** Mở cửa sổ in chỉ chứa mã QR (dễ in dán quầy / gửi khách). */
export function printQr({ account, amount, content, title }) {
  const fig = document.querySelector('[data-qr-print] figure img');
  const img = fig?.getAttribute('src');
  if (!img) return;
  const w = window.open('', '_blank', 'width=420,height=620');
  if (!w) return;
  const info = accountQrInfo(account);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title || 'Mã QR chuyển khoản')}</title>
    <style>body{font-family:system-ui,sans-serif;text-align:center;padding:24px;color:#0f172a}img{width:280px;height:280px}
    h1{font-size:18px;margin:0 0 12px}p{margin:4px 0}.amt{font-size:20px;font-weight:700;color:#1d37c0}</style></head><body>
    <h1>${esc(title || 'Quét mã để chuyển khoản')}</h1><img src="${img}" alt="QR"/>
    <p><b>${esc(info.bank?.name)} · ${esc(account.account_number)}</b></p><p>${esc((account.holder_name || '').toUpperCase())}</p>
    ${Number(amount) > 0 ? `<p class="amt">${esc(formatCurrency(amount))}</p>` : ''}
    ${cleanContent(content) ? `<p>Nội dung: ${esc(cleanContent(content))}</p>` : ''}
    <script>window.onload=()=>{window.print();}</script></body></html>`);
  w.document.close();
}

