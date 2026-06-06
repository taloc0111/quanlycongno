import React from 'react';

// Ô nhập tiền: hiển thị có dấu chấm ngăn cách hàng nghìn (3.000.000),
// nhưng gọi onChange với CHUỖI SỐ THÔ (chỉ chữ số) để cha lưu/parse như cũ.
const formatThousands = (val) => {
  if (val === '' || val === null || val === undefined) return '';
  // DB trả về dạng "3000000.00" → chỉ lấy phần nguyên.
  const intPart = String(val).split('.')[0].replace(/\D/g, '');
  if (!intPart) return '';
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

export default function MoneyInput({ value, onChange, className, placeholder, disabled }) {
  const handleChange = (e) => {
    const raw = e.target.value.replace(/\D/g, ''); // bỏ mọi ký tự không phải số
    onChange(raw);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      value={formatThousands(value)}
      onChange={handleChange}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
    />
  );
}
