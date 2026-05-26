import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Save, ShieldAlert, Layers as LayersIcon, Eye, RefreshCw, AlertTriangle, Plus, Trash2, Link2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useStudy } from "@/lib/study/store";
import { ALL_SIDEBAR_ITEMS } from "@/lib/study/sidebarItems";
import { WIDGET_DEFS } from "@/lib/study/widgetLayout";
import type { SidebarConfig, WidgetConfig, WidgetLayout } from "@/lib/study/types";
import {
  loadFeatureBlocklist,
  loadFeatureBlocklistProfiles,
  loadRoleBlocklistAssignments,
  saveFeatureBlocklist,
  saveFeatureBlocklistProfiles,
  saveRoleBlocklistAssignments,
  type BlocklistScope,
  type FeatureBlocklist,
  type FeatureBlocklistProfile,
  type RoleBlocklistAssignment,
} from "@/lib/study/featureBlocklist";
import {
  loadRoleLayoutProfileAssignments,
  loadRoleLayoutProfiles,
  saveRoleLayoutProfileAssignments,
  saveRoleLayoutProfiles,
  type LayoutScope,
  type RoleLayoutProfile,
  type RoleLayoutProfileAssignment,
} from "@/lib/study/layoutProfiles";

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
  const [layoutScope, setLayoutScope] = useState<LayoutScope>("desktop");
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [existing, setExisting] = useState<ExistingDefault | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [layoutProfiles, setLayoutProfiles] = useState<RoleLayoutProfile[]>([]);
  const [selectedLayoutProfileId, setSelectedLayoutProfileId] = useState<string>("");
  const [layoutProfileName, setLayoutProfileName] = useState("");
  const [savingLayoutProfile, setSavingLayoutProfile] = useState(false);
  const [layoutAssignments, setLayoutAssignments] = useState<RoleLayoutProfileAssignment[]>([]);
  const [savingLayoutAssignments, setSavingLayoutAssignments] = useState(false);

  const [blocklist, setBlocklist] = useState<FeatureBlocklist>({ sections: [], widgets: {} });
  const [savingBlock, setSavingBlock] = useState(false);
  const [blockProfiles, setBlockProfiles] = useState<FeatureBlocklistProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [profileName, setProfileName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [roleAssignments, setRoleAssignments] = useState<RoleBlocklistAssignment[]>([]);
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>("");
  const scopeLabel = layoutScope === "mobile" ? "מובייל" : "מחשב";

  const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  // Load roles + blocklist
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("app_roles").select("id,name,description").order("name");
      if (data) {
        setRoles(data as AppRole[]);
        const userRole = data.find((r) => r.name === "user");
        setSelectedRole(userRole?.id ?? data[0]?.id ?? "");
      }
      const [bl, profiles, assignments, loadedLayoutProfiles, loadedLayoutAssignments] = await Promise.all([
        loadFeatureBlocklist({ scope: layoutScope as BlocklistScope }),
        loadFeatureBlocklistProfiles({ scope: layoutScope as BlocklistScope }),
        loadRoleBlocklistAssignments({ scope: layoutScope as BlocklistScope }),
        loadRoleLayoutProfiles({ scope: layoutScope }),
        loadRoleLayoutProfileAssignments({ scope: layoutScope }),
      ]);
      setBlocklist(bl);
      setBlockProfiles(profiles);
      setRoleAssignments(assignments);
      setLayoutProfiles(loadedLayoutProfiles);
      setLayoutAssignments(loadedLayoutAssignments);

      if (profiles.length > 0) {
        setSelectedProfileId(profiles[0].id);
        setProfileName(profiles[0].name);
      }
      if (loadedLayoutProfiles.length > 0) {
        setSelectedLayoutProfileId(loadedLayoutProfiles[0].id);
        setLayoutProfileName(loadedLayoutProfiles[0].name);
      }
      if (assignments.length > 0) {
        setSelectedAssignmentId(assignments[0].id);
      }
    })();
  }, [layoutScope]);

  const fetchExisting = useCallback(async (roleId: string) => {
    setLoadingExisting(true);
    try {
      const { data } = await supabase
        .from("role_layout_defaults")
        .select("widget_layout,sidebar_config,category_template,updated_at,updated_by")
        .eq("role_id", roleId)
        .maybeSingle();
      setExisting((data ?? null) as unknown as ExistingDefault | null);
    } finally {
      setLoadingExisting(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedRole) return;
    if (layoutScope === "desktop") {
      void fetchExisting(selectedRole);
      return;
    }
    setExisting(null);
    setLoadingExisting(false);
  }, [layoutScope, selectedRole, fetchExisting]);

  const selectedRoleName = useMemo(
    () => roles.find((r) => r.id === selectedRole)?.name ?? "",
    [roles, selectedRole],
  );

  // === Snapshot preview (what WILL be saved) ===
  const currentWidgetLayout: WidgetLayout = state.widgetLayout ?? {};
  const currentSidebar: SidebarConfig[] = state.sidebarConfig ?? [];
  const currentCategories = (state.categories ?? []).filter((c) => !c.parentId);

  const selectedLayoutProfile = useMemo(
    () => layoutProfiles.find((p) => p.id === selectedLayoutProfileId) ?? null,
    [layoutProfiles, selectedLayoutProfileId],
  );

  const requestedWidgetLayout: WidgetLayout = selectedLayoutProfile?.widgetLayout ?? currentWidgetLayout;
  const requestedSidebar: SidebarConfig[] = selectedLayoutProfile?.sidebarConfig ?? currentSidebar;
  const requestedCategories = selectedLayoutProfile?.categoryTemplate
    ?? currentCategories.map((c) => ({ id: c.id, name: c.name, color: c.color ?? null }));

  const visibleWidgetsByTab = useMemo(() => {
    const out: Array<{ tab: string; widgets: WidgetConfig[] }> = [];
    for (const [tab, widgets] of Object.entries(requestedWidgetLayout)) {
      const vis = (widgets ?? []).filter((w) => w.visible).sort((a, b) => a.order - b.order);
      if (vis.length) out.push({ tab, widgets: vis });
    }
    return out;
  }, [requestedWidgetLayout]);

  const widgetLabel = (tab: string, id: string) =>
    WIDGET_DEFS[tab]?.find((w) => w.id === id)?.label ?? id;
  const sidebarLabel = (id: string) =>
    ALL_SIDEBAR_ITEMS.find((s) => s.id === id)?.label ?? id;

  const doSnapshot = async () => {
    if (!selectedRole) return;
    if (layoutScope !== "desktop") {
      toast.info("במובייל השמירה לתפקיד מתבצעת דרך פרופילי פריסה + שיוך.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        role_id: selectedRole,
        widget_layout: (state.widgetLayout ?? null) as unknown as Json,
        sidebar_config: (state.sidebarConfig ?? null) as unknown as Json,
        category_template: (currentCategories.map((c) => ({
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
    if (layoutScope !== "desktop") {
      toast.info("במובייל השמירה לתפקיד מתבצעת דרך פרופילי פריסה + שיוך.");
      return;
    }
    if (existing) setConfirmOpen(true); else void doSnapshot();
  };

  const clearDefaults = async () => {
    if (!selectedRole) return;
    if (layoutScope !== "desktop") return;
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

  const loadLayoutProfilePreview = (profileId: string) => {
    if (profileId === "__current") {
      setSelectedLayoutProfileId("");
      setLayoutProfileName("");
      return;
    }
    setSelectedLayoutProfileId(profileId);
    const profile = layoutProfiles.find((p) => p.id === profileId);
    if (!profile) return;
    setLayoutProfileName(profile.name);
  };

  const saveNamedLayoutProfile = async () => {
    const trimmed = layoutProfileName.trim();
    if (!trimmed) {
      toast.error("נא להזין שם לפרופיל פריסה");
      return;
    }
    setSavingLayoutProfile(true);
    try {
      const now = Date.now();
      const sameName = layoutProfiles.find((p) => p.name.trim().toLowerCase() === trimmed.toLowerCase());
      const targetId = sameName?.id ?? uid();
      const next = [
        ...layoutProfiles.filter((p) => p.id !== targetId),
        {
          id: targetId,
          name: trimmed,
          widgetLayout: currentWidgetLayout,
          sidebarConfig: currentSidebar,
          categoryTemplate: currentCategories.map((c) => ({ id: c.id, name: c.name, color: c.color ?? null })),
          updatedAt: now,
        },
      ].sort((a, b) => b.updatedAt - a.updatedAt);
      await saveRoleLayoutProfiles(next, { scope: layoutScope });
      setLayoutProfiles(next);
      setSelectedLayoutProfileId(targetId);
      setLayoutProfileName(trimmed);
      toast.success("פרופיל הפריסה נשמר");
    } catch (e) {
      toast.error("שמירת פרופיל פריסה נכשלה: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingLayoutProfile(false);
    }
  };

  const selectedRoleLayoutAssignment = useMemo(
    () => layoutAssignments.find((row) => row.roleId === selectedRole) ?? null,
    [layoutAssignments, selectedRole],
  );

  useEffect(() => {
    if (!selectedRoleLayoutAssignment?.profileId) return;
    const profile = layoutProfiles.find((p) => p.id === selectedRoleLayoutAssignment.profileId);
    if (!profile) return;
    setSelectedLayoutProfileId(profile.id);
    setLayoutProfileName(profile.name);
  }, [layoutProfiles, selectedRoleLayoutAssignment?.profileId]);

  const setSelectedRoleLayoutProfile = (profileId: string) => {
    if (!selectedRole) return;
    setLayoutAssignments((prev) => {
      const existingRow = prev.find((row) => row.roleId === selectedRole);
      if (profileId === "__none") {
        return prev.filter((row) => row.roleId !== selectedRole);
      }
      if (existingRow) {
        return prev.map((row) => (row.id === existingRow.id ? { ...row, profileId } : row));
      }
      return [...prev, { id: uid(), roleId: selectedRole, profileId }];
    });
    if (profileId !== "__none") loadLayoutProfilePreview(profileId);
  };

  const persistLayoutAssignments = async (successMessage = "שיוכי פריסה נשמרו") => {
    const valid = layoutAssignments.filter((row) => row.roleId && row.profileId);
    setSavingLayoutAssignments(true);
    try {
      await saveRoleLayoutProfileAssignments(valid, { scope: layoutScope });
      setLayoutAssignments(valid);
      toast.success(successMessage);
    } catch (e) {
      toast.error("שמירת שיוכי פריסה נכשלה: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingLayoutAssignments(false);
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

  const allSidebarIds = useMemo(() => ALL_SIDEBAR_ITEMS.map((s) => s.id), []);
  const allSidebarBlocked = allSidebarIds.length > 0 && allSidebarIds.every((id) => blocklist.sections.includes(id));

  const toggleAllSections = () => {
    setBlocklist((b) => {
      const everyBlocked = allSidebarIds.length > 0 && allSidebarIds.every((id) => b.sections.includes(id));
      if (everyBlocked) return { ...b, sections: [] };
      return { ...b, sections: [...allSidebarIds] };
    });
  };

  const allWidgetPairs = useMemo(
    () => Object.entries(WIDGET_DEFS).flatMap(([tabId, widgets]) => widgets.map((w) => ({ tabId, widgetId: w.id }))),
    [],
  );
  const allWidgetsBlocked = allWidgetPairs.length > 0 && allWidgetPairs.every(({ tabId, widgetId }) =>
    (blocklist.widgets[tabId] ?? []).includes(widgetId),
  );

  const toggleAllWidgetsGlobal = () => {
    setBlocklist((b) => {
      const everyBlocked = allWidgetPairs.length > 0 && allWidgetPairs.every(({ tabId, widgetId }) =>
        (b.widgets[tabId] ?? []).includes(widgetId),
      );
      if (everyBlocked) return { ...b, widgets: {} };

      const widgets = Object.fromEntries(
        Object.entries(WIDGET_DEFS).map(([tabId, defs]) => [tabId, defs.map((w) => w.id)]),
      );
      return { ...b, widgets };
    });
  };

  const isAllWidgetsBlockedInTab = (tabId: string, widgetIds: string[]): boolean =>
    widgetIds.length > 0 && widgetIds.every((id) => (blocklist.widgets[tabId] ?? []).includes(id));

  const toggleAllWidgetsInTab = (tabId: string, widgetIds: string[]) => {
    setBlocklist((b) => {
      const allInTabBlocked = widgetIds.length > 0 && widgetIds.every((id) => (b.widgets[tabId] ?? []).includes(id));
      const widgets = { ...b.widgets };
      if (allInTabBlocked) {
        delete widgets[tabId];
      } else {
        widgets[tabId] = [...widgetIds];
      }
      return { ...b, widgets };
    });
  };

  const persistBlocklist = async () => {
    setSavingBlock(true);
    try {
      await saveFeatureBlocklist(blocklist, { scope: layoutScope as BlocklistScope });
      toast.success("רשימת החסימה נשמרה לכל המשתמשים");
    } catch (e) {
      toast.error("שמירה נכשלה: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingBlock(false);
    }
  };

  const loadProfileToEditor = (profileId: string) => {
    setSelectedProfileId(profileId);
    const profile = blockProfiles.find((p) => p.id === profileId);
    if (!profile) return;
    setProfileName(profile.name);
    setBlocklist(profile.blocklist);
  };

  const saveNamedProfile = async () => {
    const trimmed = profileName.trim();
    if (!trimmed) {
      toast.error("נא להזין שם לפרופיל חסימה");
      return;
    }
    setSavingProfile(true);
    try {
      const now = Date.now();
      const sameName = blockProfiles.find((p) => p.name.trim().toLowerCase() === trimmed.toLowerCase());
      // Save-as behavior: new name creates a new profile, same name updates that profile.
      const targetId = sameName?.id ?? uid();

      const next = [
        ...blockProfiles.filter((p) => p.id !== targetId),
        {
          id: targetId,
          name: trimmed,
          blocklist,
          updatedAt: now,
        },
      ].sort((a, b) => b.updatedAt - a.updatedAt);

      await saveFeatureBlocklistProfiles(next, { scope: layoutScope as BlocklistScope });
      setBlockProfiles(next);
      setSelectedProfileId(targetId);
      setProfileName(trimmed);
      toast.success("פרופיל החסימה נשמר");
    } catch (e) {
      toast.error("שמירת פרופיל נכשלה: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingProfile(false);
    }
  };

  const addAssignmentRow = () => {
    const row: RoleBlocklistAssignment = {
      id: uid(),
      roleId: selectedRole || roles[0]?.id || "",
      profileId: selectedProfileId || blockProfiles[0]?.id || "",
    };
    setRoleAssignments((prev) => {
      const next = [...prev, row];
      setSelectedAssignmentId(row.id);
      return next;
    });
  };

  const selectedRoleAssignment = useMemo(
    () => roleAssignments.find((row) => row.roleId === selectedRole) ?? null,
    [roleAssignments, selectedRole],
  );

  const setSelectedRoleAssignmentProfile = (profileId: string) => {
    if (!selectedRole) return;
    setRoleAssignments((prev) => {
      const existing = prev.find((row) => row.roleId === selectedRole);
      if (profileId === "__none") {
        return prev.filter((row) => row.roleId !== selectedRole);
      }
      if (existing) {
        return prev.map((row) => (row.id === existing.id ? { ...row, profileId } : row));
      }
      const row: RoleBlocklistAssignment = { id: uid(), roleId: selectedRole, profileId };
      setSelectedAssignmentId(row.id);
      return [...prev, row];
    });
    if (profileId !== "__none") loadProfileToEditor(profileId);
  };

  const selectAssignmentRow = (row: RoleBlocklistAssignment) => {
    setSelectedAssignmentId(row.id);
    if (row.roleId) setSelectedRole(row.roleId);
    if (row.profileId) loadProfileToEditor(row.profileId);
  };

  const setAssignmentField = (id: string, field: "roleId" | "profileId", value: string) => {
    setRoleAssignments((prev) => {
      const next = prev.map((row) => (row.id === id ? { ...row, [field]: value } : row));
      const updated = next.find((row) => row.id === id);
      if (updated) {
        setSelectedAssignmentId(updated.id);
        if (field === "roleId") setSelectedRole(value);
        if (field === "profileId") loadProfileToEditor(value);
      }
      return next;
    });
  };

  const removeAssignmentRow = (id: string) => {
    setRoleAssignments((prev) => {
      const next = prev.filter((row) => row.id !== id);
      if (selectedAssignmentId === id) setSelectedAssignmentId(next[0]?.id ?? "");
      return next;
    });
  };

  const persistAssignments = async (successMessage = "שיוכי תפקיד לפרופיל נשמרו") => {
    const valid = roleAssignments.filter((row) => row.roleId && row.profileId);
    setSavingAssignments(true);
    try {
      await saveRoleBlocklistAssignments(valid, { scope: layoutScope as BlocklistScope });
      setRoleAssignments(valid);
      if (!selectedAssignmentId && valid[0]) setSelectedAssignmentId(valid[0].id);
      toast.success(successMessage);
    } catch (e) {
      toast.error("שמירת שיוכים נכשלה: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingAssignments(false);
    }
  };

  const selectedAssignment = useMemo(
    () => roleAssignments.find((row) => row.id === selectedAssignmentId) ?? null,
    [roleAssignments, selectedAssignmentId],
  );

  const selectedAssignmentProfile = useMemo(
    () => blockProfiles.find((p) => p.id === selectedAssignment?.profileId) ?? null,
    [blockProfiles, selectedAssignment?.profileId],
  );

  const profilePreview = selectedAssignmentProfile?.blocklist ?? blocklist;
  const profilePreviewSections = ALL_SIDEBAR_ITEMS.filter((s) => profilePreview.sections.includes(s.id));

  const profilePreviewWidgetsByTab = useMemo(
    () => Object.entries(WIDGET_DEFS)
      .map(([tabId, defs]) => ({
        tabId,
        widgets: defs.filter((w) => (profilePreview.widgets[tabId] ?? []).includes(w.id)),
      }))
      .filter((entry) => entry.widgets.length > 0),
    [profilePreview.widgets],
  );

  const existingUpdatedAt = existing?.updated_at
    ? new Date(existing.updated_at).toLocaleString("he-IL")
    : null;

  return (
    <div className="space-y-6" dir="rtl">
      <Tabs value={layoutScope} onValueChange={(v) => setLayoutScope(v as LayoutScope)} className="space-y-2">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="desktop">פריסת מחשב</TabsTrigger>
          <TabsTrigger value="mobile">פריסת מובייל</TabsTrigger>
        </TabsList>
      </Tabs>

      <Tabs defaultValue="layout" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="layout">טאב פריסה</TabsTrigger>
          <TabsTrigger value="blocklist">טאב חסימה</TabsTrigger>
        </TabsList>

        <TabsContent value="layout">
          <Card className="gold-frame p-4 space-y-4">
            <div className="flex items-center gap-2">
              <span className="gold-icon-circle"><LayersIcon className="h-4 w-4" /></span>
              <div>
                <h3 className="font-display text-lg font-bold">פריסה לפי תפקיד · {scopeLabel}</h3>
                <p className="text-xs text-muted-foreground">
                  כאן מנהלים שמירת פריסה לתפקיד עבור {scopeLabel}: וידג'טים, סיידבר וקטגוריות. זה נפרד לחלוטין מהחסימות.
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
              <span className="text-sm font-semibold">שיוך פריסה:</span>
              <Select
                value={selectedRoleLayoutAssignment?.profileId ?? "__none"}
                onValueChange={setSelectedRoleLayoutProfile}
              >
                <SelectTrigger className="w-56"><SelectValue placeholder="בחר פרופיל פריסה" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">ללא שיוך</SelectItem>
                  {layoutProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void persistLayoutAssignments(`שיוך הפריסה נשמר לתפקיד "${roleLabel(selectedRoleName)}"`)}
                disabled={savingLayoutAssignments || !selectedRole}
              >
                שמור שיוך פריסה
              </Button>
              <Select value={selectedLayoutProfileId || "__current"} onValueChange={loadLayoutProfilePreview}>
                <SelectTrigger className="w-56"><SelectValue placeholder="בחר פרופיל פריסה לתצוגה" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__current">מצב נוכחי (ללא פרופיל)</SelectItem>
                  {layoutProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {layoutScope === "desktop" && existing ? (
                <Badge variant="default" className="bg-green-600 hover:bg-green-600">
                  ✓ קיימת ברירת מחדל{existingUpdatedAt ? ` · עודכן ${existingUpdatedAt}` : ""}
                </Badge>
              ) : layoutScope === "desktop" ? (
                <Badge variant="outline">אין עדיין ברירת מחדל לתפקיד זה</Badge>
              ) : (
                <Badge variant="outline">במובייל עובדים עם פרופילים + שיוך לתפקיד</Badge>
              )}
              <Button variant="ghost" size="sm" onClick={() => selectedRole && layoutScope === "desktop" && fetchExisting(selectedRole)} disabled={loadingExisting || layoutScope !== "desktop"}>
                <RefreshCw className={`h-3.5 w-3.5 ${loadingExisting ? "animate-spin" : ""}`} />
              </Button>
            </div>

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

            <div className="grid md:grid-cols-2 gap-3">
              <PreviewCard
                title="סטטוס מבוקש לתפקיד"
                tone="current"
                widgets={visibleWidgetsByTab}
                sidebar={requestedSidebar}
                categories={requestedCategories.map((c) => ({ name: c.name, color: c.color }))}
                widgetLabel={widgetLabel}
                sidebarLabel={sidebarLabel}
              />
              <PreviewCard
                title={existing ? "סטטוס נוכחי לתפקיד" : "אין עדיין סטטוס שמור לתפקיד"}
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
              <Input
                value={layoutProfileName}
                onChange={(e) => setLayoutProfileName(e.target.value)}
                placeholder={`שם פרופיל פריסה (${scopeLabel})`}
                className="w-56"
              />
              <Button type="button" variant="outline" onClick={saveNamedLayoutProfile} disabled={savingLayoutProfile}>
                שמור פרופיל פריסה בשם
              </Button>
              <Button onClick={requestSave} disabled={busy || !selectedRole || layoutScope !== "desktop"}>
                שמור פריסה כברירת מחדל ל"{roleLabel(selectedRoleName)}"
              </Button>
              {layoutScope === "desktop" && existing && (
                <Button variant="outline" onClick={clearDefaults} disabled={busy}>
                  מחק ברירת מחדל לתפקיד זה
                </Button>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="blocklist">
          <Card className="gold-frame p-4 space-y-4">
            <div className="flex items-center gap-2">
              <span className="gold-icon-circle"><ShieldAlert className="h-4 w-4" /></span>
              <div>
                <h3 className="font-display text-lg font-bold">חסימה לפי תפקיד ופרופיל · {scopeLabel}</h3>
                <p className="text-xs text-muted-foreground">
                  כאן מנהלים פרופילי חסימה ואת השיוך שלהם לתפקידים עבור {scopeLabel}. זה נפרד לחלוטין מהפריסה.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded border-2 border-gold/20 bg-muted/20 p-3">
              <span className="text-sm font-semibold">תפקיד:</span>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger className="w-56"><SelectValue placeholder="בחר תפקיד" /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{roleLabel(r.name)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm font-semibold">שיוך חסימה:</span>
              <Select value={selectedRoleAssignment?.profileId ?? "__none"} onValueChange={setSelectedRoleAssignmentProfile}>
                <SelectTrigger className="w-56"><SelectValue placeholder="בחר פרופיל חסימה" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">ללא שיוך</SelectItem>
                  {blockProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void persistAssignments(`שיוך החסימה נשמר לתפקיד "${roleLabel(selectedRoleName)}"`)}
                disabled={savingAssignments || !selectedRole}
              >
                שמור שיוך לתפקיד
              </Button>
              {selectedRoleAssignment ? (
                <Badge variant="outline">משויך לפרופיל חסימה</Badge>
              ) : (
                <Badge variant="outline">אין שיוך חסימה לתפקיד זה</Badge>
              )}
            </div>

            <div className="rounded border-2 border-gold/20 bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold flex items-center gap-1">
                  <Link2 className="h-4 w-4" /> שיוך רשימות חסימה לפי תפקיד
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" className="gap-1" onClick={addAssignmentRow}>
                    <Plus className="h-3.5 w-3.5" /> הוסף שורה
                  </Button>
                  <Button type="button" size="sm" onClick={() => void persistAssignments()} disabled={savingAssignments}>
                    שמור שיוכים
                  </Button>
                </div>
              </div>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {roleAssignments.length === 0 && (
                  <div className="text-xs text-muted-foreground">עדיין אין שיוכים. לחץ "הוסף שורה" כדי להגדיר תפקיד + פרופיל חסימה.</div>
                )}
                {roleAssignments.map((row) => (
                  <div
                    key={row.id}
                    className={`grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 rounded border px-2 py-2 cursor-pointer ${selectedAssignmentId === row.id ? "border-primary/60 bg-primary/5" : "border-gold/20"}`}
                    onClick={() => selectAssignmentRow(row)}
                  >
                    <Select value={row.roleId} onValueChange={(value) => setAssignmentField(row.id, "roleId", value)}>
                      <SelectTrigger><SelectValue placeholder="חל על תפקיד" /></SelectTrigger>
                      <SelectContent>
                        {roles.map((r) => (
                          <SelectItem key={r.id} value={r.id}>{roleLabel(r.name)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={row.profileId} onValueChange={(value) => setAssignmentField(row.id, "profileId", value)}>
                      <SelectTrigger><SelectValue placeholder="שם פרופיל חסימה" /></SelectTrigger>
                      <SelectContent>
                        {blockProfiles.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeAssignmentRow(row.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-bold">מקטעי סיידבר</h4>
            <Button type="button" size="sm" variant="outline" onClick={toggleAllSections}>
              {allSidebarBlocked ? "נקה הכל" : "בחר הכל"}
            </Button>
          </div>
          <div className="text-[11px] text-muted-foreground">חסום = פעיל, פתוח = כבוי</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {ALL_SIDEBAR_ITEMS.map((s) => {
              const blocked = blocklist.sections.includes(s.id);
              return (
                <label key={s.id} className="flex items-center justify-between gap-2 rounded border-2 border-gold/30 bg-card px-2 py-1.5">
                  <span className="text-xs">{s.label}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold ${blocked ? "text-destructive" : "text-muted-foreground"}`}>
                      {blocked ? "חסום" : "פתוח"}
                    </span>
                    <Switch checked={blocked} onCheckedChange={() => toggleSection(s.id)} />
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-bold">וידג'טים (לפי טאב)</h4>
            <Button type="button" size="sm" variant="outline" onClick={toggleAllWidgetsGlobal}>
              {allWidgetsBlocked ? "נקה הכל" : "בחר הכל"}
            </Button>
          </div>
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {Object.entries(WIDGET_DEFS).map(([tabId, widgets]) => {
              const widgetIds = widgets.map((w) => w.id);
              const allTabBlocked = isAllWidgetsBlockedInTab(tabId, widgetIds);
              return (
              <div key={tabId} className="rounded border-2 border-gold/20 p-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="text-xs font-bold text-muted-foreground">טאב: {tabId}</div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => toggleAllWidgetsInTab(tabId, widgetIds)}
                  >
                    {allTabBlocked ? "נקה הכל" : "בחר הכל"}
                  </Button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {widgets.map((w) => {
                    const blocked = (blocklist.widgets[tabId] ?? []).includes(w.id);
                    return (
                      <label key={w.id} className="flex items-center justify-between gap-2 rounded border border-gold/20 bg-card px-2 py-1">
                        <span className="text-[11px]">{w.label}</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold ${blocked ? "text-destructive" : "text-muted-foreground"}`}>
                            {blocked ? "חסום" : "פתוח"}
                          </span>
                          <Switch checked={blocked} onCheckedChange={() => toggleWidget(tabId, w.id)} />
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            );})}
          </div>
        </div>

            <div className="grid md:grid-cols-2 gap-3">
              <BlocklistPreviewCard
                title={selectedAssignmentProfile
                  ? `תצוגת חסימה: ${selectedAssignmentProfile.name}`
                  : "תצוגת חסימה (מהעריכה הנוכחית)"}
                sections={profilePreviewSections.map((s) => s.label)}
                widgetsByTab={profilePreviewWidgetsByTab.map(({ tabId, widgets }) => ({
                  tabId,
                  widgetLabels: widgets.map((w) => w.label),
                }))}
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Select value={selectedProfileId} onValueChange={loadProfileToEditor}>
                <SelectTrigger className="w-56"><SelectValue placeholder="טען פרופיל חסימה" /></SelectTrigger>
                <SelectContent>
                  {blockProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="שם פרופיל חסימה"
                className="w-56"
              />
              <Button type="button" variant="outline" onClick={saveNamedProfile} disabled={savingProfile} className="gap-2">
                <Save className="h-4 w-4" /> שמור בשם
              </Button>
              <Button onClick={persistBlocklist} disabled={savingBlock} className="gap-2">
                <Save className="h-4 w-4" /> שמור רשימת חסימה
              </Button>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

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
function BlocklistPreviewCard(props: {
  title: string;
  sections: string[];
  widgetsByTab: Array<{ tabId: string; widgetLabels: string[] }>;
}) {
  const { title, sections, widgetsByTab } = props;
  return (
    <div className="rounded-lg border-2 border-gold/30 bg-card/60 p-3 space-y-3 text-xs">
      <div className="font-bold text-sm">{title}</div>
      <div>
        <div className="font-semibold mb-1 text-muted-foreground">מקטעי סיידבר חסומים ({sections.length})</div>
        <div className="flex flex-wrap gap-1">
          {sections.length === 0 ? (
            <span className="text-muted-foreground italic">אין חסימות</span>
          ) : (
            sections.map((label) => (
              <span key={label} className="rounded-full bg-muted px-2 py-0.5 text-[10px]">{label}</span>
            ))
          )}
        </div>
      </div>
      <div>
        <div className="font-semibold mb-1 text-muted-foreground">וידג'טים חסומים ({widgetsByTab.length} טאבים)</div>
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {widgetsByTab.length === 0 && <span className="text-muted-foreground italic">אין חסימות</span>}
          {widgetsByTab.map(({ tabId, widgetLabels }) => (
            <div key={tabId} className="rounded border border-border/60 p-1.5">
              <div className="text-[10px] font-bold text-muted-foreground mb-1">{tabId}</div>
              <div className="flex flex-wrap gap-1">
                {widgetLabels.map((w) => (
                  <span key={w} className="rounded border border-border/50 bg-muted px-1.5 py-0.5 text-[10px]">{w}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
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
