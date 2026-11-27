// Khớp sao kê ngân hàng với sổ tài khoản — hàm thuần (không React) để test dễ.
//
// Luồng: đọc file (utils/excel.readSpreadsheet) → map cột (STATEMENT_FIELDS + autoMapColumns)
// → parseStatementRows → matchStatement với các dòng sổ CHƯA đối soát → reconcileItemsOf.
import { normalizeYmd, toYmd, ymdToDate } from '../../utils/format';
import { reconcileKindOf } from './moneyUtils';

/** Các cột cần map. Có "Số tiền" (có dấu) HOẶC cặp "Ghi có" / "Ghi nợ". */
export const STATEMENT_FIELDS = [
  { key: 'date', label: 'Ngày', required: true, aliases: ['ngay giao dich', 'ngay gd', 'ngay hach toan', 'ngay', 'date', 'transaction date', 'posting date'] },
  { key: 'amount', label: 'Số tiền', aliases: ['so tien', 'so tien giao dich', 'amount', 'so tien (vnd)'] },
  { key: 'credit', label: 'Ghi có', aliases: ['ghi co', 'so tien ghi co', 'credit', 'tien vao', 'phat sinh co'] },
  { key: 'debit', label: 'Ghi nợ', aliases: ['ghi no', 'so tien ghi no', 'debit', 'tien ra', 'phat sinh no'] },
  { key: 'description', label: 'Nội dung', aliases: ['noi dung', 'noi dung giao dich', 'mo ta', 'description', 'dien giai', 'chi tiet'] },
];

/** Mapping đủ để đọc số tiền chưa: cần cột ngày + (số tiền hoặc ghi có/ghi nợ). */
export const mappingReady = (m = {}) => !!m.date && !!(m.amount || m.credit || m.debit);

/**
 * Đọc số tiền kiểu Việt Nam/quốc tế → number (có dấu) hoặc null.
 * "1.000.000" → 1000000 · "-500,000" → -500000 · "1,000,000.50" → 1000000.5 · "(200.000)" → -200000 · "500.000đ" → 500000.
 */
export function parseAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[^\d.,+-]/g, '');
  if (s.startsWith('-') || s.endsWith('-')) neg = true;
  s = s.replace(/[+-]/g, '');
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Cả 2 loại dấu: dấu xuất hiện sau cùng là dấu thập phân.
    const dec = lastDot > lastComma ? '.' : ',';
    const thousands = dec === '.' ? ',' : '.';
    s = s.split(thousands).join('').replace(dec, '.');
  } else {
    const sep = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : '';
    if (sep) {
      const parts = s.split(sep);
      // Nhiều dấu, hoặc 1 dấu theo sau đúng 3 chữ số → ngăn cách nghìn; còn lại là thập phân.
      s = parts.length > 2 || parts[parts.length - 1].length === 3 ? parts.join('') : parts.join('.');
    }
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** Đọc ngày sao kê → 'YYYY-MM-DD' hoặc ''. Nhận Date, số serial Excel, 'dd/mm/yyyy[ hh:mm]', 'yyyy-mm-dd'. */
export function parseStatementDate(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) return toYmd(value);
  if (typeof value === 'number') {
    if (value > 20000 && value < 80000) {
      // Serial Excel: ngày 0 = 1899-12-30 (tính theo giờ máy, không lệch múi giờ).
      return toYmd(new Date(1899, 11, 30 + Math.floor(value)));
    }
    return '';
  }
  const s = String(value).trim();
  const first = s.split(/\s+/)[0];
  return normalizeYmd(first) || normalizeYmd(s);
}

/**
 * Dòng thô của file + mapping → dòng sao kê chuẩn hoá:
 * [{ idx, date, direction:'in'|'out', amount (>0), description, error }].
 * Bỏ các dòng không có số tiền (dòng tiêu đề phụ, dòng trống). Dòng có tiền nhưng không đọc được ngày giữ lại kèm `error`.
 */
export function parseStatementRows(rawRows, mapping = {}) {
  const out = [];
  (rawRows || []).forEach((raw, i) => {
    let signed = null;
    if (mapping.amount) {
      signed = parseAmount(raw[mapping.amount]);
    }
    if (!signed) {
      const credit = mapping.credit ? parseAmount(raw[mapping.credit]) : null;
      const debit = mapping.debit ? parseAmount(raw[mapping.debit]) : null;
      if (credit) signed = Math.abs(credit);
      else if (debit) signed = -Math.abs(debit);
    }
    if (!signed) return;
    const date = parseStatementDate(mapping.date ? raw[mapping.date] : '');
    out.push({
      idx: i,
      date,
      direction: signed < 0 ? 'out' : 'in',
      amount: Math.abs(signed),
      description: mapping.description ? String(raw[mapping.description] ?? '').trim() : '',
      error: date ? '' : 'Không đọc được ngày',
    });
  });
  return out;
}

const dayDiff = (a, b) => Math.abs(Math.round((ymdToDate(a).getTime() - ymdToDate(b).getTime()) / 86400000));
const ledgerKey = (r) => `${r.kind}-${r.id}`;

/**
 * Gợi ý khớp 1-1: cùng chiều, cùng số tiền, lệch ngày ≤ maxDays; ưu tiên cặp lệch ngày ít nhất.
 * Chỉ xét dòng sổ chưa đối soát. Trả về Map(idx dòng sao kê → dòng sổ).
 */
export function matchStatement(statementRows, ledgerRows, { maxDays = 3 } = {}) {
  const ledger = (ledgerRows || []).filter((r) => !r.reconciled);
  const pairs = [];
  for (const s of statementRows || []) {
    if (!s.date || s.error) continue;
    ledger.forEach((l, li) => {
      const ld = normalizeYmd(l.date);
      if (!ld || l.direction !== s.direction) return;
      if (Math.abs(Math.abs(Number(l.amount)) - s.amount) >= 0.5) return;
      const diff = dayDiff(s.date, ld);
      if (diff <= maxDays) pairs.push({ s, l, li, diff });
    });
  }
  pairs.sort((a, b) => a.diff - b.diff || a.s.idx - b.s.idx || a.li - b.li);
  const result = new Map();
  const usedLedger = new Set();
  for (const p of pairs) {
    if (result.has(p.s.idx) || usedLedger.has(ledgerKey(p.l))) continue;
    result.set(p.s.idx, p.l);
    usedLedger.add(ledgerKey(p.l));
  }
  return result;
}

/** Dòng sổ đã chọn → items cho PUT /accounts/reconcile-batch (bỏ trùng). */
export function reconcileItemsOf(ledgerRows) {
  const seen = new Set();
  const items = [];
  for (const r of ledgerRows || []) {
    const kind = reconcileKindOf(r.kind);
    const key = `${kind}-${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ kind, id: r.id, reconciled: true });
  }
  return items;
}
