import { useState } from 'react';
import { X, MessageCircle } from 'lucide-react';
import { ZALO_URL } from '../utils/contact';

// Nút liên hệ Zalo nổi góc dưới-phải (hiện ở mọi trang). Có thể thu gọn.
export default function ZaloButton() {
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Liên hệ Zalo"
        className="fixed bottom-5 right-5 z-[55] w-12 h-12 rounded-full bg-[#0068FF] text-white shadow-lg flex items-center justify-center hover:scale-105 transition"
      >
        <MessageCircle size={22} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-[55] flex items-center">
      <a
        href={ZALO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-full bg-[#0068FF] text-white shadow-lg font-semibold text-sm hover:brightness-110 transition"
      >
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white text-[#0068FF] text-xs font-extrabold">Za</span>
        Liên hệ Zalo
      </a>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(false); }}
        title="Thu gọn"
        className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white border text-gray-500 shadow flex items-center justify-center hover:bg-gray-100"
      >
        <X size={12} />
      </button>
    </div>
  );
}
