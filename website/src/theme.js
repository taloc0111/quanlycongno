// theme.js — chế độ sáng / tối / theo máy. Lưu lựa chọn ở localStorage key 'theme'.
// index.html chạy 1 đoạn nhỏ y hệt applyTheme() TRƯỚC khi tải app để không bị nháy trắng.
import { useCallback, useEffect, useState } from 'react';
import { storage } from './services/client';

export const THEMES = [
  { value: 'light', label: 'Sáng' },
  { value: 'dark', label: 'Tối' },
  { value: 'system', label: 'Theo máy' },
];

const mql = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);

export function getThemePref() {
  const v = storage.get('theme');
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

export function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return mql()?.matches ? 'dark' : 'light';
}

/** Gắn/bỏ class .dark trên <html> theo lựa chọn. */
export function applyTheme(pref = getThemePref()) {
  const dark = resolveTheme(pref) === 'dark';
  const el = document.documentElement;
  el.classList.toggle('dark', dark);
  el.style.colorScheme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0d121e' : '#f8fafc');
  return dark;
}

/** Hook cho nút chuyển theme: { pref, isDark, setPref, cycle }. */
export function useTheme() {
  const [pref, setPrefState] = useState(getThemePref);
  const [isDark, setIsDark] = useState(() => resolveTheme(getThemePref()) === 'dark');

  const setPref = useCallback((next) => {
    storage.set('theme', next);
    setPrefState(next);
    setIsDark(applyTheme(next));
  }, []);

  // Theo máy: đổi theo hệ điều hành ngay khi người dùng bật/tắt dark mode của máy.
  useEffect(() => {
    if (pref !== 'system') return undefined;
    const m = mql();
    if (!m) return undefined;
    const onChange = () => setIsDark(applyTheme('system'));
    m.addEventListener?.('change', onChange);
    return () => m.removeEventListener?.('change', onChange);
  }, [pref]);

  const cycle = useCallback(() => {
    const order = ['light', 'dark', 'system'];
    setPref(order[(order.indexOf(pref) + 1) % order.length]);
  }, [pref, setPref]);

  return { pref, isDark, setPref, cycle };
}
