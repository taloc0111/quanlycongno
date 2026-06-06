import React from 'react';

// Toast thông báo nhỏ ở góc dưới phải (thay alert gốc của trình duyệt).
export default function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div
      className={`fixed bottom-5 right-5 z-[70] px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium ${toast.type === 'error' ? 'bg-red-600' : 'bg-green-600'}`}
    >
      {toast.type === 'error' ? '❌ ' : '✅ '}{toast.message}
    </div>
  );
}
