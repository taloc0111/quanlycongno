import { vi } from 'vitest';

/**
 * Giả lập fetch theo bảng route: { 'GET /debts': () => data | { status, body } }.
 * Khớp theo method + path (bỏ query string). Ghi lại mọi lời gọi trong `calls`.
 */
export function mockApi(routes) {
  const calls = [];
  const fn = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const path = String(url).replace(/^https?:\/\/[^/]+\/api/, '').replace(/^\/api/, '').split('?')[0];
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body, url: String(url) });
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(' ');
      if (m !== method) return false;
      if (p === path) return true;
      // Hỗ trợ tham số :id
      const re = new RegExp(`^${p.replace(/:[a-zA-Z]+/g, '[^/]+')}$`);
      return re.test(path);
    });
    if (!key) {
      return new Response(JSON.stringify({ error: `No mock for ${method} ${path}` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const handler = routes[key];
    const result = typeof handler === 'function' ? await handler({ path, body, url: String(url) }) : handler;
    const status = result && typeof result === 'object' && 'status' in result && 'body' in result ? result.status : 200;
    const payload = status === 200 && !(result && 'body' in (result || {})) ? result : result.body;
    return new Response(JSON.stringify(payload ?? {}), { status, headers: { 'Content-Type': 'application/json' } });
  });
  globalThis.fetch = fn;
  return { fetch: fn, calls };
}
