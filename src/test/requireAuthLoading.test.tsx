import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ auth: { user: { id: 'first' }, loading: false, isGuest: false, signOut: vi.fn() }, from: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mock.auth }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mock.from } }));
import { RequireAuth } from '@/components/RequireAuth';
const view = () => <MemoryRouter><RequireAuth><div>protected-content</div></RequireAuth></MemoryRouter>;
function pending() {
  let finish!: (value: unknown) => void;
  const promise = new Promise(resolve => { finish = resolve; });
  const chain = { select: () => chain, eq: () => chain, abortSignal: () => chain, maybeSingle: () => promise };
  mock.from.mockReturnValue(chain);
  return finish;
}
beforeEach(() => { localStorage.clear(); Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }); });
afterEach(() => vi.useRealTimers());
it('finishes a stalled status lookup using the last verified status', async () => {
  vi.useFakeTimers();
  mock.auth.user = { id: 'timeout-approved' };
  localStorage.setItem('pashash:ps:timeout-approved', 'approved');
  pending();
  render(view());
  expect(screen.getByTestId('silent-auth-wait')).toBeInTheDocument();
  expect(screen.queryByText(/טוען/)).not.toBeInTheDocument();
  await act(async () => vi.advanceTimersByTime(8001));
  expect(screen.getByText('protected-content')).toBeInTheDocument();
});
it('preserves a verified blocked account offline', () => {
  mock.auth.user = { id: 'offline-blocked' };
  localStorage.setItem('pashash:ps:offline-blocked', 'blocked');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  render(view());
  expect(screen.getByText('חשבון חסום')).toBeInTheDocument();
  expect(screen.queryByText('protected-content')).not.toBeInTheDocument();
});
it('rechecks status on reconnect without flashing the cached pending message', async () => {
  mock.auth.user = { id: 'reconnecting' };
  const initial = pending();
  render(view());
  await act(async () => initial({ data: { status: 'pending' }, error: null }));
  expect(screen.getByText('ממתין לאישור')).toBeInTheDocument();
  const next = pending();
  act(() => window.dispatchEvent(new Event('online')));
  expect(screen.queryByText('ממתין לאישור')).not.toBeInTheDocument();
  expect(screen.getByTestId('silent-auth-wait')).toBeInTheDocument();
  expect(screen.queryByText(/טוען/)).not.toBeInTheDocument();
  await act(async () => next({ data: { status: 'approved' }, error: null }));
  expect(screen.getByText('protected-content')).toBeInTheDocument();
});
it('does not flash a stale blocked status while checking an approved account', async () => {
  mock.auth.user = { id: 'stale-blocked' };
  localStorage.setItem('pashash:ps:stale-blocked', 'blocked');
  const finish = pending();
  render(view());
  expect(screen.getByTestId('silent-auth-wait')).toBeInTheDocument();
  expect(screen.queryByText(/טוען/)).not.toBeInTheDocument();
  expect(screen.queryByText('חשבון חסום')).not.toBeInTheDocument();
  await act(async () => finish({ data: { status: 'approved' }, error: null }));
  expect(screen.getByText('protected-content')).toBeInTheDocument();
});
it('ignores late results for the previous identity and preserves real denial', async () => {
  mock.auth.user = { id: 'previous' };
  const oldFinish = pending();
  const rendered = render(view());
  mock.auth.user = { id: 'current' };
  const currentFinish = pending();
  rendered.rerender(view());
  await act(async () => oldFinish({ data: { status: 'approved' }, error: null }));
  expect(screen.queryByText('protected-content')).not.toBeInTheDocument();
  await act(async () => currentFinish({ data: { status: 'blocked' }, error: null }));
  expect(screen.getByText('חשבון חסום')).toBeInTheDocument();
  expect(screen.queryByText('protected-content')).not.toBeInTheDocument();
});
