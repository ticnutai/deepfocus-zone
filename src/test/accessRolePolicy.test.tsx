import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
const mock = vi.hoisted(() => ({
  auth: { user: null as { id: string } | null, isGuest: true, localIdentity: 'anonymous' },
  rpc: vi.fn(), from: vi.fn(), policy: {} as Record<string, unknown>,
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mock.auth }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mock.rpc, from: mock.from } }));
import { ACCESS_KINDS, ACCESS_POLICY_EVENT, accessKindForIdentity, cachedAccessPolicy, normalizeAccessPolicy } from '@/lib/auth/accessRolePolicy';
import { PermissionsProvider, usePermissions } from '@/hooks/usePermissions';
import { rememberAdminVerification, setVerifiedOfflineAccount } from '@/lib/auth/offlineAdmin';

const baseline = { 'cards:view': true, 'cards:create': true, 'decks:edit': false };
const wrapper = ({ children }: { children: ReactNode }) => <PermissionsProvider>{children}</PermissionsProvider>;
const response = (data: unknown, error: unknown = null) => {
  const promise = Promise.resolve({ data, error });
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    abortSignal: () => chain,
    maybeSingle: () => promise,
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  });
  return chain;
};
const online = (value: boolean) => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
};
beforeEach(() => {
  window.history.replaceState({}, '', '/');
  localStorage.clear();
  sessionStorage.clear();
  online(true);
  mock.auth = { user: null, isGuest: true, localIdentity: 'anonymous' };
  mock.policy = Object.fromEntries(ACCESS_KINDS.map((kind) => [kind, { id: kind, name: kind, matrix: { ...baseline } }]));
  mock.rpc.mockImplementation(() => response(mock.policy));
  mock.from.mockImplementation((table: string) => response(table === 'user_roles' ? [] : []));
});
afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.clearAllMocks();
});

describe('canonical identity roles', () => {
  it('never publishes a settled denial while a new identity is loading', async () => {
    const frames: { loading: boolean; admin: boolean }[] = [];
    const { rerender } = renderHook(() => {
      const permissions = usePermissions();
      frames.push({ loading: permissions.loading, admin: permissions.isAdmin });
      return permissions;
    }, { wrapper });
    await waitFor(() => expect(frames.at(-1)?.loading).toBe(false));
    let finish!: (value: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    const chain = { select: () => chain, eq: () => chain, abortSignal: () => pending };
    mock.from.mockReturnValue(chain);
    frames.length = 0;
    mock.auth = { user: { id: 'delayed-admin' }, isGuest: false, localIdentity: 'anonymous' };
    rerender();
    await waitFor(() => expect(mock.from).toHaveBeenCalled());
    expect(frames.every(frame => frame.loading)).toBe(true);
    await act(async () => finish({ data: [{ app_roles: { id: 'admin', name: 'admin', access_kind: 'admin' } }], error: null }));
    expect(frames.at(-1)).toEqual({ loading: false, admin: true });
    expect(frames.some(frame => !frame.loading && !frame.admin)).toBe(false);
  });
  it('restores an offline administrator only for the password-verified local account', async () => {
    online(false);
    rememberAdminVerification('admin-user', true);
    localStorage.setItem('local-accounts:v1', JSON.stringify([{ username: 'admin', userId: 'admin-user', status: 'registered' }]));
    setVerifiedOfflineAccount('admin-user');
    mock.auth = { user: null, isGuest: true, localIdentity: 'account' };
    const { result, rerender } = renderHook(usePermissions, { wrapper });
    await waitFor(() => expect(result.current.isAdmin).toBe(true));
    for (const module of ['decks', 'cards', 'goals', 'shas', 'analytics', 'users', 'roles', 'settings'] as const) {
      for (const action of ['view', 'create', 'edit', 'delete', 'manage'] as const) expect(result.current.can(module, action)).toBe(true);
    }
    setVerifiedOfflineAccount(null);
    rerender();
    expect(result.current.isAdmin).toBe(false);
  });
  it('does not transfer local admin authority to a different active account', () => {
    online(false);
    rememberAdminVerification('admin-user', true);
    setVerifiedOfflineAccount('admin-user');
    localStorage.setItem('local-accounts:v1', JSON.stringify([{ username: 'other', userId: 'other-user', status: 'registered' }]));
    mock.auth = { user: null, isGuest: true, localIdentity: 'account' };
    const { result } = renderHook(usePermissions, { wrapper });
    expect(result.current.isAdmin).toBe(false);
  });
  it('forgets offline administrator authority after the server removes the role', async () => {
    mock.auth = { user: { id: 'admin-user' }, isGuest: false, localIdentity: 'anonymous' };
    rememberAdminVerification('admin-user', true);
    const { result } = renderHook(usePermissions, { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => online(false));
    expect(result.current.isAdmin).toBe(false);
  });
  it.each([
    [true, false, true, 'registered'], [true, false, false, 'registered_offline'],
    [false, false, true, 'anonymous_online'], [false, false, false, 'anonymous_offline'],
    [false, true, false, 'registered_offline'], [false, true, true, 'registered_offline'],
  ])('selects identity and connection explicitly (%s,%s,%s)', (cloud, local, connected, kind) => {
    expect(accessKindForIdentity(cloud as boolean, local as boolean, connected as boolean)).toBe(kind);
  });
  it('bundles the registered baseline for a first offline start', () => {
    const policy = cachedAccessPolicy();
    expect(Object.keys(policy)).toHaveLength(4);
    for (const role of Object.values(policy)) {
      expect(role.matrix).toEqual(policy.registered?.matrix);
      expect(role.matrix['cards:create']).toBe(true);
      expect(role.matrix['settings:manage']).toBe(false);
    }
  });
  it('does not accept administrator permissions from a public/guest snapshot', () => {
    const policy = normalizeAccessPolicy({ anonymous_offline: { id: 'x', name: 'guest', isAdmin: true,
      matrix: { 'roles:manage': true, 'users:delete': true, 'cards:view': true } }, admin: { id:'admin', matrix:{} } });
    expect(policy.anonymous_offline?.matrix).toEqual({ 'cards:view': true });
    expect(Object.keys(policy)).toEqual(['anonymous_offline']);
  });
  it('keeps anonymous and named local roles separate when connected', async () => {
    const { result, rerender } = renderHook(usePermissions, { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.accessKind).toBe('anonymous_online');
    mock.auth = { ...mock.auth, localIdentity:'account' };
    rerender();
    await waitFor(() => expect(result.current.roles[0].id).toBe('registered_offline'));
    expect(result.current.isAdmin).toBe(false);
  });
  it('ignores stale administrator cache on offline startup', async () => {
    mock.auth = { user: { id:'former-admin' }, isGuest:false, localIdentity:'anonymous' };
    localStorage.setItem('pashash:perms:former-admin', JSON.stringify({ isAdmin:true, matrix:{}, roles:[{id:'admin',name:'admin'}] }));
    online(false);
    const { result } = renderHook(usePermissions, { wrapper });
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.accessKind).toBe('registered_offline');
    expect(result.current.can('users','manage')).toBe(false);
    expect(mock.from).not.toHaveBeenCalled();
  });
  it('retains verified admin on disconnect but removes it immediately on guest switch', async () => {
    mock.auth = { user: { id:'admin-user' }, isGuest:false, localIdentity:'anonymous' };
    mock.from.mockReturnValue(response([{ app_roles:{ id:'admin',name:'admin',access_kind:'admin' } }]));
    const { result, rerender } = renderHook(usePermissions, { wrapper });
    await waitFor(() => expect(result.current.isAdmin).toBe(true));
    expect(result.current.can('users','delete')).toBe(true);
    act(() => online(false));
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.accessKind).toBe('admin');
    act(() => online(true));
    expect(result.current.isAdmin).toBe(false);
    await waitFor(() => expect(result.current.isAdmin).toBe(true));
    mock.auth = { user:null,isGuest:true,localIdentity:'anonymous' };
    rerender();
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.can('roles','manage')).toBe(false);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
  it('rejects a late admin response after identity change', async () => {
    let resolveRoles!: (result: unknown) => void;
    const pending = new Promise((resolve) => { resolveRoles = resolve; });
    const chain = { select: () => chain, eq: () => chain, abortSignal: () => pending };
    mock.auth = { user:{id:'old-admin'},isGuest:false,localIdentity:'anonymous' };
    mock.from.mockReturnValue(chain);
    const { result, rerender } = renderHook(usePermissions, { wrapper });
    await waitFor(() => expect(mock.from).toHaveBeenCalled());
    mock.auth = { user:null,isGuest:true,localIdentity:'anonymous' };
    rerender();
    await act(async () => resolveRoles({data:[{app_roles:{id:'admin',name:'admin',access_kind:'admin'}}],error:null}));
    expect(result.current.isAdmin).toBe(false);
  });
  it('gives any registered account its baseline and honors explicit personal denial', async () => {
    mock.auth = { user:{id:'registered-user'},isGuest:false,localIdentity:'anonymous' };
    mock.from.mockImplementation((table:string) => response(table === 'user_roles' ? [] : table === 'role_permissions'
      ? [{module:'cards',action:'create',allowed:true},{module:'cards',action:'view',allowed:true}]
      : [{module:'cards',action:'create',allowed:false}]));
    const { result } = renderHook(usePermissions, { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.roles[0].id).toBe('registered');
    expect(result.current.can('cards','view')).toBe(true);
    expect(result.current.can('cards','create')).toBe(false);
  });
  it('replaces registered grants with the selected custom role and restores the default when removed', async () => {
    mock.auth = { user:{id:'custom-user'},isGuest:false,localIdentity:'anonymous' };
    let assigned = true;
    const queried: string[][] = [];
    mock.from.mockImplementation((table:string) => {
      if (table === 'user_roles') return response(assigned ? [
        {app_roles:{id:'registered',name:'registered',access_kind:'registered'}},
        {app_roles:{id:'ofli',name:'אופלי',access_kind:null}},
      ] : []);
      if (table === 'profiles') return response({role_baseline_enabled: !assigned});
      if (table === 'role_permissions') {
        const chain = response([]);
        chain.in = (_key:string, ids:string[]) => {
          queried.push(ids);
          return response([{module:'cards',action:'view',allowed:true},
            {module:'cards',action:'create',allowed:ids.includes('registered')}]);
        };
        return chain;
      }
      return response([]);
    });
    const {result} = renderHook(usePermissions,{wrapper});
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(queried[0]).toEqual(['ofli']);
    expect(result.current.roles.map(r=>r.id)).toEqual(['ofli']);
    expect(result.current.can('cards','view')).toBe(true);
    expect(result.current.can('cards','create')).toBe(false);
    assigned=false;
    await act(async()=>{await result.current.reload();});
    expect(result.current.roles.map(r=>r.id)).toEqual(['registered']);
    expect(result.current.can('cards','create')).toBe(true);
  });
  it('refreshes only the configured role without copying changes to other roles', async () => {
    const { result, rerender } = renderHook(usePermissions, { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    mock.policy.anonymous_online = {id:'anonymous_online',name:'guest',matrix:{'cards:view':false}};
    await act(async () => { await result.current.reload(); });
    expect(result.current.can('cards','view')).toBe(false);
    expect(cachedAccessPolicy().anonymous_online?.matrix['cards:view']).toBe(false);
    mock.auth = {...mock.auth,localIdentity:'account'};
    rerender();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.can('cards','view')).toBe(true);
  });
  it('fails closed on a server error even with cached admin data', async () => {
    mock.auth = { user:{id:'old-admin'},isGuest:false,localIdentity:'anonymous' };
    mock.rpc.mockReturnValue(response(null, Error('offline')));
    const { result } = renderHook(usePermissions, { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.accessKind).toBe('registered_offline');
  });

  it('uses the selected role matrix in preview and never publishes the viewer admin matrix', async () => {
    window.history.replaceState({}, '', '/?previewRole=role-zero');
    mock.auth = { user: { id:'admin-user' }, isGuest:false, localIdentity:'anonymous' };
    mock.from.mockImplementation((table: string) => {
      if (table === 'user_roles') return response([{ app_roles:{ id:'admin',name:'admin',access_kind:'admin' } }]);
      if (table === 'app_roles') return response({ id:'role-zero',name:'ללא הרשאות',access_kind:null });
      if (table === 'role_permissions') return response([]);
      return response([]);
    });
    const { result } = renderHook(usePermissions, { wrapper });
    expect(result.current.isAdmin).toBe(false);
    await waitFor(() => expect(result.current.viewerIsAdmin).toBe(true));
    expect(result.current.previewRoleId).toBe('role-zero');
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.roles).toEqual([{ id:'role-zero',name:'ללא הרשאות' }]);
    expect(result.current.can('users','manage')).toBe(false);
    expect(result.current.can('cards','view')).toBe(false);
  });
});
