import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

// Đăng ký matcher của jest-dom (toBeInTheDocument, toBeDisabled, …).
expect.extend(matchers);

// Dọn DOM sau mỗi test: @testing-library/react tự đăng ký afterEach khi globals=true.
// Mock được reset qua `restoreMocks: true` trong vite.config.js.

// jsdom không có matchMedia/ResizeObserver (Recharts cần).
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
