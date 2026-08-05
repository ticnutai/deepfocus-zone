import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { resolvePublishedPermissions } from "@/lib/auth/localPermissionBoundary";

export type PermissionModule = "decks" | "cards" | "goals" | "shas" | "analytics" | "users" | "roles" | "settings";
export type PermissionAction = "view" | "create" | "edit" | "delete" | "manage";

interface PermSet {
  isAdmin: boolean;
  matrix: Record<string, boolean>; // key = `${module}:${action}`
  roles: { id: string; name: string }[];
}

type PermissionsCtx = PermSet & {
  loading: boolean;
  can: (m: PermissionModule, a: PermissionAction) => boolean;
  reload: () => Promise<void>;
};

const empty: PermSet = { isAdmin: false, matrix: {}, roles: [] };

type UserRoleRow = { role_id: string; app_roles: { id: string; name: string } | null };
type RolePermRow = { module: string; action: string; allowed: boolean };

const PermissionsContext = createContext<PermissionsCtx>({
  ...empty,
  loading: true,
  can: () => false,
  reload: async () => {},
});

const LS_PERMS_KEY = (uid: string) => `pashash:perms:${uid}`;

function readCachedPerms(uid: string): PermSet | null {
  try {
    const raw = localStorage.getItem(LS_PERMS_KEY(uid));
    if (!raw) return null;
    return JSON.parse(raw) as PermSet;
  } catch { return null; }
}

function writeCachedPerms(uid: string, perms: PermSet): void {
  try { localStorage.setItem(LS_PERMS_KEY(uid), JSON.stringify(perms)); } catch { /* ignore */ }
}

function runWhenBrowserIdle(fn: () => void, timeout = 2000): void {
  const ric = (window as typeof window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
  }).requestIdleCallback;
  if (typeof ric === "function") {
    ric(() => fn(), { timeout });
    return;
  }
  window.setTimeout(fn, 0);
}

async function fetchUserRoles(userId: string): Promise<{ isAdmin: boolean; roles: { id: string; name: string }[]; roleIds: string[] }> {
  const { data: ur } = await supabase
    .from("user_roles")
    .select("role_id, app_roles(id,name)")
    .eq("user_id", userId);

  const urRows = (ur ?? []) as unknown as UserRoleRow[];
  const roleIds = urRows.map((r) => r.role_id).filter((id): id is string => !!id);
  const roles = urRows.map((r) => ({ id: r.app_roles?.id, name: r.app_roles?.name })).filter((r) => r.id) as { id: string; name: string }[];
  const isAdmin = roles.some((r) => r.name === "admin");
  return { isAdmin, roles, roleIds };
}

async function fetchRoleMatrix(roleIds: string[]): Promise<Record<string, boolean>> {
  const matrix: Record<string, boolean> = {};
  if (!roleIds.length) return matrix;
  const { data: rp } = await supabase
    .from("role_permissions")
    .select("module, action, allowed")
    .in("role_id", roleIds);
  ((rp ?? []) as unknown as RolePermRow[]).forEach((row) => {
    const key = `${row.module}:${row.action}`;
    if (row.allowed) matrix[key] = true;
  });
  return matrix;
}

async function fetchPerms(userId: string, opts?: { deferMatrix?: boolean; seedMatrix?: Record<string, boolean> }): Promise<PermSet> {
  const rolesData = await fetchUserRoles(userId);
  if (rolesData.isAdmin || !rolesData.roleIds.length) {
    return { isAdmin: rolesData.isAdmin, matrix: {}, roles: rolesData.roles };
  }
  if (opts?.deferMatrix) {
    return {
      isAdmin: false,
      roles: rolesData.roles,
      matrix: opts.seedMatrix ?? {},
    };
  }
  const matrix = await fetchRoleMatrix(rolesData.roleIds);
  return { isAdmin: false, matrix, roles: rolesData.roles };
}

/** Mount once (inside AuthProvider) — all usePermissions() calls share a single fetch. */
export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { user, isGuest, guestProfile } = useAuth();
  const [perms, setPerms] = useState<PermSet>(empty);
  const [loading, setLoading] = useState(true);

  // Use userId string (not user object) as dep — avoids re-fetch on token refresh
  // where user object reference changes but user.id stays the same.
  const userId = user?.id ?? null;

  const matrixRefreshInFlight = useRef<string | null>(null);

  const load = useCallback(async (forceNetwork = false) => {
    if (isGuest) {
      if (!guestProfile) {
        setPerms(empty);
        setLoading(false);
        return;
      }

      // Guest/local mode never resolves a live cloud role. A guest profile is
      // only a presentation/content preset; its published permission snapshot
      // is clamped by the central non-admin boundary.
      setPerms(resolvePublishedPermissions(empty, true, guestProfile));

      setLoading(false);
      return;
    }

    if (!userId) { setPerms(empty); setLoading(false); return; }

    const cached = forceNetwork ? null : readCachedPerms(userId);

    // Serve stale immediately so the page renders without waiting for network.
    if (cached) {
      setPerms(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    const seedMatrix = cached?.matrix ?? {};
    const base = await fetchPerms(userId, { deferMatrix: !forceNetwork, seedMatrix });
    setPerms(base);
    setLoading(false);
    writeCachedPerms(userId, base);

    if (base.isAdmin) return;

    const roleKey = `${userId}:${base.roles.map((r) => r.id).sort().join(",")}`;
    if (matrixRefreshInFlight.current === roleKey) return;
    matrixRefreshInFlight.current = roleKey;

    const refreshMatrix = async () => {
      try {
        const latest = await fetchUserRoles(userId);
        if (latest.isAdmin || !latest.roleIds.length) {
          const next: PermSet = { isAdmin: latest.isAdmin, roles: latest.roles, matrix: {} };
          setPerms(next);
          writeCachedPerms(userId, next);
          return;
        }
        const matrix = await fetchRoleMatrix(latest.roleIds);
        const next: PermSet = { isAdmin: false, roles: latest.roles, matrix };
        setPerms(next);
        writeCachedPerms(userId, next);
      } finally {
        matrixRefreshInFlight.current = null;
      }
    };

    if (forceNetwork) {
      await refreshMatrix();
      return;
    }

    runWhenBrowserIdle(() => {
      void refreshMatrix();
    });
  }, [guestProfile, isGuest, userId]);

  useEffect(() => { void load(); }, [load]);

  // Switching from a cloud administrator to the machine-local profile must be
  // fail-closed synchronously. React effects run after render, so publishing
  // the previous `perms` state here would otherwise expose one render with the
  // administrator navigation still enabled.
  const publishedPerms = resolvePublishedPermissions(perms, isGuest, guestProfile);

  const can = useCallback(
    (m: PermissionModule, a: PermissionAction) => publishedPerms.isAdmin || !!publishedPerms.matrix[`${m}:${a}`],
    [publishedPerms],
  );

  return (
    <PermissionsContext.Provider value={{ ...publishedPerms, loading, can, reload: () => load(true) }}>
      {children}
    </PermissionsContext.Provider>
  );
}

/** Read permissions from the nearest PermissionsProvider (single shared fetch). */
export function usePermissions() {
  return useContext(PermissionsContext);
}
