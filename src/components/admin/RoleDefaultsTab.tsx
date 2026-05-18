import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Camera, Save, ShieldAlert, Layers as LayersIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useStudy } from "@/lib/study/store";
import { ALL_SIDEBAR_ITEMS } from "@/lib/study/sidebarItems";
import { WIDGET_DEFS } from "@/lib/study/widgetLayout";
import { loadFeatureBlocklist, saveFeatureBlocklist, type FeatureBlocklist } from "@/lib/study/featureBlocklist";

interface AppRole { id: string; name: string; description: string | null }

export function RoleDefaultsTab() {
  const { state } = useStudy();
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [hasExisting, setHasExisting] = useState(false);
  const [busy, setBusy] = useState(false);

  const [blocklist, setBlocklist] = useState<FeatureBlocklist>({ sections: [], widgets: {} });
  const [savingBlock, setSavingBlock] = useState(false);

  // Load roles and current blocklist
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

  // Check if defaults already exist for selected role
  useEffect(() => {
    if (!selectedRole) return;
    (async () => {
      const { data } = await supabase
        .from("role_layout_defaults")
        .select("role_id")
        .eq("role_id", selectedRole)
        .maybeSingle();
      setHasExisting(!!data);
    })();
  }, [selectedRole]);

  const selectedRoleName = useMemo(
    () => roles.find((r) => r.id === selectedRole)?.name ?? "",
    [roles, selectedRole],
  );

  const snapshotCurrent = async () => {
    if (!selectedRole) return;
    setBusy(true);
    try {
      const payload = {
        role_id: selectedRole,
        widget_layout: (state.widgetLayout ?? null) as unknown as Json,
        sidebar_config: (state.sidebarConfig ?? null) as unknown as Json,
        category_template: ((state.categories ?? []).filter((c) => !c.parentId).map((c) => ({
          id: c.id, name: c.name, color: c.color, parent_id: null,
        })) as unknown as Json),
        updated_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("role_layout_defaults").upsert(
        [payload],
        { onConflict: "role_id" },
      );
      if (error) throw error;
      setHasExisting(true);
      toast.success(`ברירת המחדל נשמרה לתפקיד "${selectedRoleName}"`);
    } catch (e) {
      toast.error("שמירה נכשלה: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const clearDefaults = async () => {
    if (!selectedRole) return;
    if (!confirm(`למחוק את ברירת המחדל של "${selectedRoleName}"?`)) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("role_layout_defaults").delete().eq("role_id", selectedRole);
      if (error) throw error;
      setHasExisting(false);
      toast.success("ברירת המחדל נמחקה");
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

  return (
    <div className="space-y-6" dir="rtl">
      {/* Section 1: Role-level defaults */}
      <Card className="gold-frame p-4 space-y-4">
        <div className="flex items-center gap-2">
          <span className="gold-icon-circle"><LayersIcon className="h-4 w-4" /></span>
          <div>
            <h3 className="font-display text-lg font-bold">ברירת מחדל לפי תפקיד</h3>
            <p className="text-xs text-muted-foreground">
              סדר אצלך את הפריסה (וידג'טים, סיידבר, קטגוריות) כפי שתרצה. בלחיצה על "צלם פריסה" המצב יישמר כברירת מחדל לתפקיד שנבחר.
              משתמש שעדיין לא שינה כלום יקבל את הפריסה הזו אוטומטית. ברגע שמשתמש משנה משהו אצלו — השמירה האישית שלו מנצחת.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">תפקיד:</span>
          <Select value={selectedRole} onValueChange={setSelectedRole}>
            <SelectTrigger className="w-56"><SelectValue placeholder="בחר תפקיד" /></SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {hasExisting ? "✓ קיימת ברירת מחדל" : "אין עדיין ברירת מחדל"}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={snapshotCurrent} disabled={busy || !selectedRole} className="gap-2">
            <Camera className="h-4 w-4" />
            צלם את הפריסה הנוכחית שלי כברירת מחדל
          </Button>
          {hasExisting && (
            <Button variant="outline" onClick={clearDefaults} disabled={busy}>
              מחק ברירת מחדל לתפקיד זה
            </Button>
          )}
        </div>

        <div className="text-[11px] text-muted-foreground bg-muted/40 rounded p-2">
          נשמרים: פריסת הוידג'טים בכל הטאבים, סדר ונראות פריטי הסיידבר, ותבנית קטגוריות שורש שייזרעו למשתמשים חדשים.
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
    </div>
  );
}
