import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  getActiveGuestViewProfileId,
  hasUsableGuestCategoryTree,
  hydrateGuestProfilesFromSiteSettings,
  isGuestStudySeedStructurallyUsable,
  listGuestViewProfiles,
  loadGuestDefaultProfileIdFromSiteSettings,
  removeGuestViewProfile,
  saveGuestViewProfile,
  saveGuestDefaultProfileIdToSiteSettings,
  saveGuestViewProfilesToSiteSettings,
  setActiveGuestViewProfile,
  type GuestViewProfile,
} from "@/lib/auth/guestViewProfile";
import { defaultSrs } from "@/lib/study/srs";
import { useStudy } from "@/lib/study/store";
import type { Card as StudyCard, CardDeckLink, Category, Deck, SidebarConfig, WidgetLayout } from "@/lib/study/types";
import { toast } from "sonner";
import { CheckCircle2, RefreshCw, Trash2, UserPlus } from "lucide-react";

interface AppRole {
  id: string;
  name: string;
}

interface RolePermissionRow {
  module: string;
  action: string;
  allowed: boolean;
}

interface RoleLayoutDefaultsRow {
  sidebar_config: SidebarConfig[] | null;
  widget_layout: WidgetLayout | null;
}

interface CategorySeedRow {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  created_at: string;
  updated_at: string | null;
  sort_order: number | null;
}

interface DeckSeedRow {
  id: string;
  name: string;
  description: string | null;
  color: string;
  created_at: string;
  updated_at: string | null;
  category_ids: unknown;
  include_sub_categories: boolean;
}

interface CardSeedRow {
  id: string;
  deck_id: string | null;
  type: string;
  question: string;
  tags: unknown;
  created_at: string;
  updated_at: string | null;
  srs: unknown;
  stats: unknown;
  answer: string | null;
  options: unknown;
  correct_indices: unknown;
  correct_boolean: boolean | null;
  explanation: string | null;
  masechta: string | null;
  daf: number | null;
  amud: number | null;
}

interface CardDeckSeedRow {
  card_id: string;
  deck_id: string;
  sort_order: number | null;
  updated_at: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  admin: "מנהל",
  user: "משתמש רגיל",
  moderator: "מנחה",
  editor: "אדיטור",
};

const roleLabel = (name: string) => ROLE_LABEL[name] ?? name;

const generateId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `guest-profile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const SEED_PAGE_SIZE = 1000;
const SEED_MAX_ROWS = 50_000;

async function fetchAllSeedPages<T>(
  queryPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
  label: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < SEED_MAX_ROWS; from += SEED_PAGE_SIZE) {
    const to = from + SEED_PAGE_SIZE - 1;
    const { data, error } = await queryPage(from, to);
    if (error) throw new Error(error.message ?? `Failed loading ${label}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < SEED_PAGE_SIZE) return rows;
  }

  throw new Error(`Seed fetch exceeded safety limit for ${label} (${SEED_MAX_ROWS} rows)`);
}

export function GuestProfilesTab() {
  const { state: studyState } = useStudy();
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [profiles, setProfiles] = useState<GuestViewProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const [profileLabel, setProfileLabel] = useState("");
  const [profileSourceUserId, setProfileSourceUserId] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Guest cloud source — when enabled, guests read this user's data from the cloud
  // (read-only). When disabled, guests get an empty/clean app like before.
  const [sourceEnabled, setSourceEnabled] = useState(false);
  const [sourceUserId, setSourceUserId] = useState<string | null>(null);
  const [sourceUserLabel, setSourceUserLabel] = useState<string>("");
  const [adminCandidates, setAdminCandidates] = useState<Array<{ id: string; email: string | null; display_name: string | null }>>([]);
  const [sourceBusy, setSourceBusy] = useState(false);
  // Same source, separate toggle for authenticated registered users (overlay).
  const [overlayForUsersEnabled, setOverlayForUsersEnabled] = useState(false);
  const [overlayBusy, setOverlayBusy] = useState(false);

  const loadGuestSource = useCallback(async () => {
    const { data: srcRow } = await supabase
      .from("site_settings").select("value").eq("key", "guest_source").maybeSingle();
    const val = (srcRow?.value ?? {}) as { enabled?: boolean; user_id?: string | null };
    setSourceEnabled(!!val.enabled);
    setSourceUserId(val.user_id ?? null);

    const { data: overlayRow } = await supabase
      .from("site_settings").select("value").eq("key", "source_overlay_for_users").maybeSingle();
    const overlayVal = (overlayRow?.value ?? {}) as { enabled?: boolean };
    setOverlayForUsersEnabled(!!overlayVal.enabled);

    // List ALL user profiles as candidates for the source (not just admins).
    const { data: profs } = await supabase
      .from("profiles")
      .select("id,email,display_name")
      .order("display_name", { ascending: true });
    const list = (profs ?? []) as Array<{ id: string; email: string | null; display_name: string | null }>;
    setAdminCandidates(list);
    const cur = list.find((p) => p.id === val.user_id);
    setSourceUserLabel(cur ? (cur.display_name || cur.email || cur.id) : "");
  }, []);

  const saveGuestSource = async (enabled: boolean, userId: string | null) => {
    setSourceBusy(true);
    try {
      const value = { enabled, user_id: userId };
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: "guest_source", value }, { onConflict: "key" });
      if (error) throw error;
      setSourceEnabled(enabled);
      setSourceUserId(userId);
      const cur = adminCandidates.find((p) => p.id === userId);
      setSourceUserLabel(cur ? (cur.display_name || cur.email || cur.id) : "");
      toast.success(enabled ? "האורח יקרא מהענן" : "האורח לא יקרא מהענן");
    } catch (e) {
      toast.error("שגיאה בשמירת הגדרת מקור האורח");
      console.error(e);
    } finally {
      setSourceBusy(false);
    }
  };

  const saveOverlayForUsers = async (enabled: boolean) => {
    setOverlayBusy(true);
    try {
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: "source_overlay_for_users", value: { enabled } }, { onConflict: "key" });
      if (error) throw error;
      setOverlayForUsersEnabled(enabled);
      toast.success(enabled ? "משתמשים רשומים יקראו מהמקור" : "משתמשים רשומים יראו רק את המידע שלהם");
    } catch (e) {
      toast.error("שגיאה בשמירת הגדרת מקור למשתמשים");
      console.error(e);
    } finally {
      setOverlayBusy(false);
    }
  };



  const load = useCallback(async () => {
    const { data } = await supabase.from("app_roles").select("id,name").order("name");
    const roleRows = (data ?? []) as AppRole[];
    setRoles(roleRows);

    const { profiles: hydratedProfiles } = await hydrateGuestProfilesFromSiteSettings();
    const localProfiles = listGuestViewProfiles();
    const needsMigration = hydratedProfiles.length === 0 && localProfiles.length > 0;

    if (needsMigration) {
      await saveGuestViewProfilesToSiteSettings(localProfiles);
      const localDefault = getActiveGuestViewProfileId() ?? localProfiles[0]?.id ?? null;
      await saveGuestDefaultProfileIdToSiteSettings(localDefault);
    }

    const defaultProfileId = await loadGuestDefaultProfileIdFromSiteSettings();
    const allProfiles = hydratedProfiles.length > 0 ? hydratedProfiles : localProfiles;
    setProfiles(allProfiles);
    const activeId = defaultProfileId ?? getActiveGuestViewProfileId();
    setActiveProfileId(activeId);

    if (!selectedRoleId && roleRows.length > 0) {
      setSelectedRoleId(roleRows[0].id);
      setProfileLabel(`תצוגת אורח: ${roleLabel(roleRows[0].name)}`);
    }

    await loadGuestSource();
  }, [selectedRoleId, loadGuestSource]);

  useEffect(() => {
    void load();
  }, [load]);


  const selectedRole = useMemo(
    () => roles.find((r) => r.id === selectedRoleId) ?? null,
    [roles, selectedRoleId],
  );

  const buildGuestStudySeed = useCallback(async () => {
    const hasMeaningfulLocalData =
      (studyState.categories?.length ?? 0) > 0
      || (studyState.decks?.length ?? 0) > 0
      || (studyState.cards?.length ?? 0) > 0
      || (studyState.cardDecks?.length ?? 0) > 0;

    const hasUsableCategoryTree = hasUsableGuestCategoryTree(studyState.categories ?? []);

    if (hasMeaningfulLocalData && hasUsableCategoryTree) {
      return {
        seededAt: Date.now(),
        categories: [...(studyState.categories ?? [])],
        decks: [...(studyState.decks ?? [])],
        cards: [...(studyState.cards ?? [])],
        cardDecks: [...(studyState.cardDecks ?? [])],
        deckCategories: { ...(studyState.deckCategories ?? {}) },
      };
    }

    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) return undefined;

    const [categoriesRows, decksRows, cardsRows, cardDeckRows] = await Promise.all([
      fetchAllSeedPages<CategorySeedRow>(
        (from, to) => supabase
          .from("categories")
          .select("id,name,parent_id,color,created_at,updated_at,sort_order")
          .eq("user_id", userId)
          .is("deleted_at", null)
          .order("sort_order", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
        "categories",
      ),
      fetchAllSeedPages<DeckSeedRow>(
        (from, to) => supabase
          .from("decks")
          .select("id,name,description,color,created_at,updated_at,category_ids,include_sub_categories")
          .eq("user_id", userId)
          .is("deleted_at", null)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
        "decks",
      ),
      fetchAllSeedPages<CardSeedRow>(
        (from, to) => supabase
          .from("cards")
          .select("id,deck_id,type,question,tags,created_at,updated_at,srs,stats,answer,options,correct_indices,correct_boolean,explanation,masechta,daf,amud")
          .eq("user_id", userId)
          .is("deleted_at", null)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
        "cards",
      ),
      fetchAllSeedPages<CardDeckSeedRow>(
        (from, to) => supabase
          .from("card_decks")
          .select("card_id,deck_id,sort_order,updated_at")
          .eq("user_id", userId)
          .order("card_id", { ascending: true })
          .order("deck_id", { ascending: true })
          .range(from, to),
        "card_decks",
      ),
    ]);

    const categories: Category[] = categoriesRows.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parent_id,
      color: row.color ?? undefined,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined,
      sortOrder: row.sort_order ?? 0,
    }));

    const decks: Deck[] = decksRows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      color: row.color,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined,
      categoryIds: Array.isArray(row.category_ids) ? row.category_ids.filter((x): x is string => typeof x === "string") : [],
      includeSubCategories: row.include_sub_categories !== false,
    }));

    const cards: StudyCard[] = cardsRows.map((row) => {
      const base = {
        id: row.id,
        deckId: row.deck_id,
        question: row.question,
        tags: Array.isArray(row.tags) ? row.tags.filter((x): x is string => typeof x === "string") : [],
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined,
        srs: row.srs && typeof row.srs === "object"
          ? row.srs as StudyCard["srs"]
          : defaultSrs(),
        stats: row.stats && typeof row.stats === "object"
          ? row.stats as StudyCard["stats"]
          : { totalReviews: 0, correct: 0, incorrect: 0 },
        masechta: row.masechta ?? null,
        daf: row.daf ?? null,
        amud: row.amud === 2 ? 2 : (row.amud === 1 ? 1 : null),
      };

      if (row.type === "flashcard") {
        return { ...base, type: "flashcard", answer: row.answer ?? "" } as StudyCard;
      }
      if (row.type === "boolean") {
        return { ...base, type: "boolean", correct: !!row.correct_boolean, explanation: row.explanation ?? undefined } as StudyCard;
      }
      if (row.type === "multiple") {
        const options = Array.isArray(row.options) ? row.options.filter((x): x is string => typeof x === "string") : [];
        const correctIndices = Array.isArray(row.correct_indices)
          ? row.correct_indices.filter((x): x is number => typeof x === "number")
          : [];
        const answer = row.answer ?? (correctIndices.length > 0 ? (options[correctIndices[0]] ?? undefined) : undefined);
        return { ...base, type: "combo", answer, options, correctIndices, explanation: row.explanation ?? undefined } as StudyCard;
      }
      return {
        ...base,
        type: "combo",
        answer: row.answer ?? undefined,
        options: Array.isArray(row.options) ? row.options.filter((x): x is string => typeof x === "string") : undefined,
        correctIndices: Array.isArray(row.correct_indices)
          ? row.correct_indices.filter((x): x is number => typeof x === "number")
          : undefined,
        explanation: row.explanation ?? undefined,
      } as StudyCard;
    });

    const cardDecks: CardDeckLink[] = cardDeckRows.map((row) => ({
      cardId: row.card_id,
      deckId: row.deck_id,
      sortOrder: row.sort_order ?? 0,
      updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined,
    }));

    const deckCategories = Object.fromEntries(decks.map((deck) => [deck.id, deck.categoryIds]));

    const seed = {
      seededAt: Date.now(),
      categories,
      decks,
      cards,
      cardDecks,
      deckCategories,
    };
    if (!isGuestStudySeedStructurallyUsable(seed)) {
      throw new Error("Guest seed snapshot is structurally invalid");
    }

    return seed;
  }, [studyState.cardDecks, studyState.cards, studyState.categories, studyState.deckCategories, studyState.decks]);

  const buildProfileFromRole = useCallback(async (opts: { roleId: string; id?: string; label?: string; sourceUserId?: string | null }) => {
    const role = roles.find((r) => r.id === opts.roleId);
    if (!role) throw new Error("תפקיד לא נמצא");

    const existing = opts.id
      ? listGuestViewProfiles().find((profile) => profile.id === opts.id)
      : null;

    const [{ data: perms, error: permsError }, { data: defaults, error: defaultsError }, studySeed] = await Promise.all([
      supabase
        .from("role_permissions")
        .select("module,action,allowed")
        .eq("role_id", role.id),
      supabase
        .from("role_layout_defaults")
        .select("sidebar_config,widget_layout")
        .eq("role_id", role.id)
        .maybeSingle(),
      buildGuestStudySeed(),
    ]);

    if (permsError) throw new Error(permsError.message);
    if (defaultsError) throw new Error(defaultsError.message);

    const matrix: Record<string, boolean> = {};
    ((perms ?? []) as RolePermissionRow[]).forEach((row) => {
      if (row.allowed) matrix[`${row.module}:${row.action}`] = true;
    });

    const defaultLabel = `תצוגת אורח: ${roleLabel(role.name)}`;
    return saveGuestViewProfile({
      id: opts.id ?? generateId(),
      label: (opts.label ?? "").trim() || defaultLabel,
      roleId: role.id,
      roleName: role.name,
      isAdmin: role.name === "admin",
      roles: [{ id: role.id, name: role.name }],
      matrix,
      sidebarConfig: (defaults as { sidebar_config?: unknown } | null)?.sidebar_config as RoleLayoutDefaultsRow["sidebar_config"] | undefined,
      widgetLayout: (defaults as { widget_layout?: unknown } | null)?.widget_layout as RoleLayoutDefaultsRow["widget_layout"] | undefined,
      studySeed: studySeed ?? existing?.studySeed,
      sourceUserId: opts.sourceUserId !== undefined ? opts.sourceUserId : (existing?.sourceUserId ?? null),
    });
  }, [buildGuestStudySeed, roles]);

  const resetForm = () => {
    setEditingId(null);
    if (roles.length > 0) {
      setSelectedRoleId(roles[0].id);
      setProfileLabel(`תצוגת אורח: ${roleLabel(roles[0].name)}`);
    } else {
      setSelectedRoleId("");
      setProfileLabel("");
    }
  };

  const submit = async () => {
    if (!selectedRoleId) {
      toast.error("בחר תפקיד");
      return;
    }
    setBusy(true);
    try {
      const saved = await buildProfileFromRole({
        roleId: selectedRoleId,
        id: editingId ?? undefined,
        label: profileLabel,
      });

      const allProfiles = listGuestViewProfiles();
      await saveGuestViewProfilesToSiteSettings(allProfiles);
      const currentDefault = await loadGuestDefaultProfileIdFromSiteSettings();
      const nextDefault = currentDefault && allProfiles.some((p) => p.id === currentDefault)
        ? currentDefault
        : saved.id;
      await saveGuestDefaultProfileIdToSiteSettings(nextDefault);

      toast.success(editingId ? "פרופיל אורח עודכן" : "פרופיל אורח נוצר");
      await load();
      resetForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "שמירת פרופיל נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (profile: GuestViewProfile) => {
    setEditingId(profile.id);
    setSelectedRoleId(profile.roleId ?? "");
    setProfileLabel(profile.label);
  };

  const markAsDefault = async (profileId: string) => {
    setBusy(true);
    try {
      setActiveGuestViewProfile(profileId);
      await saveGuestDefaultProfileIdToSiteSettings(profileId);
      setActiveProfileId(profileId);
      toast.success("פרופיל ברירת המחדל לאורח עודכן");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "עדכון ברירת מחדל נכשל");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (profile: GuestViewProfile) => {
    setBusy(true);
    try {
    removeGuestViewProfile(profile.id);
    const nextProfiles = listGuestViewProfiles();
    await saveGuestViewProfilesToSiteSettings(nextProfiles);

    const currentDefault = await loadGuestDefaultProfileIdFromSiteSettings();
    let nextDefault: string | null = currentDefault;
    if (!nextDefault || nextDefault === profile.id || !nextProfiles.some((p) => p.id === nextDefault)) {
      nextDefault = nextProfiles[0]?.id ?? null;
    }
    await saveGuestDefaultProfileIdToSiteSettings(nextDefault);

    setActiveProfileId(nextDefault);
    setProfiles(nextProfiles);
    toast.success("פרופיל אורח נמחק");
    if (editingId === profile.id) resetForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "מחיקת פרופיל נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const refreshFromRole = async (profile: GuestViewProfile) => {
    if (!profile.roleId) {
      toast.error("לפרופיל אין תפקיד מקור");
      return;
    }
    setBusy(true);
    try {
      await buildProfileFromRole({
        roleId: profile.roleId,
        id: profile.id,
        label: profile.label,
      });
      const nextProfiles = listGuestViewProfiles();
      await saveGuestViewProfilesToSiteSettings(nextProfiles);
      setProfiles(nextProfiles);
      toast.success("הפרופיל רוענן מהגדרות התפקיד");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "רענון נכשל");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="gold-frame p-4 space-y-3">
        <h3 className="font-display text-lg font-semibold">מקור נתונים לאורח (קריאה מהענן)</h3>
        <p className="text-xs text-muted-foreground">
          כאשר מופעל — האורח קורא את כל הקטגוריות והשאלות של המשתמש שנבחר ישירות מהענן (קריאה בלבד, ללא כתיבה). כשמכובה — האורח מקבל מערכת נקייה.
        </p>
        <div className="grid md:grid-cols-3 gap-3 items-end">
          <div className="space-y-1 md:col-span-2">
            <Label>משתמש מקור</Label>
            <Select
              value={sourceUserId ?? ""}
              onValueChange={(v) => void saveGuestSource(sourceEnabled, v || null)}
              disabled={sourceBusy}
            >
              <SelectTrigger><SelectValue placeholder="בחר משתמש מקור" /></SelectTrigger>
              <SelectContent>
                {adminCandidates.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {(p.display_name || p.email || p.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void saveGuestSource(!sourceEnabled, sourceUserId)}
              disabled={sourceBusy || (!sourceEnabled && !sourceUserId)}
              className={sourceEnabled ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-muted text-foreground"}
            >
              {sourceEnabled ? "פעיל — לחץ לכיבוי" : "כבוי — לחץ להפעלה"}
            </Button>
          </div>
        </div>
        {sourceEnabled && sourceUserLabel && (
          <div className="text-xs text-emerald-700">
            ✓ אורחים יקראו כעת מהמשתמש: <strong>{sourceUserLabel}</strong>
          </div>
        )}
        <div className="mt-3 border-t pt-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">משתמשים רשומים קוראים מהמקור</div>
              <div className="text-xs text-muted-foreground">
                כל משתמש רשום יראה גם את השאלות/קטגוריות של משתמש המקור (קריאה בלבד) — בנוסף למה ששייך לו.
              </div>
            </div>
            <Button
              onClick={() => void saveOverlayForUsers(!overlayForUsersEnabled)}
              disabled={overlayBusy || !sourceUserId}
              className={overlayForUsersEnabled ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-muted text-foreground"}
            >
              {overlayForUsersEnabled ? "פעיל — לחץ לכיבוי" : "כבוי — לחץ להפעלה"}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="gold-frame p-4 space-y-3">

        <h3 className="font-display text-lg font-semibold">
          {editingId ? "עריכת פרופיל אורח" : "יצירת פרופיל אורח"}
        </h3>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>תפקיד מקור</Label>
            <Select
              value={selectedRoleId}
              onValueChange={(v) => {
                setSelectedRoleId(v);
                const role = roles.find((r) => r.id === v);
                if (!editingId && role) setProfileLabel(`תצוגת אורח: ${roleLabel(role.name)}`);
              }}
            >
              <SelectTrigger><SelectValue placeholder="בחר תפקיד" /></SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{roleLabel(r.name)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>שם פרופיל להצגה במסך כניסה</Label>
            <Input
              value={profileLabel}
              onChange={(e) => setProfileLabel(e.target.value)}
              placeholder="למשל: אורח מנהל"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => void submit()} disabled={busy || !selectedRole} className="bg-gradient-navy text-primary-foreground">
            <UserPlus className="h-4 w-4" />
            {editingId ? "עדכן פרופיל" : "צור פרופיל"}
          </Button>
          {editingId && (
            <Button variant="outline" onClick={resetForm}>בטל עריכה</Button>
          )}
        </div>
      </Card>

      <Card className="gold-frame p-4 space-y-2">
        <h3 className="font-display text-lg font-semibold">פרופילי אורח קיימים</h3>
        {profiles.map((p) => (
          <div key={p.id} className="rounded-xl border-2 border-gold/30 p-3 bg-card flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">{p.label}</span>
                {activeProfileId === p.id && (
                  <Badge className="bg-emerald-600 hover:bg-emerald-600">ברירת מחדל</Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                תפקיד: {p.roleName ? roleLabel(p.roleName) : "לא הוגדר"} · עודכן {new Date(p.updatedAt).toLocaleString("he-IL")}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={() => void markAsDefault(p.id)} disabled={busy || activeProfileId === p.id}>
                <CheckCircle2 className="h-4 w-4" /> ברירת מחדל
              </Button>
              <Button size="sm" variant="outline" onClick={() => void refreshFromRole(p)} disabled={busy}>
                <RefreshCw className="h-4 w-4" /> רענן
              </Button>
              <Button size="sm" variant="outline" onClick={() => startEdit(p)}>
                ערוך
              </Button>
              <Button size="icon" variant="ghost" className="text-destructive" onClick={() => void remove(p)} disabled={busy}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
        {profiles.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-6">אין פרופילי אורח עדיין</div>
        )}
      </Card>
    </div>
  );
}
