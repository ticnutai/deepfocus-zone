import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

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

async function fetchPerms(userId: string): Promise<PermSet> {
  const { data: ur } = await supabase
    .from("user_roles")
    .select("role_id, app_roles(id,name)")
    .eq("user_id", userId);
  const urRows = (ur ?? []) as unknown as UserRoleRow[];
  const roleIds = urRows.map((r) => r.role_id);
  const roles = urRows.map((r) => ({ id: r.app_roles?.id, name: r.app_roles?.name })).filter((r) => r.id) as { id: string; name: string }[];
  const isAdmin = roles.some((r) => r.name === "admin");
  const matrix: Record<string, boolean> = {};
  if (roleIds.length) {
    const { data: rp } = await supabase
      .from("role_permissions")
      .select("module, action, allowed")
      .in("role_id", roleIds);
    ((rp ?? []) as unknown as RolePermRow[]).forEach((row) => {
      const key = `${row.module}:${row.action}`;
      if (row.allowed) matrix[key] = true;
    });
  }
  return { isAdmin, matrix, roles };
}

/** Mount once (inside AuthProvider) — all usePermissions() calls share a single fetch. */
export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [perms, setPerms] = useState<PermSet>(empty);
  const [loading, setLoading] = useState(true);

  // Use userId string (not user object) as dep — avoids re-fetch on token refresh
  // where user object reference changes but user.id stays the same.
  const userId = user?.id ?? null;

  const load = useCallback(async (forceNetwork = false) => {
    if (!userId) { setPerms(empty); setLoading(false); return; }

    // Serve stale immediately so the page renders without waiting for network.
    if (!forceNetwork) {
      const cached = readCachedPerms(userId);
      if (cached) {
        setPerms(cached);
        setLoading(false);
        // Revalidate in background — don't block render.
        void (async () => {
          const fresh = await fetchPerms(userId);
          setPerms(fresh);
          writeCachedPerms(userId, fresh);
        })();
        return;
      }
    }

    setLoading(true);
    const fresh = await fetchPerms(userId);
    setPerms(fresh);
    setLoading(false);
    writeCachedPerms(userId, fresh);
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const can = useCallback(
    (m: PermissionModule, a: PermissionAction) => perms.isAdmin || !!perms.matrix[`${m}:${a}`],
    [perms],
  );

  return (
    <PermissionsContext.Provider value={{ ...perms, loading, can, reload: () => load(true) }}>
      {children}
    </PermissionsContext.Provider>
  );
}

/** Read permissions from the nearest PermissionsProvider (single shared fetch). */
export function usePermissions() {
  return useContext(PermissionsContext);
}