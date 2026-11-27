/** @type {import('tailwindcss').Config} */
// Design token của app: 1 màu chủ đạo (brand), xám trung tính (slate) và 3 màu
// trạng thái (success/warning/danger). Dùng tên token thay vì màu Tailwind rời rạc
// để đổi theme chỉ cần sửa ở đây.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Be Vietnam Pro"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Màu đổi theo theme lấy từ biến CSS (src/index.css): đổi sáng/tối chỉ bằng class .dark trên <html>.
        // brand/success/warning/danger: 50/100 (nền nhạt) đổi theo theme; sắc 700+ giữ cố định (dùng cả cho nền nút),
        // chữ 700/800 được làm sáng riêng trong chế độ tối ở src/index.css.
        brand: {
          50: 'rgb(var(--c-brand-50) / <alpha-value>)',
          100: 'rgb(var(--c-brand-100) / <alpha-value>)',
          200: '#bfd2ff',
          300: '#93b3ff',
          400: '#6089ff',
          500: '#3b63f6',
          600: '#2447e3',
          700: '#1d37c0',
          800: '#1c2f9a',
          900: '#1c2c79',
          950: '#141c47',
        },
        ink: {
          DEFAULT: 'rgb(var(--c-ink) / <alpha-value>)',
          soft: 'rgb(var(--c-ink-soft) / <alpha-value>)',
          muted: 'rgb(var(--c-ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--c-ink-faint) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--c-surface) / <alpha-value>)',
          muted: 'rgb(var(--c-surface-muted) / <alpha-value>)',
          subtle: 'rgb(var(--c-surface-subtle) / <alpha-value>)',
          border: 'rgb(var(--c-surface-border) / <alpha-value>)',
        },
        success: { 50: 'rgb(var(--c-success-50) / <alpha-value>)', 100: 'rgb(var(--c-success-100) / <alpha-value>)', 500: '#10b981', 600: '#059669', 700: '#047857' },
        warning: { 50: 'rgb(var(--c-warning-50) / <alpha-value>)', 100: 'rgb(var(--c-warning-100) / <alpha-value>)', 500: '#f59e0b', 600: '#d97706', 700: '#b45309' },
        danger: { 50: 'rgb(var(--c-danger-50) / <alpha-value>)', 100: 'rgb(var(--c-danger-100) / <alpha-value>)', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c' },
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 1px rgb(15 23 42 / 0.05)',
        pop: '0 10px 30px -10px rgb(15 23 42 / 0.25)',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        'scale-in': { from: { opacity: 0, transform: 'scale(.97)' }, to: { opacity: 1, transform: 'scale(1)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in .18s ease-out',
        'scale-in': 'scale-in .16s ease-out',
        shimmer: 'shimmer 1.4s infinite',
      },
    },
  },
  plugins: [],
};
