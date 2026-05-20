import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { UserCog, X, RefreshCw } from "lucide-react";

const MODULES = ["decks","cards","goals","shas","analytics","users","roles","settings"] as const;
const ACTIONS  = ["view","create","edit","delete","manage"] as const;
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
    supabase.from("profiles").select("id, display_name, email").order("display_name")
      .then(({ data }) => {
        setProfiles((data ?? []) as Profile[]);
      });
  }, []);

  // Load overrides + base role perms when user changes
  useEffect(() => {
    if (!selectedUser) { setOverrides([]); setBasePerms([]); return; }
    // load overrides
    supabase.from("user_permission_overrides").select("*").eq("user_id", selectedUser)
      .then(({ data }) => setOverrides((data ?? []) as Override[]));
    // load base role perms
    supabase.from("user_roles").select("role_id").eq("user_id", selectedUser)
      .then(async ({ data: ur }) => {
        const roleIds = (ur ?? []).map((r: { role_id: string }) => r.role_id);
        if (!roleIds.length) { setBasePerms([]); return; }
        const { data: rp } = await supabase.from("role_permissions")
          .select("module, action, allowed")
          .in("role_id", roleIds)
          .eq("allowed", true);
        setBasePerms((rp ?? []) as RolePerm[]);
      });
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
      setOverrides((arr) => arr.map((o) => o.id === existing.id ? { ...o, allowed } : o));
      const { error } = await supabase.from("user_permission_overrides").update({ allowed }).eq("id", existing.id);
      if (error) { toast.error(error.message); }
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
    setOverrides((arr) => arr.filter((o) => o.id !== existing.id));
    const { error } = await supabase.from("user_permission_overrides").delete().eq("id", existing.id);
    if (error) { toast.error(error.message); }
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

  const selectedProfile = profiles.find((p) => p.id === selectedUser);

  return (
    <TooltipProvider>
      <Card className="gold-frame p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <UserCog className="h-4 w-4 text-gold" />
            <span className="text-sm text-muted-foreground">משתמש:</span>
            <Select value={selectedUser} onValueChange={setSelectedUser}>
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
          {overrides.length > 0 && (
            <Button size="sm" variant="outline" onClick={clearAllOverrides} disabled={busy}
              className="gap-1 border-gold/60 text-muted-foreground">
              <RefreshCw className="h-3 w-3" /> אפס הכל לברירת מחדל
            </Button>
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
                      <td className="p-2 font-medium text-foreground">{MODULE_LABEL[m]}</td>
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
              דריסה אישית מבטלת את הרשאת התפקיד. לחץ <strong>×</strong> תחת מתג כדי להחזיר לברירת מחדל.
            </p>
          </>
        )}
      </Card>
    </TooltipProvider>
  );
}
