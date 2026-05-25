import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, Monitor, RefreshCw, X, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ALL_SIDEBAR_ITEMS } from "@/lib/study/sidebarItems";
import type { SidebarConfig, WidgetLayout } from "@/lib/study/types";
import { saveGuestViewProfile, setActiveGuestViewProfile } from "@/lib/auth/guestViewProfile";
import { toast } from "sonner";

interface AppRole { id: string; name: string }
interface RolePermissionRow { module: string; action: string; allowed: boolean }
interface RoleLayoutDefaultsRow {
  sidebar_config: SidebarConfig[] | null;
  widget_layout: WidgetLayout | null;
}

const ROLE_LABEL: Record<string, string> = {
  admin: "מנהל",
  user: "משתמש רגיל",
  moderator: "מנחה",
};
const roleLabel = (n: string) => ROLE_LABEL[n] ?? n;

export function LayoutPreviewTab() {
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [section, setSection] = useState<string>("home");
  const [reloadToken, setReloadToken] = useState<number>(0);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("app_roles").select("id,name").order("name");
      if (data) {
        setRoles(data as AppRole[]);
        // default: pick admin + user if available
        const admin = data.find((r) => r.name === "admin");
        const user = data.find((r) => r.name === "user");
        const pick = [admin?.id, user?.id].filter(Boolean) as string[];
        setSelected(pick.length ? pick : [data[0]?.id].filter(Boolean) as string[]);
      }
    })();
  }, []);

  const toggleRole = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return prev; // max 3
      return [...prev, id];
    });
  };

  const cols = useMemo(() => {
    if (selected.length <= 1) return "grid-cols-1";
    if (selected.length === 2) return "grid-cols-1 lg:grid-cols-2";
    return "grid-cols-1 lg:grid-cols-3";
  }, [selected.length]);

  const buildUrl = (roleId: string) => {
    const params = new URLSearchParams();
    params.set("section", section);
    params.set("previewRole", roleId);
    params.set("_t", String(reloadToken));
    return `/?${params.toString()}`;
  };

  const saveRoleAsGuestProfile = async (roleId: string) => {
    const role = roles.find((r) => r.id === roleId);
    if (!role) return;

    const [{ data: perms, error: permsError }, { data: defaults, error: defaultsError }] = await Promise.all([
      supabase
        .from("role_permissions")
        .select("module,action,allowed")
        .eq("role_id", roleId),
      supabase
        .from("role_layout_defaults")
        .select("sidebar_config,widget_layout")
        .eq("role_id", roleId)
        .maybeSingle(),
    ]);

    if (permsError) {
      toast.error(`טעינת הרשאות נכשלה: ${permsError.message}`);
      return;
    }
    if (defaultsError) {
      toast.error(`טעינת פריסת תפקיד נכשלה: ${defaultsError.message}`);
      return;
    }

    const matrix: Record<string, boolean> = {};
    ((perms ?? []) as RolePermissionRow[]).forEach((row) => {
      if (row.allowed) matrix[`${row.module}:${row.action}`] = true;
    });

    const snapshot = saveGuestViewProfile({
      id: `role:${roleId}`,
      label: `תצוגת אורח: ${roleLabel(role.name)}`,
      roleId,
      roleName: role.name,
      isAdmin: role.name === "admin",
      roles: [{ id: roleId, name: role.name }],
      matrix,
      sidebarConfig: ((defaults as RoleLayoutDefaultsRow | null)?.sidebar_config ?? undefined) ?? undefined,
      widgetLayout: ((defaults as RoleLayoutDefaultsRow | null)?.widget_layout ?? undefined) ?? undefined,
    });
    setActiveGuestViewProfile(snapshot.id);
    toast.success(`נשמר פרופיל אורח עבור ${roleLabel(role.name)} והוגדר כברירת מחדל בכניסת אורח`);
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="gold-frame p-4 space-y-4">
        <div className="flex items-center gap-2">
          <span className="gold-icon-circle"><Monitor className="h-4 w-4" /></span>
          <div>
            <h3 className="font-display text-lg font-bold">תצוגה מקדימה והשוואה לפי תפקיד</h3>
            <p className="text-xs text-muted-foreground">
              בחר עד 3 תפקידים ואת הדף להצגה. לכל תפקיד מוצג iframe של האתר האמיתי עם הפריסה השמורה לאותו תפקיד (קריאה בלבד — לא משנה הגדרות אישיות).
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          {/* Roles multi-select */}
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-muted-foreground">תפקידים להצגה (עד 3):</div>
            <div className="flex flex-wrap gap-2">
              {roles.map((r) => {
                const checked = selected.includes(r.id);
                const disabled = !checked && selected.length >= 3;
                return (
                  <label
                    key={r.id}
                    className={`flex items-center gap-2 rounded-md border-2 px-2 py-1.5 cursor-pointer text-sm transition
                      ${checked ? "border-primary bg-primary/10" : "border-gold/30 bg-card"}
                      ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={() => toggleRole(r.id)}
                    />
                    <span>{roleLabel(r.name)}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Section selector */}
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-muted-foreground">טאב/דף להצגה:</div>
            <Select value={section} onValueChange={setSection}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ALL_SIDEBAR_ITEMS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button variant="outline" size="sm" onClick={() => setReloadToken(Date.now())} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> רענן את כל ה-iframes
          </Button>
        </div>

        {selected.length === 0 && (
          <div className="text-center text-muted-foreground italic py-8 border-2 border-dashed border-gold/30 rounded-lg">
            בחר לפחות תפקיד אחד להצגה
          </div>
        )}
      </Card>

      {/* Side-by-side iframes */}
      {selected.length > 0 && (
        <div className={`grid gap-3 ${cols}`}>
          {selected.map((roleId) => {
            const role = roles.find((r) => r.id === roleId);
            const url = buildUrl(roleId);
            return (
              <Card key={roleId} className="gold-frame p-2 space-y-2 overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge className="bg-gradient-navy text-primary-foreground gap-1">
                      <Eye className="h-3 w-3" />
                      {roleLabel(role?.name ?? "")}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground truncate">{url}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      title="שמור תפקיד זה כפרופיל אורח"
                      onClick={() => void saveRoleAsGuestProfile(roleId)}
                    >
                      שמור כאורח
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="פתח בלשונית חדשה"
                      onClick={() => window.open(url, "_blank")}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="הסר תצוגה"
                      onClick={() => toggleRole(roleId)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="relative w-full" style={{ height: "70vh", minHeight: 520 }}>
                  <iframe
                    key={`${roleId}-${reloadToken}`}
                    src={url}
                    title={`preview-${role?.name}`}
                    className="absolute inset-0 w-full h-full rounded-md border border-gold/30 bg-background"
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
