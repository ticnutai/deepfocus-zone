import { useEffect, useMemo, useState } from "react";
import { Eye, LayoutDashboard, Monitor, Save, SlidersHorizontal, Smartphone } from "lucide-react";
import { SimpleViewProfilesManager } from "@/components/admin/SimpleViewProfilesManager";
import { LayoutPreviewTab } from "./LayoutPreviewTab";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useStudy } from "@/lib/study/store";
import { normalizeSplitWorkspaceSidebarConfig } from "@/lib/study/sidebarItems";
import type { LayoutScope } from "@/lib/study/layoutProfiles";

interface AppRole {
  id: string;
  name: string;
  description: string | null;
}

interface EditorState {
  dirty: boolean;
  profileId: string;
  profileName: string;
  assignedRoleIds: string[];
}

/**
 * One admin surface for the complete display profile.
 *
 * Older versions exposed role defaults, layout profiles and feature
 * blocklists as separate editors. The persistence readers remain compatible
 * with those records, but new edits are intentionally routed through the
 * unified manager so layout and visibility can never receive two unrelated
 * assignments for the same role.
 */
export function RoleDefaultsTab() {
  const { state } = useStudy();
  const [scope, setScope] = useState<LayoutScope>("desktop");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [editorState, setEditorState] = useState<EditorState>({
    dirty: false,
    profileId: "",
    profileName: "",
    assignedRoleIds: [],
  });

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("app_roles")
      .select("id,name,description")
      .order("is_system", { ascending: false })
      .order("name")
      .then(({ data }) => {
        if (!cancelled) setRoles((data ?? []) as AppRole[]);
      });
    return () => { cancelled = true; };
  }, []);

  const currentSidebar = useMemo(
    () => normalizeSplitWorkspaceSidebarConfig(state.sidebarConfig ?? []),
    [state.sidebarConfig],
  );
  const currentCategories = useMemo(
    () => (state.categories ?? [])
      .filter((category) => !category.parentId)
      .map((category) => ({ id: category.id, name: category.name, color: category.color ?? null })),
    [state.categories],
  );

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="gold-frame p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="gold-icon-circle"><LayoutDashboard className="h-5 w-5" /></span>
            <div>
              <h2 className="font-display text-xl font-bold">פרופילי גישה ותצוגה</h2>
              <p className="text-sm text-muted-foreground">
                {mode === "edit"
                  ? "פרופיל אחד מרכז מה מותר, מה מוצג ואיך המסך מסודר — בלי הגדרות כפולות."
                  : "בדיקה בטוחה של התוצאה השמורה, כפי שכל תפקיד יראה אותה בפועל."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {mode === "edit" && (
              <div className="flex items-center gap-2 rounded-xl border bg-muted/30 p-1.5">
                <span className="px-2 text-xs font-bold text-muted-foreground">עורכים עבור:</span>
                <Tabs value={scope} onValueChange={(value) => {
                  if (!editorState.dirty) setScope(value as LayoutScope);
                }}>
                  <TabsList className="grid min-w-52 grid-cols-2 bg-background" aria-label="סוג מכשיר">
                    <TabsTrigger value="desktop" className="gap-1.5" disabled={editorState.dirty && scope !== "desktop"}><Monitor className="h-4 w-4" /> מחשב</TabsTrigger>
                    <TabsTrigger value="mobile" className="gap-1.5" disabled={editorState.dirty && scope !== "mobile"}><Smartphone className="h-4 w-4" /> מובייל</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            )}
            <Tabs value={mode} onValueChange={(value) => {
              if (value === "preview" && editorState.dirty) return;
              setMode(value as "edit" | "preview");
            }}>
              <TabsList className="grid min-w-72 grid-cols-2" aria-label="עריכה ובדיקה">
                <TabsTrigger value="edit" className="gap-2">
                  <SlidersHorizontal className="h-4 w-4" /> 1. עריכת פרופיל
                </TabsTrigger>
                <TabsTrigger value="preview" className="gap-2" disabled={editorState.dirty}>
                  <Eye className="h-4 w-4" /> {editorState.dirty ? "שמור לפני בדיקה" : "2. בדיקת התוצאה"}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </Card>

      {editorState.dirty && (
        <div className="flex items-center gap-2 rounded-xl border-2 border-amber-400/60 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          <Save className="h-4 w-4 shrink-0" />
          קיימת טיוטה שלא נשמרה. שמור ופרסם את הפרופיל לפני בדיקת התוצאה, כדי שהבדיקה תציג בדיוק את השינויים החדשים.
        </div>
      )}

      <div className="grid gap-2 rounded-xl border border-gold/30 bg-card p-3 text-sm sm:grid-cols-3">
        <div><strong>גישה</strong><span className="block text-xs text-muted-foreground">אילו עמודים ופעולות מותרים.</span></div>
        <div><strong>תצוגה</strong><span className="block text-xs text-muted-foreground">אילו רכיבים יופיעו בתוך העמודים.</span></div>
        <div><strong>פריסה</strong><span className="block text-xs text-muted-foreground">הסדר, הגדלים וניצול שטח המסך.</span></div>
      </div>

      <div className={mode === "edit" ? "space-y-4" : "hidden"} aria-hidden={mode !== "edit"}>
          <SimpleViewProfilesManager
            scope={scope}
            roles={roles}
            currentWidgetLayout={state.widgetLayout ?? {}}
            currentSidebar={currentSidebar}
            currentCategories={currentCategories}
            onEditorStateChange={setEditorState}
          />
      </div>

      <div className={mode === "preview" ? "block" : "hidden"} aria-hidden={mode !== "preview"}>
        <LayoutPreviewTab
          roles={roles}
          preferredRoleIds={editorState.assignedRoleIds}
          profileName={editorState.profileName}
        />
      </div>
    </div>
  );
}
