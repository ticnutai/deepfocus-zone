/**
 * Central navigation security policy.
 *
 * The policy is intentionally explicit and fails closed: a newly introduced
 * page is unavailable to non-admins until it is classified here.
 */
const ADMIN_ONLY_SECTION_IDS = new Set([
  "admin",
  "system-rubric",
  "db-inspector",
  "perf",
  "ai-generator",
  "question-lab",
  "sync-diagnostics",
]);

const CARDS_PERMISSION_SECTION_IDS = new Set([
  "cards",
  "categories",
  "questions",
]);

const DECKS_PERMISSION_SECTION_IDS = new Set(["decks"]);
const GOALS_PERMISSION_SECTION_IDS = new Set(["goals"]);
const SHAS_PERMISSION_SECTION_IDS = new Set(["shas-board"]);
const ANALYTICS_PERMISSION_SECTION_IDS = new Set(["analytics", "summary"]);
const SETTINGS_PERMISSION_SECTION_IDS = new Set(["settings"]);

const STANDARD_USER_SECTION_IDS = new Set([
  "home",
  "overview",
  "summary",
  "study",
  "daf",
  "analytics",
  "goals",
  "backup",
  "blocker",
  "morning",
  "today",
  "tasks",
  "search",
  "habits",
  "journal",
  "timer",
  "monitor",
  "book",
  "shas-board",
  "studio",
  "pdf",
  "ai",
  "achievements",
  "archive",
  "backup-restore",
  "settings",
]);

export type SectionAccessContext = {
  isAdmin: boolean;
  canViewCards: boolean;
  canViewDecks: boolean;
  canViewGoals: boolean;
  canViewShas: boolean;
  canViewAnalytics: boolean;
  canViewSettings: boolean;
};

export function canAccessAppSection(
  sectionId: string,
  {
    isAdmin,
    canViewCards,
    canViewDecks,
    canViewGoals,
    canViewShas,
    canViewAnalytics,
    canViewSettings,
  }: SectionAccessContext,
): boolean {
  if (ADMIN_ONLY_SECTION_IDS.has(sectionId)) return isAdmin;
  if (CARDS_PERMISSION_SECTION_IDS.has(sectionId)) return canViewCards;
  if (DECKS_PERMISSION_SECTION_IDS.has(sectionId)) return canViewDecks;
  if (GOALS_PERMISSION_SECTION_IDS.has(sectionId)) return canViewGoals;
  if (SHAS_PERMISSION_SECTION_IDS.has(sectionId)) return canViewShas;
  if (ANALYTICS_PERMISSION_SECTION_IDS.has(sectionId)) return canViewAnalytics;
  if (SETTINGS_PERMISSION_SECTION_IDS.has(sectionId)) return canViewSettings;
  return STANDARD_USER_SECTION_IDS.has(sectionId);
}
