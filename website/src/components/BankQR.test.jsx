import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeedbackProvider } from '../ui/FeedbackContext';
import { AuthProvider } from '../auth/AuthContext';
import BankQR, { QrModal } from './BankQR';
import CustomerStatement from '../modules/CustomerStatement';
import { mockApi } from '../test/mockApi';
import { storage } from '../services/client';
import { invalidateMoneyCache } from '../services/money';

// Chuỗi VietQR đang hiển thị = thuộc tính data-qr-payload trên <figure> (thư viện qrcode bản Node vẽ được ảnh trong jsdom).
const lastPayload = () => { const f = document.querySelectorAll('[data-qr-payload]'); return f.length ? f[f.length - 1].getAttribute('data-qr-payload') : ''; };

const TCB = { id: 1, name: 'TCB chính', bank: 'TCB', account_number: '19031234567890', holder_name: 'NGUYEN VAN A', is_own: true, archived: false };
const LAN = { id: 2, name: 'TK chị Lan', bank: 'VIB', account_number: '0011223344', holder_name: 'LAN', is_own: false, archived: false };
const CASH = { id: 3, name: 'Tiền mặt', bank: 'Tiền mặt', account_number: '', is_own: true, archived: false };

beforeEach(() => { invalidateMoneyCache(); storage.set('token', 't'); storage.setJSON('authUser', { id: 1, username: 'admin', fullName: 'Đại lý A', role: 'admin' }); });

describe('BankQR', () => {
  it('vẽ QR với số tiền + nội dung không dấu', async () => {
    render(<BankQR account={TCB} amount={1500000} content="Thanh toán vé VN1" />);
    expect(await screen.findByRole('img', { name: /Mã QR chuyển khoản TCB chính/ })).toBeInTheDocument();
    expect(screen.getByText(/Techcombank · 19031234567890/)).toBeInTheDocument();
    expect(screen.getByText('ND: Thanh toan ve VN1')).toBeInTheDocument();
    expect(lastPayload()).toContain('5407' + '1500000');
    expect(lastPayload()).toContain('970407');
  });

  it('báo lý do khi tài khoản không tạo được QR', () => {
    render(<BankQR account={CASH} />);
    expect(screen.getByText(/Chưa rõ ngân hàng/)).toBeInTheDocument();
  });

  it('QrModal chỉ liệt kê TK đủ thông tin và đổi số tiền', async () => {
    render(<FeedbackProvider><QrModal open onClose={() => {}} accounts={[TCB, CASH, LAN]} amount={200000} content="coc" /></FeedbackProvider>);
    const sel = await screen.findByLabelText('Tài khoản nhận');
    expect(within(sel).getAllByRole('option').map((o) => o.textContent)).toEqual(['TCB chính · 19031234567890', 'TK chị Lan · 0011223344']);
    await waitFor(() => expect(lastPayload()).toContain('5406200000'));
    const amt = screen.getByLabelText(/Số tiền/);
    await userEvent.clear(amt);
    await userEvent.type(amt, '350000');
    await waitFor(() => expect(lastPayload()).toContain('5406350000'));
  });
});

describe('CustomerStatement có QR', () => {
  it('in kèm QR đúng số còn nợ vào TK của mình (bỏ TK giữ hộ)', async () => {
    mockApi({ 'GET /accounts': [TCB, LAN, CASH], 'GET /auth/profile': { id: 1, username: 'admin', role: 'admin' } });
    render(
      <FeedbackProvider><AuthProvider>
        <CustomerStatement open onClose={() => {}} customer={{ name: 'Khách B', phone: '0909' }}
          transactions={[{ date: '2026-11-01', typeLabel: 'Vé máy bay', desc: 'VN1', sold: 2000000, paid: 500000, remaining: 1500000 }]}
          payments={[]} totals={{ sold: 2000000, paid: 500000, outstanding: 1500000 }} />
      </AuthProvider></FeedbackProvider>,
    );
    expect(await screen.findByText('Quét mã để chuyển khoản')).toBeInTheDocument();
    const sel = screen.getByLabelText('QR vào TK');
    expect(within(sel).getAllByRole('option').map((o) => o.textContent)).toEqual(['Không in QR', 'TCB chính · 19031234567890']);
    await waitFor(() => expect(lastPayload()).toContain('54071500000'));
    expect(screen.getByText('Nội dung: Khach B 0909 thanh toan')).toBeInTheDocument();
    await userEvent.selectOptions(sel, '');
    await waitFor(() => expect(screen.queryByText('Quét mã để chuyển khoản')).not.toBeInTheDocument());
  });
});
