import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, Lock, UserX } from "lucide-react";
import { saveGuestViewProfile } from "@/lib/auth/guestViewProfile";
import type { SidebarConfig, WidgetLayout } from "@/lib/study/types";

interface Role { id: string; name: string; description: string | null; is_system: boolean; }
interface RolePermRow { module: string; action: string; allowed: boolean; }
interface RoleDefaultsRow { sidebar_config: SidebarConfig[] | null; widget_layout: WidgetLayout | null; }

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
        <Button onClick={create} disabled={busy} className="bg-gradient-navy text-primary-foreground">
          <Plus className="h-4 w-4" /> הוסף תפקיד
        </Button>
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
