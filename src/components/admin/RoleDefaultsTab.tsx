import { useEffect, useMemo, useState } from "react";
import { LayoutDashboard } from "lucide-react";
import { SimpleViewProfilesManager } from "@/components/admin/SimpleViewProfilesManager";
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
  const [roles, setRoles] = useState<AppRole[]>([]);

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
              <h2 className="font-display text-xl font-bold">פרופילים לפי סוג משתמש</h2>
              <p className="text-sm text-muted-foreground">בוחרים פעם אחת מה פתוח, מה מותר ואיך המסך מסודר.</p>
            </div>
          </div>
          <Tabs value={scope} onValueChange={(value) => setScope(value as LayoutScope)}>
            <TabsList className="grid min-w-64 grid-cols-2">
              <TabsTrigger value="desktop">מחשב</TabsTrigger>
              <TabsTrigger value="mobile">מובייל</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </Card>

      <SimpleViewProfilesManager
        scope={scope}
        roles={roles}
        currentWidgetLayout={state.widgetLayout ?? {}}
        currentSidebar={currentSidebar}
        currentCategories={currentCategories}
      />
    </div>
  );
}
