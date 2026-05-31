import React, { useState, useMemo } from 'react';
import { X, Upload, Download, FileSpreadsheet, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { readSpreadsheet, autoMapColumns, downloadTemplate } from '../utils/excel';

/**
 * Modal import dữ liệu từ Excel/CSV — tái sử dụng cho nợ vé / hộ chiếu / khách hàng.
 *
 * Props:
 *  - open: boolean
 *  - onClose: () => void
 *  - title: string
 *  - templateName: string                    tên file template tải về
 *  - fields: [{ key, label, required, aliases? }]
 *  - sampleRow?: Record<key, any>            dòng ví dụ trong template
 *  - onImport: (rows) => Promise<{inserted, failed, skipped?, errors?}>
 *  - onSuccess?: () => void                   gọi sau khi import xong (vd: tải lại danh sách)
 */
export default function ImportModal({
  open,
  onClose,
  title,
  templateName,
  fields,
  sampleRow,
  onImport,
  onSuccess,
}) {
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [parseError, setParseError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  function reset() {
    setFileName('');
    setHeaders([]);
    setRawRows([]);
    setMapping({});
    setParseError('');
    setResult(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError('');
    setResult(null);
    try {
      const { headers: hs, rows } = await readSpreadsheet(file);
      if (rows.length === 0) {
        setParseError('File rỗng hoặc không đọc được dữ liệu.');
        return;
      }
      setFileName(file.name);
      setHeaders(hs);
      setRawRows(rows);
      setMapping(autoMapColumns(fields, hs));
    } catch (err) {
      setParseError('Không đọc được file: ' + err.message);
    }
  }

  // Chuyển dữ liệu thô sang đúng field key theo mapping hiện tại.
  const mappedRows = useMemo(() => {
    if (rawRows.length === 0) return [];
    return rawRows.map((r) => {
      const o = {};
      for (const f of fields) {
        const col = mapping[f.key];
        o[f.key] = col ? r[col] : '';
      }
      return o;
    });
  }, [rawRows, mapping, fields]);

  // Đếm lỗi thiếu trường bắt buộc (kiểm tra sơ bộ phía client).
  const clientErrors = useMemo(() => {
    const requiredKeys = fields.filter((f) => f.required).map((f) => f.key);
    let count = 0;
    mappedRows.forEach((row) => {
      if (requiredKeys.some((k) => String(row[k] ?? '').trim() === '')) count += 1;
    });
    return count;
  }, [mappedRows, fields]);

  async function handleSubmit() {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await onImport(mappedRows);
      setResult(res);
      if (res.inserted > 0 && onSuccess) onSuccess();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Import thất bại';
      setResult({ inserted: 0, failed: mappedRows.length, errors: [{ row: '-', message: msg }] });
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const fmt = (v) => {
    if (v instanceof Date) return v.toLocaleDateString('vi-VN');
    return String(v ?? '');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h3 className="flex items-center gap-2 text-xl font-bold text-gray-900">
            <FileSpreadsheet className="text-orange-600" size={22} /> {title}
          </h3>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-700">
            <X size={22} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Bước 1: chọn file + tải template */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 cursor-pointer font-semibold text-sm">
              <Upload size={18} /> Chọn file Excel/CSV
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" />
            </label>
            <button
              onClick={() =>
                downloadTemplate(templateName, fields, sampleRow).catch((err) =>
                  setParseError('Không tạo được file mẫu: ' + err.message)
                )
              }
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-semibold text-sm"
            >
              <Download size={18} /> Tải file mẫu
            </button>
            {fileName && <span className="text-sm text-gray-500">📄 {fileName} — {rawRows.length} dòng</span>}
          </div>

          {parseError && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              <AlertTriangle size={18} /> {parseError}
            </div>
          )}

          {/* Bước 2: map cột */}
          {headers.length > 0 && !result && (
            <>
              <div>
                <h4 className="font-semibold text-gray-800 mb-2">Ghép cột dữ liệu</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {fields.map((f) => (
                    <div key={f.key} className="flex items-center gap-2">
                      <span className="w-40 text-sm text-gray-600 shrink-0">
                        {f.label}{f.required && <span className="text-red-500"> *</span>}
                      </span>
                      <select
                        value={mapping[f.key] || ''}
                        onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}
                        className="flex-1 border rounded-lg px-2 py-1.5 text-sm focus:border-orange-500 focus:outline-none"
                      >
                        <option value="">— bỏ qua —</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview 5 dòng đầu */}
              <div>
                <h4 className="font-semibold text-gray-800 mb-2">Xem trước (5 dòng đầu)</h4>
                <div className="overflow-x-auto border rounded-lg">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        {fields.map((f) => (
                          <th key={f.key} className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">
                            {f.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {mappedRows.slice(0, 5).map((row, i) => (
                        <tr key={i} className="border-t">
                          {fields.map((f) => (
                            <td key={f.key} className="px-3 py-1.5 whitespace-nowrap">{fmt(row[f.key])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {clientErrors > 0 && (
                  <p className="mt-2 text-sm text-amber-600 flex items-center gap-1">
                    <AlertTriangle size={15} /> {clientErrors} dòng thiếu trường bắt buộc — sẽ bị bỏ qua khi import.
                  </p>
                )}
              </div>
            </>
          )}

          {/* Kết quả */}
          {result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-green-800">
                <CheckCircle2 size={20} />
                <span className="font-semibold">
                  Đã import {result.inserted} dòng
                  {result.skipped ? `, bỏ qua ${result.skipped} dòng trùng` : ''}
                  {result.failed ? `, ${result.failed} dòng lỗi` : ''}.
                </span>
              </div>
              {result.errors?.length > 0 && (
                <div className="max-h-48 overflow-y-auto border border-red-200 rounded-lg">
                  <table className="min-w-full text-xs">
                    <thead className="bg-red-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-red-700 w-20">Dòng</th>
                        <th className="px-3 py-2 text-left font-semibold text-red-700">Lỗi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((e, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-1.5">{e.row}</td>
                          <td className="px-3 py-1.5 text-red-600">{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t px-6 py-4">
          <button onClick={handleClose} className="px-5 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-semibold text-sm">
            {result ? 'Đóng' : 'Huỷ'}
          </button>
          {headers.length > 0 && !result && (
            <button
              onClick={handleSubmit}
              disabled={submitting || mappedRows.length === 0}
              className="px-5 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-semibold text-sm disabled:opacity-50"
            >
              {submitting ? 'Đang import…' : `Import ${mappedRows.length} dòng`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
