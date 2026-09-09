import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudy } from "@/lib/study/store";
import { usePermissions } from "@/hooks/usePermissions";
import type { SidebarConfig, WidgetLayout } from "@/lib/study/types";
import { resolveRoleLayoutProfile, type LayoutScope } from "@/lib/study/layoutProfiles";
import { Eye, Lock } from "lucide-react";

/**
 * When the URL contains ?previewRole=<role_id>, fetches that role's saved
 * layout defaults and applies them in memory only.
 * Admin-only, read-only; profile edits belong to the unified editor.
 */
export function PreviewRoleApplier() {
  const { viewerIsAdmin } = usePermissions();
  const study = useStudy() as ReturnType<typeof useStudy> & {
    _applyPreviewLayout?: (sidebar: SidebarConfig[] | null, layout: WidgetLayout | null) => void;
  };
  const [roleName, setRoleName] = useState<string | null>(null);
  const [roleId, setRoleId] = useState<string | null>(null);
  const embedded = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("previewEmbedded") === "1";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const previewRoleId = params.get("previewRole");
    const previewScopeParam = params.get("previewViewport");
    const previewScope: LayoutScope = previewScopeParam === "mobile" ? "mobile" : "desktop";
    if (!previewRoleId || !viewerIsAdmin || !study._applyPreviewLayout) return;
    let cancelled = false;
    (async () => {
      const [assignedProfile, roleInfo] = await Promise.all([
        resolveRoleLayoutProfile(previewRoleId, { scope: previewScope }).catch(() => null),
        supabase.from("app_roles").select("name").eq("id", previewRoleId).maybeSingle(),
      ]);
      let rd: { sidebar_config: SidebarConfig[] | null; widget_layout: WidgetLayout | null } | null = null;
      if (!assignedProfile && previewScope === "desktop") {
        const { data } = await supabase
          .from("role_layout_defaults")
          .select("widget_layout, sidebar_config")
          .eq("role_id", previewRoleId)
          .maybeSingle();
        rd = (data ?? null) as unknown as { sidebar_config: SidebarConfig[] | null; widget_layout: WidgetLayout | null } | null;
      }
      if (cancelled) return;
      const sidebar = assignedProfile?.sidebarConfig ?? (rd?.sidebar_config ?? null);
      const layout = assignedProfile?.widgetLayout ?? (rd?.widget_layout ?? null);
      study._applyPreviewLayout?.(sidebar, layout);
      setRoleId(previewRoleId);
      setRoleName(roleInfo.data?.name ?? previewRoleId.slice(0, 6));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerIsAdmin]);

  if (!roleName || !roleId) return null;

  const exitPreview = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("previewRole");
    url.searchParams.delete("previewViewport");
    window.location.href = url.toString();
  };

  return (
    <div
      dir="rtl"
      className="fixed top-0 inset-x-0 z-[100] pointer-events-none flex justify-center"
    >
      <div className="pointer-events-auto mt-1 rounded-full bg-amber-500/95 text-black px-3 py-1 text-xs font-bold shadow-lg flex items-center gap-2">
        <Eye className="h-3.5 w-3.5" />
        <span>בדיקת הרשאות ותצוגה: {roleName}</span>
        <span className="flex items-center gap-1 text-[10px] font-normal opacity-80">
          <Lock className="h-3 w-3" />
          צפייה בלבד — עריכה בטאב הרשאות ותצוגה
        </span>
        {!embedded && (
          <button
            onClick={exitPreview}
            className="rounded-full bg-black/80 text-amber-200 px-2 py-0.5 text-[10px] hover:bg-black"
          >
            יציאה
          </button>
        )}
      </div>
    </div>
  );
}
