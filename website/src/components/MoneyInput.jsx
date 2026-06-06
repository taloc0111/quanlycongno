import React from 'react';

// Ô nhập tiền: hiển thị có dấu chấm ngăn cách hàng nghìn (3.000.000),
// nhưng gọi onChange với CHUỖI SỐ THÔ (chỉ chữ số, kèm dấu '-' nếu cho phép âm)
// để cha lưu/parse như cũ.
const formatThousands = (val, allowNegative) => {
  if (val === '' || val === null || val === undefined) return '';
  const str = String(val);
  const neg = allowNegative && str.trim().startsWith('-');
  // DB trả về dạng "3000000.00" → chỉ lấy phần nguyên.
  const intPart = str.split('.')[0].replace(/\D/g, '');
  if (!intPart) return neg ? '-' : '';
  const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return neg ? `-${formatted}` : formatted;
};

export default function MoneyInput({ value, onChange, className, placeholder, disabled, allowNegative = false }) {
  const handleChange = (e) => {
    const input = e.target.value;
    const neg = allowNegative && input.trim().startsWith('-');
    const digits = input.replace(/\D/g, ''); // bỏ mọi ký tự không phải số
    onChange(neg ? `-${digits}` : digits);
  };
  return (
    <input
      type="text"
      inputMode={allowNegative ? 'text' : 'numeric'}
      value={formatThousands(value, allowNegative)}
      onChange={handleChange}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
    />
  );
}
