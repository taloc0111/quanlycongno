import React from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import { vi } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';

registerLocale('vi', vi);

/**
 * Vietnamese date picker (dd/MM/yyyy).
 * value: ISO string 'YYYY-MM-DD' or '' (matches native <input type="date"> API)
 * onChange: called with ISO string 'YYYY-MM-DD' or ''
 */
export default function VnDatePicker({ value, onChange, className, placeholder, ...rest }) {
  // Normalize: take only YYYY-MM-DD part to avoid double-T or timezone issues
  const isoDate = value ? value.slice(0, 10) : '';
  const selected = isoDate ? new Date(isoDate + 'T00:00:00') : null;
  // Guard against invalid dates
  const safeSelected = selected && !isNaN(selected.getTime()) ? selected : null;

  const handleChange = (date) => {
    if (!date) { onChange(''); return; }
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    onChange(`${y}-${m}-${d}`);
  };

  return (
    <DatePicker
      selected={safeSelected}
      onChange={handleChange}
      dateFormat="dd/MM/yyyy"
      locale="vi"
      placeholderText={placeholder || 'dd/mm/yyyy'}
      className={className || 'w-full border rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-none'}
      isClearable
      showYearDropdown
      scrollableYearDropdown
      yearDropdownItemNumber={80}
      autoComplete="off"
      {...rest}
    />
  );
}
