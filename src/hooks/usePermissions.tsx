import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { getVerifiedOfflineAccount, hasVerifiedOfflineAdmin, rememberAdminVerification } from '@/lib/auth/offlineAdmin';
import { getActiveLocalAccount } from '@/lib/auth/localAccount';
import { settleOnAbort } from '@/lib/requestDeadline';
import { startupCheckpoint } from '@/lib/debug/startupDiagnostics';
import {
  ACCESS_POLICY_EVENT, accessKindForIdentity, cachedAccessPolicy, loadAccessPolicy,
  type AccessKind, type AccessRolePolicy,
} from "@/lib/auth/accessRolePolicy";

export type PermissionModule = "decks" | "cards" | "goals" | "shas" | "analytics" | "users" | "roles" | "settings";
export type PermissionAction = "view" | "create" | "edit" | "delete" | "manage";
interface PermSet {
  isAdmin: boolean;
  matrix: Record<string, boolean>;
  roles: { id: string; name: string }[];
}
type PermissionsCtx = PermSet & {
  loading: boolean;
  /** The signed-in account's real administrator state (before role preview). */
  viewerIsAdmin: boolean;
  previewRoleId?: string;
  accessKind?: AccessKind | 'admin';
  can: (m: PermissionModule, a: PermissionAction) => boolean;
  /**
   * Permissions used only to decide what is shown in the ordinary learner UI.
   * An administrator keeps full authority through `can`, while their default
   * presentation follows the same connected/offline baseline as a registered
   * learner. Role preview continues to render the selected role exactly.
   */
  presentationIsAdmin: boolean;
  presentationRoles: { id: string; name: string }[];
  canPresent: (m: PermissionModule, a: PermissionAction) => boolean;
  reload: () => Promise<void>;
};
const empty: PermSet = { isAdmin: false, matrix: {}, roles: [] };
const PermissionsContext = createContext<PermissionsCtx>({
  ...empty, loading: true, viewerIsAdmin: false, presentationIsAdmin: false, presentationRoles: [],
  can: () => false, canPresent: () => false, reload: async () => {},
});

type Role = { id: string; name: string; access_kind: string | null };
type PermissionRow = { module: string; action: string; allowed: boolean };

async function fetchCloudPermissions(userId: string, policy: AccessRolePolicy, signal: AbortSignal): Promise<PermSet> {
  const { data, error } = await supabase.from('user_roles')
    .select('app_roles(id,name,access_kind)').eq('user_id', userId).abortSignal(signal);
  if (error) throw error;
  const assigned = ((data ?? []) as unknown as { app_roles: Role | null }[])
    .flatMap((row) => row.app_roles ? [row.app_roles] : []);
  if (assigned.some((role) => role.name === 'admin')) return { isAdmin: true, roles: assigned, matrix: {} };
  const baseline = policy.registered;
  if (!baseline) throw new Error('Registered access policy is missing');
  // Connectivity roles are automatic, never additive manually assigned privileges.
  const custom = assigned.filter((role) => !role.access_kind && role.id !== baseline.id);
  const profile = await supabase.from('profiles').select('role_baseline_enabled').eq('id',userId).abortSignal(signal).maybeSingle();
  if (profile.error) throw profile.error;
  const roles = profile.data?.role_baseline_enabled === false ? custom : [baseline, ...custom];
  const [permissions, overrides] = await Promise.all([
    supabase.from('role_permissions').select('module,action,allowed')
      .in('role_id', roles.map((role) => role.id)).abortSignal(signal),
    supabase.from('user_permission_overrides').select('module,action,allowed')
      .eq('user_id', userId).abortSignal(signal),
  ]);
  if (permissions.error) throw permissions.error;
  if (overrides.error) throw overrides.error;
  const matrix: Record<string, boolean> = {};
  for (const row of (permissions.data ?? []) as PermissionRow[]) {
    if (row.allowed) matrix[`${row.module}:${row.action}`] = true;
  }
  for (const row of (overrides.data ?? []) as PermissionRow[]) {
    matrix[`${row.module}:${row.action}`] = row.allowed;
  }
  for (const key of Object.keys(matrix)) {
    if (key.startsWith('users:') || key.startsWith('roles:')) matrix[key] = false;
  }
  return { isAdmin: false, roles: roles.map(({ id, name }) => ({ id, name })), matrix };
}

/**
 * Resolve exactly one role for the protected admin preview. This deliberately
 * ignores the administrator's own roles and personal overrides so the UI is
 * rendered from the selected role's effective matrix instead of leaking the
 * administrator matrix into the preview iframe.
 */
async function fetchPreviewRolePermissions(roleId: string, signal: AbortSignal): Promise<PermSet> {
  const [roleResult, permissionResult] = await Promise.all([
    supabase.from('app_roles').select('id,name,access_kind').eq('id', roleId).abortSignal(signal).maybeSingle(),
    supabase.from('role_permissions').select('module,action,allowed').eq('role_id', roleId).abortSignal(signal),
  ]);
  if (roleResult.error) throw roleResult.error;
  if (permissionResult.error) throw permissionResult.error;
  const role = roleResult.data as Role | null;
  if (!role) throw new Error('Preview role was not found');
  if (role.name === 'admin') return { isAdmin: true, roles: [{ id: role.id, name: role.name }], matrix: {} };
  const matrix: Record<string, boolean> = {};
  for (const row of (permissionResult.data ?? []) as PermissionRow[]) {
    matrix[`${row.module}:${row.action}`] = row.allowed === true;
  }
  for (const key of Object.keys(matrix)) {
    if (key.startsWith('users:') || key.startsWith('roles:')) matrix[key] = false;
  }
  return { isAdmin: false, roles: [{ id: role.id, name: role.name }], matrix };
}

/** Offline admin authority is bound to the same authenticated account, never a guest preset. */
export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { user, isGuest, localIdentity, loading: authLoading } = useAuth();
  const userId = !isGuest && !user?.is_anonymous ? user?.id ?? null : null;
  const verifiedLocalId = getVerifiedOfflineAccount();
  const offlineUserId = isGuest && localIdentity === 'account' && getActiveLocalAccount()?.userId === verifiedLocalId
    ? verifiedLocalId : null;
  const identity = `${userId ?? offlineUserId ?? 'guest'}:${isGuest ? localIdentity : 'cloud'}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const [online, setOnline] = useState(() => navigator.onLine);
  const [networkFailed, setNetworkFailed] = useState(false);
  const [policy, setPolicy] = useState(cachedAccessPolicy);
  const previewRoleId = useMemo(() => typeof window === 'undefined'
    ? ''
    : new URLSearchParams(window.location.search).get('previewRole') ?? '', []);
  const [snapshot, setSnapshot] = useState<{
    owner: string;
    viewer: PermSet;
    preview: PermSet | null;
    adminPresentation: PermSet | null;
  } | null>(null);
  const request = useRef<AbortController | null>(null);
  const [readyIdentity, setReadyIdentity] = useState<string | null>(null);

  const reload = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    startupCheckpoint('permissions:resolve:start','start');
    request.current = controller;
    const valid = () => !controller.signal.aborted && identityRef.current === identity && navigator.onLine;
    if (!navigator.onLine) {
      setSnapshot(null);
      setReadyIdentity(identity);
      return;
    }
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const latest = await settleOnAbort(loadAccessPolicy(controller.signal), controller.signal);
      if (!valid()) return;
      setPolicy(latest);
      const viewer = userId ? await settleOnAbort(fetchCloudPermissions(userId, latest, controller.signal), controller.signal) : null;
      if (!valid()) return;
      if (userId && viewer) rememberAdminVerification(userId, viewer.isAdmin);
      // A real registered account receives permissions from role_permissions,
      // including changes that are newer than the compact connectivity policy.
      // Use that exact source for an administrator's learner-facing shell too;
      // administrator authority itself remains in `viewer`/`can`.
      const registeredRoleId = latest.registered?.id;
      const adminPresentation = viewer?.isAdmin && registeredRoleId
        ? await settleOnAbort(fetchPreviewRolePermissions(registeredRoleId, controller.signal), controller.signal)
        : null;
      if (!valid()) return;
      const preview = previewRoleId && viewer?.isAdmin
        ? await settleOnAbort(fetchPreviewRolePermissions(previewRoleId, controller.signal), controller.signal)
        : null;
      if (!valid()) return;
      setNetworkFailed(false);
      setSnapshot(viewer ? { owner: identity, viewer, preview, adminPresentation } : null);
      startupCheckpoint('permissions:resolve:settled','ok',viewer?.isAdmin?'admin':'non-admin');
    } catch (error) {
      if (identityRef.current === identity && request.current === controller) {
        if (!controller.signal.aborted) console.warn('[permissions] using offline role:', error instanceof Error ? error.message : String(error));
        setSnapshot(null);
        setNetworkFailed(true);
        startupCheckpoint('permissions:resolve:settled',controller.signal.aborted?'timeout':'error');
      }
    } finally {
      window.clearTimeout(timeout);
      if (identityRef.current === identity && request.current === controller) {
        setReadyIdentity(identity);
      }
    }
  }, [identity, previewRoleId, userId]);

  useEffect(() => {
    setSnapshot(null);
    void reload();
    const onOnline = () => { setOnline(true); void reload(); };
    const onOffline = () => {
      request.current?.abort();
      setOnline(false);
      setSnapshot(null);
      setReadyIdentity(identity);
    };
    const onPolicyChange = () => { void reload(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener(ACCESS_POLICY_EVENT, onPolicyChange);
    const timer = window.setInterval(() => { if (navigator.onLine) void reload(); }, 60000);
    return () => {
      request.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener(ACCESS_POLICY_EVENT, onPolicyChange);
    };
  }, [reload]);

  const connected = online && !networkFailed;
  const kind = accessKindForIdentity(!!userId, isGuest && localIdentity === 'account', connected);
  const role = policy[kind];
  const offlineAdmin = (!connected || !!offlineUserId) && hasVerifiedOfflineAdmin(userId ?? offlineUserId);
  // Guard during render, not just effects: a former admin must not leak for one frame.
  const viewer: PermSet = useMemo(() => connected && userId && snapshot?.owner === identity
    ? snapshot.viewer
    : offlineAdmin ? { isAdmin: true, matrix: {}, roles: [{ id: 'verified-offline-admin', name: 'admin' }] }
    : { isAdmin: false, matrix: role?.matrix ?? {}, roles: role ? [{ id: role.id, name: role.name }] : [] },
  [connected, userId, snapshot, identity, role, offlineAdmin]);
  // Preview requests fail closed until both the real administrator and the
  // selected role have been verified. This prevents even a one-frame admin UI
  // leak while the iframe is loading.
  const published: PermSet = useMemo(() => previewRoleId
    ? (viewer.isAdmin && snapshot?.owner === identity && snapshot.preview ? snapshot.preview : empty)
    : viewer,
  [identity, previewRoleId, snapshot, viewer]);
  const can = useCallback((m: PermissionModule, a: PermissionAction) =>
    published.isAdmin || (!!published.matrix[`${m}:view`] && !!published.matrix[`${m}:${a}`]), [published]);
  const presentation: PermSet = useMemo(() => {
    if (previewRoleId) return published;
    if (!viewer.isAdmin) return published;
    if (connected && snapshot?.owner === identity && snapshot.adminPresentation) {
      return snapshot.adminPresentation;
    }
    return {
      isAdmin: false,
      matrix: role?.matrix ?? {},
      roles: role ? [{ id: role.id, name: role.name }] : [],
    };
  }, [connected, identity, previewRoleId, published, role, snapshot, viewer.isAdmin]);
  const canPresent = useCallback((m: PermissionModule, a: PermissionAction) =>
    presentation.isAdmin || (!!presentation.matrix[`${m}:view`] && !!presentation.matrix[`${m}:${a}`]), [presentation]);
  return (
    <PermissionsContext.Provider value={{
      ...published,
      viewerIsAdmin: viewer.isAdmin,
      previewRoleId: previewRoleId || undefined,
      accessKind: published.isAdmin ? 'admin' : kind,
      presentationIsAdmin: presentation.isAdmin,
      presentationRoles: presentation.roles,
      // Identity changes must report pending during render, before effects run.
      // Same-identity background refreshes may keep a verified snapshot visible.
      loading: !!authLoading || readyIdentity !== identity,
      can,
      canPresent,
      reload,
    }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() { return useContext(PermissionsContext); }
