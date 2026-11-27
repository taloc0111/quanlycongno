import { describe, it, expect, vi } from 'vitest';
import { api, qs, ApiError, storage } from './client';
import { mockApi } from '../test/mockApi';

describe('client', () => {
  it('qs drops empty and "all" values', () => {
    expect(qs({ agencyId: '', month: 'all', q: 'x', n: 0 })).toBe('?q=x&n=0');
    expect(qs({})).toBe('');
  });

  it('adds bearer token and parses JSON', async () => {
    storage.set('token', 'abc');
    const { calls, fetch } = mockApi({ 'GET /debts': [{ id: 1 }] });
    const data = await api.get('/debts');
    expect(data).toEqual([{ id: 1 }]);
    expect(calls[0].path).toBe('/debts');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer abc');
  });

  it('throws ApiError with server message and dispatches auth:logout on 401', async () => {
    mockApi({ 'GET /debts': { status: 401, body: { error: 'Invalid token' } } });
    const handler = vi.fn();
    window.addEventListener('auth:logout', handler);
    await expect(api.get('/debts')).rejects.toMatchObject({ status: 401, message: 'Invalid token' });
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener('auth:logout', handler);
  });

  it('dispatches auth:feature-disabled on 403 featureDisabled', async () => {
    mockApi({ 'GET /ticket-watches': { status: 403, body: { error: 'Chưa bật', featureDisabled: 'fareWatch' } } });
    const handler = vi.fn();
    window.addEventListener('auth:feature-disabled', handler);
    await expect(api.get('/ticket-watches')).rejects.toBeInstanceOf(ApiError);
    expect(handler.mock.calls[0][0].detail).toBe('fareWatch');
    window.removeEventListener('auth:feature-disabled', handler);
  });

  it('wraps network failures in a friendly message', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(api.post('/x', {})).rejects.toMatchObject({ status: 0, message: expect.stringContaining('Không kết nối') });
  });
});
