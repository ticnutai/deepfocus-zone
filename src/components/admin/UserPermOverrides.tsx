import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cachedAccessPolicy } from "@/lib/auth/accessRolePolicy";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { UserCog, X, RefreshCw, CheckCheck, Ban } from "lucide-react";

const MODULES = ["decks","cards","goals","shas","analytics","settings"] as const;
const ACTIONS  = ["view","create","edit","delete","manage"] as const;
type PermissionModule = (typeof MODULES)[number];
const MODULE_LABEL: Record<string, string> = {
  decks: "מערכות", cards: "כרטיסים", goals: "יעדים", shas: 'ש"ס',
  analytics: "ניתוח", users: "משתמשים", roles: "תפקידים", settings: "הגדרות",
};
const ACTION_LABEL: Record<string, string> = {
  view: "צפייה", create: "יצירה", edit: "עריכה", delete: "מחיקה", manage: "ניהול",
};

interface Profile { id: string; display_name: string | null; email: string | null; }
interface Override { id: string; user_id: string; module: string; action: string; allowed: boolean; }
interface RolePerm { module: string; action: string; allowed: boolean; }

export function UserPermOverrides() {
  const { user: me } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [basePerms, setBasePerms] = useState<RolePerm[]>([]);
  const [busy, setBusy] = useState(false);

  // Load all profiles
  useEffect(() => {
    Promise.all([
      supabase.from("profiles").select("id, display_name, email").order("display_name"),
      supabase.from("user_roles").select("user_id,app_roles(name)"),
    ]).then(([{ data }, assigned]) => {
        const adminIds = new Set((assigned.data ?? []).filter((row) => row.app_roles?.name === 'admin').map((row) => row.user_id));
        setProfiles(((data ?? []) as Profile[]).filter((profile) => !adminIds.has(profile.id)));
      });
  }, []);

  // Load overrides + base role perms when user changes
  useEffect(() => {
    if (!selectedUser) { setOverrides([]); setBasePerms([]); return; }
    let cancelled = false;
    setOverrides([]);
    setBasePerms([]);
    // load overrides
    supabase.from("user_permission_overrides").select("*").eq("user_id", selectedUser)
      .then(({ data }) => { if (!cancelled) setOverrides((data ?? []) as Override[]); });
    // load base role perms
    supabase.from("user_roles").select("role_id,app_roles(access_kind)").eq("user_id", selectedUser)
      .then(async ({ data: ur }) => {
        const baseline = cachedAccessPolicy().registered?.id;
        const roleIds = [...new Set([...(baseline ? [baseline] : []), ...(ur ?? [])
          .filter((row) => !row.app_roles?.access_kind).map((row) => row.role_id)])];
        if (!roleIds.length || cancelled) return;
        const { data: rp } = await supabase.from("role_permissions")
          .select("module, action, allowed")
          .in("role_id", roleIds)
          .eq("allowed", true);
        if (!cancelled) setBasePerms((rp ?? []) as RolePerm[]);
      });
    return () => { cancelled = true; };
  }, [selectedUser]);

  const overrideMap = useMemo(() => {
    const m: Record<string, Override> = {};
    overrides.forEach((o) => { m[`${o.module}:${o.action}`] = o; });
    return m;
  }, [overrides]);

  const baseMap = useMemo(() => {
    const m = new Set<string>();
    basePerms.forEach((p) => { if (p.allowed) m.add(`${p.module}:${p.action}`); });
    return m;
  }, [basePerms]);

  const setOverride = async (module: string, action: string, allowed: boolean) => {
    if (!selectedUser) return;
    setBusy(true);
    const key = `${module}:${action}`;
    const existing = overrideMap[key];
    if (existing) {
      const { error } = await supabase.from("user_permission_overrides").update({ allowed }).eq("id", existing.id);
      if (error) { toast.error(error.message); setBusy(false); return; }
      setOverrides((arr) => arr.map((o) => o.id === existing.id ? { ...o, allowed } : o));
    } else {
      const { data, error } = await supabase.from("user_permission_overrides")
        .insert({ user_id: selectedUser, module: module as never, action: action as never, allowed, set_by: me?.id ?? null })
        .select().single();
      if (error) { toast.error(error.message); setBusy(false); return; }
      setOverrides((arr) => [...arr, data as Override]);
    }
    setBusy(false);
  };

  const clearOverride = async (module: string, action: string) => {
    const key = `${module}:${action}`;
    const existing = overrideMap[key];
    if (!existing) return;
    setBusy(true);
    const { error } = await supabase.from("user_permission_overrides").delete().eq("id", existing.id);
    if (error) { toast.error(error.message); setBusy(false); return; }
    setOverrides((arr) => arr.filter((o) => o.id !== existing.id));
    setBusy(false);
  };

  const clearAllOverrides = async () => {
    if (!selectedUser || overrides.length === 0) return;
    setBusy(true);
    const { error } = await supabase.from("user_permission_overrides").delete().eq("user_id", selectedUser);
    if (error) { toast.error(error.message); setBusy(false); return; }
    setOverrides([]);
    setBusy(false);
    toast.success("כל הדריסות נמחקו — משתמש יחזור לברירת מחדל של תפקידיו");
  };

  const setModuleRow = async (module: PermissionModule, allowed: boolean) => {
    if (!selectedUser) return;
    setBusy(true);
    const rows = ACTIONS.map((a) => ({
      user_id: selectedUser, module, action: a, allowed, set_by: me?.id ?? null,
    }));
    const { data, error } = await supabase
      .from("user_permission_overrides")
      .upsert(rows, { onConflict: "user_id,module,action" })
      .select();
    if (error) { toast.error(error.message); setBusy(false); return; }
    setOverrides((arr) => [
      ...arr.filter((o) => o.module !== module),
      ...(data as Override[]),
    ]);
    setBusy(false);
  };

  const clearModuleRow = async (module: PermissionModule) => {
    if (!selectedUser) return;
    setBusy(true);
    const { error } = await supabase
      .from("user_permission_overrides")
      .delete()
      .eq("user_id", selectedUser)
      .eq("module", module);
    if (error) { toast.error(error.message); setBusy(false); return; }
    setOverrides((arr) => arr.filter((o) => o.module !== module));
    setBusy(false);
  };

  const setAllOverrides = async (allowed: boolean) => {
    if (!selectedUser) return;
    const label = selectedProfile?.display_name || selectedProfile?.email || "המשתמש הנבחר";
    if (!window.confirm(allowed
      ? `לאשר חריגה רחבה לכל פעולות התוכן עבור ${label}? ההרשאות האישיות יגברו על התפקיד.`
      : `לחסום כחריגה אישית את כל פעולות התוכן עבור ${label}?`)) return;
    setBusy(true);
    const rows = MODULES.flatMap((m) =>
      ACTIONS.map((a) => ({ user_id: selectedUser, module: m, action: a, allowed, set_by: me?.id ?? null }))
    );
    const { data, error } = await supabase
      .from("user_permission_overrides")
      .upsert(rows, { onConflict: "user_id,module,action" })
      .select();
    if (error) { toast.error(error.message); setBusy(false); return; }
    setOverrides(data as Override[]);
    toast.success(allowed ? "כל ההרשאות הופעלו" : "כל ההרשאות נחסמו");
    setBusy(false);
  };

  const selectedProfile = profiles.find((p) => p.id === selectedUser);

  return (
    <TooltipProvider>
      <Card className="gold-frame p-4 space-y-4">
        <div>
          <h3 className="font-display text-lg font-bold">חריגות הרשאה למשתמש</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            ברירת המחדל מגיעה מהתפקיד. השתמש כאן רק במקרה חריג; כל שינוי מסומן ומוצג לצד התוצאה האפקטיבית.
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <UserCog className="h-4 w-4 text-gold" />
            <span className="text-sm text-muted-foreground">משתמש:</span>
            <Select value={selectedUser} onValueChange={setSelectedUser} disabled={busy}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="בחר משתמש…" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.display_name || "(ללא שם)"}
                    {p.email ? ` · ${p.email}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedUser && (
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={() => setAllOverrides(true)} disabled={busy}
                className="gap-1 border-green-500/60 text-green-700 dark:text-green-400">
                <CheckCheck className="h-3 w-3" /> אשר את כל פעולות התוכן
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAllOverrides(false)} disabled={busy}
                className="gap-1 border-destructive/60 text-destructive">
                <Ban className="h-3 w-3" /> חסום את כל פעולות התוכן
              </Button>
              {overrides.length > 0 && (
                <Button size="sm" variant="outline" onClick={clearAllOverrides} disabled={busy}
                  className="gap-1 border-gold/60 text-muted-foreground">
                  <RefreshCw className="h-3 w-3" /> אפס הכל לברירת מחדל
                </Button>
              )}
            </div>
          )}
        </div>

        {!selectedUser ? (
          <div className="text-center text-sm text-muted-foreground py-8 rounded-xl border-2 border-dashed border-gold/30">
            בחר משתמש כדי לראות ולערוך הרשאות אישיות
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 text-xs flex-wrap">
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-sm bg-gradient-navy" />
                <span className="text-muted-foreground">הרשאת תפקיד (בסיס)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-sm bg-gold" />
                <span className="text-muted-foreground">דריסה אישית פעילה</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-sm bg-destructive/60" />
                <span className="text-muted-foreground">דריסה אישית חוסמת</span>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border-2 border-gold/40">
              <table className="w-full text-sm">
                <thead className="bg-secondary">
                  <tr>
                    <th className="p-2 text-right font-semibold text-foreground w-28">מודול \\ פעולה</th>
                    {ACTIONS.map((a) => (
                      <th key={a} className="p-2 text-center font-semibold text-foreground">{ACTION_LABEL[a]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MODULES.map((m) => (
                    <tr key={m} className="border-t border-gold/20 hover:bg-secondary/40">
                      <td className="p-2 font-medium text-foreground">
                        <div className="flex items-center justify-between gap-1 min-w-[6rem]">
                          <span>{MODULE_LABEL[m]}</span>
                          <div className="flex gap-0.5 opacity-50 hover:opacity-100 transition-opacity">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button onClick={() => setModuleRow(m, true)} disabled={busy}
                                  className="text-green-600 hover:text-green-700 p-0.5 rounded"
                                  aria-label="אפשר שורה">
                                  <CheckCheck className="h-3 w-3" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>אפשר כל פעולות {MODULE_LABEL[m]}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button onClick={() => clearModuleRow(m)} disabled={busy}
                                  className="text-muted-foreground hover:text-destructive p-0.5 rounded"
                                  aria-label="נקה שורה">
                                  <X className="h-3 w-3" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>נקה דריסות {MODULE_LABEL[m]}</TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      </td>
                      {ACTIONS.map((a) => {
                        const key = `${m}:${a}`;
                        const override = overrideMap[key];
                        const hasBase = baseMap.has(key);
                        const hasOverride = !!override;
                        const effectiveAllowed = hasOverride ? override.allowed : hasBase;
                        const cellColor = hasOverride
                          ? override.allowed ? "bg-gold/10" : "bg-destructive/10"
                          : "";
                        return (
                          <td key={a} className={`p-2 text-center ${cellColor}`}>
                            <div className="flex flex-col items-center gap-1">
                              <Switch
                                checked={effectiveAllowed}
                                onCheckedChange={(v) => setOverride(m, a, v)}
                                disabled={busy}
                                className={hasOverride
                                  ? override.allowed ? "data-[state=checked]:bg-gold" : ""
                                  : "opacity-70"
                                }
                              />
                              {hasOverride && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      onClick={() => clearOverride(m, a)}
                                      disabled={busy}
                                      className="text-muted-foreground hover:text-destructive"
                                      aria-label="בטל דריסה"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>בטל דריסה (חזור לתפקיד)</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {overrides.length > 0 && (
              <p className="text-xs text-muted-foreground">
                <Badge variant="outline" className="border-gold/60 ml-1">{overrides.length}</Badge>
                דריסות אישיות פעילות עבור{" "}
                <span className="font-medium">{selectedProfile?.display_name || selectedProfile?.email || "משתמש זה"}</span>
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              הרשאה אישית גוברת על בסיס המשתמש הרשום ותפקידיו הנוספים. למנהל תמיד יש הכול ולכן הוא אינו ברשימה. לחץ <strong>×</strong> כדי להחזיר לברירת המחדל.
            </p>
          </>
        )}
      </Card>
    </TooltipProvider>
  );
}
