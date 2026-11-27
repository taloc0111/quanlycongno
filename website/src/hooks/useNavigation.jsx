import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const NavContext = createContext(null);

// Đọc "#key/param" từ URL hash → { key, param }.
function parseHash() {
  const h = (window.location.hash || '').replace(/^#/, '');
  if (!h) return { key: 'dashboard', param: null };
  const [key, ...rest] = h.split('/');
  return { key: key || 'dashboard', param: rest.length ? decodeURIComponent(rest.join('/')) : null };
}

/**
 * Điều hướng trong app bằng URL hash (#debt, #customer/12) — không cần router,
 * tải lại trang vẫn giữ đúng màn hình, có nút Back của trình duyệt.
 */
export function NavigationProvider({ children }) {
  const [route, setRoute] = useState(parseHash);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((key, param) => {
    const next = param != null ? `#${key}/${encodeURIComponent(param)}` : `#${key}`;
    if (window.location.hash === next) setRoute(parseHash());
    else window.location.hash = next;
  }, []);

  const value = useMemo(() => ({ ...route, navigate }), [route, navigate]);
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useNavigation() {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNavigation must be used within NavigationProvider');
  return ctx;
}
