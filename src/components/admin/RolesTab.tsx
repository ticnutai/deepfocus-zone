import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, Lock, UserX } from "lucide-react";
import {
  saveGuestViewProfile,
} from "@/lib/auth/guestViewProfile";
import type { SidebarConfig, WidgetLayout } from "@/lib/study/types";
import {
  loadFeatureBlocklistProfiles,
  loadRoleBlocklistAssignments,
  saveFeatureBlocklistProfiles,
  saveRoleBlocklistAssignments,
  type BlocklistScope,
} from "@/lib/study/featureBlocklist";
import { PROFILE_B_PROFILE_NAME } from "@/lib/study/profileBMode";

interface Role { id: string; name: string; description: string | null; is_system: boolean; }
interface RolePermRow { module: string; action: string; allowed: boolean; }
interface RoleDefaultsRow { sidebar_config: SidebarConfig[] | null; widget_layout: WidgetLayout | null; }
type PermissionModule = "decks" | "cards" | "goals" | "shas" | "analytics" | "users" | "roles" | "settings";
type PermissionAction = "view" | "create" | "edit" | "delete" | "manage";

const ALL_MODULES: PermissionModule[] = ["decks", "cards", "goals", "shas", "analytics", "users", "roles", "settings"];
const ALL_ACTIONS: PermissionAction[] = ["view", "create", "edit", "delete", "manage"];

const PROFILE_B_ALLOWED = new Set<string>([
  "decks:view",
  "decks:create",
  "decks:edit",
  "decks:delete",
  "cards:view",
  "cards:create",
  "cards:edit",
  "cards:delete",
  "goals:view",
  "goals:create",
  "goals:edit",
  "shas:view",
  "analytics:view",
]);

export function RolesTab() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("app_roles").select("*").order("is_system", { ascending: false }).order("name");
    setRoles((data ?? []) as Role[]);
  };
  useEffect(() => { load(); }, []);

  const ensureProfileBAssignmentForScope = async (roleId: string, scope: BlocklistScope) => {
    const [profiles, assignments] = await Promise.all([
      loadFeatureBlocklistProfiles({ scope }),
      loadRoleBlocklistAssignments({ scope }),
    ]);

    const normalizedName = PROFILE_B_PROFILE_NAME.trim().toLowerCase();
    let profile = profiles.find((row) => row.name.trim().toLowerCase() === normalizedName);
    if (!profile) {
      profile = {
        id: crypto.randomUUID(),
        name: PROFILE_B_PROFILE_NAME,
        blocklist: { sections: ["backup", "backup-restore"], widgets: {} },
        updatedAt: Date.now(),
      };
      await saveFeatureBlocklistProfiles([...profiles, profile], { scope });
    }

    const withoutRole = assignments.filter((row) => row.roleId !== roleId);
    withoutRole.push({ id: crypto.randomUUID(), roleId, profileId: profile.id });
    await saveRoleBlocklistAssignments(withoutRole, { scope });
  };

  const installProfileB = async () => {
    setBusy(true);
    try {
      let role = roles.find((r) => r.name === "profile_b");
      if (!role) {
        const { data, error } = await supabase
          .from("app_roles")
          .insert({ name: "profile_b", description: "פרופיל B: pull-only + local-create", is_system: false })
          .select()
          .single();
        if (error) throw new Error(error.message);
        role = data as Role;
      }

      await supabase.from("role_permissions").delete().eq("role_id", role.id);
      const permissionRows = ALL_MODULES.flatMap((module) =>
        ALL_ACTIONS.map((action) => ({
          role_id: role!.id,
          module,
          action,
          allowed: PROFILE_B_ALLOWED.has(`${module}:${action}`),
        })),
      );
      await supabase.from("role_permissions").insert(permissionRows as never[]);

      await Promise.all([
        ensureProfileBAssignmentForScope(role.id, "desktop"),
        ensureProfileBAssignmentForScope(role.id, "mobile"),
      ]);

      const guestSnapshot = await (async () => {
        const [{ data: perms, error: permsError }, { data: defaults, error: defaultsError }] = await Promise.all([
          supabase.from("role_permissions").select("module,action,allowed").eq("role_id", role!.id),
          supabase.from("role_layout_defaults").select("sidebar_config,widget_layout").eq("role_id", role!.id).maybeSingle(),
        ]);
        if (permsError) throw new Error(permsError.message);
        if (defaultsError) throw new Error(defaultsError.message);

        const matrix: Record<string, boolean> = {};
        ((perms ?? []) as RolePermRow[]).forEach((row) => {
          if (row.allowed) matrix[`${row.module}:${row.action}`] = true;
        });

        return saveGuestViewProfile({
          id: `role:${role!.id}`,
          label: `תצוגת אורח: ${role!.name}`,
          roleId: role!.id,
          roleName: role!.name,
          isAdmin: false,
          roles: [{ id: role!.id, name: role!.name }],
          matrix,
          sidebarConfig: ((defaults as RoleDefaultsRow | null)?.sidebar_config ?? undefined) ?? undefined,
          widgetLayout: ((defaults as RoleDefaultsRow | null)?.widget_layout ?? undefined) ?? undefined,
        });
      })();

      void guestSnapshot;
      toast.success("פרופיל B הותקן. אפשר לשייך אותו לאורח או לכל תפקיד לפי בחירה.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "התקנת פרופיל B נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!name.trim()) return toast.error("הזן שם תפקיד");
    setBusy(true);
    const { data, error } = await supabase
      .from("app_roles")
      .insert({ name: name.trim(), description: desc.trim() || null, is_system: false })
      .select()
      .single();
    if (error) { setBusy(false); return toast.error(error.message); }
    // seed permissions = all false
    const modules = ["decks","cards","goals","shas","analytics","users","roles","settings"] as const;
    const actions = ["view","create","edit","delete","manage"] as const;
    const rows = modules.flatMap((m) => actions.map((a) => ({
      role_id: (data as Role).id, module: m, action: a, allowed: false,
    })));
    await supabase.from("role_permissions").insert(rows as never[]);
    setBusy(false);
    setName(""); setDesc("");
    toast.success("התפקיד נוצר");
    load();
  };

  const remove = async (id: string) => {
    setBusy(true);
    const { error } = await supabase.from("app_roles").delete().eq("id", id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("נמחק");
    load();
  };

  const createGuestProfileFromRole = async (role: Role) => {
    setBusy(true);
    try {
      const [{ data: perms, error: permsError }, { data: defaults, error: defaultsError }] = await Promise.all([
        supabase.from("role_permissions").select("module,action,allowed").eq("role_id", role.id),
        supabase.from("role_layout_defaults").select("sidebar_config,widget_layout").eq("role_id", role.id).maybeSingle(),
      ]);

      if (permsError) throw new Error(permsError.message);
      if (defaultsError) throw new Error(defaultsError.message);

      const matrix: Record<string, boolean> = {};
      ((perms ?? []) as RolePermRow[]).forEach((row) => {
        if (row.allowed) matrix[`${row.module}:${row.action}`] = true;
      });

      saveGuestViewProfile({
        id: `role:${role.id}`,
        label: `תצוגת אורח: ${role.name}`,
        roleId: role.id,
        roleName: role.name,
        isAdmin: role.name === "admin",
        roles: [{ id: role.id, name: role.name }],
        matrix,
        sidebarConfig: ((defaults as RoleDefaultsRow | null)?.sidebar_config ?? undefined) ?? undefined,
        widgetLayout: ((defaults as RoleDefaultsRow | null)?.widget_layout ?? undefined) ?? undefined,
      });

      toast.success(`נוצר/עודכן פרופיל אורח לתפקיד ${role.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "יצירת פרופיל אורח נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="gold-frame p-4 space-y-3">
        <h3 className="font-display text-lg font-semibold">תפקיד חדש</h3>
        <div className="grid sm:grid-cols-3 gap-2">
          <Input placeholder="שם (למשל editor)" value={name} onChange={(e) => setName(e.target.value)} />
          <Input className="sm:col-span-2" placeholder="תיאור" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={create} disabled={busy} className="bg-gradient-navy text-primary-foreground">
            <Plus className="h-4 w-4" /> הוסף תפקיד
          </Button>
          <Button variant="outline" onClick={installProfileB} disabled={busy}>
            התקן פרופיל B
          </Button>
        </div>
      </Card>

      <Card className="gold-frame p-4 space-y-2">
        <h3 className="font-display text-lg font-semibold mb-2">תפקידים קיימים</h3>
        {roles.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl border-2 border-gold/40 bg-card p-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">{r.name}</span>
                {r.is_system && <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" /> מובנה</Badge>}
              </div>
              {r.description && <div className="text-xs text-muted-foreground mt-0.5">{r.description}</div>}
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => createGuestProfileFromRole(r)} disabled={busy}>
                <UserX className="h-4 w-4" />
                פרופיל אורח
              </Button>
              {!r.is_system && (
                <Button variant="ghost" size="icon" onClick={() => remove(r.id)} className="text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        ))}
        {!roles.length && <div className="text-center text-sm text-muted-foreground py-4">אין תפקידים</div>}
      </Card>
    </div>
  );
}
