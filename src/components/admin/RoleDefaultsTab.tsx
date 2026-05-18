import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Camera, Save, ShieldAlert, Layers as LayersIcon, Eye, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useStudy } from "@/lib/study/store";
import { ALL_SIDEBAR_ITEMS } from "@/lib/study/sidebarItems";
import { WIDGET_DEFS } from "@/lib/study/widgetLayout";
import type { SidebarConfig, WidgetConfig, WidgetLayout } from "@/lib/study/types";
import { loadFeatureBlocklist, saveFeatureBlocklist, type FeatureBlocklist } from "@/lib/study/featureBlocklist";

interface AppRole { id: string; name: string; description: string | null }
interface ExistingDefault {
  widget_layout: WidgetLayout | null;
  sidebar_config: SidebarConfig[] | null;
  category_template: Array<{ id: string; name: string; color?: string | null }> | null;
  updated_at: string | null;
  updated_by: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  admin: "מנהל",
  user: "משתמש רגיל",
  moderator: "מנחה",
};
const roleLabel = (name: string) => ROLE_LABEL[name] ?? name;

const sizeLabel = (s?: string) => (s === "full" ? "רחב" : "חצי");

export function RoleDefaultsTab() {
  const { state } = useStudy();
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [existing, setExisting] = useState<ExistingDefault | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [blocklist, setBlocklist] = useState<FeatureBlocklist>({ sections: [], widgets: {} });
  const [savingBlock, setSavingBlock] = useState(false);

  // Load roles + blocklist
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("app_roles").select("id,name,description").order("name");
      if (data) {
        setRoles(data as AppRole[]);
        const userRole = data.find((r) => r.name === "user");
        setSelectedRole(userRole?.id ?? data[0]?.id ?? "");
      }
      const bl = await loadFeatureBlocklist();
      setBlocklist(bl);
    })();
  }, []);

  const fetchExisting = useCallback(async (roleId: string) => {
    setLoadingExisting(true);
    try {
      const { data } = await supabase
        .from("role_layout_defaults")
        .select("widget_layout,sidebar_config,category_template,updated_at,updated_by")
        .eq("role_id", roleId)
        .maybeSingle();
      setExisting(data as ExistingDefault | null);
    } finally {
      setLoadingExisting(false);
    }
  }, []);

  useEffect(() => { if (selectedRole) void fetchExisting(selectedRole); }, [selectedRole, fetchExisting]);

  const selectedRoleName = useMemo(
    () => roles.find((r) => r.id === selectedRole)?.name ?? "",
    [roles, selectedRole],
  );

  // === Snapshot preview (what WILL be saved) ===
  const previewWidgetLayout: WidgetLayout = state.widgetLayout ?? {};
  const previewSidebar: SidebarConfig[] = state.sidebarConfig ?? [];
  const previewCategories = (state.categories ?? []).filter((c) => !c.parentId);

  const visibleWidgetsByTab = useMemo(() => {
    const out: Array<{ tab: string; widgets: WidgetConfig[] }> = [];
    for (const [tab, widgets] of Object.entries(previewWidgetLayout)) {
      const vis = (widgets ?? []).filter((w) => w.visible).sort((a, b) => a.order - b.order);
      if (vis.length) out.push({ tab, widgets: vis });
    }
    return out;
  }, [previewWidgetLayout]);

  const widgetLabel = (tab: string, id: string) =>
    WIDGET_DEFS[tab]?.find((w) => w.id === id)?.label ?? id;
  const sidebarLabel = (id: string) =>
    ALL_SIDEBAR_ITEMS.find((s) => s.id === id)?.label ?? id;

  const doSnapshot = async () => {
    if (!selectedRole) return;
    setBusy(true);
    try {
      const payload = {
        role_id: selectedRole,
        widget_layout: (state.widgetLayout ?? null) as unknown as Json,
        sidebar_config: (state.sidebarConfig ?? null) as unknown as Json,
        category_template: (previewCategories.map((c) => ({
          id: c.id, name: c.name, color: c.color, parent_id: null,
        })) as unknown as Json),
        updated_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("role_layout_defaults")
        .upsert([payload], { onConflict: "role_id" });
      if (error) throw error;
      toast.success(`ברירת המחדל נשמרה לתפקיד "${roleLabel(selectedRoleName)}"`);
      await fetchExisting(selectedRole);
    } catch (e) {
      toast.error("שמירה נכשלה: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };

  const requestSave = () => {
    if (existing) setConfirmOpen(true); else void doSnapshot();
  };

  const clearDefaults = async () => {
    if (!selectedRole) return;
    if (!confirm(`למחוק את ברירת המחדל של "${roleLabel(selectedRoleName)}"?`)) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("role_layout_defaults").delete().eq("role_id", selectedRole);
      if (error) throw error;
      toast.success("ברירת המחדל נמחקה");
      await fetchExisting(selectedRole);
    } catch (e) {
      toast.error("מחיקה נכשלה: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const toggleSection = (id: string) => {
    setBlocklist((b) => {
      const set = new Set(b.sections);
      if (set.has(id)) set.delete(id); else set.add(id);
      return { ...b, sections: Array.from(set) };
    });
  };

  const toggleWidget = (tabId: string, widgetId: string) => {
    setBlocklist((b) => {
      const cur = new Set(b.widgets[tabId] ?? []);
      if (cur.has(widgetId)) cur.delete(widgetId); else cur.add(widgetId);
      const widgets = { ...b.widgets, [tabId]: Array.from(cur) };
      if (widgets[tabId].length === 0) delete widgets[tabId];
      return { ...b, widgets };
    });
  };

  const persistBlocklist = async () => {
    setSavingBlock(true);
    try {
      await saveFeatureBlocklist(blocklist);
      toast.success("רשימת החסימה נשמרה לכל המשתמשים");
    } catch (e) {
      toast.error("שמירה נכשלה: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingBlock(false);
    }
  };

  const existingUpdatedAt = existing?.updated_at
    ? new Date(existing.updated_at).toLocaleString("he-IL")
    : null;

  return (
    <div className="space-y-6" dir="rtl">
      {/* Section 1: Role-level defaults */}
      <Card className="gold-frame p-4 space-y-4">
        <div className="flex items-center gap-2">
          <span className="gold-icon-circle"><LayersIcon className="h-4 w-4" /></span>
          <div>
            <h3 className="font-display text-lg font-bold">ברירת מחדל לפי תפקיד</h3>
            <p className="text-xs text-muted-foreground">
              סדר אצלך את הפריסה (וידג'טים, סיידבר, קטגוריות) כפי שתרצה. בלחיצה על "שמור פריסה כברירת מחדל" המצב הנוכחי יישמר עבור התפקיד שנבחר.
              משתמש שעדיין לא שינה כלום יקבל את הפריסה הזו אוטומטית. ברגע שמשתמש משנה משהו אצלו — השמירה האישית שלו מנצחת.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">חל על תפקיד:</span>
          <Select value={selectedRole} onValueChange={setSelectedRole}>
            <SelectTrigger className="w-56"><SelectValue placeholder="בחר תפקיד" /></SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {roleLabel(r.name)} {r.name !== roleLabel(r.name) ? `(${r.name})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {existing ? (
            <Badge variant="default" className="bg-green-600 hover:bg-green-600">
              ✓ קיימת ברירת מחדל{existingUpdatedAt ? ` · עודכן ${existingUpdatedAt}` : ""}
            </Badge>
          ) : (
            <Badge variant="outline">אין עדיין ברירת מחדל לתפקיד זה</Badge>
          )}
          <Button variant="ghost" size="sm" onClick={() => selectedRole && fetchExisting(selectedRole)} disabled={loadingExisting}>
            <RefreshCw className={`h-3.5 w-3.5 ${loadingExisting ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Scope clarity banner */}
        <div className="rounded border-2 border-gold/30 bg-muted/30 p-3 text-xs space-y-1">
          <div className="font-bold text-sm flex items-center gap-1">
            <Eye className="h-3.5 w-3.5" /> מה בדיוק יוחל על "{roleLabel(selectedRoleName)}":
          </div>
          <ul className="list-disc pr-5 space-y-0.5">
            <li>פריסת הוידג'טים בכל הטאבים (סדר, גודל, נראות).</li>
            <li>סדר ונראות של פריטי הסיידבר.</li>
            <li>תבנית קטגוריות שורש שתיזרע למשתמשים חדשים בתפקיד זה.</li>
            <li><strong>לא</strong> נדרס מידע אישי של משתמשים שכבר התאימו אצלם פריסה.</li>
          </ul>
        </div>

        {/* Preview: current snapshot vs saved */}
        <div className="grid md:grid-cols-2 gap-3">
          <PreviewCard
            title="פריסה שתישמר (המצב הנוכחי שלך)"
            tone="current"
            widgets={visibleWidgetsByTab}
            sidebar={previewSidebar}
            categories={previewCategories.map((c) => ({ name: c.name, color: c.color }))}
            widgetLabel={widgetLabel}
            sidebarLabel={sidebarLabel}
          />
          <PreviewCard
            title={existing ? "פריסה שמורה כעת לתפקיד" : "אין עדיין פריסה שמורה"}
            tone="saved"
            empty={!existing}
            widgets={(() => {
              const wl = existing?.widget_layout ?? {};
              const out: Array<{ tab: string; widgets: WidgetConfig[] }> = [];
              for (const [tab, widgets] of Object.entries(wl)) {
                const vis = (widgets ?? []).filter((w) => w.visible).sort((a, b) => a.order - b.order);
                if (vis.length) out.push({ tab, widgets: vis });
              }
              return out;
            })()}
            sidebar={existing?.sidebar_config ?? []}
            categories={(existing?.category_template ?? []).map((c) => ({ name: c.name, color: c.color ?? undefined }))}
            widgetLabel={widgetLabel}
            sidebarLabel={sidebarLabel}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={requestSave} disabled={busy || !selectedRole} className="gap-2">
            <Camera className="h-4 w-4" />
            שמור פריסה כברירת מחדל ל"{roleLabel(selectedRoleName)}"
          </Button>
          {existing && (
            <Button variant="outline" onClick={clearDefaults} disabled={busy}>
              מחק ברירת מחדל לתפקיד זה
            </Button>
          )}
        </div>
      </Card>

      {/* Section 2: Global blocklist */}
      <Card className="gold-frame p-4 space-y-4">
        <div className="flex items-center gap-2">
          <span className="gold-icon-circle"><ShieldAlert className="h-4 w-4" /></span>
          <div>
            <h3 className="font-display text-lg font-bold">חסימה גלובלית של פיצ'רים</h3>
            <p className="text-xs text-muted-foreground">
              הפיצ'רים שתסמן כאן <strong>לא יופיעו בכלל</strong> אצל אף משתמש (חוץ ממנהל). שינויים נכנסים לתוקף בטעינה הבאה.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-bold">מקטעי סיידבר</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {ALL_SIDEBAR_ITEMS.map((s) => {
              const blocked = blocklist.sections.includes(s.id);
              return (
                <label key={s.id} className="flex items-center justify-between gap-2 rounded border-2 border-gold/30 bg-card px-2 py-1.5">
                  <span className="text-xs">{s.label}</span>
                  <Switch checked={blocked} onCheckedChange={() => toggleSection(s.id)} />
                </label>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-bold">וידג'טים (לפי טאב)</h4>
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {Object.entries(WIDGET_DEFS).map(([tabId, widgets]) => (
              <div key={tabId} className="rounded border-2 border-gold/20 p-2">
                <div className="text-xs font-bold mb-1 text-muted-foreground">טאב: {tabId}</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {widgets.map((w) => {
                    const blocked = (blocklist.widgets[tabId] ?? []).includes(w.id);
                    return (
                      <label key={w.id} className="flex items-center justify-between gap-2 rounded border border-gold/20 bg-card px-2 py-1">
                        <span className="text-[11px]">{w.label}</span>
                        <Switch checked={blocked} onCheckedChange={() => toggleWidget(tabId, w.id)} />
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={persistBlocklist} disabled={savingBlock} className="gap-2">
            <Save className="h-4 w-4" /> שמור רשימת חסימה
          </Button>
        </div>
      </Card>

      {/* Overwrite warning */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              לדרוס את ברירת המחדל הקיימת?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-right">
                <div>
                  כבר קיימת ברירת מחדל לתפקיד <strong>"{roleLabel(selectedRoleName)}"</strong>
                  {existingUpdatedAt ? ` (עודכנה ב-${existingUpdatedAt})` : ""}.
                  פעולה זו תחליף אותה בפריסה הנוכחית שלך.
                </div>
                <div className="rounded bg-amber-500/10 border border-amber-500/30 p-2 text-xs">
                  ⚠ משתמשים בתפקיד זה <strong>שטרם שינו</strong> את הפריסה אצלם — יקבלו את ברירת המחדל החדשה בטעינה הבאה.
                  משתמשים שכבר התאימו פריסה אישית — לא יושפעו.
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={doSnapshot} disabled={busy}>
              כן, החלף ברירת מחדל
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ─── Preview sub-component ─── */
function PreviewCard(props: {
  title: string;
  tone: "current" | "saved";
  empty?: boolean;
  widgets: Array<{ tab: string; widgets: WidgetConfig[] }>;
  sidebar: SidebarConfig[];
  categories: Array<{ name: string; color?: string | null }>;
  widgetLabel: (tab: string, id: string) => string;
  sidebarLabel: (id: string) => string;
}) {
  const { title, tone, empty, widgets, sidebar, categories, widgetLabel, sidebarLabel } = props;
  const borderTone = tone === "current" ? "border-primary/40" : "border-gold/30";
  return (
    <div className={`rounded-lg border-2 ${borderTone} bg-card/60 p-3 space-y-3 text-xs`}>
      <div className="font-bold text-sm flex items-center justify-between">
        <span>{title}</span>
        {tone === "current" && <Badge variant="outline" className="text-[10px]">תצוגה מקדימה</Badge>}
      </div>

      {empty ? (
        <div className="text-muted-foreground italic py-6 text-center">— אין נתונים שמורים —</div>
      ) : (
        <>
          {/* Sidebar */}
          <div>
            <div className="font-semibold mb-1 text-muted-foreground">סיידבר ({sidebar.filter((s) => s.visible).length} פריטים גלויים)</div>
            <div className="flex flex-wrap gap-1">
              {(sidebar.length ? sidebar : []).filter((s) => s.visible)
                .sort((a, b) => a.order - b.order)
                .map((s) => (
                  <span key={s.id} className="rounded-full bg-muted px-2 py-0.5 text-[10px]">
                    {sidebarLabel(s.id)}
                  </span>
                ))}
              {sidebar.filter((s) => s.visible).length === 0 && (
                <span className="text-muted-foreground italic">ברירת מחדל מערכת</span>
              )}
            </div>
          </div>

          {/* Categories */}
          <div>
            <div className="font-semibold mb-1 text-muted-foreground">קטגוריות שורש ({categories.length})</div>
            <div className="flex flex-wrap gap-1">
              {categories.length === 0 ? (
                <span className="text-muted-foreground italic">אין</span>
              ) : (
                categories.map((c, i) => (
                  <span
                    key={i}
                    className="rounded px-1.5 py-0.5 text-[10px] border"
                    style={{ borderColor: c.color ?? undefined, color: c.color ?? undefined }}
                  >
                    {c.name}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Widget layout per tab */}
          <div>
            <div className="font-semibold mb-1 text-muted-foreground">וידג'טים גלויים ({widgets.length} טאבים)</div>
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {widgets.length === 0 && (
                <span className="text-muted-foreground italic">אין פריסה</span>
              )}
              {widgets.map(({ tab, widgets: ws }) => (
                <div key={tab} className="rounded border border-border/60 p-1.5">
                  <div className="text-[10px] font-bold text-muted-foreground mb-1">{tab}</div>
                  <div className="grid grid-cols-2 gap-1">
                    {ws.map((w) => (
                      <div
                        key={w.id}
                        className={`rounded px-1.5 py-1 text-[10px] truncate ${w.size === "full" ? "col-span-2 bg-primary/10 border border-primary/30" : "bg-muted border border-border/50"}`}
                        title={`${widgetLabel(tab, w.id)} · ${sizeLabel(w.size)}`}
                      >
                        {widgetLabel(tab, w.id)}
                        <span className="text-muted-foreground"> · {sizeLabel(w.size)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
