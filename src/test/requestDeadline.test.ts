import { afterEach, expect, it, vi } from 'vitest';
import { withRequestDeadline } from '@/lib/requestDeadline';
afterEach(() => vi.useRealTimers());
it('settles a transport that never responds and ignores abort', async () => {
  vi.useFakeTimers();
  let signal!: AbortSignal;
  const request = withRequestDeadline(s => { signal=s; return new Promise(() => {}); }, 8000);
  const assertion = expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.advanceTimersByTimeAsync(8000);
  await assertion;
  expect(signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it('cancels promptly when the identity changes and ignores a late success', async () => {
  const parent = new AbortController();
  let finish!: (value: string) => void;
  const result = withRequestDeadline(() => new Promise<string>(r => { finish=r; }), 8000, parent.signal);
  parent.abort();
  await expect(result).rejects.toMatchObject({name:'AbortError'});
  finish('late admin');
});
it('does not start an already cancelled request', async () => {
  const parent = new AbortController(); parent.abort();
  const operation = vi.fn();
  await expect(withRequestDeadline(operation,8000,parent.signal)).rejects.toMatchObject({name:'AbortError'});
  expect(operation).not.toHaveBeenCalled();
});
it('cleans up the timer after a successful request', async () => {
  vi.useFakeTimers();
  await expect(withRequestDeadline(() => Promise.resolve('ok'), 8000)).resolves.toBe('ok');
  expect(vi.getTimerCount()).toBe(0);
});
