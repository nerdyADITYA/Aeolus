import { ApiError, formatDetail, request } from './client.js';
import { mockFetch } from '../test/mockApi.js';

describe('request', () => {
  it('returns parsed JSON and sends JSON bodies with a content type', async () => {
    const f = mockFetch({ 'PUT /api/x': ({ body }) => ({ echoed: body }) });
    const out = await request('/api/x', { method: 'PUT', body: { a: 1 } });
    expect(out).toEqual({ echoed: { a: 1 } });
    expect(f.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('maps backend errors to ApiError with status, detail and hint', async () => {
    mockFetch({ 'GET /api/site/forecast': { status: 404, body: { detail: 'No forecast yet', hint: 'POST /api/site/forecast' } } });
    const err = await request('/api/site/forecast').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect([err.status, err.detail, err.hint]).toEqual([404, 'No forecast yet', 'POST /api/site/forecast']);
  });

  it('formats FastAPI validation errors', async () => {
    mockFetch({ 'PUT /api/site': { status: 422, body: { detail: [{ loc: ['body', 'latitude'], msg: 'Input should be less than or equal to 90' }] } } });
    const err = await request('/api/site', { method: 'PUT', body: {} }).catch((e) => e);
    expect(err.detail).toBe('latitude: Input should be less than or equal to 90');
    expect(formatDetail(undefined)).toBe('Unexpected error');
  });

  it('turns a network failure into a friendly ApiError with status 0', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await request('/api/health').catch((e) => e);
    expect(err.status).toBe(0);
    expect(err.detail).toMatch(/Cannot reach the backend/);
    expect(err.hint).toMatch(/start\.ps1/);
  });

  it('rethrows aborts untouched so callers can ignore them', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(request('/api/health')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('treats a bodyless gateway error (dev proxy, backend down) as unreachable', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 502, statusText: 'Bad Gateway' }));
    const err = await request('/api/health').catch((e) => e);
    expect([err.status, err.detail]).toEqual([0, 'Cannot reach the backend. Is it running?']);
    expect(err.hint).toContain('.\\start.ps1');                                  // the backslash must survive string escaping
  });

  it('tolerates a non-JSON error body from other statuses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('<html>oops</html>', { status: 500, statusText: 'Internal Server Error' }));
    const err = await request('/api/health').catch((e) => e);
    expect([err.status, err.detail]).toEqual([500, 'Internal Server Error']);
  });
});
