import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Eye, LayoutTemplate, Plus, Save, ShieldCheck, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  buildDisplaySecurityRows,
  PROFILE_ACTIONS,
  SECURITY_MODULE_SECTIONS,
  type ProfileAction,
  type ProfileActionPermissions,
} from "@/lib/auth/displaySecurity";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ALL_SIDEBAR_ITEMS } from "@/lib/study/sidebarItems";
import { mergeLayout, WIDGET_DEFS } from "@/lib/study/widgetLayout";
import {
  loadFeatureBlocklistProfiles,
  loadRoleBlocklistAssignments,
  saveFeatureBlocklistProfiles,
  saveRoleBlocklistAssignments,
  LOCAL_OFFLINE_ROLE_ID,
  type BlocklistScope,
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
import type { SidebarConfig, WidgetLayout } from "@/lib/study/types";

interface AppRole { id: string; name: string; description: string | null }
interface CategoryTemplateItem { id: string; name: string; color?: string | null }

interface UnifiedProfile {
  id: string;
  name: string;
  actionPermissions: ProfileActionPermissions;
  hiddenSections: string[];
  hiddenWidgets: Record<string, string[]>;
  widgetLayout: WidgetLayout;
  sidebarConfig: SidebarConfig[];
  categoryTemplate: CategoryTemplateItem[];
  updatedAt: number;
}

const ADMIN_ONLY_SECTION_IDS = new Set(["admin", "system-rubric", "db-inspector", "perf", "ai-generator", "question-lab"]);

const SECURITY_MODULE_LABELS: Record<string, string> = {
  cards: "קטגוריות ויצירת שאלות",
  decks: "יצירת מבחנים",
  goals: "יעדים",
  shas: 'לוח ש"ס',
  analytics: "סיכום וניתוחים",
  settings: "הגדרות",
};

const ACTION_LABELS: Record<ProfileAction, string> = {
  create: "יצירה",
  edit: "עריכה",
  delete: "מחיקה",
  manage: "ניהול",
};

const labelForRole = (name: string) => ({
  admin: "מנהל",
  user: "משתמש רגיל",
  moderator: "מנחה",
  [LOCAL_OFFLINE_ROLE_ID]: "חשבון מקומי / אופליין",
}[name] ?? name);

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function defaultSidebar(): SidebarConfig[] {
  return ALL_SIDEBAR_ITEMS.map((item, order) => ({ id: item.id, visible: true, order }));
}

function layoutOrderOnly(config: SidebarConfig[]): SidebarConfig[] {
  const source = config.length ? config : defaultSidebar();
  return source.map((item, order) => ({ ...item, visible: true, order }));
}

function layoutWithUnifiedVisibility(layout: WidgetLayout): WidgetLayout {
  return Object.fromEntries(
    Object.keys(WIDGET_DEFS).map((tabId) => [
      tabId,
      mergeLayout(layout[tabId], tabId).map((widget, order) => ({ ...widget, visible: true, order })),
    ]),
  );
}

function normalizeHiddenWidgets(value: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(WIDGET_DEFS)
      .map(([tabId, defs]) => {
        const known = new Set(defs.map((widget) => widget.id));
        const hidden = Array.from(new Set(value[tabId] ?? [])).filter((id) => known.has(id));
        return [tabId, hidden] as const;
      })
      .filter(([, hidden]) => hidden.length > 0),
  );
}

const widgetTabLabel = (tabId: string) => ({
  overview: "כללי",
  goals: "יעדים",
  cards: "קטגוריות ושאלות (תאימות ישנה)",
  goals_page: "יעדים יומיים",
  ai_page: "מאמן AI",
  achievements_page: "הישגים",
}[tabId] ?? ALL_SIDEBAR_ITEMS.find((item) => item.id === tabId)?.label ?? tabId);

function rolePermissionsToProfile(
  rows: Array<{ role_id: string; module: string; action: string; allowed: boolean }>,
  roleId?: string,
): ProfileActionPermissions {
  if (!roleId) return {};
  const result: ProfileActionPermissions = {};
  rows.filter((row) => row.role_id === roleId && PROFILE_ACTIONS.includes(row.action as ProfileAction)).forEach((row) => {
    result[row.module] = { ...result[row.module], [row.action]: row.allowed };
  });
  return result;
}

function mergeProfiles(
  layoutProfiles: RoleLayoutProfile[],
  blockProfiles: FeatureBlocklistProfile[],
  layoutAssignments: RoleLayoutProfileAssignment[],
  blockAssignments: RoleBlocklistAssignment[],
  permissionRows: Array<{ role_id: string; module: string; action: string; allowed: boolean }>,
): UnifiedProfile[] {
  const ids = new Set([...layoutProfiles.map((p) => p.id), ...blockProfiles.map((p) => p.id)]);
  return Array.from(ids).map((id) => {
    const layout = layoutProfiles.find((p) => p.id === id);
    const block = blockProfiles.find((p) => p.id === id);
    const assignedRoleId = layoutAssignments.find((row) => row.profileId === id)?.roleId
      ?? blockAssignments.find((row) => row.profileId === id)?.roleId;
    const storedPermissions = layout?.actionPermissions ?? {};
    return {
      id,
      name: layout?.name ?? block?.name ?? "ללא שם",
      actionPermissions: Object.keys(storedPermissions).length
        ? storedPermissions
        : rolePermissionsToProfile(permissionRows, assignedRoleId),
      hiddenSections: block?.blocklist.sections ?? [],
      hiddenWidgets: normalizeHiddenWidgets(block?.blocklist.widgets ?? {}),
      widgetLayout: layoutWithUnifiedVisibility(layout?.widgetLayout ?? {}),
      sidebarConfig: layoutOrderOnly(layout?.sidebarConfig ?? []),
      categoryTemplate: layout?.categoryTemplate ?? [],
      updatedAt: Math.max(layout?.updatedAt ?? 0, block?.updatedAt ?? 0),
    };
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function SimpleViewProfilesManager({
  scope,
  roles,
  currentWidgetLayout,
  currentSidebar,
  currentCategories,
}: {
  scope: LayoutScope;
  roles: AppRole[];
  currentWidgetLayout: WidgetLayout;
  currentSidebar: SidebarConfig[];
  currentCategories: CategoryTemplateItem[];
}) {
  const [profiles, setProfiles] = useState<UnifiedProfile[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<UnifiedProfile | null>(null);
  const [layoutAssignments, setLayoutAssignments] = useState<RoleLayoutProfileAssignment[]>([]);
  const [blockAssignments, setBlockAssignments] = useState<RoleBlocklistAssignment[]>([]);
  const [assignedRoleIds, setAssignedRoleIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const availableRoles = useMemo(() => {
    // Administrator is intentionally excluded: it is always fail-open for
    // administration and must never be weakened by a display profile.
    const configurableRoles = roles.filter((role) => role.name !== "admin");
    const withLocal = configurableRoles.some((r) => r.id === LOCAL_OFFLINE_ROLE_ID)
      ? configurableRoles
      : [...configurableRoles, { id: LOCAL_OFFLINE_ROLE_ID, name: LOCAL_OFFLINE_ROLE_ID, description: "חשבון מקומי ללא ענן" }];
    return withLocal;
  }, [roles]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [layoutRows, blockRows, layoutLinks, blockLinks, permissionResult] = await Promise.all([
        loadRoleLayoutProfiles({ force: true, scope }),
        loadFeatureBlocklistProfiles({ force: true, scope: scope as BlocklistScope }),
        loadRoleLayoutProfileAssignments({ force: true, scope }),
        loadRoleBlocklistAssignments({ force: true, scope: scope as BlocklistScope }),
        supabase.from("role_permissions").select("role_id,module,action,allowed"),
      ]);
      if (permissionResult.error) throw permissionResult.error;
      const merged = mergeProfiles(
        layoutRows,
        blockRows,
        layoutLinks,
        blockLinks,
        (permissionResult.data ?? []) as Array<{ role_id: string; module: string; action: string; allowed: boolean }>,
      );
      setProfiles(merged);
      setLayoutAssignments(layoutLinks);
      setBlockAssignments(blockLinks);
      const nextId = merged[0]?.id ?? "";
      setSelectedId(nextId);
      setDraft(merged.find((p) => p.id === nextId) ?? null);
    } catch (error) {
      toast.error("טעינת הפרופילים נכשלה: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setAssignedRoleIds([]);
      return;
    }
    const layoutRoleIds = layoutAssignments.filter((a) => a.profileId === selectedId).map((a) => a.roleId);
    const blockRoleIds = blockAssignments.filter((a) => a.profileId === selectedId).map((a) => a.roleId);
    setAssignedRoleIds(Array.from(new Set([...layoutRoleIds, ...blockRoleIds])));
  }, [selectedId, layoutAssignments, blockAssignments]);

  const selectProfile = (profileId: string) => {
    setSelectedId(profileId);
    const profile = profiles.find((p) => p.id === profileId) ?? null;
    setDraft(profile ? { ...profile, hiddenSections: [...profile.hiddenSections] } : null);
  };

  const createProfile = () => {
    const id = uid();
    const profile: UnifiedProfile = {
      id,
      name: `פרופיל חדש ${profiles.length + 1}`,
      actionPermissions: {},
      hiddenSections: [],
      hiddenWidgets: {},
      widgetLayout: currentWidgetLayout,
      sidebarConfig: currentSidebar.length ? currentSidebar : defaultSidebar(),
      categoryTemplate: currentCategories,
      updatedAt: Date.now(),
    };
    setProfiles((prev) => [profile, ...prev]);
    setSelectedId(id);
    setDraft(profile);
    setAssignedRoleIds([]);
  };

  const duplicateProfile = () => {
    if (!draft) return;
    const copy: UnifiedProfile = {
      ...draft,
      id: uid(),
      name: `${draft.name} — עותק`,
      hiddenSections: [...draft.hiddenSections],
      actionPermissions: Object.fromEntries(
        Object.entries(draft.actionPermissions).map(([module, actions]) => [module, { ...actions }]),
      ),
      hiddenWidgets: Object.fromEntries(Object.entries(draft.hiddenWidgets).map(([key, value]) => [key, [...value]])),
      updatedAt: Date.now(),
    };
    setProfiles((prev) => [copy, ...prev]);
    setSelectedId(copy.id);
    setDraft(copy);
    setAssignedRoleIds([]);
  };

  const toggleSection = (sectionId: string) => {
    if (!draft) return;
    const hidden = new Set(draft.hiddenSections);
    if (hidden.has(sectionId)) hidden.delete(sectionId); else hidden.add(sectionId);
    setDraft({ ...draft, hiddenSections: Array.from(hidden) });
  };

  const toggleAction = (module: string, action: ProfileAction) => {
    if (!draft) return;
    setDraft({
      ...draft,
      actionPermissions: {
        ...draft.actionPermissions,
        [module]: {
          ...draft.actionPermissions[module],
          [action]: !draft.actionPermissions[module]?.[action],
        },
      },
    });
  };

  const toggleWidget = (tabId: string, widgetId: string) => {
    if (!draft) return;
    const hidden = new Set(draft.hiddenWidgets[tabId] ?? []);
    if (hidden.has(widgetId)) hidden.delete(widgetId); else hidden.add(widgetId);
    const next = { ...draft.hiddenWidgets };
    if (hidden.size) next[tabId] = Array.from(hidden); else delete next[tabId];
    setDraft({ ...draft, hiddenWidgets: next });
  };

  const setAllWidgetsVisible = (visible: boolean) => {
    if (!draft) return;
    setDraft({
      ...draft,
      hiddenWidgets: visible
        ? {}
        : Object.fromEntries(Object.entries(WIDGET_DEFS).map(([tabId, defs]) => [tabId, defs.map((widget) => widget.id)])),
    });
  };

  const setAllVisible = (visible: boolean) => {
    if (!draft) return;
    setDraft({ ...draft, hiddenSections: visible ? [] : ALL_SIDEBAR_ITEMS.map((item) => item.id) });
  };

  const setSafeUserPreset = () => {
    if (!draft) return;
    setDraft({ ...draft, hiddenSections: Array.from(ADMIN_ONLY_SECTION_IDS) });
  };

  const applyCurrentLayout = () => {
    if (!draft) return;
    setDraft({
      ...draft,
      widgetLayout: layoutWithUnifiedVisibility(currentWidgetLayout),
      sidebarConfig: layoutOrderOnly(currentSidebar),
      categoryTemplate: currentCategories,
    });
    toast.success("תבנית המסך הנוכחית הועתקה לפרופיל. לחץ שמור כדי לאשר.");
  };

  const toggleRole = (roleId: string) => {
    setAssignedRoleIds((prev) => prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]);
  };

  const save = async () => {
    if (!draft?.name.trim()) return toast.error("נא להזין שם לפרופיל");
    setBusy(true);
    try {
      const now = Date.now();
      const normalized = {
        ...draft,
        name: draft.name.trim(),
        hiddenSections: Array.from(new Set(draft.hiddenSections)),
        hiddenWidgets: normalizeHiddenWidgets(draft.hiddenWidgets),
        widgetLayout: layoutWithUnifiedVisibility(draft.widgetLayout),
        sidebarConfig: layoutOrderOnly(draft.sidebarConfig),
        updatedAt: now,
      };
      const nextProfiles = [normalized, ...profiles.filter((p) => p.id !== normalized.id)];

      const existingLayouts = await loadRoleLayoutProfiles({ force: true, scope });
      const existingBlocks = await loadFeatureBlocklistProfiles({ force: true, scope: scope as BlocklistScope });
      await Promise.all([
        saveRoleLayoutProfiles([
          ...existingLayouts.filter((p) => p.id !== normalized.id),
          {
            id: normalized.id,
            name: normalized.name,
            actionPermissions: normalized.actionPermissions,
            widgetLayout: normalized.widgetLayout,
            sidebarConfig: normalized.sidebarConfig,
            categoryTemplate: normalized.categoryTemplate,
            updatedAt: now,
          },
        ], { scope }),
        saveFeatureBlocklistProfiles([
          ...existingBlocks.filter((p) => p.id !== normalized.id),
          {
            id: normalized.id,
            name: normalized.name,
            blocklist: { sections: normalized.hiddenSections, widgets: normalized.hiddenWidgets },
            updatedAt: now,
          },
        ], { scope: scope as BlocklistScope }),
      ]);

      const nextLayoutAssignments = [
        ...layoutAssignments.filter((a) => !assignedRoleIds.includes(a.roleId) && a.profileId !== normalized.id),
        ...assignedRoleIds.map((roleId) => ({ id: uid(), roleId, profileId: normalized.id })),
      ];
      const nextBlockAssignments = [
        ...blockAssignments.filter((a) => !assignedRoleIds.includes(a.roleId) && a.profileId !== normalized.id),
        ...assignedRoleIds.map((roleId) => ({ id: uid(), roleId, profileId: normalized.id })),
      ];

      // One-control rule: this profile owns page visibility and every action.
      // Hiding all pages of a module forces all of its actions off.
      const securityRows = buildDisplaySecurityRows(
        normalized.hiddenSections,
        availableRoles.filter((role) => assignedRoleIds.includes(role.id)),
        LOCAL_OFFLINE_ROLE_ID,
        normalized.actionPermissions,
      );
      await Promise.all([
        saveRoleLayoutProfileAssignments(nextLayoutAssignments, { scope }),
        saveRoleBlocklistAssignments(nextBlockAssignments, { scope: scope as BlocklistScope }),
        ...(scope === "desktop" && assignedRoleIds.length
          ? [supabase.from("role_layout_defaults").delete().in("role_id", assignedRoleIds)]
          : []),
        ...(securityRows.length
          ? [supabase.from("role_permissions").upsert(securityRows as never[], { onConflict: "role_id,module,action" })]
          : []),
      ]);

      setProfiles(nextProfiles);
      setDraft(normalized);
      setLayoutAssignments(nextLayoutAssignments);
      setBlockAssignments(nextBlockAssignments);
      toast.success(`הפרופיל "${normalized.name}" נשמר; התצוגה וכל ההרשאות סונכרנו`);
    } catch (error) {
      toast.error("שמירת הפרופיל נכשלה: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft || !confirm(`למחוק את הפרופיל "${draft.name}"?`)) return;
    setBusy(true);
    try {
      const layoutRows = (await loadRoleLayoutProfiles({ force: true, scope })).filter((p) => p.id !== draft.id);
      const blockRows = (await loadFeatureBlocklistProfiles({ force: true, scope: scope as BlocklistScope })).filter((p) => p.id !== draft.id);
      const layoutLinks = layoutAssignments.filter((a) => a.profileId !== draft.id);
      const blockLinks = blockAssignments.filter((a) => a.profileId !== draft.id);
      await Promise.all([
        saveRoleLayoutProfiles(layoutRows, { scope }),
        saveFeatureBlocklistProfiles(blockRows, { scope: scope as BlocklistScope }),
        saveRoleLayoutProfileAssignments(layoutLinks, { scope }),
        saveRoleBlocklistAssignments(blockLinks, { scope: scope as BlocklistScope }),
      ]);
      toast.success("הפרופיל נמחק");
      setSelectedId("");
      setDraft(null);
      await load();
    } catch (error) {
      toast.error("מחיקת הפרופיל נכשלה: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  };

  const displayItems = useMemo(
    () => ALL_SIDEBAR_ITEMS.filter((item) => !ADMIN_ONLY_SECTION_IDS.has(item.id)),
    [],
  );
  const visibleCount = draft ? displayItems.filter((item) => !draft.hiddenSections.includes(item.id)).length : 0;
  const totalWidgetCount = Object.values(WIDGET_DEFS).reduce((count, widgets) => count + widgets.length, 0);
  const hiddenWidgetCount = draft
    ? Object.values(normalizeHiddenWidgets(draft.hiddenWidgets)).reduce((count, widgets) => count + widgets.length, 0)
    : 0;
  const visibleWidgetCount = totalWidgetCount - hiddenWidgetCount;
  const splitAssignmentCount = useMemo(() => {
    return availableRoles.filter((role) => {
      const layoutId = layoutAssignments.find((row) => row.roleId === role.id)?.profileId;
      const blockId = blockAssignments.find((row) => row.roleId === role.id)?.profileId;
      return !!layoutId && !!blockId && layoutId !== blockId;
    }).length;
  }, [availableRoles, blockAssignments, layoutAssignments]);

  return (
    <Card className="gold-frame overflow-hidden" dir="rtl">
      <div className="border-b-2 border-gold/25 bg-gradient-to-l from-gold/10 to-transparent p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="gold-icon-circle"><LayoutTemplate className="h-5 w-5" /></span>
            <div>
              <h2 className="font-display text-xl font-bold">פרופיל הרשאות, תצוגה ופריסה</h2>
              <p className="text-sm text-muted-foreground">הגדרה אחת לכל האלמנטים: מה פתוח, מה מותר ואיך המסך מסודר.</p>
            </div>
          </div>
          <Button onClick={createProfile} disabled={loading || busy} className="gap-2">
            <Plus className="h-4 w-4" /> צור פרופיל חדש
          </Button>
        </div>
      </div>

      <div className="grid gap-3 border-b-2 border-gold/20 bg-muted/20 p-4 md:grid-cols-3">
        <div className="rounded-xl border bg-card p-3">
          <div className="flex items-center gap-2 font-bold"><ShieldCheck className="h-4 w-4 text-emerald-600" /> הרשאה</div>
          <p className="mt-1 text-xs text-muted-foreground">כיבוי עמוד חוסם גם כתובת ישירה וגם יצירה, עריכה, מחיקה וניהול באותו מודול.</p>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="flex items-center gap-2 font-bold"><Eye className="h-4 w-4 text-gold" /> מה רואים</div>
          <p className="mt-1 text-xs text-muted-foreground">לא מסומן פירושו מוסתר, והרשאת הצפייה למודול המתאים נחסמת יחד איתו.</p>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="flex items-center gap-2 font-bold"><LayoutTemplate className="h-4 w-4 text-gold" /> איך מסודר</div>
          <p className="mt-1 text-xs text-muted-foreground">הפריסה שומרת סדר וגודל בלבד; הנראות נשלטת במקום אחד כדי למנוע סתירות.</p>
        </div>
      </div>

      {splitAssignmentCount > 0 && (
        <div className="mx-5 mt-4 rounded-xl border-2 border-amber-400/60 bg-amber-50 p-3 text-sm text-amber-950">
          נמצאו {splitAssignmentCount} שיוכים ישנים שבהם הפריסה והחסימה מצביעות לפרופילים שונים. בחירת הפרופיל ושמירתו תאחד אותם אוטומטית למקור אחד.
        </div>
      )}

      <div className="grid gap-5 p-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="rounded-xl border-2 border-gold/30 bg-card p-3">
            <div className="mb-2 text-sm font-bold">1. בחר או צור פרופיל</div>
            <Select value={selectedId} onValueChange={selectProfile} disabled={loading || profiles.length === 0}>
              <SelectTrigger><SelectValue placeholder={loading ? "טוען..." : "בחר פרופיל"} /></SelectTrigger>
              <SelectContent>{profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
            {draft && (
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={duplicateProfile} className="flex-1 gap-1"><Copy className="h-3.5 w-3.5" /> שכפל</Button>
                <Button size="sm" variant="outline" onClick={() => void remove()} disabled={busy} className="text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            )}
          </div>

          {draft && (
            <div className="rounded-xl border-2 border-gold/30 bg-card p-3 space-y-2">
              <div className="text-sm font-bold">שם הפרופיל</div>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="לדוגמה: משתמש רגיל" />
            </div>
          )}
        </div>

        {draft ? (
          <div className="space-y-5">
            <section className="rounded-xl border-2 border-gold/30 bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-bold">2. כל העמודים וההרשאות</h3>
                  <p className="text-xs text-muted-foreground">מסומן = מוצג ומאושרת צפייה. כיבוי כל עמודי המודול חוסם אוטומטית גם את כל הפעולות שלו.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setAllVisible(true)}>הצג הכול</Button>
                  <Button size="sm" variant="outline" onClick={setSafeUserPreset}>תבנית משתמש בטוחה</Button>
                  <Button size="sm" variant="outline" onClick={() => setAllVisible(false)}>הסתר הכול</Button>
                </div>
              </div>
              <div className="mb-3 rounded-lg bg-muted/40 px-3 py-2 text-sm font-semibold">
                <Check className="ml-1 inline h-4 w-4 text-green-600" /> {visibleCount} אפשרויות יוצגו
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {displayItems.map((item) => {
                  const checked = !draft.hiddenSections.includes(item.id);
                  return (
                    <label key={item.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 transition-colors ${checked ? "border-gold/50 bg-gold/5" : "border-border bg-muted/25 text-muted-foreground"}`}>
                      <Checkbox checked={checked} onCheckedChange={() => toggleSection(item.id)} />
                      <span className="text-sm font-medium">{item.label}</span>
                    </label>
                  );
                })}
              </div>

              <div className="mt-5 border-t-2 border-gold/20 pt-4">
                <h4 className="font-bold">פעולות בתוך עמוד פתוח</h4>
                <p className="mb-3 text-xs text-muted-foreground">
                  אין מטריצה נוספת: גם הפעולות נשמרות כחלק מאותו פרופיל. כאשר העמוד חסום, המתגים מושבתים והאבטחה נחסמת בפועל.
                </p>
                <div className="grid gap-3 lg:grid-cols-2">
                  {Object.entries(SECURITY_MODULE_SECTIONS).map(([module, sectionIds]) => {
                    const moduleVisible = sectionIds.some((sectionId) => !draft.hiddenSections.includes(sectionId));
                    return (
                      <div key={module} className={`rounded-xl border-2 p-3 ${moduleVisible ? "border-gold/35 bg-gold/5" : "border-border bg-muted/30"}`}>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div>
                            <div className="font-semibold">{SECURITY_MODULE_LABELS[module] ?? module}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {moduleVisible ? "העמוד פתוח — בחר מה מותר לבצע" : "חסום בתצוגה ובאבטחה"}
                            </div>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${moduleVisible ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
                            {moduleVisible ? "צפייה פתוחה" : "חסום"}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {PROFILE_ACTIONS.map((action) => {
                            const checked = moduleVisible && draft.actionPermissions[module]?.[action] === true;
                            return (
                              <label key={action} className={`flex items-center gap-2 rounded-lg border p-2 text-xs ${moduleVisible ? "cursor-pointer bg-card" : "cursor-not-allowed opacity-60"}`}>
                                <Checkbox
                                  checked={checked}
                                  disabled={!moduleVisible}
                                  onCheckedChange={() => toggleAction(module, action)}
                                />
                                <span>{ACTION_LABELS[action]}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="rounded-xl border-2 border-gold/30 bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-bold">3. ווידג׳טים זמינים בתוך העמודים</h3>
                  <p className="text-xs text-muted-foreground">מסומן = יוצג בפריסת ברירת המחדל. לא מסומן = לא יהיה זמין למשתמש.</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setAllWidgetsVisible(true)}>הצג הכול</Button>
                  <Button size="sm" variant="outline" onClick={() => setAllWidgetsVisible(false)}>הסתר הכול</Button>
                </div>
              </div>
              <div className="mb-3 rounded-lg bg-muted/40 px-3 py-2 text-sm font-semibold">
                <Check className="ml-1 inline h-4 w-4 text-green-600" /> {visibleWidgetCount} מתוך {totalWidgetCount} ווידג׳טים יוצגו
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {Object.entries(WIDGET_DEFS).map(([tabId, widgets]) => (
                  <details key={tabId} className="rounded-xl border border-gold/30 bg-muted/10 p-3" open={tabId === "overview"}>
                    <summary className="cursor-pointer select-none font-semibold">
                      {widgetTabLabel(tabId)} · {widgets.filter((widget) => !(draft.hiddenWidgets[tabId] ?? []).includes(widget.id)).length}/{widgets.length}
                    </summary>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {widgets.map((widget) => {
                        const checked = !(draft.hiddenWidgets[tabId] ?? []).includes(widget.id);
                        return (
                          <label key={widget.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 ${checked ? "border-gold/40 bg-card" : "bg-muted/30 text-muted-foreground"}`}>
                            <Checkbox checked={checked} onCheckedChange={() => toggleWidget(tabId, widget.id)} />
                            <span className="text-xs font-medium">{widget.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </details>
                ))}
              </div>
            </section>

            <section className="rounded-xl border-2 border-gold/30 bg-card p-4">
              <h3 className="font-bold">4. פריסת ברירת המחדל</h3>
              <p className="mt-1 text-xs text-muted-foreground">סדר וגודל מועתקים מהמסך הנוכחי. בחירת הנראות נעשית רק בסעיפים 2–3, ולכן אין שתי הגדרות שסותרות זו את זו.</p>
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-muted/30 p-3 text-sm">
                <span>{draft.sidebarConfig.length} פריטי ניווט מסודרים</span>
                <span>·</span>
                <span>{Object.keys(draft.widgetLayout).length} עמודי ווידג׳טים</span>
                <Button size="sm" variant="outline" onClick={applyCurrentLayout} className="mr-auto gap-1">
                  <LayoutTemplate className="h-3.5 w-3.5" /> העתק את הסדר והגדלים מהמסך הנוכחי
                </Button>
              </div>
            </section>

            <section className="rounded-xl border-2 border-gold/30 bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <Users className="h-5 w-5 text-gold" />
                <div>
                  <h3 className="font-bold">5. למי לשייך את הפרופיל?</h3>
                  <p className="text-xs text-muted-foreground">אפשר לשייך את אותה תבנית לכמה סוגי משתמשים.</p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {availableRoles.map((role) => {
                  const checked = assignedRoleIds.includes(role.id);
                  return (
                    <label key={role.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border-2 p-3 ${checked ? "border-gold bg-gold/10" : "border-border"}`}>
                      <Checkbox checked={checked} onCheckedChange={() => toggleRole(role.id)} />
                      <div><div className="font-semibold">{labelForRole(role.name)}</div>{role.description && <div className="text-[11px] text-muted-foreground">{role.description}</div>}</div>
                    </label>
                  );
                })}
              </div>
            </section>

            <div className="sticky bottom-3 z-10 flex justify-end">
              <Button size="lg" onClick={() => void save()} disabled={busy} className="min-w-56 gap-2 shadow-lg">
                <Save className="h-4 w-4" /> {busy ? "שומר..." : "שמור פרופיל ושיוכים"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-64 items-center justify-center rounded-xl border-2 border-dashed border-gold/30 text-center text-muted-foreground">
            <div><LayoutTemplate className="mx-auto mb-2 h-10 w-10 opacity-50" /><p>צור פרופיל ראשון כדי להתחיל</p></div>
          </div>
        )}
      </div>
    </Card>
  );
}
