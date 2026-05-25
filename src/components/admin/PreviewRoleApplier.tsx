import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudy } from "@/lib/study/store";
import { usePermissions } from "@/hooks/usePermissions";
import type { SidebarConfig, WidgetLayout } from "@/lib/study/types";
import { Eye, Save } from "lucide-react";

/**
 * When the URL contains ?previewRole=<role_id>, fetches that role's saved
 * layout defaults and applies them to local store state. Sets a global flag
 * (window.__previewRoleId) so that subsequent layout edits via setSidebarConfig
 * / setWidgetLayout are redirected to role_layout_defaults instead of the
 * admin's own user_settings.
 *
 * Admin-only.
 */
export function PreviewRoleApplier() {
  const { isAdmin } = usePermissions();
  const study = useStudy() as ReturnType<typeof useStudy> & {
    _applyPreviewLayout?: (sidebar: SidebarConfig[] | null, layout: WidgetLayout | null) => void;
  };
  const [roleName, setRoleName] = useState<string | null>(null);
  const [roleId, setRoleId] = useState<string | null>(null);

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
      // Activate write redirection AFTER initial layout applied.
      (window as unknown as { __previewRoleId?: string | null }).__previewRoleId = previewRoleId;
      setRoleId(previewRoleId);
      setRoleName(role?.name ?? previewRoleId.slice(0, 6));
    })();
    return () => {
      cancelled = true;
      (window as unknown as { __previewRoleId?: string | null }).__previewRoleId = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  if (!roleName || !roleId) return null;

  const exitPreview = () => {
    (window as unknown as { __previewRoleId?: string | null }).__previewRoleId = null;
    const url = new URL(window.location.href);
    url.searchParams.delete("previewRole");
    window.location.href = url.toString();
  };

  return (
    <div
      dir="rtl"
      className="fixed top-0 inset-x-0 z-[100] pointer-events-none flex justify-center"
    >
      <div className="pointer-events-auto mt-1 rounded-full bg-amber-500/95 text-black px-3 py-1 text-xs font-bold shadow-lg flex items-center gap-2">
        <Eye className="h-3.5 w-3.5" />
        <span>עריכת תפקיד: {roleName}</span>
        <span className="flex items-center gap-1 text-[10px] font-normal opacity-80">
          <Save className="h-3 w-3" />
          שינויים נשמרים אוטומטית לתפקיד
        </span>
        <button
          onClick={exitPreview}
          className="rounded-full bg-black/80 text-amber-200 px-2 py-0.5 text-[10px] hover:bg-black"
        >
          יציאה
        </button>
      </div>
    </div>
  );
}
