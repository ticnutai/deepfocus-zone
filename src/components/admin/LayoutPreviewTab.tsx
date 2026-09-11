import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, Monitor, RefreshCw, X, ExternalLink, BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ALL_SIDEBAR_ITEMS } from "@/lib/study/sidebarItems";
import { type LayoutScope } from "@/lib/study/layoutProfiles";

interface AppRole { id: string; name: string }
interface ContentRule { role_id: string; include_own: boolean; include_site_library: boolean; source_user_ids: string[] }
interface ContentSource { source_user_id: string; label: string; question_count: number }
const ROLE_LABEL: Record<string, string> = {
  admin: "מנהל",
  user: "משתמש רגיל",
  moderator: "מנחה",
};
const roleLabel = (n: string) => ROLE_LABEL[n] ?? n;

export function LayoutPreviewTab({
  roles: suppliedRoles,
  preferredRoleIds = [],
  profileName = "",
}: {
  roles?: AppRole[];
  preferredRoleIds?: string[];
  profileName?: string;
}) {
  const [loadedRoles, setLoadedRoles] = useState<AppRole[]>([]);
  const roles = suppliedRoles ?? loadedRoles;
  const [selected, setSelected] = useState<string[]>([]);
  const [section, setSection] = useState<string>("home");
  const [scope, setScope] = useState<LayoutScope>("desktop");
  const [reloadToken, setReloadToken] = useState<number>(0);
  const [contentRules, setContentRules] = useState<ContentRule[]>([]);
  const [contentSources, setContentSources] = useState<ContentSource[]>([]);

  useEffect(() => {
    (async () => {
      if (suppliedRoles) return;
      const { data } = await supabase.from("app_roles").select("id,name").order("name");
      if (data) {
        setLoadedRoles(data as AppRole[]);
      }
    })();
  }, [suppliedRoles]);

  useEffect(() => {
    void Promise.all([
      supabase.from("role_content_access").select("role_id,include_own,include_site_library,source_user_ids"),
      supabase.rpc("get_admin_content_sources"),
    ]).then(([rules, sources]) => {
      if (rules.data) setContentRules(rules.data as ContentRule[]);
      if (sources.data) setContentSources(sources.data as ContentSource[]);
    });
  }, [reloadToken]);

  useEffect(() => {
    const valid = preferredRoleIds.filter((id) => roles.some((role) => role.id === id)).slice(0, 3);
    setSelected(valid);
  }, [preferredRoleIds, roles]);

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

  const buildUrl = (roleId: string, embedded = false) => {
    const params = new URLSearchParams();
    params.set("section", section);
    params.set("previewRole", roleId);
    params.set("previewViewport", scope);
    if (embedded) params.set("previewEmbedded", "1");
    params.set("_t", String(reloadToken));
    return `/?${params.toString()}`;
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="gold-frame p-4 space-y-4">
        <div className="flex items-center gap-2">
          <span className="gold-icon-circle"><Monitor className="h-4 w-4" /></span>
          <div>
            <h3 className="font-display text-lg font-bold">בדיקת הרשאות ותצוגה לפי תפקיד</h3>
            <p className="text-xs text-muted-foreground">
              {profileName ? `הפרופיל שנבדק: ${profileName}. ` : ""}בחר עד 3 תפקידים ואת הדף להצגה. כל חלון מחיל הרשאות, מקורות שאלות, נראות ופריסה של התפקיד.
            </p>
          </div>
        </div>

        <p className="rounded-lg border border-emerald-500/40 bg-emerald-50 p-3 text-sm text-emerald-950 dark:bg-emerald-950/25 dark:text-emerald-100">
          מצב בדיקה מוגן: פעולות כתיבה חסומות, ותפריטים ופעולות מחושבים לפי התפקיד הנבחר. נתוני המשתמש אינם מתחזים לחשבון אמיתי; אכיפת הנתונים נבדקת בנפרד מול השרת ו־RLS.
        </p>

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

          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-muted-foreground">מצב תצוגה:</div>
            <Select value={scope} onValueChange={(v) => setScope(v as LayoutScope)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="desktop">מחשב</SelectItem>
                <SelectItem value="mobile">מובייל</SelectItem>
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
            const iframeUrl = buildUrl(roleId, true);
            const rule = contentRules.find((item) => item.role_id === roleId);
            const sourceLabels = (rule?.source_user_ids ?? []).map((id) => contentSources.find((item) => item.source_user_id === id)?.label ?? id);
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
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-gold/25 bg-muted/20 px-3 py-2 text-xs">
                  <BookOpen className="h-4 w-4 text-primary" />
                  <span className="font-semibold">מקורות שאלות:</span>
                  <Badge variant="outline">אישי: {rule?.include_own === false ? "לא" : "כן"}</Badge>
                  <Badge variant="outline">ספריית האתר: {rule?.include_site_library ? "כן" : "לא"}</Badge>
                  <span className="text-muted-foreground">{sourceLabels.length ? sourceLabels.join("، ") : "ללא מוסיפים נבחרים"}</span>
                </div>
                <div className="relative w-full" style={{ height: "70vh", minHeight: 520 }}>
                  {scope === "mobile" ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-muted/10 rounded-md border border-gold/20">
                      <div className="relative h-full max-h-[680px] w-[390px] max-w-full rounded-[28px] border-2 border-gold/40 bg-background shadow-xl overflow-hidden">
                        <iframe
                          key={`${roleId}-${scope}-${reloadToken}`}
                          src={iframeUrl}
                          title={`preview-${role?.name}`}
                          className="absolute inset-0 w-full h-full bg-background"
                        />
                      </div>
                    </div>
                  ) : (
                    <iframe
                      key={`${roleId}-${scope}-${reloadToken}`}
                      src={iframeUrl}
                      title={`preview-${role?.name}`}
                      className="absolute inset-0 w-full h-full rounded-md border border-gold/30 bg-background"
                    />
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
