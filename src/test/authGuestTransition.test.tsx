import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ callback: null as any, resolve: null as any }));
vi.mock('@/integrations/supabase/client', () => ({
  clearPersistedSupabaseSession: vi.fn(),
  supabase: { auth: {
    getSession: () => new Promise(resolve => { auth.resolve = resolve; }),
    onAuthStateChange: (callback: any) => { auth.callback = callback; return {data:{subscription:{unsubscribe:vi.fn()}}}; },
    signOut: () => Promise.reject(new Error('offline')),
    stopAutoRefresh: vi.fn(), startAutoRefresh: vi.fn(),
  } },
}));
vi.mock('@/lib/auth/activityTracking', () => ({startCloudActivityTracking: () => () => {}}));
vi.mock('@/lib/auth/localAccount', () => ({getPendingRegistration: () => null, getLocalAccount: () => null}));
import { AuthProvider, useAuth } from '@/hooks/useAuth';

describe('explicit anonymous identity', () => {
  it('ignores delayed admin boot/session events and logs out locally offline', async () => {
    localStorage.clear();
    let current: ReturnType<typeof useAuth>;
    function Probe() { current = useAuth(); return null; }
    const view = render(<AuthProvider><Probe /></AuthProvider>);
    act(() => current.signInAsGuest());
    const admin = {user:{id:'admin',email:'admin@example.test'}};
    await act(async () => auth.resolve({data:{session:admin}}));
    await waitFor(() => expect(current.loading).toBe(false));
    act(() => auth.callback('SIGNED_IN', admin));
    expect(current.isGuest).toBe(true);
    expect(current.user?.id).toBe('guest');
    expect(current.session).toBeNull();
    await act(async () => current.signOut());
    expect(current.user).toBeNull();
    view.unmount();
  });
});
