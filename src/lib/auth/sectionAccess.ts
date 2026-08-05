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
  "decks",
  "questions",
]);

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
};

export function canAccessAppSection(
  sectionId: string,
  { isAdmin, canViewCards }: SectionAccessContext,
): boolean {
  if (ADMIN_ONLY_SECTION_IDS.has(sectionId)) return isAdmin;
  if (CARDS_PERMISSION_SECTION_IDS.has(sectionId)) return canViewCards;
  return STANDARD_USER_SECTION_IDS.has(sectionId);
}

