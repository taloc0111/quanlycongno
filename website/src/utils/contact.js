// Thông tin liên hệ chủ hệ thống. Có thể override qua biến môi trường Vite (VITE_*).
const env = import.meta.env;

export const ZALO_URL = env.VITE_ZALO_URL || 'https://zalo.me/84933773728';
export const ZALO_NUMBER = env.VITE_ZALO_NUMBER || '0933 773 728';

// Bật/tắt nút Zalo. Mặc định BẬT; đặt VITE_ZALO_ENABLED=false để tắt.
export const ZALO_ENABLED = String(env.VITE_ZALO_ENABLED ?? 'true').toLowerCase() !== 'false';
