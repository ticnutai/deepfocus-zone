import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, Lock, UserX } from "lucide-react";
import {
  hasUsableGuestCategoryTree,
  isGuestStudySeedStructurallyUsable,
  saveGuestViewProfile,
  listGuestViewProfiles,
  saveGuestViewProfilesToSiteSettings,
} from "@/lib/auth/guestViewProfile";
import { defaultSrs } from "@/lib/study/srs";
import type { Card as StudyCard, CardDeckLink, Category, Deck, SidebarConfig, WidgetLayout } from "@/lib/study/types";
import { useStudy } from "@/lib/study/store";
import {
  loadFeatureBlocklistProfiles,
  loadRoleBlocklistAssignments,
  saveFeatureBlocklistProfiles,
  saveRoleBlocklistAssignments,
  type BlocklistScope,
} from "@/lib/study/featureBlocklist";
import { PROFILE_B_PROFILE_NAME } from "@/lib/study/profileBMode";

interface Role { id: string; name: string; description: string | null; is_system: boolean; }
interface RolePermRow { module: string; action: string; allowed: boolean; }
interface RoleDefaultsRow { sidebar_config: SidebarConfig[] | null; widget_layout: WidgetLayout | null; }
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
type PermissionModule = "decks" | "cards" | "goals" | "shas" | "analytics" | "users" | "roles" | "settings";
type PermissionAction = "view" | "create" | "edit" | "delete" | "manage";

const ALL_MODULES: PermissionModule[] = ["decks", "cards", "goals", "shas", "analytics", "users", "roles", "settings"];
const ALL_ACTIONS: PermissionAction[] = ["view", "create", "edit", "delete", "manage"];

const PROFILE_B_ALLOWED = new Set<string>([
  "decks:view",
  "decks:create",
  "decks:edit",
  "decks:delete",
  "cards:view",
  "cards:create",
  "cards:edit",
  "cards:delete",
  "goals:view",
  "goals:create",
  "goals:edit",
  "shas:view",
  "analytics:view",
]);

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

export function RolesTab() {
  const { state: studyState } = useStudy();
  const [roles, setRoles] = useState<Role[]>([]);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("app_roles").select("*").order("is_system", { ascending: false }).order("name");
    setRoles((data ?? []) as Role[]);
  };
  useEffect(() => { load(); }, []);

  const ensureProfileBAssignmentForScope = async (roleId: string, scope: BlocklistScope) => {
    const [profiles, assignments] = await Promise.all([
      loadFeatureBlocklistProfiles({ scope }),
      loadRoleBlocklistAssignments({ scope }),
    ]);

    const normalizedName = PROFILE_B_PROFILE_NAME.trim().toLowerCase();
    let profile = profiles.find((row) => row.name.trim().toLowerCase() === normalizedName);
    if (!profile) {
      profile = {
        id: crypto.randomUUID(),
        name: PROFILE_B_PROFILE_NAME,
        blocklist: { sections: ["backup", "backup-restore"], widgets: {} },
        updatedAt: Date.now(),
      };
      await saveFeatureBlocklistProfiles([...profiles, profile], { scope });
    }

    const withoutRole = assignments.filter((row) => row.roleId !== roleId);
    withoutRole.push({ id: crypto.randomUUID(), roleId, profileId: profile.id });
    await saveRoleBlocklistAssignments(withoutRole, { scope });
  };

  const buildGuestStudySeed = async () => {
    const hasMeaningfulLocalData =
      (studyState.categories?.length ?? 0) > 0
      || (studyState.decks?.length ?? 0) > 0
      || (studyState.cards?.length ?? 0) > 0
      || (studyState.cardDecks?.length ?? 0) > 0;

    const hasUsableCategoryTree = hasUsableGuestCategoryTree(studyState.categories ?? []);

    // Prefer the currently-loaded study state shown in the UI, then fall back to DB snapshots.
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
  };

  const installProfileB = async () => {
    setBusy(true);
    try {
      let role = roles.find((r) => r.name === "profile_b");
      if (!role) {
        const { data, error } = await supabase
          .from("app_roles")
          .insert({ name: "profile_b", description: "פרופיל B: pull-only + local-create", is_system: false })
          .select()
          .single();
        if (error) throw new Error(error.message);
        role = data as Role;
      }

      await supabase.from("role_permissions").delete().eq("role_id", role.id);
      const permissionRows = ALL_MODULES.flatMap((module) =>
        ALL_ACTIONS.map((action) => ({
          role_id: role!.id,
          module,
          action,
          allowed: PROFILE_B_ALLOWED.has(`${module}:${action}`),
        })),
      );
      await supabase.from("role_permissions").insert(permissionRows as never[]);

      await Promise.all([
        ensureProfileBAssignmentForScope(role.id, "desktop"),
        ensureProfileBAssignmentForScope(role.id, "mobile"),
      ]);

      const guestSnapshot = await (async () => {
        const [{ data: perms, error: permsError }, { data: defaults, error: defaultsError }, studySeed] = await Promise.all([
          supabase.from("role_permissions").select("module,action,allowed").eq("role_id", role!.id),
          supabase.from("role_layout_defaults").select("sidebar_config,widget_layout").eq("role_id", role!.id).maybeSingle(),
          buildGuestStudySeed(),
        ]);
        if (permsError) throw new Error(permsError.message);
        if (defaultsError) throw new Error(defaultsError.message);

        const matrix: Record<string, boolean> = {};
        ((perms ?? []) as RolePermRow[]).forEach((row) => {
          if (row.allowed) matrix[`${row.module}:${row.action}`] = true;
        });

        return saveGuestViewProfile({
          id: `role:${role!.id}`,
          label: `תצוגת אורח: ${role!.name}`,
          roleId: role!.id,
          roleName: role!.name,
          isAdmin: false,
          roles: [{ id: role!.id, name: role!.name }],
          matrix,
          sidebarConfig: ((defaults as RoleDefaultsRow | null)?.sidebar_config ?? undefined) ?? undefined,
          widgetLayout: ((defaults as RoleDefaultsRow | null)?.widget_layout ?? undefined) ?? undefined,
          studySeed,
        });
      })();

      void guestSnapshot;
      await saveGuestViewProfilesToSiteSettings(listGuestViewProfiles());
      toast.success("פרופיל B הותקן. אפשר לשייך אותו לאורח או לכל תפקיד לפי בחירה.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "התקנת פרופיל B נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!name.trim()) return toast.error("הזן שם תפקיד");
    setBusy(true);
    const { data, error } = await supabase
      .from("app_roles")
      .insert({ name: name.trim(), description: desc.trim() || null, is_system: false })
      .select()
      .single();
    if (error) { setBusy(false); return toast.error(error.message); }
    // seed permissions = all false
    const modules = ["decks","cards","goals","shas","analytics","users","roles","settings"] as const;
    const actions = ["view","create","edit","delete","manage"] as const;
    const rows = modules.flatMap((m) => actions.map((a) => ({
      role_id: (data as Role).id, module: m, action: a, allowed: false,
    })));
    await supabase.from("role_permissions").insert(rows as never[]);
    setBusy(false);
    setName(""); setDesc("");
    toast.success("התפקיד נוצר");
    load();
  };

  const remove = async (id: string) => {
    setBusy(true);
    const { error } = await supabase.from("app_roles").delete().eq("id", id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("נמחק");
    load();
  };

  const createGuestProfileFromRole = async (role: Role) => {
    setBusy(true);
    try {
      const [{ data: perms, error: permsError }, { data: defaults, error: defaultsError }, studySeed] = await Promise.all([
        supabase.from("role_permissions").select("module,action,allowed").eq("role_id", role.id),
        supabase.from("role_layout_defaults").select("sidebar_config,widget_layout").eq("role_id", role.id).maybeSingle(),
        buildGuestStudySeed(),
      ]);

      if (permsError) throw new Error(permsError.message);
      if (defaultsError) throw new Error(defaultsError.message);

      const matrix: Record<string, boolean> = {};
      ((perms ?? []) as RolePermRow[]).forEach((row) => {
        if (row.allowed) matrix[`${row.module}:${row.action}`] = true;
      });

      saveGuestViewProfile({
        id: `role:${role.id}`,
        label: `תצוגת אורח: ${role.name}`,
        roleId: role.id,
        roleName: role.name,
        isAdmin: role.name === "admin",
        roles: [{ id: role.id, name: role.name }],
        matrix,
        sidebarConfig: ((defaults as RoleDefaultsRow | null)?.sidebar_config ?? undefined) ?? undefined,
        widgetLayout: ((defaults as RoleDefaultsRow | null)?.widget_layout ?? undefined) ?? undefined,
        studySeed,
      });

      toast.success(`נוצר/עודכן פרופיל אורח לתפקיד ${role.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "יצירת פרופיל אורח נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="gold-frame p-4 space-y-3">
        <h3 className="font-display text-lg font-semibold">תפקיד חדש</h3>
        <div className="grid sm:grid-cols-3 gap-2">
          <Input placeholder="שם (למשל editor)" value={name} onChange={(e) => setName(e.target.value)} />
          <Input className="sm:col-span-2" placeholder="תיאור" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={create} disabled={busy} className="bg-gradient-navy text-primary-foreground">
            <Plus className="h-4 w-4" /> הוסף תפקיד
          </Button>
          <Button variant="outline" onClick={installProfileB} disabled={busy}>
            התקן פרופיל B
          </Button>
        </div>
      </Card>

      <Card className="gold-frame p-4 space-y-2">
        <h3 className="font-display text-lg font-semibold mb-2">תפקידים קיימים</h3>
        {roles.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl border-2 border-gold/40 bg-card p-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">{r.name}</span>
                {r.is_system && <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" /> מובנה</Badge>}
              </div>
              {r.description && <div className="text-xs text-muted-foreground mt-0.5">{r.description}</div>}
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => createGuestProfileFromRole(r)} disabled={busy}>
                <UserX className="h-4 w-4" />
                פרופיל אורח
              </Button>
              {!r.is_system && (
                <Button variant="ghost" size="icon" onClick={() => remove(r.id)} className="text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        ))}
        {!roles.length && <div className="text-center text-sm text-muted-foreground py-4">אין תפקידים</div>}
      </Card>
    </div>
  );
}
