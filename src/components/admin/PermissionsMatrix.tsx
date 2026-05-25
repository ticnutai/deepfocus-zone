import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Lock, LockOpen } from "lucide-react";

const MODULES = ["decks","cards","goals","shas","analytics","users","roles","settings"] as const;
const ACTIONS = ["view","create","edit","delete","manage"] as const;
const MODULE_LABEL: Record<string, string> = {
  decks: "מערכות", cards: "כרטיסים", goals: "יעדים", shas: 'ש"ס',
  analytics: "ניתוח", users: "משתמשים", roles: "תפקידים", settings: "הגדרות",
};
const ACTION_LABEL: Record<string, string> = {
  view: "צפייה", create: "יצירה", edit: "עריכה", delete: "מחיקה", manage: "ניהול",
};

interface Role { id: string; name: string; is_system: boolean; }
interface Perm { id: string; role_id: string; module: string; action: string; allowed: boolean; }

export function PermissionsMatrix() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [perms, setPerms] = useState<Perm[]>([]);

  const load = useCallback(async () => {
    const { data: r } = await supabase.from("app_roles").select("*").order("is_system", { ascending: false }).order("name");
    setRoles((r ?? []) as Role[]);
    if (r?.length) setSelected((prev) => prev || (r as Role[])[0].id);
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selected) return;
    supabase.from("role_permissions").select("*").eq("role_id", selected)
      .then(({ data }) => setPerms((data ?? []) as Perm[]));
  }, [selected]);

  const reloadPerms = useCallback(async (roleId: string) => {
    const { data } = await supabase.from("role_permissions").select("*").eq("role_id", roleId);
    setPerms((data ?? []) as Perm[]);
  }, []);

  const map = useMemo(() => {
    const m: Record<string, Perm> = {};
    perms.forEach((p) => { m[`${p.module}:${p.action}`] = p; });
    return m;
  }, [perms]);

  const role = roles.find((r) => r.id === selected);
  const isAdminRole = role?.name === "admin";

  const toggle = async (module: string, action: string, allowed: boolean) => {
    const existing = map[`${module}:${action}`];
    if (existing) {
      // optimistic
      setPerms((arr) => arr.map((p) => p.id === existing.id ? { ...p, allowed } : p));
      const { error } = await supabase.from("role_permissions").update({ allowed }).eq("id", existing.id);
      if (error) { toast.error(error.message); load(); }
    } else {
      const { data, error } = await supabase.from("role_permissions")
        .insert({ role_id: selected, module: module as never, action: action as never, allowed })
        .select().single();
      if (error) return toast.error(error.message);
      setPerms((arr) => [...arr, data as Perm]);
    }
  };

  const isActionAllowed = useCallback((module: string, action: string): boolean => {
    if (isAdminRole) return true;
    return !!map[`${module}:${action}`]?.allowed;
  }, [isAdminRole, map]);

  const isModuleAllAllowed = useCallback((module: string): boolean => {
    return ACTIONS.every((action) => isActionAllowed(module, action));
  }, [isActionAllowed]);

  const isAllAllowed = useMemo(() => MODULES.every((module) => isModuleAllAllowed(module)), [isModuleAllAllowed]);

  const setModuleAll = useCallback(async (module: string, allowed: boolean) => {
    if (!selected || isAdminRole) return;

    try {
      await Promise.all(ACTIONS.map(async (action) => {
        const existing = map[`${module}:${action}`];
        if (existing) {
          const { error } = await supabase.from("role_permissions").update({ allowed }).eq("id", existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("role_permissions").insert({
            role_id: selected,
            module: module as never,
            action: action as never,
            allowed,
          });
          if (error) throw error;
        }
      }));
      await reloadPerms(selected);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      await reloadPerms(selected);
    }
  }, [isAdminRole, map, reloadPerms, selected]);

  const setAll = useCallback(async (allowed: boolean) => {
    if (!selected || isAdminRole) return;
    for (const module of MODULES) {
      // Keep calls sequential to avoid overloading writes and reduce race conditions.
      await setModuleAll(module, allowed);
    }
  }, [isAdminRole, selected, setModuleAll]);

  return (
    <Card className="gold-frame p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">תפקיד:</span>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}{r.is_system ? " (מובנה)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isAdminRole && (
            <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" /> אדמין — הכל פתוח</Badge>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1"
          disabled={isAdminRole || !selected}
          onClick={() => void setAll(!isAllAllowed)}
          title={isAllAllowed ? "נקה הכל" : "בחר הכל"}
        >
          {isAllAllowed ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          {isAllAllowed ? "נקה הכל" : "בחר הכל"}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border-2 border-gold/40">
        <table className="w-full text-sm">
          <thead className="bg-secondary">
            <tr>
              <th className="p-2 text-right font-semibold text-foreground">מודול \\ פעולה</th>
              {ACTIONS.map((a) => (
                <th key={a} className="p-2 text-center font-semibold text-foreground">{ACTION_LABEL[a]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODULES.map((m) => (
              <tr key={m} className="border-t border-gold/20 hover:bg-secondary/40">
                <td className="p-2 font-medium text-foreground">
                  <div className="flex items-center justify-between gap-2">
                    <span>{MODULE_LABEL[m]}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px] gap-1"
                      disabled={isAdminRole}
                      onClick={() => void setModuleAll(m, !isModuleAllAllowed(m))}
                      title={isModuleAllAllowed(m) ? "נקה הכל" : "בחר הכל"}
                    >
                      {isModuleAllAllowed(m) ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                      {isModuleAllAllowed(m) ? "נקה הכל" : "בחר הכל"}
                    </Button>
                  </div>
                </td>
                {ACTIONS.map((a) => {
                  const p = map[`${m}:${a}`];
                  const checked = isAdminRole ? true : !!p?.allowed;
                  return (
                    <td key={a} className="p-2 text-center">
                      <div className="flex justify-center">
                        <Switch
                          checked={checked}
                          disabled={isAdminRole}
                          onCheckedChange={(v) => toggle(m, a, v)}
                        />
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        השינויים נשמרים אוטומטית. אדמין מקבל את כל ההרשאות תמיד ולא ניתן לשנות זאת.
      </p>
    </Card>
  );
}
