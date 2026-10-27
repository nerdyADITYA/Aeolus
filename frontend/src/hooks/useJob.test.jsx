import { renderHook, act } from '@testing-library/react';
import { useJob } from './useJob.js';
import { mockFetch } from '../test/mockApi.js';

const job = (status, progress = 0) => ({ id: 'abc', type: 'setup', status, progress, message: status, result: null, error: null });

describe('useJob', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('polls until the job is done, then stops and calls onFinish once', async () => {
    let n = 0;
    const f = mockFetch({ 'GET /api/jobs/abc': () => job(++n < 3 ? 'running' : 'done', n < 3 ? 0.4 : 1) });
    const onFinish = vi.fn();
    const { result } = renderHook(() => useJob('abc', { onFinish, intervalMs: 1000 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.job.status).toBe('running');
    expect(result.current.active).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(result.current.job.status).toBe('done');
    expect(onFinish).toHaveBeenCalledTimes(1);
    const calls = f.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(f.mock.calls.length).toBe(calls); // stopped polling
  });

  it('reports a failed job and stops', async () => {
    mockFetch({ 'GET /api/jobs/abc': { ...job('failed'), error: 'boom' } });
    const onFinish = vi.fn();
    const { result } = renderHook(() => useJob('abc', { onFinish }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.job.error).toBe('boom');
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('keeps retrying through a brief backend outage', async () => {
    let n = 0;
    mockFetch({ 'GET /api/jobs/abc': () => (++n === 1 ? { status: 500, body: { detail: 'down' } } : job('running', 0.5)) });
    const { result } = renderHook(() => useJob('abc', { intervalMs: 500 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.pollError).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(result.current.job.status).toBe('running');
    expect(result.current.pollError).toBeNull();
  });

  it('stops for a job that no longer exists, and does nothing without an id', async () => {
    const f = mockFetch({ 'GET /api/jobs/gone': { status: 404, body: { detail: 'No job' } } });
    const { result } = renderHook(() => useJob('gone', { intervalMs: 200 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(f.mock.calls.length).toBe(1);
    expect(result.current.pollError.status).toBe(404);
    const idle = renderHook(() => useJob(null));
    expect(idle.result.current.job).toBeNull();
  });
});
