import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Tách thư viện lớn ra chunk riêng để cache tốt hơn.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules[\\/](recharts|d3-|victory-)/.test(id)) return 'charts';
          if (/node_modules[\\/](react-datepicker|date-fns)/.test(id)) return 'datepicker';
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
  test: {
    // Chỉ chạy test của website (không quét lên backend/ hay thư mục khác).
    dir: 'src',
    include: ['**/*.test.{js,jsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    restoreMocks: true,
    css: false,
  },
});
