// utils/format.js — định dạng tiền & ngày tiếng Việt.
export const formatCurrency = (value) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })
    .format(Number(value) || 0);

export const formatNumber = (value) =>
  new Intl.NumberFormat('vi-VN').format(Number(value) || 0);

export const formatDate = (value) => {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('vi-VN');
};
