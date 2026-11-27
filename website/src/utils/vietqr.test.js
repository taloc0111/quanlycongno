import { describe, it, expect } from 'vitest';
import { crc16, buildVietQR, cleanContent, findBank, accountQrInfo } from './vietqr';

// Đọc lại chuỗi TLV để kiểm cấu trúc.
function parseTlv(s) {
  const out = {};
  let i = 0;
  while (i < s.length) {
    const id = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    out[id] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

describe('vietqr', () => {
  it('crc16 CCITT-FALSE khớp vector chuẩn', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  it('mã tĩnh (không số tiền) đúng cấu trúc NAPAS', () => {
    const p = buildVietQR({ bin: '970407', accountNumber: '19031234567890' });
    const t = parseTlv(p);
    expect(t['00']).toBe('01');
    expect(t['01']).toBe('11');
    expect(t['53']).toBe('704');
    expect(t['58']).toBe('VN');
    expect(t['54']).toBeUndefined();
    const m = parseTlv(t['38']);
    expect(m['00']).toBe('A000000727');
    expect(m['02']).toBe('QRIBFTTA');
    expect(parseTlv(m['01'])).toEqual({ '00': '970407', '01': '19031234567890' });
    // CRC cuối chuỗi tính trên phần trước + "6304"
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
  });

  it('mã có số tiền + nội dung', () => {
    const p = buildVietQR({ bin: '970436', accountNumber: '0011001234567', amount: 2500000.4, content: 'Thanh toán vé VN123 – Nguyễn Văn Á' });
    const t = parseTlv(p);
    expect(t['01']).toBe('12');
    expect(t['54']).toBe('2500000');
    expect(parseTlv(t['62'])['08']).toBe('Thanh toan ve VN123 Nguyen Van A');
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
  });

  it('cleanContent bỏ dấu, ký tự lạ và cắt 50 ký tự', () => {
    expect(cleanContent('Đặt cọc tour Đà Nẵng #12!')).toBe('Dat coc tour Da Nang 12');
    expect(cleanContent('x'.repeat(80))).toHaveLength(50);
  });

  it('findBank nhận nhiều cách viết', () => {
    expect(findBank('TCB').bin).toBe('970407');
    expect(findBank('techcombank').bin).toBe('970407');
    expect(findBank('Vietcombank').bin).toBe('970436');
    expect(findBank('vietinbank').bin).toBe('970415');
    expect(findBank('MB').bin).toBe('970422');
    expect(findBank('970441').code).toBe('VIB');
    expect(findBank('Tiền mặt')).toBeNull();
    expect(findBank('')).toBeNull();
  });

  it('báo lỗi rõ khi thiếu ngân hàng / số TK', () => {
    expect(() => buildVietQR({ bin: '', accountNumber: '123456' })).toThrow(/ngân hàng/);
    expect(() => buildVietQR({ bin: '970407', accountNumber: '12' })).toThrow(/Số tài khoản/);
    expect(accountQrInfo({ bank: 'MoMo', account_number: '0901' }).ok).toBe(false);
    expect(accountQrInfo({ bank: 'ACB', account_number: '' }).ok).toBe(false);
    expect(accountQrInfo({ bank: 'ACB', account_number: '123456789' }).ok).toBe(true);
  });
});
