import { describe, it, expect } from 'vitest';
import { formatCurrency, formatDate, normalizeYmd, today, addDays, daysUntil, monthOf, formatCompact, num, toYmd } from './format';

describe('format utils', () => {
  it('formatCurrency rounds to VND without decimals', () => {
    expect(formatCurrency('3000000.00')).toMatch(/3\.000\.000/);
    expect(formatCurrency(null)).toMatch(/^0/);
  });

  it('formatDate handles YYYY-MM-DD, ISO timestamps and Date', () => {
    expect(formatDate('2026-12-01')).toBe('01/12/2026');
    expect(formatDate('')).toBe('');
    expect(formatDate(new Date(2026, 0, 5))).toBe('05/01/2026');
    // ISO (TIMESTAMPTZ) hiển thị theo giờ máy — chỉ kiểm tra định dạng.
    expect(formatDate('2026-06-15T10:00:00.000Z')).toMatch(/^\d{2}\/\d{2}\/2026$/);
  });

  it('normalizeYmd accepts dd/mm/yyyy', () => {
    expect(normalizeYmd('5/1/2026')).toBe('2026-01-05');
    expect(normalizeYmd('garbage')).toBe('');
  });

  it('today/addDays/daysUntil are timezone-safe string math', () => {
    const t = today();
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(t).toBe(toYmd(new Date()));
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysUntil(addDays(t, 3))).toBe(3);
    expect(daysUntil(addDays(t, -2))).toBe(-2);
    expect(daysUntil('')).toBeNull();
  });

  it('monthOf and formatCompact', () => {
    expect(monthOf('2026-11-27')).toBe('2026-11');
    expect(formatCompact(12500000)).toBe('12.5 tr');
    expect(formatCompact(1200000000)).toBe('1.2 tỷ');
    expect(formatCompact(-900000)).toBe('-900 k');
  });

  it('num coerces DB numeric strings', () => {
    expect(num('1500000.00')).toBe(1500000);
    expect(num('abc')).toBe(0);
    expect(num(undefined)).toBe(0);
  });
});
