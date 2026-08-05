import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, LayoutTemplate, Plus, Save, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ALL_SIDEBAR_ITEMS } from "@/lib/study/sidebarItems";
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
  hiddenSections: string[];
  hiddenWidgets: Record<string, string[]>;
  widgetLayout: WidgetLayout;
  sidebarConfig: SidebarConfig[];
  categoryTemplate: CategoryTemplateItem[];
  updatedAt: number;
}

const ADMIN_ONLY_SECTION_IDS = new Set(["admin", "system-rubric", "db-inspector", "perf", "ai-generator", "question-lab"]);

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

function mergeProfiles(layoutProfiles: RoleLayoutProfile[], blockProfiles: FeatureBlocklistProfile[]): UnifiedProfile[] {
  const ids = new Set([...layoutProfiles.map((p) => p.id), ...blockProfiles.map((p) => p.id)]);
  return Array.from(ids).map((id) => {
    const layout = layoutProfiles.find((p) => p.id === id);
    const block = blockProfiles.find((p) => p.id === id);
    return {
      id,
      name: layout?.name ?? block?.name ?? "ללא שם",
      hiddenSections: block?.blocklist.sections ?? [],
      hiddenWidgets: block?.blocklist.widgets ?? {},
      widgetLayout: layout?.widgetLayout ?? {},
      sidebarConfig: layout?.sidebarConfig?.length ? layout.sidebarConfig : defaultSidebar(),
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
    const withLocal = roles.some((r) => r.id === LOCAL_OFFLINE_ROLE_ID)
      ? roles
      : [...roles, { id: LOCAL_OFFLINE_ROLE_ID, name: LOCAL_OFFLINE_ROLE_ID, description: "חשבון מקומי ללא ענן" }];
    return withLocal;
  }, [roles]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [layoutRows, blockRows, layoutLinks, blockLinks] = await Promise.all([
        loadRoleLayoutProfiles({ force: true, scope }),
        loadFeatureBlocklistProfiles({ force: true, scope: scope as BlocklistScope }),
        loadRoleLayoutProfileAssignments({ force: true, scope }),
        loadRoleBlocklistAssignments({ force: true, scope: scope as BlocklistScope }),
      ]);
      const merged = mergeProfiles(layoutRows, blockRows);
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
      widgetLayout: currentWidgetLayout,
      sidebarConfig: currentSidebar.length ? currentSidebar : defaultSidebar(),
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
      const normalized = { ...draft, name: draft.name.trim(), updatedAt: now };
      const nextProfiles = [normalized, ...profiles.filter((p) => p.id !== normalized.id)];

      const existingLayouts = await loadRoleLayoutProfiles({ force: true, scope });
      const existingBlocks = await loadFeatureBlocklistProfiles({ force: true, scope: scope as BlocklistScope });
      await Promise.all([
        saveRoleLayoutProfiles([
          ...existingLayouts.filter((p) => p.id !== normalized.id),
          {
            id: normalized.id,
            name: normalized.name,
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
      await Promise.all([
        saveRoleLayoutProfileAssignments(nextLayoutAssignments, { scope }),
        saveRoleBlocklistAssignments(nextBlockAssignments, { scope: scope as BlocklistScope }),
      ]);

      setProfiles(nextProfiles);
      setDraft(normalized);
      setLayoutAssignments(nextLayoutAssignments);
      setBlockAssignments(nextBlockAssignments);
      toast.success(`הפרופיל "${normalized.name}" נשמר ושויך בהצלחה`);
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

  const visibleCount = draft ? ALL_SIDEBAR_ITEMS.length - draft.hiddenSections.length : 0;

  return (
    <Card className="gold-frame overflow-hidden" dir="rtl">
      <div className="border-b-2 border-gold/25 bg-gradient-to-l from-gold/10 to-transparent p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="gold-icon-circle"><LayoutTemplate className="h-5 w-5" /></span>
            <div>
              <h2 className="font-display text-xl font-bold">פרופילי תצוגה — פשוט וברור</h2>
              <p className="text-sm text-muted-foreground">יוצרים פרופיל, בוחרים מה ייפתח ומשייכים אותו לסוג המשתמש.</p>
            </div>
          </div>
          <Button onClick={createProfile} disabled={loading || busy} className="gap-2">
            <Plus className="h-4 w-4" /> צור פרופיל חדש
          </Button>
        </div>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="rounded-xl border-2 border-gold/30 bg-card p-3">
            <div className="mb-2 text-sm font-bold">1. בחר או צור פרופיל</div>
            <Select value={selectedId || undefined} onValueChange={selectProfile} disabled={loading || profiles.length === 0}>
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
              <Button size="sm" variant="outline" onClick={applyCurrentLayout} className="w-full gap-1">
                <LayoutTemplate className="h-3.5 w-3.5" /> העתק את תבנית המסך הנוכחית
              </Button>
              <p className="text-[11px] text-muted-foreground">שומר גם סדר, גודל ונראות של אזורי המסך.</p>
            </div>
          )}
        </div>

        {draft ? (
          <div className="space-y-5">
            <section className="rounded-xl border-2 border-gold/30 bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-bold">2. מה ייפתח בפרופיל?</h3>
                  <p className="text-xs text-muted-foreground">מסומן = מופיע למשתמש. לא מסומן = מוסתר.</p>
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
                {ALL_SIDEBAR_ITEMS.map((item) => {
                  const checked = !draft.hiddenSections.includes(item.id);
                  return (
                    <label key={item.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 transition-colors ${checked ? "border-gold/50 bg-gold/5" : "border-border bg-muted/25 text-muted-foreground"}`}>
                      <Checkbox checked={checked} onCheckedChange={() => toggleSection(item.id)} />
                      <span className="text-sm font-medium">{item.label}</span>
                      {ADMIN_ONLY_SECTION_IDS.has(item.id) && <span className="mr-auto text-[10px] text-destructive">מנהל</span>}
                    </label>
                  );
                })}
              </div>
            </section>

            <section className="rounded-xl border-2 border-gold/30 bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <Users className="h-5 w-5 text-gold" />
                <div>
                  <h3 className="font-bold">3. למי לשייך את הפרופיל?</h3>
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
