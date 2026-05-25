import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudy } from "@/lib/study/store";
import { usePermissions } from "@/hooks/usePermissions";
import type { SidebarConfig, WidgetLayout } from "@/lib/study/types";
import { Eye } from "lucide-react";

/**
 * When the URL contains ?previewRole=<role_id>, fetches that role's saved
 * layout defaults and applies them to local store state (no cloud writes).
 * Shows a fixed banner indicating preview mode. Admin-only.
 */
export function PreviewRoleApplier() {
  const { isAdmin } = usePermissions();
  const study = useStudy() as ReturnType<typeof useStudy> & {
    _applyPreviewLayout?: (sidebar: SidebarConfig[] | null, layout: WidgetLayout | null) => void;
  };
  const [roleName, setRoleName] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const previewRoleId = params.get("previewRole");
    if (!previewRoleId || !isAdmin || !study._applyPreviewLayout) return;
    let cancelled = false;
    (async () => {
      const [{ data: rd }, { data: role }] = await Promise.all([
        supabase
          .from("role_layout_defaults")
          .select("widget_layout, sidebar_config")
          .eq("role_id", previewRoleId)
          .maybeSingle(),
        supabase.from("app_roles").select("name").eq("id", previewRoleId).maybeSingle(),
      ]);
      if (cancelled) return;
      const sidebar = (rd?.sidebar_config ?? null) as unknown as SidebarConfig[] | null;
      const layout = (rd?.widget_layout ?? null) as unknown as WidgetLayout | null;
      study._applyPreviewLayout?.(sidebar, layout);
      setRoleName(role?.name ?? previewRoleId.slice(0, 6));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  if (!roleName) return null;
  return (
    <div
      dir="rtl"
      className="fixed top-0 inset-x-0 z-[100] pointer-events-none flex justify-center"
    >
      <div className="pointer-events-auto mt-1 rounded-full bg-amber-500/95 text-black px-3 py-1 text-xs font-bold shadow-lg flex items-center gap-1.5">
        <Eye className="h-3.5 w-3.5" />
        תצוגה מקדימה — תפקיד: {roleName} (קריאה בלבד, לא נשמר)
      </div>
    </div>
  );
}
