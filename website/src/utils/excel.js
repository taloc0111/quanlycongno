// utils/excel.js — Đọc/ghi Excel & CSV bằng SheetJS (xlsx).
// xlsx được nạp động (dynamic import) để tách khỏi bundle chính,
// chỉ tải khi người dùng thực sự dùng chức năng import/template.

/** Chuẩn hoá chuỗi để so khớp tên cột: bỏ dấu, lowercase, gọn khoảng trắng. */
const COMBINING_MARKS = /[̀-ͯ]/g;
export function normalizeHeader(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/\s+/g, ' ');
}

/**
 * Đọc file Excel/CSV → { headers: string[], rows: Array<Record<string, any>> }.
 * Mỗi row dùng tên cột (header) làm key. Ngày được trả về dạng Date, số dạng number.
 */
export async function readSpreadsheet(file) {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { headers: [], rows: [] };
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

/**
 * Tự động khớp cột trong file với các field cấu hình (theo label + aliases).
 * @returns {Record<string, string>} map fieldKey -> headerName (hoặc '' nếu không khớp)
 */
export function autoMapColumns(fields, headers) {
  const normHeaders = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));
  const mapping = {};
  for (const field of fields) {
    const candidates = [field.label, ...(field.aliases || [])].map(normalizeHeader);
    const hit = normHeaders.find((h) => candidates.includes(h.norm));
    mapping[field.key] = hit ? hit.raw : '';
  }
  return mapping;
}

/**
 * Xuất một mảng-các-dòng (aoa, dòng đầu là header) ra file .xlsx.
 * opts:
 *   - sheetName: tên sheet
 *   - colWidths: number[] độ rộng từng cột (ký tự)
 *   - moneyCols: number[] index cột áp định dạng số có ngăn cách nghìn (#,##0)
 */
export async function exportToExcel(filename, aoa, opts = {}) {
  const { sheetName = 'Sheet1', colWidths, moneyCols = [] } = opts;
  return exportWorkbook(filename, [{ name: sheetName, aoa, colWidths, moneyCols }]);
}

/**
 * Xuất file .xlsx nhiều sheet. Mỗi sheet: { name, aoa, colWidths?, moneyCols? }.
 * moneyCols: index cột áp định dạng số ngăn cách nghìn (#,##0) — hiển thị theo
 * locale Excel (máy tiếng Việt ra dấu chấm: 3.000.000) và vẫn tính/sum được.
 */
export async function exportWorkbook(filename, sheets) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.aoa);
    if (s.colWidths) ws['!cols'] = s.colWidths.map((wch) => ({ wch }));
    if (s.moneyCols?.length && ws['!ref']) {
      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let r = range.s.r + 1; r <= range.e.r; r++) {
        for (const c of s.moneyCols) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (cell && typeof cell.v === 'number') cell.z = '#,##0';
        }
      }
    }
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  XLSX.writeFile(wb, filename);
}

/** Tải file .xlsx template gồm dòng header + 1 dòng ví dụ. */
export async function downloadTemplate(filename, fields, sampleRow = {}) {
  const XLSX = await import('xlsx');
  const header = fields.map((f) => f.label);
  const example = fields.map((f) => sampleRow[f.key] ?? '');
  const ws = XLSX.utils.aoa_to_sheet([header, example]);
  ws['!cols'] = fields.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  XLSX.writeFile(wb, filename);
}
