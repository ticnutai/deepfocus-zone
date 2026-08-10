import { useEffect, useState, useCallback } from "react";
import type { Card, Category, CustomCategoryTemplate, Deck, GeneralStudyPlan, Goal, LearningSession, PlanReview, PlanReviewQuality, QuizAttempt, QuizPlan, ReviewLog, ShasPlan, ShasReview, SidebarConfig, StudyState, TabConfig, UiPrefs, WidgetLayout } from "./types";
import { PLAN_REVIEW_INTERVALS_DAYS } from "./types";
import { timeOp, perf } from "@/lib/debug/perf";
import { perfMeter } from "@/lib/debug/perfMeter";
import { applyReview, defaultSrs, getSrsAlgorithm, getRetentionTarget } from "./srs";
import { toHebrewNum } from "./shasFormat";
import { SHAS_BAVLI } from "./shasData";
import { UNCATEGORIZED_NAME, UNCATEGORIZED_TAG, findUncategorized, isUncategorized } from "./uncategorized";
import { isBundledLibraryItem, primeBundledLibraryGuard, PROTECTED_DELETE_MESSAGE } from "./bundledLibraryGuard";
import { appendCloudToIdbDeleteAuditEvent, appendDeleteAuditEvent, bumpPendingDeleteAttempt, clearStudyStateCache, clearWidgetLayoutIdb, enqueueFullSyncJob, enqueuePendingDelete, listDeleteAuditEvents, listPendingDeletes, listSyncJobs, loadStudyStateCache, markSyncJobFailure, readWidgetLayoutIdb, registerGuestWorkspaceFlush, removePendingDelete, removeSyncJob, saveStudyStateCache, writeWidgetLayoutIdb } from "./indexedStateCache";
import { applyCloudSyncPref, isSyncEnabled } from "./syncControl";
import {
  canProfileBDeleteCard,
  canProfileBDeleteDeck,
  canPushToCloud,
  isProfileBMode,
  markProfileBCardCreated,
  markProfileBDeckCreated,
} from "./profileBMode";
import {
  loadRoleLayoutProfileAssignments,
  loadRoleLayoutProfiles,
  resolveRoleLayoutProfile,
  saveRoleLayoutProfileAssignments,
  saveRoleLayoutProfiles,
  type LayoutScope,
} from "./layoutProfiles";
import {
  loadFeatureBlocklistProfiles,
  loadRoleBlocklistAssignments,
  saveFeatureBlocklistProfiles,
  saveRoleBlocklistAssignments,
} from "./featureBlocklist";
import { supabase } from "@/integrations/supabase/client";
import { loadBundledOfflineLibrary } from "./offlineLibrary";
import { enqueueOfflineQuestion, reconcileOfflineQuestions } from "./offlineQuestionSync";
import { withClientSource } from "@/lib/app/clientSource";

/** Active guest profile's pinned source user id, or null to use the global guest_source. */
const getActiveGuestSourceUserId = (): string | null => {
  try { return getActiveGuestViewProfile()?.sourceUserId ?? null; } catch { return null; }
};
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import type { Json, Database } from "@/integrations/supabase/types";
import {
  getActiveGuestViewProfile,
  hasUsableGuestCategoryTree,
  isGuestStudySeedStructurallyUsable,
} from "@/lib/auth/guestViewProfile";

const emptyState = (): StudyState => ({
  decks: [], cards: [], logs: [], categories: [], goals: [],
  shasPlan: null, notificationsEnabled: false, reminderTime: "20:00", dayNotes: [],
  shasPlans: [], activeShasPlanId: null,
  cardDecks: [], shasReviews: [], reviewIntervals: [1, 3, 7, 14, 30],
  learningSessions: [], tabConfig: [], sidebarConfig: [], widgetLayout: undefined, uiPrefs: {}, generalPlans: [], planReviews: [],
  customCategoryTemplates: [],
  quizPlans: [], quizAttempts: [],
});

let memState: StudyState = emptyState();
let currentUserId: string | null = null;
let loadedFor: string | null = null;
const listeners = new Set<() => void>();
let cachePersistTimer: number | null = null;
let uiPrefsSyncTimer: number | null = null;
let uiPrefsSyncUserId: string | null = null;
let uiPrefsSyncPayload: UiPrefs | null = null;
let cloudSyncInFlight = false;
let cloudSyncPendingJobs = 0;
let isHydrated = false;
let hydrationInFlightFor: string | null = null;
// Shared IDB read promise — prevents StrictMode double-mount from opening IDB twice.
let idbHydratePromise: Promise<[
  import('./indexedStateCache').SyncJob[],
  import('./indexedStateCache').PendingDelete[],
  import('./types').StudyState | null,
]> | null = null;
let idbHydrateForUser: string | null = null;
// Phase 2 card backfill: bootstrap only loads reviewed cards. The rest load silently here.
let phase2BackfillNeeded = false;
let phase2BackfillUserId: string | null = null;
let phase2BackfillInFlight = false;
let phase2TotalCount = 0; // total card count from bootstrap; Phase 2 skips if already loaded

// === Source-overlay (read-only items pulled from another user's cloud) ===
// IDs here belong to a different user and must NEVER be written to the current
// user's cloud. They live in memState for display purposes only.
const sourceOwnedDeckIds = new Set<string>();
const sourceOwnedCategoryIds = new Set<string>();
const sourceOwnedCardIds = new Set<string>();
let sourceOverlayHydrateInFlight = false;
let sourceOverlayHydratedFor: string | null = null;
let sourceOverlaySourceUserId: string | null = null;
const isSourceOwnedCard = (id: string) => sourceOwnedCardIds.has(id);
const isSourceOwnedDeck = (id: string) => sourceOwnedDeckIds.has(id);
const isSourceOwnedCategory = (id: string) => sourceOwnedCategoryIds.has(id);
export function getSourceUserId(): string | null { return sourceOverlaySourceUserId; }
export function isCardFromSource(id: string): boolean { return sourceOwnedCardIds.has(id); }


const GUEST_ID = "guest";
const GUEST_STATE_KEY = "guest-study-state";
const GUEST_STATE_AT_KEY = "guest-study-state-at";
const GUEST_SETTINGS_KEY = "guest-display-settings";
const GUEST_PROFILE_SEED_APPLIED_KEY = (profileId: string) => `guest-study-seed-applied:${profileId}`;
const BROWSER_CACHE_RESET_VERSION = 3;
const BROWSER_CACHE_RESET_KEY = `study-browser-reset-v${BROWSER_CACHE_RESET_VERSION}`;
const CLOUD_REFRESH_INTERVAL_MS = 0; // always refresh from cloud on hydrate so decks/cards arrive immediately
const BG_CLOUD_REFRESH_DELAY_MS = 0; // no delay — kick the cloud reconciliation as soon as hydrate finishes
const UI_PREFS_SYNC_DEBOUNCE_MS = 800;

const hasMeaningfulStudyData = (state: StudyState): boolean => {
  return (state.categories?.length ?? 0) > 0
    || (state.decks?.length ?? 0) > 0
    || (state.cards?.length ?? 0) > 0
    || (state.cardDecks?.length ?? 0) > 0;
};

const isStudyStateStructurallyUsable = (state: StudyState): boolean => {
  if (!hasMeaningfulStudyData(state)) return true;
  return hasUsableGuestCategoryTree(state.categories ?? []);
};

const clearStudyDataCollections = (state: StudyState): StudyState => ({
  ...state,
  categories: [],
  decks: [],
  cards: [],
  cardDecks: [],
  deckCategories: {},
});

const applyGuestProfileSeedOnce = (state: StudyState): StudyState => {
  if (typeof window === "undefined") return state;
  const activeProfile = getActiveGuestViewProfile();
  const seed = activeProfile?.studySeed;
  if (!activeProfile?.id || !seed) return state;

  const stateHasData = hasMeaningfulStudyData(state);
  const stateIsUsable = isStudyStateStructurallyUsable(state);
  const seedAppliedKey = GUEST_PROFILE_SEED_APPLIED_KEY(activeProfile.id);
  const seedVersion = String(seed.seededAt);
  const seedWasApplied = localStorage.getItem(seedAppliedKey) === seedVersion;
  if (seedWasApplied && stateHasData && stateIsUsable) return state;
  if (seedWasApplied && stateHasData && !stateIsUsable) {
    return clearStudyDataCollections(state);
  }

  if (!isGuestStudySeedStructurallyUsable(seed)) {
    return stateHasData && !stateIsUsable ? clearStudyDataCollections(state) : state;
  }

  // Bundle data is the baseline; local rows win so offline learning progress
  // and locally-created questions survive future library updates.
  const mergeById = <T extends { id: string }>(baseline: T[], local: T[]): T[] => {
    const merged = new Map<string, T>();
    for (const item of baseline) merged.set(item.id, item);
    for (const item of local) merged.set(item.id, item);
    return [...merged.values()];
  };
  const linkKey = (link: { cardId: string; deckId: string }) => `${link.cardId}::${link.deckId}`;
  const cardDeckMap = new Map<string, NonNullable<StudyState["cardDecks"]>[number]>();
  for (const link of seed.cardDecks ?? []) cardDeckMap.set(linkKey(link), link);
  for (const link of state.cardDecks ?? []) cardDeckMap.set(linkKey(link), link);

  const seededState = applyBidirectionalDedupeGuards({
    ...state,
    categories: mergeById(Array.isArray(seed.categories) ? seed.categories : [], state.categories ?? []),
    decks: mergeById(Array.isArray(seed.decks) ? seed.decks : [], state.decks ?? []),
    cards: mergeById(Array.isArray(seed.cards) ? seed.cards : [], state.cards ?? []),
    cardDecks: [...cardDeckMap.values()],
    deckCategories:
      seed.deckCategories && typeof seed.deckCategories === "object" && !Array.isArray(seed.deckCategories)
        ? { ...seed.deckCategories, ...(state.deckCategories ?? {}) }
        : (state.deckCategories ?? {}),
  });

  if (!isStudyStateStructurallyUsable(seededState)) {
    return stateHasData && !stateIsUsable ? clearStudyDataCollections(state) : state;
  }

  try {
    localStorage.setItem(seedAppliedKey, seedVersion);
  } catch {
    // ignore storage errors
  }
  return seededState;
};

async function applyBundledLibraryToAuthenticatedState(state: StudyState): Promise<StudyState> {
  const library = await loadBundledOfflineLibrary();
  const seed = library?.seed;
  if (!seed || !isGuestStudySeedStructurallyUsable(seed)) return state;

  const mergeById = <T extends { id: string }>(baseline: T[], local: T[]): T[] => {
    const merged = new Map<string, T>();
    for (const item of baseline) merged.set(item.id, item);
    for (const item of local) merged.set(item.id, item);
    return [...merged.values()];
  };
  for (const category of seed.categories) sourceOwnedCategoryIds.add(category.id);
  for (const deck of seed.decks) sourceOwnedDeckIds.add(deck.id);
  for (const card of seed.cards) sourceOwnedCardIds.add(card.id);
  sourceOverlaySourceUserId = library.sourceUserId;

  const cardDeckMap = new Map<string, NonNullable<StudyState["cardDecks"]>[number]>();
  const linkKey = (link: { cardId: string; deckId: string }) => `${link.cardId}::${link.deckId}`;
  for (const link of seed.cardDecks ?? []) cardDeckMap.set(linkKey(link), link);
  for (const link of state.cardDecks ?? []) cardDeckMap.set(linkKey(link), link);

  return applyBidirectionalDedupeGuards({
    ...state,
    categories: mergeById(seed.categories, state.categories ?? []),
    decks: mergeById(seed.decks, state.decks ?? []),
    cards: mergeById(seed.cards, state.cards ?? []),
    cardDecks: [...cardDeckMap.values()],
    deckCategories: { ...(seed.deckCategories ?? {}), ...(state.deckCategories ?? {}) },
  });
}

function runWhenBrowserIdle(fn: () => void, timeout = 1500): void {
  const ric = (window as typeof window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
  }).requestIdleCallback;
  if (typeof ric === "function") {
    ric(() => fn(), { timeout });
    return;
  }
  window.setTimeout(fn, 0);
}

function runAfterFirstInteractionOrDelay(fn: () => void, fallbackDelayMs = 20_000): () => void {
  let done = false;
  const win = window as Window;

  const fire = () => {
    if (done) return;
    done = true;
    cleanup();
    fn();
  };

  const timer = win.setTimeout(fire, Math.max(0, fallbackDelayMs));
  const opts: AddEventListenerOptions = { once: true, passive: true };
  const onInteract = () => fire();

  win.addEventListener("pointerdown", onInteract, opts);
  win.addEventListener("keydown", onInteract, opts);
  win.addEventListener("touchstart", onInteract, opts);
  win.addEventListener("scroll", onInteract, opts);

  const cleanup = () => {
    win.clearTimeout(timer);
    win.removeEventListener("pointerdown", onInteract);
    win.removeEventListener("keydown", onInteract);
    win.removeEventListener("touchstart", onInteract);
    win.removeEventListener("scroll", onInteract);
  };

  return cleanup;
}
// Beyond this age, run a FULL reload instead of a delta sync (catches deletions
// that delta sync can't observe — delta only sees updated_at >= lastSync).
const DEFAULT_FULL_REFRESH_TTL_MS = 24 * 60 * 60 * 1000; // 24h
export const CACHE_TTL_STORAGE_KEY = "cache:full-refresh-ttl-ms";
export function getFullRefreshTtlMs(): number {
  try {
    const raw = localStorage.getItem(CACHE_TTL_STORAGE_KEY);
    if (!raw) return DEFAULT_FULL_REFRESH_TTL_MS;
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) return DEFAULT_FULL_REFRESH_TTL_MS;
    return v;
  } catch { return DEFAULT_FULL_REFRESH_TTL_MS; }
}
export function setFullRefreshTtlMs(ms: number) {
  try { localStorage.setItem(CACHE_TTL_STORAGE_KEY, String(Math.max(60_000, Math.floor(ms)))); } catch { /* ignore */ }
}
const LAST_CLOUD_BOOTSTRAP_AT_KEY = (userId: string) => `last-cloud-bootstrap-at:${userId}`;
const LAST_FULL_SYNC_AT_KEY = (userId: string) => `last-cloud-full-sync-at:${userId}`;
const LAST_CLOUD_CARDS_COUNT_KEY = (userId: string) => `last-cloud-cards-count:${userId}`;
const LAST_CLOUD_DECKS_COUNT_KEY = (userId: string) => `last-cloud-decks-count:${userId}`;
const LAST_CLOUD_CATEGORIES_COUNT_KEY = (userId: string) => `last-cloud-categories-count:${userId}`;

function rememberCloudCardsTotalCount(userId: string, count: number): void {
  try { localStorage.setItem(LAST_CLOUD_CARDS_COUNT_KEY(userId), String(Math.max(0, Math.floor(count)))); } catch { /* ignore */ }
}

function rememberCloudDecksTotalCount(userId: string, count: number): void {
  try { localStorage.setItem(LAST_CLOUD_DECKS_COUNT_KEY(userId), String(Math.max(0, Math.floor(count)))); } catch { /* ignore */ }
}

function rememberCloudCategoriesTotalCount(userId: string, count: number): void {
  try { localStorage.setItem(LAST_CLOUD_CATEGORIES_COUNT_KEY(userId), String(Math.max(0, Math.floor(count)))); } catch { /* ignore */ }
}

/** Last time IDB was refreshed from cloud (delta or full). 0 if never. */
export function getLastCloudSyncAt(userId: string): number {
  try { return Number(localStorage.getItem(LAST_CLOUD_BOOTSTRAP_AT_KEY(userId)) ?? "0") || 0; } catch { return 0; }
}
/** Last full reload from cloud (loadAll). 0 if never. */
export function getLastFullSyncAt(userId: string): number {
  try { return Number(localStorage.getItem(LAST_FULL_SYNC_AT_KEY(userId)) ?? "0") || 0; } catch { return 0; }
}
/** Last exact cloud cards count observed by the sync reconciler. 0 if unknown. */
export function getLastKnownCloudCardsCount(userId: string): number {
  try { return Number(localStorage.getItem(LAST_CLOUD_CARDS_COUNT_KEY(userId)) ?? "0") || 0; } catch { return 0; }
}

export function getLastKnownCloudDecksCount(userId: string): number {
  try { return Number(localStorage.getItem(LAST_CLOUD_DECKS_COUNT_KEY(userId)) ?? "0") || 0; } catch { return 0; }
}

export function getLastKnownCloudCategoriesCount(userId: string): number {
  try { return Number(localStorage.getItem(LAST_CLOUD_CATEGORIES_COUNT_KEY(userId)) ?? "0") || 0; } catch { return 0; }
}

export function getCurrentStudyCardsCount(): number {
  return memState.cards.length;
}
const WIDGET_LAYOUT_CACHE_KEY = (userId: string) => `widget-layout-cache:${userId}`;
/** Stores the widget_layout_updated_at timestamp that came from cloud on last loadAll(). Used to detect in-flight local changes during bg refresh. */
const WIDGET_LAYOUT_CLOUD_TS_KEY = (userId: string) => `widget-layout-cloud-ts:${userId}`;
/** Stores user_settings.updated_at from cloud for tab/sidebar config LWW during delta sync. */
const TAB_CONFIG_CLOUD_TS_KEY = (userId: string) => `tab-config-cloud-ts:${userId}`;
const UI_PREFS_CACHE_KEY = (userId: string) => `ui-prefs-cache:${userId}`;
const DECK_CATEGORIES_KEY = (userId: string) => `deck-categories:${userId}`;

type WidgetLayoutCache = {
  updatedAt: number;
  layout: WidgetLayout;
};

const readWidgetLayoutCache = (userId: string): WidgetLayoutCache | null => {
  try {
    const raw = localStorage.getItem(WIDGET_LAYOUT_CACHE_KEY(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WidgetLayoutCache;
    if (!parsed || typeof parsed !== "object" || typeof parsed.updatedAt !== "number") return null;
    if (!parsed.layout || typeof parsed.layout !== "object" || Array.isArray(parsed.layout)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeWidgetLayoutCache = (userId: string, layout: WidgetLayout, updatedAt = Date.now()) => {
  try {
    localStorage.setItem(WIDGET_LAYOUT_CACHE_KEY(userId), JSON.stringify({ updatedAt, layout }));
  } catch {
    // ignore storage errors
  }
};

const readUiPrefsCache = (userId: string): UiPrefs | null => {
  try {
    const raw = localStorage.getItem(UI_PREFS_CACHE_KEY(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UiPrefs;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeUiPrefsCache = (userId: string, prefs: UiPrefs) => {
  try {
    localStorage.setItem(UI_PREFS_CACHE_KEY(userId), JSON.stringify(prefs));
  } catch {
    // ignore storage errors
  }
};

const readDeckCategoriesCache = (userId: string): Record<string, string[]> => {
  try {
    const raw = localStorage.getItem(DECK_CATEGORIES_KEY(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, string[]>;
  } catch { return {}; }
};

const writeDeckCategoriesCache = (userId: string, map: Record<string, string[]>) => {
  try { localStorage.setItem(DECK_CATEGORIES_KEY(userId), JSON.stringify(map)); } catch { /* ignore */ }
};

type GuestDisplaySettings = {
  tabConfig?: StudyState["tabConfig"];
  sidebarConfig?: StudyState["sidebarConfig"];
  widgetLayout?: StudyState["widgetLayout"];
  uiPrefs?: StudyState["uiPrefs"];
  at?: number;
};

/**
 * An empty array/object is truthy in JS, so a naive overlay would let an empty
 * `tabConfig` overwrite a valid one — which empties the tab strip and makes the
 * "active tab not allowed" guard bounce the user to a different tab. Only real,
 * non-empty values may override.
 */
const hasContent = (v: unknown): boolean => {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
};

const readGuestDisplaySettings = (): GuestDisplaySettings | null => {
  try {
    const raw = localStorage.getItem(GUEST_SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as GuestDisplaySettings) : null;
  } catch { return null; }
};

/**
 * Display settings are tiny but must never be lost. The full guest snapshot can
 * exceed the localStorage quota (the bundled library alone is ~22k cards), and a
 * quota failure there would silently take the settings down with it. So they are
 * mirrored into their own small record, written synchronously on every change.
 */
const writeGuestDisplaySettings = () => {
  try {
    // Never let a transient empty value (e.g. mid-hydration, before the real
    // config has loaded) erase a previously saved setting — keep the last
    // known-good value for any field that is currently empty.
    const prev = readGuestDisplaySettings();
    const pick = <T,>(next: T, before: T | undefined): T | undefined =>
      hasContent(next) ? next : before;
    localStorage.setItem(GUEST_SETTINGS_KEY, JSON.stringify({
      tabConfig: pick(memState.tabConfig, prev?.tabConfig),
      sidebarConfig: pick(memState.sidebarConfig, prev?.sidebarConfig),
      widgetLayout: pick(memState.widgetLayout, prev?.widgetLayout),
      uiPrefs: pick(memState.uiPrefs, prev?.uiPrefs),
      at: Date.now(),
    }));
  } catch { /* ignore */ }
};

/** Overlay the last-known display settings onto a state loaded from any source. */
const applyGuestDisplaySettings = (state: StudyState, s: GuestDisplaySettings | null): StudyState => {
  if (!s) return state;
  return {
    ...state,
    ...(hasContent(s.tabConfig) ? { tabConfig: s.tabConfig } : {}),
    ...(hasContent(s.sidebarConfig) ? { sidebarConfig: s.sidebarConfig } : {}),
    ...(hasContent(s.widgetLayout) ? { widgetLayout: s.widgetLayout } : {}),
    ...(hasContent(s.uiPrefs) ? { uiPrefs: s.uiPrefs } : {}),
  };
};

const notify = () => {
  if (currentUserId === GUEST_ID) {
    // Settings first: this must succeed even when the full snapshot below
    // overflows the quota and throws.
    writeGuestDisplaySettings();
    try {
      localStorage.setItem(GUEST_STATE_KEY, JSON.stringify(memState));
      // Stamp the write so hydration can tell whether the debounced IndexedDB
      // snapshot is actually newer before letting it overwrite this one.
      localStorage.setItem(GUEST_STATE_AT_KEY, String(Date.now()));
    } catch { /* storage full — settings already persisted above */ }
  }
  perfMeter.bumpNotify(listeners.size);
  listeners.forEach((l) => l());
};

// Synchronously persist the live guest workspace so an account switch can park
// it without losing the newest (not-yet-flushed) edit. Registered globally so
// `flushGuestWorkspace()` in the cache module can reach the in-memory state
// without a circular import.
registerGuestWorkspaceFlush(async () => {
  if (currentUserId !== GUEST_ID) return;
  try { localStorage.setItem(GUEST_STATE_KEY, JSON.stringify(memState)); } catch { /* storage full */ }
  try { await saveStudyStateCache(GUEST_ID, memState); } catch { /* ignore */ }
});

// A reload can land inside the debounced persist window (~2s), which would drop
// the pending write. On unload we synchronously re-stamp the localStorage
// snapshot (the authoritative fast path on boot) and fire a best-effort IndexedDB
// write, so display settings survive a refresh made immediately after a change.
if (typeof window !== "undefined") {
  const flushOnUnload = () => {
    if (currentUserId !== GUEST_ID) return;
    try {
      localStorage.setItem(GUEST_STATE_KEY, JSON.stringify(memState));
      localStorage.setItem(GUEST_STATE_AT_KEY, String(Date.now()));
    } catch { /* storage full */ }
    void saveStudyStateCache(GUEST_ID, memState).catch(() => {});
  };
  window.addEventListener("pagehide", flushOnUnload);
  window.addEventListener("beforeunload", flushOnUnload);
}

let notifyTransitionScheduled = false;
const requestStoreNotify = () => {
  if (notifyTransitionScheduled) return;
  notifyTransitionScheduled = true;
  const flush = () => {
    notifyTransitionScheduled = false;
    notify();
  };
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => flush());
    return;
  }
  // SSR / test fallback — flush asynchronously so multiple setState calls in the
  // same microtask still coalesce into a single notify.
  Promise.resolve().then(flush);
};

const markCloudSyncJobs = (count: number) => {
  const next = Math.max(0, count);
  if (next === cloudSyncPendingJobs) return; // nothing changed, skip render
  cloudSyncPendingJobs = next;
  requestStoreNotify();
};

const clearLegacyBrowserCachesForUser = async (userId: string) => {
  try {
    localStorage.removeItem(WIDGET_LAYOUT_CACHE_KEY(userId));
    localStorage.removeItem(WIDGET_LAYOUT_CLOUD_TS_KEY(userId));
    localStorage.removeItem(TAB_CONFIG_CLOUD_TS_KEY(userId));
    localStorage.removeItem(UI_PREFS_CACHE_KEY(userId));
    localStorage.removeItem(DECK_CATEGORIES_KEY(userId));
    localStorage.removeItem(`category-children-cache:${userId}:v${CATEGORY_CACHE_VERSION}`);
    localStorage.removeItem(`category-prefetch-score:${userId}:v${CATEGORY_CACHE_VERSION}`);
    localStorage.removeItem(GUEST_STATE_KEY);
    await clearStudyStateCache(userId);
    await clearWidgetLayoutIdb(userId);
  } catch {
    // ignore reset errors
  }
};

const scheduleStateCachePersist = () => {
  const uid = currentUserId;
  if (!uid) return;
  if (cachePersistTimer !== null) window.clearTimeout(cachePersistTimer);
  cachePersistTimer = window.setTimeout(() => {
    cachePersistTimer = null;
    const snapshotUser = currentUserId;
    if (!snapshotUser) return;
    // Yield to browser first so the save doesn't block the main thread.
    void Promise.resolve().then(async () => {
      await saveStudyStateCache(snapshotUser, memState);
      if (snapshotUser !== GUEST_ID && typeof navigator !== "undefined" && !navigator.onLine) {
        await enqueueFullSyncJob(snapshotUser, "offline-local-change");
        const jobs = await listSyncJobs(snapshotUser);
        markCloudSyncJobs(jobs.length);
      }
    });
  }, 2000);
};

const getRecordTs = (item: unknown): number => {
  if (!item || typeof item !== "object") return 0;
  const rec = item as Record<string, unknown>;
  const updatedAt = rec.updatedAt;
  if (typeof updatedAt === "number" && Number.isFinite(updatedAt)) return updatedAt;
  const createdAt = rec.createdAt;
  if (typeof createdAt === "number" && Number.isFinite(createdAt)) return createdAt;
  return 0;
};

const mergeByKeyLww = <T>(
  localItems: T[] | undefined,
  cloudItems: T[] | undefined,
  keyOf: (item: T) => string,
): T[] => {
  const merged = new Map<string, T>();
  for (const item of cloudItems ?? []) merged.set(keyOf(item), item);
  for (const item of localItems ?? []) {
    const key = keyOf(item);
    const existing = merged.get(key);
    if (!existing || getRecordTs(item) >= getRecordTs(existing)) {
      merged.set(key, item);
    }
  }
  return [...merged.values()];
};

const normalizeName = (v: string | null | undefined): string => (v ?? "").trim().toLowerCase();
const normalizeQuestionKey = (v: string | null | undefined): string => normalizeName(v).replace(/\s+/g, " ");

const formatHebRef = (book: string, chapter: number, verse: number, verseEnd?: number) => {
  const c = toHebrewNum(chapter) || String(chapter);
  const v = toHebrewNum(verse) || String(verse);
  const ve = verseEnd && verseEnd !== verse ? `-${toHebrewNum(verseEnd) || String(verseEnd)}` : "";
  return `${book.trim()} ${c}:${v}${ve}`;
};

const normalizeReferenceText = (input: string): string => {
  const s = input.trim();
  if (!s) return input;

  const bookRef = s.match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/u);
  if (bookRef) {
    const [, book, ch, vs, ve] = bookRef;
    return formatHebRef(book, Number(ch), Number(vs), ve ? Number(ve) : undefined);
  }

  return s
    .replace(/\b(פרק|פסוק|דף)\s+(\d+)\b/gu, (_m, word: string, num: string) => `${word} ${toHebrewNum(Number(num)) || num}`)
    .replace(/\bעמוד\s+([12])\b/gu, (_m, amud: string) => `עמוד ${amud === "1" ? "א" : "ב"}`);
};

const normalizeReferenceTag = (tag: string): string => {
  if (!tag.startsWith("ref:")) return tag;
  const raw = tag.slice(4).trim();

  const dottedColon = raw.match(/^(.+?)\.(\d+):(\d+)(?:-(\d+))?$/u);
  if (dottedColon) {
    const [, book, ch, vs, ve] = dottedColon;
    const c = toHebrewNum(Number(ch)) || ch;
    const v = toHebrewNum(Number(vs)) || vs;
    const end = ve ? `-${toHebrewNum(Number(ve)) || ve}` : "";
    return `ref:${book.trim()}.${c}:${v}${end}`;
  }

  const dottedDot = raw.match(/^(.+?)\.(\d+)\.(\d+)(?:-(\d+))?$/u);
  if (dottedDot) {
    const [, book, ch, vs, ve] = dottedDot;
    const c = toHebrewNum(Number(ch)) || ch;
    const v = toHebrewNum(Number(vs)) || vs;
    const end = ve ? `-${toHebrewNum(Number(ve)) || ve}` : "";
    return `ref:${book.trim()}.${c}.${v}${end}`;
  }

  const spaced = raw.match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/u);
  if (spaced) {
    const [, book, ch, vs, ve] = spaced;
    return `ref:${formatHebRef(book, Number(ch), Number(vs), ve ? Number(ve) : undefined)}`;
  }

  return tag;
};

const normalizeReferenceNotationInState = (state: StudyState): StudyState => {
  let changed = false;

  const categories = (state.categories ?? []).map((c) => {
    const normalizedName = normalizeReferenceText(c.name);
    if (normalizedName !== c.name) {
      changed = true;
      return { ...c, name: normalizedName };
    }
    return c;
  });

  const cards = (state.cards ?? []).map((card) => {
    const tags = (card.tags ?? []).map((tag) => {
      if (tag.startsWith("ref:")) return normalizeReferenceTag(tag);
      if (tag.startsWith("cat:")) {
        const payload = tag.slice(4);
        const nextPayload = normalizeReferenceText(payload);
        return nextPayload === payload ? tag : `cat:${nextPayload}`;
      }
      return tag;
    });
    const tagsChanged = tags.length !== (card.tags ?? []).length || tags.some((t, i) => t !== (card.tags ?? [])[i]);
    if (tagsChanged) {
      changed = true;
      return { ...card, tags };
    }
    return card;
  });

  if (!changed) return state;
  return { ...state, categories, cards };
};

function dedupeBySemanticKeyLww<T>(
  rows: T[] | undefined,
  keyOf: (row: T) => string,
): T[] {
  const map = new Map<string, T>();
  for (const row of rows ?? []) {
    const key = keyOf(row);
    const prev = map.get(key);
    if (!prev || getRecordTs(row) >= getRecordTs(prev)) {
      map.set(key, row);
    }
  }
  return [...map.values()];
}

// The flashcard-twin deck was removed from DB. Filter it out of any cached local state
// so deleted flashcard cards don't persist indefinitely in IndexedDB after the migration.
const DEPRECATED_FLASHCARD_TWIN_DECK_ID = "b5e2f1a3-7c9d-4e8f-a012-3b4c5d6e7f8a";

function applyBidirectionalDedupeGuards(state: StudyState): StudyState {
  const normalized = normalizeReferenceNotationInState(state);
  const categories = dedupeBySemanticKeyLww(normalized.categories, (c) => `${c.parentId ?? "root"}::${normalizeName(c.name)}`);
  const decks = dedupeBySemanticKeyLww(
    (normalized.decks ?? []).filter((d) => (
      d.id !== DEPRECATED_FLASHCARD_TWIN_DECK_ID
      && !deletedDeckIds.has(d.id)
      && !lastCloudDeckTombstones.has(d.id)
    )),
    (d) => normalizeName(d.name),
  );
  // Upgrade legacy "multiple" cards to "combo" so dual-mode study works regardless of
  // whether a cloud sync has run (IDB may still hold the old type from a previous session).
  const upgradeCard = (c: Card): Card => {
    if (c.type !== "multiple") return c;
    const mc = c as AnyCard;
    const answer = mc.options && mc.correctIndices ? (mc.options[mc.correctIndices[0]] ?? undefined) : undefined;
    return { ...c, type: "combo", answer, options: mc.options, correctIndices: mc.correctIndices } as Card;
  };
  const cards = dedupeBySemanticKeyLww(
    (normalized.cards ?? [])
      .filter((c) => (
        c.deckId !== DEPRECATED_FLASHCARD_TWIN_DECK_ID
        && !deletedCardIds.has(c.id)
        && !lastCloudCardTombstones.has(c.id)
      ))
      .map(upgradeCard),
    (c) => normalizeQuestionKey(c.question),
  );

  const categoryIds = new Set(categories.map((c) => c.id));
  const deckIds = new Set(decks.map((d) => d.id));
  const cardIds = new Set(cards.map((c) => c.id));

  return {
    ...normalized,
    categories,
    decks,
    cards,
    cardDecks: (normalized.cardDecks ?? []).filter((l) => cardIds.has(l.cardId) && deckIds.has(l.deckId)),
    deckCategories: Object.fromEntries(
      Object.entries(normalized.deckCategories ?? {}).filter(([deckId]) => deckIds.has(deckId)),
    ),
    goals: normalized.goals ?? [],
  };
}

// Tombstones: ids of cloud rows that were soft-deleted (deleted_at != null).
// Populated by loadAll / loadDelta and consumed by merge functions to drop
// the matching local rows. This is the multi-device delete-propagation path:
// without it, device B (which still has X locally) would resurrect X on hydrate.
let lastCloudCategoryTombstones: Set<string> = new Set();
let lastCloudDeckTombstones: Set<string> = new Set();
let lastCloudCardTombstones: Set<string> = new Set();

// Local in-flight delete guards: ids deleted via the UI this session.
// Prevents delta/full sync from re-adding rows before cloud tombstones arrive.
const deletedDeckIds: Set<string> = new Set();
const deletedCardIds: Set<string> = new Set();

const mergeStudyStateLww = (local: StudyState, cloud: StudyState, isFullCloudSync = false): StudyState => {
  const localUiTs = typeof local.uiPrefs?.updatedAt === "number" ? local.uiPrefs.updatedAt : 0;
  const cloudUiTs = typeof cloud.uiPrefs?.updatedAt === "number" ? cloud.uiPrefs.updatedAt : 0;

  const tombstones = lastCloudCategoryTombstones;
  const cloudCategoryIds = new Set((cloud.categories ?? []).map((c) => c.id));
  const mergedCategories = isFullCloudSync
    ? (cloud.categories ?? [])
    : [
        ...(cloud.categories ?? []),
        ...(local.categories ?? []).filter((c) => !cloudCategoryIds.has(c.id)),
      ];
  let filteredCategories: typeof mergedCategories;
  if (tombstones.size) {
    filteredCategories = mergedCategories.filter((c) => {
      if (tombstones.has(c.id)) {
        // Audit: category deleted locally due to cloud tombstone
        if (currentUserId && currentUserId !== GUEST_ID) {
          void appendCloudToIdbDeleteAuditEvent(currentUserId, "categories", c.id);
        }
        return false;
      }
      return true;
    });
  } else {
    filteredCategories = mergedCategories;
  }

  return applyBidirectionalDedupeGuards({
    ...cloud,
    decks: mergeByKeyLww(local.decks, cloud.decks, (x) => x.id),
    cards: mergeByKeyLww(local.cards, cloud.cards, (x) => x.id),
    logs: mergeByKeyLww(local.logs, cloud.logs, (x) => x.id),
    categories: filteredCategories,
    goals: mergeByKeyLww(local.goals, cloud.goals, (x) => x.id),
    dayNotes: mergeByKeyLww(local.dayNotes, cloud.dayNotes, (x) => x.date),
    learningSessions: mergeByKeyLww(local.learningSessions, cloud.learningSessions, (x) => x.id),
    shasReviews: mergeByKeyLww(local.shasReviews, cloud.shasReviews, (x) => x.id),
    shasPlans: mergeByKeyLww(local.shasPlans, cloud.shasPlans, (x) => x.id),
    cardDecks: mergeByKeyLww(local.cardDecks, cloud.cardDecks, (x) => `${x.cardId}::${x.deckId}`),
    uiPrefs: localUiTs > cloudUiTs ? local.uiPrefs : cloud.uiPrefs,
    // View settings are sourced from user_settings in cloud to avoid stale local flicker.
    tabConfig: cloud.tabConfig ?? [],
    sidebarConfig: cloud.sidebarConfig ?? [],
    widgetLayout: cloud.widgetLayout,
    generalPlans: mergeByKeyLww(local.generalPlans, cloud.generalPlans, (x) => x.id),
    planReviews: mergeByKeyLww(local.planReviews, cloud.planReviews, (x) => x.id),
    customCategoryTemplates: mergeByKeyLww(local.customCategoryTemplates, cloud.customCategoryTemplates, (x) => x.id),
    quizPlans: mergeByKeyLww(local.quizPlans, cloud.quizPlans, (x) => x.id),
    quizAttempts: mergeByKeyLww(local.quizAttempts, cloud.quizAttempts, (x) => x.id),
    deckCategories: {
      ...(cloud.deckCategories ?? {}),
      ...(local.deckCategories ?? {}),
    },
  });
};

function setState(updater: (s: StudyState) => StudyState) {
  memState = updater(memState);
  perfMeter.bumpMutation();
  // Batch consecutive mutations within the same frame into a single notify.
  // Test/SSR fallback inside requestStoreNotify uses a microtask, so callers
  // that read memState synchronously after setState still see fresh data.
  requestStoreNotify();
  scheduleStateCachePersist();
}

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID
  ? crypto.randomUUID()
  : Math.random().toString(36).slice(2) + Date.now().toString(36));

// Local helper types
type SrsData = { ease: number; interval: number; repetitions: number; dueAt: number; lastReviewedAt: number | null };
type StatsData = { totalReviews: number; correct: number; incorrect: number };
type AnyCard = Card & { answer?: string; options?: string[]; correctIndices?: number[]; correct?: boolean; explanation?: string };

// Track in-flight category INSERT promises so that child rows can chain after their parent
// (avoids "violates foreign key constraint categories_parent_id_fkey" race when creating
// a nested path like חומש שמות / יתרו / פרק א in rapid succession).
const categoryInsertPromises = new Map<string, Promise<unknown>>();

const ROOT_PARENT_KEY = "__root__";
const CATEGORY_CACHE_TTL_MS = 5 * 60 * 1000;
const CATEGORY_CACHE_VERSION = 1;
const CATEGORY_PREFETCH_MIN_GAP_MS = 140;
const CATEGORY_PREFETCH_MAX_IN_FLIGHT = 1;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const parentCacheKey = (parentId: string | null) => parentId ?? ROOT_PARENT_KEY;
let loadedCategoryParents = new Set<string>();
let loadedCategoryParentsAt = new Map<string, number>();
let loadingCategoryParents = new Set<string>();
let categoryHasChildrenHint = new Map<string, boolean>();
let categoryLoadDurationsMs: number[] = [];
let categoryLastLoadMs: number | null = null;
let categoryCacheHits = 0;
let categoryCacheMisses = 0;
let categoryPersistedHits = 0;
let categoryStaleDropped = 0;
let categoryPersistedCacheByParent = new Map<string, { ts: number; rows: CategoryChildRow[] }>();
let categoryPrefetchScore = new Map<string, number>();
let categoryRequestSeqByParent = new Map<string, number>();
let categoryAbortControllersByParent = new Map<string, AbortController>();
let categoryLocalStateUser: string | null = null;
let categoryAbortedRequests = 0;
let categoryPrefetchInFlight = 0;
let categoryPrefetchLastStartMs = 0;
let categoryPrefetchThrottled = 0;

type CategoryChildRow = {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  created_at: string;
  sort_order: number | null;
  has_children: boolean;
};

const rpcClient = supabase as unknown as {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

let cachedAccessToken: string | null = null;
let cachedAccessTokenAt = 0;
let accessTokenInFlight: Promise<string | null> | null = null;
const ACCESS_TOKEN_STALE_MS = 30 * 60 * 1000;

const readAccessTokenFromLocalStorage = (): string | null => {
  try {
    const host = new URL(SUPABASE_URL).host;
    const projectRef = host.split(".")[0] ?? "";
    const preferredKey = projectRef ? `sb-${projectRef}-auth-token` : "";
    const keys = preferredKey
      ? [preferredKey, ...Object.keys(localStorage).filter((k) => k !== preferredKey)]
      : Object.keys(localStorage);

    for (const key of keys) {
      if (!key.includes("auth-token")) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as {
        access_token?: unknown;
        currentSession?: { access_token?: unknown };
      };
      const token = typeof parsed?.access_token === "string"
        ? parsed.access_token
        : (typeof parsed?.currentSession?.access_token === "string" ? parsed.currentSession.access_token : null);
      if (token) return token;
    }
  } catch {
    // ignore parse/storage errors
  }
  return null;
};

const getCachedAccessToken = async (forceRefresh = false): Promise<string | null> => {
  const now = Date.now();
  // Avoid auth lock contention by reusing the in-memory token whenever possible.
  // Supabase auth refresh events keep this token up-to-date.
  const tokenSeemsFresh = cachedAccessToken !== null && (now - cachedAccessTokenAt <= ACCESS_TOKEN_STALE_MS);
  if (!forceRefresh && tokenSeemsFresh) return cachedAccessToken;

  if (!forceRefresh && cachedAccessToken === null) {
    const storageToken = readAccessTokenFromLocalStorage();
    if (storageToken) {
      cachedAccessToken = storageToken;
      cachedAccessTokenAt = now;
      return storageToken;
    }
  }

  if (accessTokenInFlight) return accessTokenInFlight;

  accessTokenInFlight = supabase.auth.getSession()
    .then(({ data }) => {
      cachedAccessToken = data.session?.access_token ?? null;
      cachedAccessTokenAt = Date.now();
      return cachedAccessToken;
    })
    .catch(() => {
      cachedAccessToken = null;
      cachedAccessTokenAt = Date.now();
      return null;
    })
    .finally(() => {
      accessTokenInFlight = null;
    });

  return accessTokenInFlight;
};

supabase.auth.onAuthStateChange((_event, session) => {
  cachedAccessToken = session?.access_token ?? null;
  cachedAccessTokenAt = Date.now();
});

const isAbortError = (error: unknown) => {
  return error instanceof DOMException && error.name === "AbortError";
};

const fetchCategoryChildrenRpc = async (parentId: string | null, signal: AbortSignal): Promise<CategoryChildRow[]> => {
  const isGuest = currentUserId === GUEST_ID;
  const rpcName = isGuest ? "get_guest_category_children_for" : "get_category_children";
  const guestSourceUid = isGuest ? getActiveGuestSourceUserId() : null;
  const body = isGuest
    ? JSON.stringify({ p_source_user_id: guestSourceUid, p_parent_id: parentId })
    : JSON.stringify({ p_parent_id: parentId });
  const callRpc = async (name: string, accessToken: string | null) => fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_PUBLISHABLE_KEY,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body,
    signal,
  });

  // Guest mode has no Supabase session — call as anon (apikey only).
  let response = await callRpc(rpcName, isGuest ? null : await getCachedAccessToken());
  if (!isGuest && response.status === 401) {
    cachedAccessToken = null;
    cachedAccessTokenAt = 0;
    response = await callRpc(rpcName, await getCachedAccessToken(true));
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `${rpcName} failed: ${response.status}`);
  }

  const ownRows = ((await response.json()) ?? []) as CategoryChildRow[];

  // For authenticated users, also pull source-overlay children (read-only).
  // No-op server-side when admin disabled the overlay.
  if (!isGuest && currentUserId) {
    try {
      const tok = await getCachedAccessToken();
      const sourceResp = await callRpc("get_source_category_children", tok);
      if (sourceResp.ok) {
        const sourceRows = ((await sourceResp.json()) ?? []) as CategoryChildRow[];
        // Track ownership and merge (own rows win on id collision).
        const ownIds = new Set(ownRows.map((r) => r.id));
        for (const r of sourceRows) {
          sourceOwnedCategoryIds.add(r.id);
          if (!ownIds.has(r.id)) ownRows.push(r);
        }
      }
    } catch (e) {
      if (!isAbortError(e)) console.warn("[source-overlay] children fetch failed:", e);
    }
  }

  return ownRows;
};


const CATEGORY_CHILDREN_CACHE_KEY = (userId: string) =>
  `category-children-cache:${userId}:v${CATEGORY_CACHE_VERSION}`;
const CATEGORY_PREFETCH_SCORE_KEY = (userId: string) =>
  `category-prefetch-score:${userId}:v${CATEGORY_CACHE_VERSION}`;

const saveCategoryPersistedCache = (userId: string) => {
  try {
    const obj: Record<string, { ts: number; rows: CategoryChildRow[] }> = {};
    categoryPersistedCacheByParent.forEach((value, key) => { obj[key] = value; });
    localStorage.setItem(CATEGORY_CHILDREN_CACHE_KEY(userId), JSON.stringify(obj));
  } catch {
    // ignore storage errors
  }
};

const saveCategoryPrefetchScores = (userId: string) => {
  try {
    const obj: Record<string, number> = {};
    categoryPrefetchScore.forEach((value, key) => { obj[key] = value; });
    localStorage.setItem(CATEGORY_PREFETCH_SCORE_KEY(userId), JSON.stringify(obj));
  } catch {
    // ignore storage errors
  }
};

const ensureCategoryLocalState = (userId: string) => {
  if (categoryLocalStateUser === userId) return;
  categoryPersistedCacheByParent = new Map<string, { ts: number; rows: CategoryChildRow[] }>();
  categoryPrefetchScore = new Map<string, number>();
  categoryRequestSeqByParent = new Map<string, number>();
  categoryAbortControllersByParent = new Map<string, AbortController>();
  categoryLocalStateUser = userId;

  try {
    const rawCache = localStorage.getItem(CATEGORY_CHILDREN_CACHE_KEY(userId));
    if (rawCache) {
      const parsed = JSON.parse(rawCache) as Record<string, { ts: number; rows: CategoryChildRow[] }>;
      for (const [key, value] of Object.entries(parsed ?? {})) {
        if (!value || typeof value.ts !== "number" || !Array.isArray(value.rows)) continue;
        categoryPersistedCacheByParent.set(key, value);
      }
    }
  } catch {
    // ignore parse/storage errors
  }

  try {
    const rawScores = localStorage.getItem(CATEGORY_PREFETCH_SCORE_KEY(userId));
    if (rawScores) {
      const parsed = JSON.parse(rawScores) as Record<string, number>;
      for (const [key, value] of Object.entries(parsed ?? {})) {
        if (!Number.isFinite(value)) continue;
        categoryPrefetchScore.set(key, value);
      }
    }
  } catch {
    // ignore parse/storage errors
  }
};

const resetCategoryLazyState = () => {
  loadedCategoryParents = new Set<string>();
  loadedCategoryParentsAt = new Map<string, number>();
  loadingCategoryParents = new Set<string>();
  categoryHasChildrenHint = new Map<string, boolean>();
  categoryLoadDurationsMs = [];
  categoryLastLoadMs = null;
  categoryCacheHits = 0;
  categoryCacheMisses = 0;
  categoryPersistedHits = 0;
  categoryStaleDropped = 0;
  categoryAbortedRequests = 0;
  categoryPrefetchInFlight = 0;
  categoryPrefetchLastStartMs = 0;
  categoryPrefetchThrottled = 0;
  categoryRequestSeqByParent = new Map<string, number>();
  categoryAbortControllersByParent.forEach((c) => c.abort());
  categoryAbortControllersByParent = new Map<string, AbortController>();
  categoryPersistedCacheByParent = new Map<string, { ts: number; rows: CategoryChildRow[] }>();
  categoryPrefetchScore = new Map<string, number>();
  categoryLocalStateUser = null;
};

const percentile = (arr: number[], p: number): number => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
};

const pushCategoryLoadDuration = (ms: number) => {
  categoryLastLoadMs = ms;
  categoryLoadDurationsMs.push(ms);
  if (categoryLoadDurationsMs.length > 200) {
    categoryLoadDurationsMs = categoryLoadDurationsMs.slice(-200);
  }
};

const getCategoryPerfSnapshot = () => ({
  samples: categoryLoadDurationsMs.length,
  lastMs: categoryLastLoadMs,
  p50Ms: percentile(categoryLoadDurationsMs, 50),
  p95Ms: percentile(categoryLoadDurationsMs, 95),
  cacheHits: categoryCacheHits,
  cacheMisses: categoryCacheMisses,
  persistedHits: categoryPersistedHits,
  staleDropped: categoryStaleDropped,
  aborted: categoryAbortedRequests,
  prefetchThrottled: categoryPrefetchThrottled,
  inFlight: loadingCategoryParents.size,
});

const invalidateCategoryParentCache = (parentId: string | null) => {
  const key = parentCacheKey(parentId);
  loadedCategoryParents.delete(key);
  loadedCategoryParentsAt.delete(key);
  categoryPersistedCacheByParent.delete(key);
  if (currentUserId && currentUserId !== GUEST_ID) saveCategoryPersistedCache(currentUserId);
};

const markCategoryParentLoadedNow = (parentId: string | null) => {
  const key = parentCacheKey(parentId);
  loadedCategoryParents.add(key);
  loadedCategoryParentsAt.set(key, Date.now());
};

const isCategoryParentCacheFresh = (parentId: string | null) => {
  const key = parentCacheKey(parentId);
  if (!loadedCategoryParents.has(key)) return false;
  const ts = loadedCategoryParentsAt.get(key) ?? 0;
  return Date.now() - ts < CATEGORY_CACHE_TTL_MS;
};

const bg = (p: PromiseLike<{ error: unknown }>, label = "sync") => {
  if (currentUserId === GUEST_ID) return; // guest mode – no network sync
  if (!isSyncEnabled() || !canPushToCloud()) return; // pull-only/local-only mode
  Promise.resolve(p).then((r) => {
    if (r?.error) {
      const err = r.error as { message?: string; code?: string; name?: string };
      const msg = err.message ?? err.code ?? "";
      // AbortError with 'steal' is a normal multi-tab Web Locks coordination event —
      // the other tab completed the same write, so data is not lost. Suppress the toast.
      const isStolenLock = (err.name === "AbortError" || msg.includes("AbortError")) && msg.includes("steal");
      if (isStolenLock) {
        console.debug(`[${label}] lock stolen by another tab (harmless)`);
        return;
      }
      console.error(`[${label}]`, err);
      if (currentUserId && currentUserId !== GUEST_ID) {
        void enqueueFullSyncJob(currentUserId, `${label}: ${msg || "unknown"}`)
          .then(async () => {
            const jobs = await listSyncJobs(currentUserId);
            markCloudSyncJobs(jobs.length);
          });
      }
      toast({
        title: "שגיאה בשמירה לשרת",
        description: `${label}: ${msg || "שגיאה לא ידועה"}`,
        variant: "destructive",
      });
    }
  });
};

const flushUiPrefsCloudSync = () => {
  uiPrefsSyncTimer = null;
  const userId = uiPrefsSyncUserId;
  const payload = uiPrefsSyncPayload;
  uiPrefsSyncUserId = null;
  uiPrefsSyncPayload = null;
  if (!userId || userId === GUEST_ID || !payload) return;
  if (currentUserId !== userId) return;
  if (!isSyncEnabled() || !canPushToCloud()) return;
  bg(
    supabase.from("user_settings").upsert(
      { user_id: userId, ui_prefs: payload as unknown as Json },
      { onConflict: "user_id" },
    ),
    "user_settings.ui_prefs",
  );
};

const scheduleUiPrefsCloudSync = (userId: string, payload: UiPrefs) => {
  uiPrefsSyncUserId = userId;
  uiPrefsSyncPayload = payload;
  if (uiPrefsSyncTimer !== null) window.clearTimeout(uiPrefsSyncTimer);
  uiPrefsSyncTimer = window.setTimeout(() => {
    flushUiPrefsCloudSync();
  }, UI_PREFS_SYNC_DEBOUNCE_MS);
};

/**
 * Pending Delete Queue — durable per-row tombstone propagation.
 *
 * 1. softDeleteCategory(rowId) is called for every category we want gone
 * 2. enqueues into IndexedDB so the deletion survives crashes / offline
 * 3. tries to push immediately; on failure, the row stays in the queue
 * 4. flushPendingDeletes(userId) retries the queue on every hydrate
 */
const flushPendingDeletes = async (userId: string): Promise<{ success: number; failed: number; empty: boolean }> => {
  if (!userId || userId === GUEST_ID) return { success: 0, failed: 0, empty: true };
  if (!isSyncEnabled() || !canPushToCloud()) return { success: 0, failed: 0, empty: true };
  const pending = await listPendingDeletes(userId);
  if (pending.length === 0) {
    await appendDeleteAuditEvent(userId, "categories", null, "noop", "pending-delete queue is empty");
    return { success: 0, failed: 0, empty: true };
  }
  const nowIso = new Date().toISOString();
  let success = 0;
  let failed = 0;
  for (const job of pending) {
    try {
      const { error } = await supabase
        .from(job.table)
        .update({ deleted_at: nowIso } as never)
        .eq("id", job.rowId);
      if (error) {
        if (job.table === "decks") deletedDeckIds.add(job.rowId);
        if (job.table === "cards") deletedCardIds.add(job.rowId);
        await bumpPendingDeleteAttempt(job.id, error.message ?? "unknown");
        await appendDeleteAuditEvent(userId, job.table, job.rowId, "failed", error.message ?? "unknown");
        failed += 1;
      } else {
        await removePendingDelete(job.id);
        if (job.table === "decks") deletedDeckIds.delete(job.rowId);
        if (job.table === "cards") deletedCardIds.delete(job.rowId);
        await appendDeleteAuditEvent(userId, job.table, job.rowId, "success", "deleted_at propagated to cloud");
        success += 1;
      }
    } catch (err) {
      await bumpPendingDeleteAttempt(job.id, String(err));
      await appendDeleteAuditEvent(userId, job.table, job.rowId, "failed", String(err));
      failed += 1;
    }
  }
  return { success, failed, empty: false };
};

/**
 * Soft-delete one or more rows with durable queueing.
 *  1. Each id is recorded in the IndexedDB pending-deletes store immediately
 *     (so a crash, refresh, or offline window cannot lose the deletion).
 *  2. We try to push a single batched UPDATE to the cloud right away.
 *  3. On success the corresponding queue rows are removed.
 *  4. On failure the queue keeps the rows; flushPendingDeletes(userId) retries
 *     on next hydrate (or whenever called).
 *
 * Callers are still responsible for updating in-memory state.
 */
const softDeleteWithQueue = (table: "categories" | "decks" | "cards", rowIds: string[]) => {
  if (!currentUserId || currentUserId === GUEST_ID) return;
  if (!isSyncEnabled() || !canPushToCloud()) return;
  if (rowIds.length === 0) return;
  const userId = currentUserId;
  void (async () => {
    // 1) Enqueue every id (durable)
    await Promise.all(rowIds.map((rid) => enqueuePendingDelete(userId, table, rid)));
    await Promise.all(rowIds.map((rid) => appendDeleteAuditEvent(userId, table, rid, "queued", "queued for tombstone propagation")));
    // 2) Try to push immediately
    const nowIso = new Date().toISOString();
    try {
      let success = true;
      for (let i = 0; i < rowIds.length; i += 200) {
        const chunk = rowIds.slice(i, i + 200);
        const { error } = await supabase
          .from(table)
          .update({ deleted_at: nowIso } as never)
          .in("id", chunk);
        if (error) {
          success = false;
          console.warn(`[softDelete:${table}]`, error);
          break;
        }
      }
      if (success) {
        // 3) Remove the just-confirmed jobs from the queue
        const all = await listPendingDeletes(userId);
        const idSet = new Set(rowIds);
        const toRemove = all.filter((j) => j.table === table && idSet.has(j.rowId));
        await Promise.all(toRemove.map((j) => removePendingDelete(j.id)));
        if (table === "decks") {
          for (const rid of rowIds) deletedDeckIds.delete(rid);
        }
        if (table === "cards") {
          for (const rid of rowIds) deletedCardIds.delete(rid);
        }
      }
    } catch (err) {
      console.warn(`[softDelete:${table}]`, err);
    }
  })();
};

// helpers for ISO date keys (yyyy-mm-dd)
const isoDate = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const todayIso = () => isoDate(new Date());
const addDaysIso = (base: Date, days: number) => {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + days);
  return isoDate(d);
};

// ---- Mappers ----
interface CardRow {
  id: string; deck_id: string; type: string; question: string;
  tags: unknown; created_at: string; srs: unknown; stats: unknown;
  updated_at?: string | null;
  answer: string | null; options: unknown; correct_indices: unknown;
  correct_boolean: boolean | null; explanation: string | null;
  masechta?: string | null; daf?: number | null; amud?: number | null;
}
const cardFromRow = (r: CardRow): Card => {
  const rawStats = (r.stats as (StatsData & { editHistory?: Card["editHistory"] }) | null) ?? null;
  const editHistory = rawStats?.editHistory;
  const stats: StatsData = rawStats
    ? { totalReviews: rawStats.totalReviews ?? 0, correct: rawStats.correct ?? 0, incorrect: rawStats.incorrect ?? 0 }
    : { totalReviews: 0, correct: 0, incorrect: 0 };
  const base = {
    id: r.id, deckId: r.deck_id ?? null, type: r.type, question: r.question,
    tags: (r.tags as string[] | null) ?? [], createdAt: new Date(r.created_at).getTime(),
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : new Date(r.created_at).getTime(),
    srs: (r.srs as SrsData | null) ?? defaultSrs(),
    stats,
    masechta: r.masechta ?? null,
    daf: r.daf ?? null,
    amud: (r.amud as 1 | 2 | null | undefined) ?? null,
    ...(editHistory ? { editHistory } : {}),
  };
  if (r.type === "flashcard") return { ...base, type: "flashcard", answer: r.answer ?? "" };
  if (r.type === "multiple") {
    // Map "multiple" → "combo" so the card supports both flashcard and MC study modes.
    const opts = (r.options as string[] | null) ?? [];
    const correctIdxs = (r.correct_indices as number[] | null) ?? [];
    const answer = r.answer ?? (correctIdxs.length > 0 && opts.length > 0 ? (opts[correctIdxs[0]] ?? undefined) : undefined);
    return { ...base, type: "combo", answer, options: opts, correctIndices: correctIdxs, explanation: r.explanation ?? undefined };
  }
  if (r.type === "boolean") return { ...base, type: "boolean", correct: !!r.correct_boolean, explanation: r.explanation ?? undefined };
  return { ...base, type: "combo", answer: r.answer ?? undefined, options: (r.options as string[] | undefined), correctIndices: (r.correct_indices as number[] | undefined), explanation: r.explanation ?? undefined };
};

const cardToRow = (c: Card, userId: string) => {
  const ac = c as AnyCard;
  const statsWithHistory = c.editHistory && c.editHistory.length > 0
    ? { ...c.stats, editHistory: c.editHistory }
    : c.stats;
  return {
    id: c.id, user_id: userId, deck_id: c.deckId, type: c.type, question: c.question,
    updated_at: new Date((c.updatedAt ?? Date.now())).toISOString(),
    answer: ac.answer ?? null,
    options: ac.options ?? null,
    correct_indices: ac.correctIndices ?? null,
    correct_boolean: c.type === "boolean" ? ac.correct : null,
    explanation: ac.explanation ?? null,
    tags: c.tags, srs: c.srs, stats: statsWithHistory,
    masechta: c.masechta ?? null,
    daf: c.daf ?? null,
    amud: c.amud ?? null,
  };
};

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const runAndThrow = async (label: string, promise: PromiseLike<{ error: unknown }>) => {
  const r = await Promise.resolve(promise);
  if (r?.error) {
    const err = r.error as { message?: string; code?: string };
    throw new Error(`${label}: ${err.message ?? err.code ?? "unknown"}`);
  }
};

const syncRowsById = async (
  userId: string,
  table: string,
  rows: Array<Record<string, unknown>>,
  _appendOnly = false,
  _softDelete = false,
) => {
  // SAFETY POLICY (per user request): NEVER delete cloud rows based on diff with
  // local state. The local state can be incomplete (pagination, partial load,
  // worker not finished) and a diff-based delete has caused mass data loss in
  // the past. Cloud deletions now happen ONLY via explicit user actions in the
  // UI (e.g. delete-card, delete-deck buttons, "clear all" flow). This sync
  // function is upsert-only.
  void userId;
  if (rows.length > 0) {
    const deduped = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const rawId = row.id;
      const key = typeof rawId === "string" && rawId.length > 0 ? rawId : JSON.stringify(row);
      deduped.set(key, row);
    }
    const uniqueRows = Array.from(deduped.values());
    if (uniqueRows.length !== rows.length) {
      console.debug(`[sync:${table}] deduped ${rows.length - uniqueRows.length} duplicate row(s) before upsert`);
    }
    for (const batch of chunk(uniqueRows, 500)) {
      await runAndThrow(`${table}.upsert`, supabase.from(table as never).upsert(batch as never, { onConflict: "id" }));
    }
  }
};

/** Sync card_decks: upsert-only. Cloud rows are deleted only by explicit UI actions. */
const syncCardDecks = async (
  userId: string,
  rows: Array<{ card_id: string; deck_id: string; sort_order: number; updated_at: string }>,
) => {
  const withUser = rows.map((r) => ({ ...r, user_id: userId }));
  for (const batch of chunk(withUser, 500)) {
    await runAndThrow(
      "card_decks.upsert",
      supabase.from("card_decks").upsert(batch as never, { onConflict: "card_id,deck_id" }),
    );
  }
};

/** Sync day_notes: upsert-only. Cloud rows are deleted only by explicit UI actions. */
const syncDayNotes = async (
  userId: string,
  rows: Array<{ date: string; text: string; updated_at: string }>,
) => {
  const withUser = rows.map((r) => ({ ...r, user_id: userId }));
  for (const batch of chunk(withUser, 500)) {
    await runAndThrow(
      "day_notes.upsert",
      supabase.from("day_notes").upsert(batch as never, { onConflict: "user_id,date" }),
    );
  }
};

const flushLocalStateToCloud = async (userId: string, state: StudyState) => {
  const settingsPayload = {
    user_id: userId,
    notifications_enabled: state.notificationsEnabled ?? false,
    reminder_time: state.reminderTime ?? "20:00",
    tab_config: {
      home: state.tabConfig ?? [],
      sidebar: state.sidebarConfig ?? [],
    } as unknown as Json,
    widget_layout: (state.widgetLayout ?? null) as unknown as Json,
    ui_prefs: (state.uiPrefs ?? {}) as unknown as Json,
    review_intervals: (state.reviewIntervals ?? [1, 3, 7, 14, 30]) as unknown as Json,
    plan_review_intervals: (state.planReviewIntervals ?? [...PLAN_REVIEW_INTERVALS_DAYS]) as unknown as Json,
    shas_plans: (state.shasPlans ?? []) as unknown as Json,
    active_shas_plan_id: state.activeShasPlanId ?? null,
    general_plans: (state.generalPlans ?? []) as unknown as Json,
    general_plan_reviews: (state.planReviews ?? []) as unknown as Json,
    custom_category_templates: (state.customCategoryTemplates ?? []) as unknown as Json,
    quiz_plans: (state.quizPlans ?? []) as unknown as Json,
    quiz_attempts: (state.quizAttempts ?? []) as unknown as Json,
  };

  await runAndThrow("user_settings.upsert", supabase.from("user_settings").upsert(settingsPayload, { onConflict: "user_id" }));

  const decksRows = (state.decks ?? []).filter((d) => !isSourceOwnedDeck(d.id)).map((d) => ({
    id: d.id,
    user_id: userId,
    name: d.name,
    description: d.description ?? null,
    color: d.color,
    created_at: new Date(d.createdAt).toISOString(),
    updated_at: new Date((d.updatedAt ?? d.createdAt)).toISOString(),
    category_ids: d.categoryIds ?? [],
    include_sub_categories: d.includeSubCategories !== false,
  }));

  const categoriesRows = (state.categories ?? []).filter((c) => !isSourceOwnedCategory(c.id)).map((c) => ({
    id: c.id,
    user_id: userId,
    name: c.name,
    parent_id: c.parentId,
    color: c.color ?? null,
    created_at: new Date(c.createdAt).toISOString(),
    updated_at: new Date((c.updatedAt ?? c.createdAt)).toISOString(),
    sort_order: c.sortOrder ?? 0,
  }));

  const cardsRows = (state.cards ?? []).filter((c) => !isSourceOwnedCard(c.id)).map((c) => cardToRow(c, userId));


  const goalsRows = (state.goals ?? []).map((g) => ({
    id: g.id,
    user_id: userId,
    type: g.type,
    title: g.title,
    target: g.target,
    window_days: g.windowDays ?? null,
    deck_id: g.deckId ?? null,
    active: g.active,
    manual_done_dates: g.manualDoneDates ?? [],
    created_at: new Date(g.createdAt).toISOString(),
    updated_at: new Date((g.updatedAt ?? g.createdAt)).toISOString(),
  }));

  const sessionsRows = (state.learningSessions ?? []).map((s) => ({
    id: s.id,
    user_id: userId,
    date: s.date,
    subject: s.subject,
    session_type: s.sessionType,
    quality: s.quality,
    duration_minutes: s.durationMinutes ?? null,
    note: s.note ?? null,
    next_review_date: s.nextReviewDate ?? null,
    review_number: s.reviewNumber,
    created_at: new Date(s.createdAt).toISOString(),
    updated_at: new Date((s.updatedAt ?? s.createdAt)).toISOString(),
  }));

  const logsRows = (state.logs ?? []).map((l) => ({
    id: l.id,
    user_id: userId,
    card_id: l.cardId,
    deck_id: l.deckId,
    at: new Date(l.at).toISOString(),
    quality: l.quality,
    correct: l.correct,
    duration_ms: l.durationMs,
    updated_at: new Date((l.updatedAt ?? l.at)).toISOString(),
  }));

  const shasReviewsRows = (state.shasReviews ?? []).map((r) => ({
    id: r.id,
    user_id: userId,
    masechta: r.masechta,
    daf: r.daf,
    amud: r.amud,
    half: r.half ?? null,
    unit: r.unit,
    review_index: r.reviewIndex,
    due_date: r.dueDate,
    done_at: r.doneAt,
    is_initial: r.isInitial,
    note: r.note ?? null,
    updated_at: new Date((r.updatedAt ?? Date.now())).toISOString(),
  }));

  const dayNotesRows = (state.dayNotes ?? []).map((n) => ({
    user_id: userId,
    date: n.date,
    text: n.text,
    updated_at: new Date(n.updatedAt).toISOString(),
  }));

  const cardDeckRows = (state.cardDecks ?? []).map((x) => ({
    user_id: userId,
    card_id: x.cardId,
    deck_id: x.deckId,
    sort_order: x.sortOrder ?? 0,
    updated_at: new Date((x.updatedAt ?? Date.now())).toISOString(),
  }));

  await syncRowsById(userId, "decks", decksRows);
  // categories: use soft-delete so tombstones are preserved for multi-device sync.
  await syncRowsById(userId, "categories", categoriesRows, false, true);
  await syncRowsById(userId, "cards", cardsRows as unknown as Array<Record<string, unknown>>);
  await syncRowsById(userId, "goals", goalsRows);
  await syncRowsById(userId, "learning_sessions", sessionsRows);
  await syncRowsById(userId, "review_logs", logsRows, true); // appendOnly: never delete old logs not in local 2000-entry window
  await syncRowsById(userId, "shas_reviews", shasReviewsRows);

  await syncDayNotes(userId, dayNotesRows);
  await syncCardDecks(userId, cardDeckRows);
};

const runPendingCloudSync = async (userId: string) => {
  if (cloudSyncInFlight) return;
  if (!isSyncEnabled() || !canPushToCloud()) return; // skip while push is disabled
  const traceId = perf.createTraceId("sync");
  const restoreTrace = perf.pushTrace(traceId);
  const stopSync = perf.startTimer("store:runPendingCloudSync(total)", "store", traceId);
  cloudSyncInFlight = true;
  try {
    const jobs = await listSyncJobs(userId);
    perf.log("store:runPendingCloudSync.jobs_loaded", `${jobs.length} jobs`, "store", traceId);
    markCloudSyncJobs(jobs.length);
    let processedCount = 0;
    for (const job of jobs) {
      try {
        if (job.kind === "full-sync") {
          const stopJob = perf.startTimer(`store:syncJob:${job.kind}`, "store", traceId);
          await flushLocalStateToCloud(userId, memState);
          stopJob(`attempts=${job.attempts}`);
        }
        await removeSyncJob(job.id);
        processedCount++;
      } catch (error) {
        const message = error instanceof Error ? error.message : "sync failed";
        perf.error("store:syncJob.failed", message, traceId);
        await markSyncJobFailure(job.id, message);
      }
    }
    // Only re-query remaining jobs if we actually processed some (avoids redundant IDB read).
    if (processedCount > 0) {
      const remaining = await listSyncJobs(userId);
      perf.log("store:runPendingCloudSync.jobs_remaining", `${remaining.length} jobs`, "store", traceId);
      markCloudSyncJobs(remaining.length);
    } else {
      perf.log("store:runPendingCloudSync.jobs_remaining", "0 jobs (skipped re-query)", "store", traceId);
      markCloudSyncJobs(0);
    }
  } finally {
    cloudSyncInFlight = false;
    stopSync();
    restoreTrace();
  }
};

/** Fetch all rows from a table that may exceed PostgREST's 1000-row default limit. */
async function fetchAllPages<T>(
  query: () => ReturnType<typeof supabase.from>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await (query() as unknown as { range: (f: number, t: number) => Promise<{ data: T[] | null; error: unknown }> })
      .range(from, from + pageSize - 1) as { data: T[] | null; error: unknown };
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break; // last page
    from += pageSize;
  }
  return rows;
}

/**
 * Phase 2: silently loads unreviewed cards in the background after bootstrap.
 * Bootstrap (Phase 1) only returns cards with srs.repetitions > 0 to keep the first
 * load fast (~1-2s instead of 16s). This function fetches the rest using parallel
 * requests (CONCURRENCY=4, PAGE=2000) to cut total time from ~15s → ~3-4s.
 *
 * IDB is saved after EVERY batch so that a mid-load refresh always resumes from
 * the last saved batch rather than restarting from scratch.
 */
async function runPhase2CardBackfill(userId: string) {
  if (phase2BackfillInFlight) return;
  if (!phase2BackfillNeeded) return;
  // Already have all cards in memory — skip (common on second visit after IDB hydration).
  if (phase2TotalCount > 0 && memState.cards.length >= phase2TotalCount) return;
  phase2BackfillInFlight = true;
  phase2BackfillUserId = userId;
  const PAGE = 3000;
  const CONCURRENCY = 2;
  let offset = 0;
  try {
    while (true) {
      // Fire CONCURRENCY pages in parallel.
      const batchOffsets = Array.from({ length: CONCURRENCY }, (_, i) => offset + i * PAGE);
      const isGuest = currentUserId === GUEST_ID;
      const phase2RpcName = isGuest ? "get_guest_unreviewed_cards_page_for" : "get_unreviewed_cards_page";
      const guestSourceUid = isGuest ? getActiveGuestSourceUserId() : null;
      const batchResults = await Promise.all(
        batchOffsets.map((o) => {
          const args = isGuest
            ? { p_source_user_id: guestSourceUid, p_offset: o, p_limit: PAGE }
            : { p_offset: o, p_limit: PAGE };
          return rpcClient.rpc(phase2RpcName, args) as Promise<{ data: unknown; error: unknown }>;
        })
      );

      let batchHadRows = false;
      // Build existingIds once from current memState to dedup across all batch results.
      const existingIds = new Set(memState.cards.map((c) => c.id));
      const newCards: ReturnType<typeof cardFromRow>[] = [];

      for (const result of batchResults) {
        if (result.error) {
          console.error("[phase2] get_unreviewed_cards_page error:", result.error);
          continue;
        }
        const rows = Array.isArray(result.data) ? result.data : [];
        if (rows.length > 0) batchHadRows = true;
        const mapped = (rows as unknown as Parameters<typeof cardFromRow>[0][])
          .map(cardFromRow)
          .filter((c) => !existingIds.has(c.id));
        // Track newly added ids to prevent cross-page dupes within the same batch.
        mapped.forEach((c) => existingIds.add(c.id));
        newCards.push(...mapped);
      }

      if (newCards.length > 0) {
        memState = { ...memState, cards: [...memState.cards, ...newCards] };
        // Notify React so the category counts update visibly after each batch.
        requestStoreNotify();
        // Save IDB incrementally: if the user refreshes mid-backfill the next visit
        // resumes from the cards we've already loaded, not from scratch.
        if (phase2BackfillUserId === userId) {
          void saveStudyStateCache(userId, memState).catch((e) =>
            console.warn("[phase2] incremental IDB save failed:", e)
          );
        }
      }

      // Stop when no page in the batch returned any rows.
      if (!batchHadRows) break;
      offset += CONCURRENCY * PAGE;
    }
    // Final React notification and authoritative IDB write.
    requestStoreNotify();
    if (phase2BackfillUserId === userId) {
      await saveStudyStateCache(userId, memState);
    }
    phase2BackfillNeeded = false;
  } catch (e) {
    console.error("[phase2] card backfill failed:", e);
  } finally {
    phase2BackfillInFlight = false;
  }
}

/**
 * Smart delta sync — fetches ONLY rows changed since `sinceMs` (per-table
 * `updated_at >= since`). Returns a Partial<StudyState> meant to be merged
 * into memState via `mergeByKeyLww`. Deletions are captured via tombstones
 * (`deleted_at != null`) and then filtered out in merge/apply guards.
 *
 * Skips small singleton tables (user_settings, shas_plans) — those are cheap
 * to refetch and live behind the full path. Logs are also skipped (we only
 * keep the latest 2000 server-side; delta would need its own ordering).
 */
async function loadDelta(userId: string, sinceMs: number): Promise<{
  cloudCardsTotalCount: number;
  cloudDecksTotalCount: number;
  cloudCategoriesActiveTotalCount: number;
  decks: Deck[];
  cards: Card[];
  categories: Category[];
  goals: Goal[];
  dayNotes: { date: string; text: string; updatedAt: number }[];
  cardDecks: { cardId: string; deckId: string; sortOrder: number; updatedAt: number }[];
  shasReviews: ShasReview[];
  learningSessions: LearningSession[];
  widgetLayout?: WidgetLayout;
  widgetLayoutUpdatedAt: number;
  tabConfigBundle?: { home: TabConfig[]; sidebar: SidebarConfig[] };
  tabConfigUpdatedAt: number;
}> {
  void userId; // RLS handles user scoping
  const sinceIso = new Date(Math.max(0, sinceMs - 1000)).toISOString(); // -1s safety overlap
  type R<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];

  const [cardsCountR, decksCountR, categoriesActiveCountR, decksR, cardsR, catsR, goalsR, notesR, cardDecksR, reviewsR, sessionsR, settingsR] = await Promise.all([
    timeOp("db:delta:cards_count", "db", () => supabase.from("cards").select("id", { count: "exact", head: true }).is("deleted_at", null)),
    timeOp("db:delta:decks_count", "db", () => supabase.from("decks").select("id", { count: "exact", head: true }).is("deleted_at", null)),
    timeOp(
      "db:delta:categories_active_count",
      "db",
      () => supabase.from("categories").select("id", { count: "exact", head: true }).is("deleted_at", null),
    ),
    timeOp("db:delta:decks", "db", () => supabase.from("decks").select("*").gte("updated_at", sinceIso)),
    (async () => {
      // Keep the page at 1000: the backend API caps ranged table reads at 1000 rows.
      // Larger ranges can return only 1000 and look like the final page, leaving IDB stale.
      const PAGE = 1000;
      let from = 0;
      const all: R<'cards'>[] = [];
      while (true) {
        const { data, error } = await supabase.from("cards").select("*").gte("updated_at", sinceIso).range(from, from + PAGE - 1);
        if (error) return { data: all, error };
        all.push(...((data ?? []) as R<'cards'>[]));
        if ((data ?? []).length < PAGE) break;
        from += PAGE;
      }
      return { data: all };
    })(),
    // Categories delta: include rows with deleted_at >= since so tombstones propagate.
    // We split the active rows from the tombstones below.
    timeOp("db:delta:categories", "db", () => supabase.from("categories").select("*").gte("updated_at", sinceIso)),
    timeOp("db:delta:goals", "db", () => supabase.from("goals").select("*").gte("updated_at", sinceIso)),
    timeOp("db:delta:day_notes", "db", () => supabase.from("day_notes").select("*").gte("updated_at", sinceIso)),
    timeOp("db:delta:card_decks", "db", () => supabase.from("card_decks").select("*").gte("updated_at", sinceIso)),
    timeOp("db:delta:shas_reviews", "db", () => supabase.from("shas_reviews").select("*").gte("updated_at", sinceIso)),
    timeOp("db:delta:learning_sessions", "db", () => supabase.from("learning_sessions").select("*").gte("updated_at", sinceIso)),
    // Pull latest layout metadata every delta cycle so widget layout changes on another device
    // propagate quickly without waiting for a full snapshot refresh.
    timeOp("db:delta:user_settings_layout", "db", () =>
      supabase
        .from("user_settings")
        .select("widget_layout,widget_layout_updated_at,tab_config,updated_at")
        .maybeSingle(),
    ),
  ]);

  if (cardsCountR.error) throw cardsCountR.error;
  if (decksCountR.error) throw decksCountR.error;
  if (categoriesActiveCountR.error) throw categoriesActiveCountR.error;
  const cloudCardsTotalCount = typeof cardsCountR.count === "number" ? cardsCountR.count : 0;
  const cloudDecksTotalCount = typeof decksCountR.count === "number" ? decksCountR.count : 0;
  const cloudCategoriesActiveTotalCount = typeof categoriesActiveCountR.count === "number" ? categoriesActiveCountR.count : 0;
  rememberCloudCardsTotalCount(userId, cloudCardsTotalCount);
  rememberCloudDecksTotalCount(userId, cloudDecksTotalCount);
  rememberCloudCategoriesTotalCount(userId, cloudCategoriesActiveTotalCount);

  const allDeckRows = (decksR.data ?? []) as Array<R<'decks'> & { deleted_at?: string | null }>;
  const deltaDeckTombstones = new Set<string>();
  for (const row of allDeckRows) if (row.deleted_at) deltaDeckTombstones.add(row.id);
  if (deltaDeckTombstones.size) {
    const next = new Set(lastCloudDeckTombstones);
    for (const id of deltaDeckTombstones) next.add(id);
    lastCloudDeckTombstones = next;
  }
  const decks: Deck[] = allDeckRows.filter((d) => !d.deleted_at).map((d) => ({
    id: d.id, name: d.name, description: d.description ?? undefined, color: d.color,
    createdAt: new Date(d.created_at).getTime(),
    updatedAt: d.updated_at ? new Date(d.updated_at).getTime() : new Date(d.created_at).getTime(),
    categoryIds: Array.isArray(d.category_ids) ? (d.category_ids as string[]) : [],
    includeSubCategories: d.include_sub_categories !== false,
  }));
  const allCardRows = (cardsR.data ?? []) as Array<R<'cards'> & { deleted_at?: string | null }>;
  const deltaCardTombstones = new Set<string>();
  for (const row of allCardRows) if (row.deleted_at) deltaCardTombstones.add(row.id);
  if (deltaCardTombstones.size) {
    const next = new Set(lastCloudCardTombstones);
    for (const id of deltaCardTombstones) next.add(id);
    lastCloudCardTombstones = next;
  }
  const cards: Card[] = allCardRows.filter((c) => !c.deleted_at).map(cardFromRow);
  const allCatRows = ((catsR.data ?? []) as Array<R<'categories'> & { deleted_at?: string | null }>);
  // Capture tombstones from this delta so the merge can drop them from local state.
  const deltaTombstones = new Set<string>();
  for (const row of allCatRows) if (row.deleted_at) deltaTombstones.add(row.id);
  if (deltaTombstones.size) {
    const next = new Set(lastCloudCategoryTombstones);
    for (const id of deltaTombstones) next.add(id);
    lastCloudCategoryTombstones = next;
  }
  const categories: Category[] = allCatRows
    .filter((c) => !c.deleted_at)
    .map((c) => ({
      id: c.id, name: c.name, parentId: c.parent_id, color: c.color ?? undefined,
      createdAt: new Date(c.created_at).getTime(), sortOrder: c.sort_order ?? 0,
      updatedAt: c.updated_at ? new Date(c.updated_at).getTime() : new Date(c.created_at).getTime(),
    }));
  const goals: Goal[] = ((goalsR.data ?? []) as R<'goals'>[]).map((g) => ({
    id: g.id, type: g.type as Goal['type'], title: g.title, target: Number(g.target),
    windowDays: g.window_days ?? undefined, deckId: g.deck_id ?? null,
    active: g.active, createdAt: new Date(g.created_at).getTime(),
    updatedAt: g.updated_at ? new Date(g.updated_at).getTime() : new Date(g.created_at).getTime(),
    manualDoneDates: (g.manual_done_dates as string[] | null) ?? [],
  }));
  const dayNotes = ((notesR.data ?? []) as R<'day_notes'>[]).map((n) => ({
    date: n.date, text: n.text, updatedAt: new Date(n.updated_at).getTime(),
  }));
  const cardDecks = ((cardDecksR.data ?? []) as R<'card_decks'>[]).map((r) => ({
    cardId: r.card_id, deckId: r.deck_id, sortOrder: r.sort_order ?? 0,
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : 0,
  }));
  const shasReviews: ShasReview[] = ((reviewsR.data ?? []) as R<'shas_reviews'>[]).map((r) => ({
    id: r.id, masechta: r.masechta, daf: r.daf,
    amud: (r.amud === 2 ? 2 : 1) as 1 | 2,
    half: r.half == null ? null : ((r.half === 2 ? 2 : 1) as 1 | 2),
    unit: (r.unit as ShasReview["unit"]) ?? "daf",
    reviewIndex: r.review_index ?? 1,
    dueDate: r.due_date,
    doneAt: r.done_at ?? null,
    isInitial: !!r.is_initial,
    note: r.note ?? null,
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : 0,
  }));
  const learningSessions: LearningSession[] = ((sessionsR.data ?? []) as R<'learning_sessions'>[]).map((r) => ({
    id: r.id, date: r.date, subject: r.subject,
    sessionType: r.session_type as "initial" | "review",
    quality: r.quality as 1 | 2 | 3 | 4 | 5,
    durationMinutes: r.duration_minutes ?? undefined,
    note: r.note ?? undefined,
    nextReviewDate: r.next_review_date ?? null,
    reviewNumber: r.review_number ?? 1,
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : new Date(r.created_at).getTime(),
  }));

  const widgetLayout = (() => {
    const raw = settingsR.data?.widget_layout;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as unknown as WidgetLayout;
    return undefined;
  })();
  const widgetLayoutUpdatedAt = (() => {
    const raw = (settingsR.data as { widget_layout_updated_at?: string | null } | null)?.widget_layout_updated_at;
    if (raw) {
      const t = new Date(raw).getTime();
      if (Number.isFinite(t)) return t;
    }
    if (settingsR.data?.updated_at) {
      const t = new Date(settingsR.data.updated_at).getTime();
      if (Number.isFinite(t)) return t;
    }
    return 0;
  })();
  const tabConfigBundle = (() => {
    const raw = settingsR.data?.tab_config;
    if (Array.isArray(raw)) {
      return { home: raw as unknown as TabConfig[], sidebar: [] as SidebarConfig[] };
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const obj = raw as { home?: unknown; sidebar?: unknown };
      return {
        home: Array.isArray(obj.home) ? (obj.home as unknown as TabConfig[]) : [],
        sidebar: Array.isArray(obj.sidebar) ? (obj.sidebar as unknown as SidebarConfig[]) : [],
      };
    }
    return undefined;
  })();
  const tabConfigUpdatedAt = settingsR.data?.updated_at
    ? new Date(settingsR.data.updated_at).getTime()
    : 0;

  return {
    cloudCardsTotalCount,
    cloudDecksTotalCount,
    cloudCategoriesActiveTotalCount,
    decks,
    cards,
    categories,
    goals,
    dayNotes,
    cardDecks,
    shasReviews,
    learningSessions,
    widgetLayout,
    widgetLayoutUpdatedAt,
    tabConfigBundle,
    tabConfigUpdatedAt,
  };
}

const applyDeltaToState = (base: StudyState, delta: Awaited<ReturnType<typeof loadDelta>>): StudyState => {
  const uidForSettings = currentUserId;
  const storedWidgetCloudTs = (uidForSettings && uidForSettings !== GUEST_ID)
    ? Number(localStorage.getItem(WIDGET_LAYOUT_CLOUD_TS_KEY(uidForSettings)) ?? "0")
    : 0;
  const storedTabCloudTs = (uidForSettings && uidForSettings !== GUEST_ID)
    ? Number(localStorage.getItem(TAB_CONFIG_CLOUD_TS_KEY(uidForSettings)) ?? "0")
    : 0;
  const hasWidgetSettingsDelta = !!(
    uidForSettings
    && uidForSettings !== GUEST_ID
    && delta.widgetLayoutUpdatedAt > 0
    && delta.widgetLayoutUpdatedAt > storedWidgetCloudTs
  );
  const hasTabConfigDelta = !!(
    uidForSettings
    && uidForSettings !== GUEST_ID
    && delta.tabConfigBundle
    && delta.tabConfigUpdatedAt > 0
    && delta.tabConfigUpdatedAt > storedTabCloudTs
  );

  // No changes anywhere → return base reference unchanged so React skips render.
  const totalChanged = delta.decks.length + delta.cards.length + delta.categories.length
    + delta.goals.length + delta.dayNotes.length + delta.cardDecks.length
    + delta.shasReviews.length + delta.learningSessions.length;
  if (totalChanged === 0 && !hasWidgetSettingsDelta && !hasTabConfigDelta) return base;
  const tombstones = lastCloudCategoryTombstones;
  const mergedCats = mergeByKeyLww(base.categories, delta.categories, (x) => x.id);
  let filteredCats: typeof mergedCats;
  if (tombstones.size) {
    filteredCats = mergedCats.filter((c) => {
      if (tombstones.has(c.id)) {
        // Audit: category deleted locally due to cloud tombstone (delta)
        if (currentUserId && currentUserId !== GUEST_ID) {
          void appendCloudToIdbDeleteAuditEvent(currentUserId, "categories", c.id);
        }
        return false;
      }
      return true;
    });
  } else {
    filteredCats = mergedCats;
  }

  let nextWidgetLayout = base.widgetLayout;
  const uidForLayout = uidForSettings;
  if (uidForLayout && uidForLayout !== GUEST_ID && delta.widgetLayoutUpdatedAt > 0) {
    localStorage.setItem(WIDGET_LAYOUT_CLOUD_TS_KEY(uidForLayout), String(delta.widgetLayoutUpdatedAt));
    const localWidgetCache = readWidgetLayoutCache(uidForLayout);
    const localTs = localWidgetCache?.updatedAt ?? 0;
    if (delta.widgetLayout && localTs < delta.widgetLayoutUpdatedAt) {
      nextWidgetLayout = delta.widgetLayout;
      writeWidgetLayoutCache(uidForLayout, delta.widgetLayout, delta.widgetLayoutUpdatedAt);
      void writeWidgetLayoutIdb(uidForLayout, delta.widgetLayout, delta.widgetLayoutUpdatedAt);
    } else if (localWidgetCache?.layout && localTs >= delta.widgetLayoutUpdatedAt) {
      nextWidgetLayout = localWidgetCache.layout;
    } else if (!delta.widgetLayout && localWidgetCache?.layout) {
      nextWidgetLayout = localWidgetCache.layout;
    }
  }

  let nextTabConfig = base.tabConfig;
  let nextSidebarConfig = base.sidebarConfig;
  if (uidForSettings && uidForSettings !== GUEST_ID && delta.tabConfigUpdatedAt > 0) {
    if (delta.tabConfigBundle && delta.tabConfigUpdatedAt > storedTabCloudTs) {
      nextTabConfig = delta.tabConfigBundle.home;
      nextSidebarConfig = delta.tabConfigBundle.sidebar;
      localStorage.setItem(TAB_CONFIG_CLOUD_TS_KEY(uidForSettings), String(delta.tabConfigUpdatedAt));
    }
  }

  return applyBidirectionalDedupeGuards({
    ...base,
    decks: mergeByKeyLww(base.decks, delta.decks, (x) => x.id),
    cards: mergeByKeyLww(base.cards, delta.cards, (x) => x.id),
    categories: filteredCats,
    goals: mergeByKeyLww(base.goals, delta.goals, (x) => x.id),
    dayNotes: mergeByKeyLww(base.dayNotes, delta.dayNotes, (x) => x.date),
    cardDecks: mergeByKeyLww(base.cardDecks, delta.cardDecks, (x) => `${x.cardId}::${x.deckId}`),
    shasReviews: mergeByKeyLww(base.shasReviews, delta.shasReviews, (x) => x.id),
    learningSessions: mergeByKeyLww(base.learningSessions, delta.learningSessions, (x) => x.id),
    tabConfig: nextTabConfig,
    sidebarConfig: nextSidebarConfig,
    widgetLayout: nextWidgetLayout,
  });
};

async function loadAll(userId: string): Promise<StudyState> {
  const traceId = perf.createTraceId("load");
  const restoreTrace = perf.pushTrace(traceId);
  const stopTotal = perf.startTimer("store:loadAll (total)", "store", traceId);
  try {
  const rowCount = <T extends { data?: unknown[] | null }>(r: T): string | undefined =>
    r.data != null ? `${r.data.length} rows` : "no data";

  type R<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
  let decksR: { data?: R<'decks'>[] | null };
  let cardsR: { data?: R<'cards'>[] | null };
  let logsR: { data?: R<'review_logs'>[] | null };
  let goalsR: { data?: R<'goals'>[] | null };
  let shasR: { data?: R<'shas_plans'> | null };
  let notesR: { data?: R<'day_notes'>[] | null };
  let settingsR: { data?: R<'user_settings'> | null };
  let cardDecksR: { data?: R<'card_decks'>[] | null };
  let reviewsR: { data?: R<'shas_reviews'>[] | null };
  let sessionsR: { data?: R<'learning_sessions'>[] | null };
  let catsData: { data?: R<'categories'>[] | null };

  const [bootstrap, roleDefaultsR, userRolesR] = await Promise.all([
    timeOp(
      "db:bootstrap_snapshot", "db",
      () => rpcClient.rpc("get_bootstrap_snapshot") as unknown as Promise<{ data: Record<string, unknown> | null; error: unknown }>,
    ),
    timeOp(
      "db:role_layout_defaults", "db",
      () => rpcClient.rpc("get_my_role_layout_defaults") as unknown as Promise<{ data: Record<string, unknown> | null; error: unknown }>,
    ).catch(() => ({ data: null, error: null })),
    timeOp(
      "db:user_roles", "db",
      () => supabase.from("user_roles").select("role_id").eq("user_id", userId),
    ).catch(() => ({ data: null, error: null })),
  ]);
  const userRoleIds = ((userRolesR?.data ?? []) as Array<{ role_id?: string | null }>)
    .map((row) => row.role_id)
    .filter((id): id is string => !!id);
  const viewportScope: LayoutScope = (typeof window !== "undefined" && window.innerWidth < 768) ? "mobile" : "desktop";
  let roleAssignedLayout: Awaited<ReturnType<typeof resolveRoleLayoutProfile>> = null;
  for (const roleId of userRoleIds) {
    const resolved = await resolveRoleLayoutProfile(roleId, { scope: viewportScope }).catch(() => null);
    if (resolved) {
      roleAssignedLayout = resolved;
      break;
    }
  }
  const roleDefaults = (roleDefaultsR?.data && typeof roleDefaultsR.data === "object") ? roleDefaultsR.data as Record<string, unknown> : null;
  const roleDefaultWidgetLayout = (() => {
    if (roleAssignedLayout?.widgetLayout && typeof roleAssignedLayout.widgetLayout === "object") {
      return roleAssignedLayout.widgetLayout;
    }
    const raw = roleDefaults?.widget_layout;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as unknown as WidgetLayout;
    return undefined;
  })();
  const roleDefaultSidebar = (() => {
    if (Array.isArray(roleAssignedLayout?.sidebarConfig)) {
      return roleAssignedLayout.sidebarConfig;
    }
    const raw = roleDefaults?.sidebar_config;
    if (Array.isArray(raw)) return raw as unknown as SidebarConfig[];
    return undefined;
  })();

  if (!bootstrap.error && bootstrap.data && typeof bootstrap.data === "object") {
    const payload = bootstrap.data as Record<string, unknown>;
    const bootstrapDeckRows = Array.isArray(payload.decks)
      ? (payload.decks as Array<R<'decks'> & { deleted_at?: string | null }>)
      : [];
    const bootstrapCardRows = Array.isArray(payload.cards)
      ? (payload.cards as Array<R<'cards'> & { deleted_at?: string | null }>)
      : [];
    const bootstrapDeckTombstones = new Set<string>();
    for (const d of bootstrapDeckRows) if (d.deleted_at) bootstrapDeckTombstones.add(d.id);
    const bootstrapDeckTombstoneIdsR = await supabase.from("decks").select("id").not("deleted_at", "is", null);
    for (const d of (bootstrapDeckTombstoneIdsR.data ?? []) as Array<{ id: string }>) bootstrapDeckTombstones.add(d.id);
    lastCloudDeckTombstones = bootstrapDeckTombstones;
    const bootstrapCardTombstones = new Set<string>();
    for (const c of bootstrapCardRows) if (c.deleted_at) bootstrapCardTombstones.add(c.id);
    const bootstrapCardTombstoneIdsR = await supabase.from("cards").select("id").not("deleted_at", "is", null);
    for (const c of (bootstrapCardTombstoneIdsR.data ?? []) as Array<{ id: string }>) bootstrapCardTombstones.add(c.id);
    lastCloudCardTombstones = bootstrapCardTombstones;
    decksR = { data: bootstrapDeckRows.filter((d) => !d.deleted_at) as R<'decks'>[] };
    cardsR = { data: bootstrapCardRows.filter((c) => !c.deleted_at) as R<'cards'>[] };
    // Detect if Phase 2 backfill is needed (bootstrap only returned reviewed cards).
    const cardsTotalCount = typeof payload.cards_total_count === 'number' ? payload.cards_total_count : 0;
    const cardsLoadedCount = Array.isArray(payload.cards) ? payload.cards.length : 0;
    if (cardsTotalCount > 0) phase2TotalCount = cardsTotalCount;
    rememberCloudCardsTotalCount(userId, cardsTotalCount);
    rememberCloudDecksTotalCount(userId, decksR.data?.length ?? 0);
    if (cardsTotalCount > cardsLoadedCount) {
      phase2BackfillNeeded = true;
    }
    logsR = { data: Array.isArray(payload.review_logs) ? (payload.review_logs as R<'review_logs'>[]) : [] };
    goalsR = { data: Array.isArray(payload.goals) ? (payload.goals as R<'goals'>[]) : [] };
    shasR = { data: (payload.shas_legacy && typeof payload.shas_legacy === "object") ? (payload.shas_legacy as R<'shas_plans'>) : null };
    notesR = { data: Array.isArray(payload.day_notes) ? (payload.day_notes as R<'day_notes'>[]) : [] };
    settingsR = { data: (payload.user_settings && typeof payload.user_settings === "object") ? (payload.user_settings as R<'user_settings'>) : null };
    cardDecksR = { data: Array.isArray(payload.card_decks) ? (payload.card_decks as R<'card_decks'>[]) : [] };
    reviewsR = { data: Array.isArray(payload.shas_reviews) ? (payload.shas_reviews as R<'shas_reviews'>[]) : [] };
    sessionsR = { data: Array.isArray(payload.learning_sessions) ? (payload.learning_sessions as R<'learning_sessions'>[]) : [] };
    catsData = { data: Array.isArray(payload.categories_roots) ? (payload.categories_roots as R<'categories'>[]) : [] };
    // Capture category tombstones returned by the RPC (deleted_at != null on the cloud).
    // Used by mergeStudyStateLww to drop the matching local rows on next merge.
    const tombArr = Array.isArray(payload.categories_tombstones) ? payload.categories_tombstones : [];
    const tombSet = new Set<string>();
    for (const t of tombArr) {
      if (t && typeof t === "object" && typeof (t as { id?: unknown }).id === "string") {
        tombSet.add((t as { id: string }).id);
      }
    }
    lastCloudCategoryTombstones = tombSet;
    rememberCloudCategoriesTotalCount(userId, catsData.data?.length ?? 0);
  } else {
    [decksR, cardsR, logsR, goalsR, shasR, notesR, settingsR, cardDecksR, reviewsR, sessionsR, catsData] = await Promise.all([
      timeOp("db:decks", "db", () => supabase.from("decks").select("*").order("created_at"), rowCount),
      // Paginated card fetch — load ALL cards regardless of count
      (async () => {
        const PAGE = 1000;
        let from = 0;
        const allCards: R<'cards'>[] = [];
        while (true) {
          const { data, error } = await supabase.from("cards").select("*").order("created_at").range(from, from + PAGE - 1);
          if (error) return { data: allCards, error };
          allCards.push(...((data ?? []) as R<'cards'>[]));
          if ((data ?? []).length < PAGE) break;
          from += PAGE;
        }
        return { data: allCards };
      })(),
      timeOp("db:review_logs", "db", () => supabase.from("review_logs").select("*").order("at", { ascending: false }).limit(2000), rowCount),
      timeOp("db:goals", "db", () => supabase.from("goals").select("*"), rowCount),
      timeOp("db:shas_plans", "db", () => supabase.from("shas_plans").select("*").maybeSingle()),
      timeOp("db:day_notes", "db", () => supabase.from("day_notes").select("*"), rowCount),
      timeOp("db:user_settings", "db", () => supabase.from("user_settings").select("*").maybeSingle()),
      timeOp("db:card_decks", "db", () => supabase.from("card_decks").select("*").order("sort_order"), rowCount),
      timeOp("db:shas_reviews", "db", () => supabase.from("shas_reviews").select("*").order("due_date"), rowCount),
      timeOp("db:learning_sessions", "db", () => supabase.from("learning_sessions").select("*").order("created_at", { ascending: false }), rowCount),
      // Fetch ALL categories — tombstones (deleted_at != null) are captured separately
      // and stripped from the active list below.
      timeOp(
        "db:categories (all)", "db",
        () => supabase.from("categories").select("*").order("sort_order"),
        rowCount,
      ),
    ]);
    // Fallback path: split active rows from tombstones.
    const allDeckRows = (decksR.data ?? []) as Array<R<'decks'> & { deleted_at?: string | null }>;
    const deckTombSet = new Set<string>();
    for (const r of allDeckRows) if (r.deleted_at) deckTombSet.add(r.id);
    lastCloudDeckTombstones = deckTombSet;
    decksR = { data: allDeckRows.filter((r) => !r.deleted_at) as R<'decks'>[] };

    const allCardRows = (cardsR.data ?? []) as Array<R<'cards'> & { deleted_at?: string | null }>;
    const cardTombSet = new Set<string>();
    for (const r of allCardRows) if (r.deleted_at) cardTombSet.add(r.id);
    lastCloudCardTombstones = cardTombSet;
    cardsR = { data: allCardRows.filter((r) => !r.deleted_at) as R<'cards'>[] };

    const allRows = (catsData.data ?? []) as Array<R<'categories'> & { deleted_at?: string | null }>;
    const tombSet = new Set<string>();
    for (const r of allRows) if (r.deleted_at) tombSet.add(r.id);
    lastCloudCategoryTombstones = tombSet;
    catsData = { data: allRows.filter((r) => !r.deleted_at) };
    rememberCloudCardsTotalCount(userId, cardsR.data?.length ?? 0);
    rememberCloudDecksTotalCount(userId, decksR.data?.length ?? 0);
    rememberCloudCategoriesTotalCount(userId, catsData.data?.length ?? 0);
  }
  const decks: Deck[] = (decksR.data ?? []).map((d) => ({
      id: d.id, name: d.name, description: d.description ?? undefined, color: d.color,
      createdAt: new Date(d.created_at).getTime(),
      updatedAt: d.updated_at ? new Date(d.updated_at).getTime() : new Date(d.created_at).getTime(),
      categoryIds: Array.isArray(d.category_ids) ? (d.category_ids as string[]) : [],
      includeSubCategories: d.include_sub_categories !== false,
  }));
  const cards: Card[] = (cardsR.data ?? []).map(cardFromRow);
  const logs: ReviewLog[] = (logsR.data ?? []).map((l): ReviewLog => ({
    id: l.id, cardId: l.card_id, deckId: l.deck_id, at: new Date(l.at).getTime(),
    quality: l.quality as ReviewLog["quality"], correct: l.correct, durationMs: l.duration_ms,
    updatedAt: l.updated_at ? new Date(l.updated_at).getTime() : new Date(l.at).getTime(),
  }));
  const categories: Category[] = (catsData.data ?? []).map((c) => ({
    id: c.id, name: c.name, parentId: c.parent_id, color: c.color ?? undefined,
    createdAt: new Date(c.created_at).getTime(), sortOrder: c.sort_order ?? 0,
    updatedAt: c.updated_at ? new Date(c.updated_at).getTime() : new Date(c.created_at).getTime(),
  }));

  resetCategoryLazyState();
  // The bootstrap RPC returns ONLY root categories (parent_id IS NULL). Mark only the
  // root level as loaded so loadCategoryChildren is still called lazily for deeper levels
  // as the user navigates. (Previously every parent was marked, which disabled lazy loading.)
  markCategoryParentLoadedNow(null);
  const goals: Goal[] = (goalsR.data ?? []).map((g) => ({
    id: g.id, type: g.type as Goal['type'], title: g.title, target: Number(g.target),
    windowDays: g.window_days ?? undefined, deckId: g.deck_id ?? null,
    active: g.active, createdAt: new Date(g.created_at).getTime(),
    updatedAt: g.updated_at ? new Date(g.updated_at).getTime() : new Date(g.created_at).getTime(),
    manualDoneDates: (g.manual_done_dates as string[] | null) ?? [],
  }));
  const sd = shasR.data;
  const legacyShasPlan: ShasPlan | null = sd ? {
    id: sd.id, selectedMasechtos: (sd.selected_masechtos as string[]) ?? [],
    pagesPerDay: sd.pages_per_day, startDate: new Date(sd.start_date).getTime(),
    unit: (sd.unit as ShasPlan["unit"]) ?? "daf",
    currentMasechta: sd.current_masechta, currentDaf: sd.current_daf,
    currentAmud: (sd.current_amud === 2 ? 2 : 1),
    currentHalf: (sd.current_half === 2 ? 2 : 1),
    completed: (sd.completed as ShasPlan["completed"]) ?? [],
  } : null;
  const settingsObj = settingsR.data as { shas_plans?: unknown; active_shas_plan_id?: unknown } | null;
  const shasPlansFromSettings: ShasPlan[] = Array.isArray(settingsObj?.shas_plans)
    ? (settingsObj?.shas_plans as ShasPlan[])
    : [];
  const shasPlans = shasPlansFromSettings.length
    ? shasPlansFromSettings
    : (legacyShasPlan ? [legacyShasPlan] : []);
  const activeShasPlanIdFromSettings = typeof settingsObj?.active_shas_plan_id === "string"
    ? settingsObj.active_shas_plan_id
    : null;
  const activeShasPlanId = (activeShasPlanIdFromSettings && shasPlans.some((p) => p.id === activeShasPlanIdFromSettings))
    ? activeShasPlanIdFromSettings
    : (shasPlans[0]?.id ?? null);
  const shasPlan = activeShasPlanId
    ? (shasPlans.find((p) => p.id === activeShasPlanId) ?? null)
    : null;
  const dayNotes = (notesR.data ?? []).map((n) => ({
    date: n.date, text: n.text, updatedAt: new Date(n.updated_at).getTime(),
  }));
  const cardDecks = (cardDecksR.data ?? []).map((r) => ({
    cardId: r.card_id, deckId: r.deck_id, sortOrder: r.sort_order ?? 0,
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : 0,
  }));
  const shasReviews: ShasReview[] = (reviewsR.data ?? []).map((r) => ({
    id: r.id, masechta: r.masechta, daf: r.daf,
    amud: (r.amud === 2 ? 2 : 1) as 1 | 2,
    half: r.half == null ? null : ((r.half === 2 ? 2 : 1) as 1 | 2),
    unit: (r.unit as ShasReview["unit"]) ?? "daf",
    reviewIndex: r.review_index ?? 1,
    dueDate: r.due_date,
    doneAt: r.done_at ?? null,
    isInitial: !!r.is_initial,
    note: r.note ?? null,
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : 0,
  }));
  const intervalsRaw = settingsR.data?.review_intervals;
  const reviewIntervals: number[] = Array.isArray(intervalsRaw) && intervalsRaw.length
    ? intervalsRaw.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
    : [1, 3, 7, 14, 30];

  const planIntervalsRaw = (settingsR.data as { plan_review_intervals?: unknown })?.plan_review_intervals;
  const planReviewIntervals: number[] = Array.isArray(planIntervalsRaw) && planIntervalsRaw.length
    ? (planIntervalsRaw as unknown[]).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
    : [...PLAN_REVIEW_INTERVALS_DAYS];

  const cloudWidgetLayout = (() => {
    const raw = settingsR.data?.widget_layout;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as unknown as WidgetLayout;
    return undefined;
  })();
  // Prefer the dedicated widget_layout_updated_at timestamp when present (it tracks
  // ONLY widget layout changes). Fallback to the row's updated_at for old rows.
  const cloudWidgetLayoutUpdatedAt = (() => {
    const raw = (settingsR.data as { widget_layout_updated_at?: string | null } | null)?.widget_layout_updated_at;
    if (raw) {
      const t = new Date(raw).getTime();
      if (Number.isFinite(t)) return t;
    }
    return settingsR.data?.updated_at ? new Date(settingsR.data.updated_at).getTime() : 0;
  })();
  const localWidgetLayoutCache = readWidgetLayoutCache(userId);
  // Persist the cloud's widget layout timestamp so bg-refresh paths can compare against it.
  localStorage.setItem(WIDGET_LAYOUT_CLOUD_TS_KEY(userId), String(cloudWidgetLayoutUpdatedAt));
  const effectiveWidgetLayout = (() => {
    // If cloud has nothing saved, always trust the local cache (avoid wiping user prefs).
    if (!cloudWidgetLayout) return localWidgetLayoutCache?.layout ?? roleDefaultWidgetLayout;
    if (!localWidgetLayoutCache?.layout) return cloudWidgetLayout;
    return localWidgetLayoutCache.updatedAt >= cloudWidgetLayoutUpdatedAt
      ? localWidgetLayoutCache.layout
      : cloudWidgetLayout;
  })();

  const tabConfigBundle = (() => {
    const raw = settingsR.data?.tab_config;
    if (Array.isArray(raw)) {
      return { home: raw as unknown as TabConfig[], sidebar: [] as SidebarConfig[] };
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const obj = raw as { home?: unknown; sidebar?: unknown };
      return {
        home: Array.isArray(obj.home) ? (obj.home as unknown as TabConfig[]) : [],
        sidebar: Array.isArray(obj.sidebar) ? (obj.sidebar as unknown as SidebarConfig[]) : [],
      };
    }
    return { home: [] as TabConfig[], sidebar: [] as SidebarConfig[] };
  })();
  const cloudTabConfigUpdatedAt = settingsR.data?.updated_at
    ? new Date(settingsR.data.updated_at).getTime()
    : 0;
  localStorage.setItem(TAB_CONFIG_CLOUD_TS_KEY(userId), String(cloudTabConfigUpdatedAt));

  return {
    decks, cards, logs, categories, goals, shasPlan, dayNotes, cardDecks,
    shasPlans, activeShasPlanId,
    shasReviews, reviewIntervals, planReviewIntervals,
    notificationsEnabled: settingsR.data?.notifications_enabled ?? false,
    reminderTime: settingsR.data?.reminder_time ?? "20:00",
    learningSessions: (sessionsR.data ?? []).map((r): LearningSession => ({
      id: r.id,
      date: r.date,
      subject: r.subject,
      sessionType: r.session_type as "initial" | "review",
      quality: r.quality as 1 | 2 | 3 | 4 | 5,
      durationMinutes: r.duration_minutes ?? undefined,
      note: r.note ?? undefined,
      nextReviewDate: r.next_review_date ?? null,
      reviewNumber: r.review_number ?? 1,
      createdAt: new Date(r.created_at).getTime(),
      updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : new Date(r.created_at).getTime(),
    })),
    tabConfig: tabConfigBundle.home,
    sidebarConfig: (tabConfigBundle.sidebar.length === 0 && roleDefaultSidebar) ? roleDefaultSidebar : tabConfigBundle.sidebar,
    widgetLayout: effectiveWidgetLayout,
    uiPrefs: (() => {
      const raw = (settingsR.data as Record<string, unknown> | null)?.ui_prefs;
      const cloud: UiPrefs = (raw && typeof raw === "object" && !Array.isArray(raw)) ? (raw as UiPrefs) : {};
      const local = readUiPrefsCache(userId);
      if (!local) return cloud;
      const cloudTs = typeof cloud.updatedAt === "number" ? cloud.updatedAt : 0;
      const localTs = typeof local.updatedAt === "number" ? local.updatedAt : 0;
      return localTs > cloudTs ? local : cloud;
    })(),
    generalPlans: (() => {
      const raw = settingsR.data?.general_plans;
      if (Array.isArray(raw)) return raw as unknown as GeneralStudyPlan[];
      return [];
    })(),
    planReviews: (() => {
      const raw = (settingsR.data as Record<string, unknown> | null)?.general_plan_reviews;
      if (Array.isArray(raw)) return raw as PlanReview[];
      return [];
    })(),
    customCategoryTemplates: (() => {
      const raw = (settingsR.data as Record<string, unknown> | null)?.custom_category_templates;
      if (Array.isArray(raw)) return raw as CustomCategoryTemplate[];
      return [];
    })(),
    quizPlans: (() => {
      const raw = (settingsR.data as Record<string, unknown> | null)?.quiz_plans;
      if (Array.isArray(raw)) return raw as QuizPlan[];
      return [];
    })(),
    quizAttempts: (() => {
      const raw = (settingsR.data as Record<string, unknown> | null)?.quiz_attempts;
      if (Array.isArray(raw)) return raw as QuizAttempt[];
      return [];
    })(),
    deckCategories: readDeckCategoriesCache(userId),
  };
  } finally {
    stopTotal();
    restoreTrace();
  }
}

/**
 * Guest mode cloud hydration.
 * Pulls the source-user snapshot (if admin enabled `guest_source` in site_settings)
 * via SECURITY DEFINER RPCs callable by anon. Merges into memState, preserving any
 * locally-created items. Guest NEVER writes back to cloud.
 */
let guestCloudHydrateInFlight = false;
async function hydrateGuestFromCloud(): Promise<void> {
  if (guestCloudHydrateInFlight) return;
  if (currentUserId !== GUEST_ID) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  guestCloudHydrateInFlight = true;
  try {
    const headers = { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY };
    const guestSourceUid = getActiveGuestSourceUserId();
    const rpcBody = JSON.stringify({ p_source_user_id: guestSourceUid });
    const [snapResp, ccResp] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/rpc/get_guest_bootstrap_snapshot_for`, {
        method: "POST", headers, body: rpcBody,
      }),
      fetch(`${SUPABASE_URL}/rest/v1/rpc/get_guest_card_categories_for`, {
        method: "POST", headers, body: rpcBody,
      }),
    ]);
    if (!snapResp.ok) return;
    const payload = (await snapResp.json()) as Record<string, unknown> | null;
    if (!payload || typeof payload !== "object") return; // guest source disabled

    type CatRow = { id: string; name: string; parent_id: string | null; color: string | null; created_at: string; sort_order: number | null; updated_at?: string | null };
    type DeckRow = { id: string; name: string; description: string | null; color: string; created_at: string; updated_at: string | null; category_ids: unknown; include_sub_categories: boolean | null };
    type CardCatRow = { card_id: string; category_id: string };

    const catsRaw = Array.isArray(payload.categories_roots) ? (payload.categories_roots as CatRow[]) : [];
    const decksRaw = Array.isArray(payload.decks) ? (payload.decks as DeckRow[]) : [];
    const cardsRaw = Array.isArray(payload.cards) ? (payload.cards as Parameters<typeof cardFromRow>[0][]) : [];
    const cardDecksRaw = Array.isArray(payload.card_decks)
      ? (payload.card_decks as Array<{ card_id: string; deck_id: string; sort_order: number | null }>)
      : [];
    const cardsTotalCount = typeof payload.cards_total_count === "number" ? payload.cards_total_count : 0;

    const cloudCategories: Category[] = catsRaw.map((c) => ({
      id: c.id, name: c.name, parentId: c.parent_id, color: c.color ?? undefined,
      createdAt: new Date(c.created_at).getTime(),
      sortOrder: c.sort_order ?? 0,
      updatedAt: c.updated_at ? new Date(c.updated_at).getTime() : new Date(c.created_at).getTime(),
    }));
    const cloudDecks: Deck[] = decksRaw.map((d) => ({
      id: d.id, name: d.name, description: d.description ?? undefined, color: d.color,
      createdAt: new Date(d.created_at).getTime(),
      updatedAt: d.updated_at ? new Date(d.updated_at).getTime() : new Date(d.created_at).getTime(),
      categoryIds: Array.isArray(d.category_ids) ? (d.category_ids as string[]) : [],
      includeSubCategories: d.include_sub_categories !== false,
    }));
    const cloudCards: Card[] = cardsRaw.map(cardFromRow);
    const cloudCardDecks = cardDecksRaw.map((cd) => ({
      cardId: cd.card_id, deckId: cd.deck_id, sortOrder: cd.sort_order ?? 0,
    }));

    // card_categories → derive deckCategories-like mapping is not direct; the existing app
    // mostly relies on Card.tags / card_decks. We don't need card_categories for the read flow.
    void ccResp; // reserved for future use

    // Merge: cloud rows overwrite locals with same id; locally-added items survive.
    const mergeById = <T extends { id: string }>(local: T[], cloud: T[]): T[] => {
      const map = new Map<string, T>();
      for (const item of local ?? []) map.set(item.id, item);
      for (const item of cloud) map.set(item.id, item);
      return [...map.values()];
    };
    const mergedCategories = mergeById(memState.categories ?? [], cloudCategories);
    const mergedDecks = mergeById(memState.decks ?? [], cloudDecks);
    const mergedCards = mergeById(memState.cards ?? [], cloudCards);
    // card_decks has no id field — dedupe by (cardId,deckId)
    const cdKey = (x: { cardId: string; deckId: string }) => `${x.cardId}::${x.deckId}`;
    const cdMap = new Map<string, { cardId: string; deckId: string; sortOrder: number }>();
    for (const x of memState.cardDecks ?? []) cdMap.set(cdKey(x), x);
    for (const x of cloudCardDecks) cdMap.set(cdKey(x), x);
    const mergedCardDecks = [...cdMap.values()];

    memState = {
      ...memState,
      categories: mergedCategories,
      decks: mergedDecks,
      cards: mergedCards,
      cardDecks: mergedCardDecks,
    };

    // Update lazy-load hints so the UI knows which roots have children.
    markCategoryParentLoadedNow(null);
    for (const c of mergedCategories) {
      if (c.parentId) categoryHasChildrenHint.set(c.parentId, true);
    }

    // Phase 2 backfill — pull remaining unreviewed cards in background.
    if (cardsTotalCount > cloudCards.length) {
      phase2BackfillNeeded = true;
      phase2TotalCount = cardsTotalCount;
      void runPhase2CardBackfill(GUEST_ID);
    }

    try { localStorage.setItem(GUEST_STATE_KEY, JSON.stringify(memState)); } catch { /* storage full */ }
    notify();
  } finally {
    guestCloudHydrateInFlight = false;
  }
}

/**
 * Pull a read-only overlay of cards/categories/decks from the configured
 * "source" user. Merges into memState and tracks IDs in sourceOwned* sets so
 * cloud sync never tries to write them under the current user's account.
 * No-op for guest mode (guest has its own hydrator) and when admin disabled.
 */
async function hydrateSourceOverlayForAuthUser(uid: string): Promise<void> {
  if (uid === GUEST_ID || !uid) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  if (sourceOverlayHydrateInFlight) return;
  if (sourceOverlayHydratedFor === uid) return;
  sourceOverlayHydrateInFlight = true;
  try {
    const [snapR, ccR] = await Promise.all([
      rpcClient.rpc("get_source_overlay_snapshot") as unknown as Promise<{ data: Record<string, unknown> | null; error: unknown }>,
      rpcClient.rpc("get_source_card_categories") as unknown as Promise<{ data: unknown; error: unknown }>,
    ]);
    if (snapR.error) { console.warn("[source-overlay] snapshot error:", snapR.error); return; }
    const payload = snapR.data;
    if (!payload || typeof payload !== "object") return; // disabled or no source

    type CatRow = { id: string; name: string; parent_id: string | null; color: string | null; created_at: string; sort_order: number | null; updated_at?: string | null };
    type DeckRow = { id: string; name: string; description: string | null; color: string; created_at: string; updated_at: string | null; category_ids: unknown; include_sub_categories: boolean | null };

    const catsRaw = Array.isArray(payload.categories_roots) ? (payload.categories_roots as CatRow[]) : [];
    const decksRaw = Array.isArray(payload.decks) ? (payload.decks as DeckRow[]) : [];
    const cardsRaw = Array.isArray(payload.cards) ? (payload.cards as Parameters<typeof cardFromRow>[0][]) : [];
    const cardDecksRaw = Array.isArray(payload.card_decks)
      ? (payload.card_decks as Array<{ card_id: string; deck_id: string; sort_order: number | null }>)
      : [];
    const cardsTotalCount = typeof payload.cards_total_count === "number" ? payload.cards_total_count : 0;

    const ownedCats = catsRaw.map((c) => ({
      id: c.id, name: c.name, parentId: c.parent_id, color: c.color ?? undefined,
      createdAt: new Date(c.created_at).getTime(),
      sortOrder: c.sort_order ?? 0,
      updatedAt: c.updated_at ? new Date(c.updated_at).getTime() : new Date(c.created_at).getTime(),
    } as Category));
    const ownedDecks = decksRaw.map((d) => ({
      id: d.id, name: d.name, description: d.description ?? undefined, color: d.color,
      createdAt: new Date(d.created_at).getTime(),
      updatedAt: d.updated_at ? new Date(d.updated_at).getTime() : new Date(d.created_at).getTime(),
      categoryIds: Array.isArray(d.category_ids) ? (d.category_ids as string[]) : [],
      includeSubCategories: d.include_sub_categories !== false,
    } as Deck));
    const ownedCards = cardsRaw.map(cardFromRow);
    const ownedCardDecks = cardDecksRaw.map((cd) => ({
      cardId: cd.card_id, deckId: cd.deck_id, sortOrder: cd.sort_order ?? 0,
    }));

    // Track ownership BEFORE merging so sync filters work.
    for (const c of ownedCats) sourceOwnedCategoryIds.add(c.id);
    for (const d of ownedDecks) sourceOwnedDeckIds.add(d.id);
    for (const c of ownedCards) sourceOwnedCardIds.add(c.id);

    // Merge by id — local rows win (user's own copies override source).
    const mergeById = <T extends { id: string }>(local: T[], cloud: T[]): T[] => {
      const map = new Map<string, T>();
      for (const item of cloud) map.set(item.id, item);
      for (const item of local ?? []) map.set(item.id, item);
      return [...map.values()];
    };
    const cdKey = (x: { cardId: string; deckId: string }) => `${x.cardId}::${x.deckId}`;
    const cdMap = new Map<string, { cardId: string; deckId: string; sortOrder: number }>();
    for (const x of ownedCardDecks) cdMap.set(cdKey(x), x);
    for (const x of memState.cardDecks ?? []) cdMap.set(cdKey(x), x);

    memState = {
      ...memState,
      categories: mergeById(memState.categories ?? [], ownedCats),
      decks: mergeById(memState.decks ?? [], ownedDecks),
      cards: mergeById(memState.cards ?? [], ownedCards),
      cardDecks: [...cdMap.values()],
    };

    markCategoryParentLoadedNow(null);
    for (const c of ownedCats) {
      if (c.parentId) categoryHasChildrenHint.set(c.parentId, true);
    }

    // Phase 2 backfill for source unreviewed cards (in background).
    if (cardsTotalCount > ownedCards.length) {
      void runSourceOverlayPhase2(uid, cardsTotalCount).catch((e) =>
        console.warn("[source-overlay] phase2 failed:", e)
      );
    }

    sourceOverlayHydratedFor = uid;
    sourceOverlaySourceUserId = typeof payload.source_user_id === "string" ? payload.source_user_id : null;
    void ccR; // card_categories not directly used yet
    await saveStudyStateCache(uid, memState);
    requestStoreNotify();
  } finally {
    sourceOverlayHydrateInFlight = false;
  }
}

async function runSourceOverlayPhase2(uid: string, totalCount: number): Promise<void> {
  const PAGE = 3000;
  let offset = 0;
  // currentLoaded counts how many source cards we already have in mem.
  let loaded = memState.cards.filter((c) => sourceOwnedCardIds.has(c.id)).length;
  while (loaded < totalCount && currentUserId === uid) {
    const { data, error } = await (rpcClient.rpc("get_source_unreviewed_cards_page", { p_offset: offset, p_limit: PAGE }) as Promise<{ data: unknown; error: unknown }>);
    if (error) { console.warn("[source-overlay] page error:", error); break; }
    const rows = Array.isArray(data) ? (data as Parameters<typeof cardFromRow>[0][]) : [];
    if (rows.length === 0) break;
    const existing = new Set(memState.cards.map((c) => c.id));
    const fresh = rows.map(cardFromRow).filter((c) => !existing.has(c.id));
    for (const c of fresh) sourceOwnedCardIds.add(c.id);
    if (fresh.length > 0) {
      memState = { ...memState, cards: [...memState.cards, ...fresh] };
      requestStoreNotify();
    }
    loaded += fresh.length;
    offset += PAGE;
    if (rows.length < PAGE) break;
  }
  if (currentUserId === uid) await saveStudyStateCache(uid, memState);
}


export function useStudy() {
  const { user } = useAuth();
  const [, force] = useState(0);


  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    // If already hydrated when this component mounts, trigger an immediate render
    if (isHydrated) force((n) => n + 1);
    return () => { listeners.delete(fn); };
  }, []);

  useEffect(() => {
    const uid = user?.id ?? null;
    let cancelled = false;
    currentUserId = uid;
    if (sourceOverlayHydratedFor && sourceOverlayHydratedFor !== uid) {
      sourceOwnedCardIds.clear();
      sourceOwnedDeckIds.clear();
      sourceOwnedCategoryIds.clear();
      sourceOverlayHydratedFor = null;
      sourceOverlaySourceUserId = null;
    }
    if (!uid) {
      memState = emptyState();
      isHydrated = true;
      resetCategoryLazyState();
      loadedFor = null;
      notify();
      return;
    }
    // Avoid duplicate parallel hydrations for the same user.
    // If already hydrated, or currently hydrating this user, skip.
    if (loadedFor === uid && (isHydrated || hydrationInFlightFor === uid)) return;
    loadedFor = uid;
    hydrationInFlightFor = uid;
    if (uid === GUEST_ID) {
      const saved = localStorage.getItem(GUEST_STATE_KEY);
      // Last-known display settings — the authority for theme/tab/sidebar/UI
      // prefs regardless of which snapshot the study data comes from.
      const guestSettings = readGuestDisplaySettings();
      // Warm the shipped-library id sets so delete guards can answer instantly.
      primeBundledLibraryGuard();
      console.log("[guest-hydrate] boot", {
        hasLocalSnapshot: !!saved,
        localSnapshotKB: saved ? Math.round(saved.length / 1024) : 0,
        settingsRecord: guestSettings
          ? {
              tabConfig: guestSettings.tabConfig?.length ?? null,
              sidebarConfig: guestSettings.sidebarConfig?.length ?? null,
              widgetLayoutTabs: guestSettings.widgetLayout
                ? Object.keys(guestSettings.widgetLayout).length
                : null,
              at: guestSettings.at ? new Date(guestSettings.at).toISOString() : null,
            }
          : null,
      });
      if (saved) {
        try { memState = applyBidirectionalDedupeGuards(JSON.parse(saved) as StudyState); } catch { memState = emptyState(); }
      } else {
        memState = emptyState();
      }
      if (hasMeaningfulStudyData(memState) && !isStudyStateStructurallyUsable(memState)) {
        memState = clearStudyDataCollections(memState);
      }
      memState = applyGuestDisplaySettings(applyGuestProfileSeedOnce(memState), guestSettings);
      ensureCategoryLocalState(uid);
      // Mark roots loaded for any local-only seed data so UI shows it immediately.
      markCategoryParentLoadedNow(null);
      for (const cat of memState.categories ?? []) {
        if (!cat.parentId) continue;
        categoryHasChildrenHint.set(cat.parentId, true);
      }
      isHydrated = true;
      notify();
      // localStorage is only a fast bootstrap and is limited to a few MB. The
      // authoritative offline guest snapshot lives in IndexedDB, just like an
      // authenticated user's state. This keeps large card collections usable
      // across restarts with no network.
      void (async () => {
        try {
          const cached = await loadStudyStateCache(GUEST_ID);
          if (cancelled || currentUserId !== GUEST_ID) return;
          if (cached && hasMeaningfulStudyData(cached) && isStudyStateStructurallyUsable(cached)) {
            // IndexedDB is authoritative for the bulk study data (localStorage
            // is capped at a few MB and silently truncates large libraries), but
            // NOT for display settings: those are written synchronously on every
            // change while this cache only catches up on a ~2s debounce.
            // Re-applying stale settings here is what rolled back the user's
            // theme/tab/sidebar choice and made clicks land on the wrong tab.
            memState = applyGuestDisplaySettings(
              applyGuestProfileSeedOnce(applyBidirectionalDedupeGuards(cached)),
              guestSettings,
            );
            console.log("[guest-hydrate] adopted IndexedDB snapshot", {
              cards: memState.cards?.length ?? 0,
              decks: memState.decks?.length ?? 0,
              categories: memState.categories?.length ?? 0,
              tabConfig: memState.tabConfig?.length ?? 0,
            });
            ensureCategoryLocalState(uid);
            markCategoryParentLoadedNow(null);
            for (const cat of memState.categories ?? []) {
              if (cat.parentId) categoryHasChildrenHint.set(cat.parentId, true);
            }
            notify();
          }
          // Safety net for offline mode: if the guest state is still empty (e.g.
          // a local account that entered before the profile seed was loaded, or
          // an app that booted straight into guest mode without visiting the
          // login screen), apply the bundled library directly so the ~22k
          // questions are always present offline.
          if (!hasMeaningfulStudyData(memState)) {
            const seeded = await applyBundledLibraryToAuthenticatedState(memState);
            if (!cancelled && currentUserId === GUEST_ID && hasMeaningfulStudyData(seeded)) {
              memState = applyGuestDisplaySettings(applyBidirectionalDedupeGuards(seeded), guestSettings);
              ensureCategoryLocalState(uid);
              markCategoryParentLoadedNow(null);
              for (const cat of memState.categories ?? []) {
                if (cat.parentId) categoryHasChildrenHint.set(cat.parentId, true);
              }
              notify();
              await saveStudyStateCache(GUEST_ID, memState);
            }
          }
          if (typeof navigator === "undefined" || navigator.onLine) {
            await hydrateGuestFromCloud();
            await saveStudyStateCache(GUEST_ID, memState);
          }
        } catch (err) {
          console.warn("[guest] offline hydrate failed:", err);
        }
      })();
      return;
    }
    ensureCategoryLocalState(uid);
    isHydrated = false;
    notify();
    void (async () => {
      const hydrateTraceId = perf.createTraceId("hydrate");
      const restoreHydrateTrace = perf.pushTrace(hydrateTraceId);
      const stopHydrateTotal = perf.startTimer("store:hydrate(total)", "store", hydrateTraceId);

      try {
        perf.log("store:hydrate.start", `user=${uid}`, "store", hydrateTraceId);

        const isCurrentlyOffline = typeof navigator !== "undefined" && !navigator.onLine;
        // Never destroy a usable IndexedDB snapshot while there is no network
        // available to rebuild it.
        const needsHardReset = !isCurrentlyOffline && localStorage.getItem(BROWSER_CACHE_RESET_KEY) !== "1";
        if (needsHardReset) {
          const stopReset = perf.startTimer("store:hydrate.hard_reset", "store", hydrateTraceId);
          await clearLegacyBrowserCachesForUser(uid);
          stopReset();
          localStorage.setItem(BROWSER_CACHE_RESET_KEY, "1");
        }

        // Run listSyncJobs and loadStudyStateCache in parallel to avoid double IDB open cost.
        // Re-use an in-flight promise when StrictMode cancels & remounts to avoid double IDB reads.
        const stopJobs = perf.startTimer("store:hydrate.list_sync_jobs", "store", hydrateTraceId);
        const stopCacheLoad = perf.startTimer("store:hydrate.idb_load", "store", hydrateTraceId);
        if (idbHydrateForUser !== uid) {
          idbHydrateForUser = uid;
          idbHydratePromise = Promise.all([
            listSyncJobs(uid),
            listPendingDeletes(uid),
            needsHardReset ? Promise.resolve(null) : loadStudyStateCache(uid),
          ]);
        }
        const [existingJobs, pendingDeletes, cachedState] = await idbHydratePromise!;
        // Keep in-memory anti-resurrection guards aligned with the durable queue.
        // If a deck/card delete is still pending, hide it locally until cloud tombstone succeeds.
        deletedDeckIds.clear();
        deletedCardIds.clear();
        for (const job of pendingDeletes) {
          if (job.table === "decks") deletedDeckIds.add(job.rowId);
          if (job.table === "cards") deletedCardIds.add(job.rowId);
        }
        stopJobs(`${existingJobs.length} jobs`);
        stopCacheLoad(cachedState ? "hit" : "miss");
        if (!cancelled) markCloudSyncJobs(existingJobs.length);
        if (cancelled) return;

        let hasCache = false;
        if (!needsHardReset && cachedState) {
          // Apply deprecation filters eagerly so stale IDB cards never flash on screen.
          memState = applyBidirectionalDedupeGuards(cachedState);
          // Overlay widget layout: prefer the freshest between dedicated IDB store (immediate write),
          // localStorage (synchronous write), and the IDB state snapshot (2s debounce).
          // Dedicated IDB store wins over localStorage if its timestamp is newer.
          const localWidgetCache = readWidgetLayoutCache(uid);
          const idbWidgetCache = await readWidgetLayoutIdb(uid);
          const lsTs = localWidgetCache?.updatedAt ?? 0;
          const idbDedicatedTs = idbWidgetCache?.updatedAt ?? 0;
          if (idbDedicatedTs > lsTs && idbWidgetCache?.layout) {
            memState = { ...memState, widgetLayout: idbWidgetCache.layout };
          } else if (localWidgetCache?.layout) {
            memState = { ...memState, widgetLayout: localWidgetCache.layout };
          }
          if (typeof cachedState.uiPrefs?.syncEnabled === "boolean") applyCloudSyncPref(cachedState.uiPrefs.syncEnabled);
          isHydrated = true;
          hasCache = true;
          performance.mark("pashash:notify:idb-cache-applied");
          // Defer React re-render to a new task so hydration never blocks open interactions.
          setTimeout(() => {
            notify();
            performance.measure("pashash:react-render:idb-cache", "pashash:notify:idb-cache-applied");
          }, 0);
          perf.log("store:hydrate.cache_applied", "indexeddb snapshot applied", "store", hydrateTraceId);
          // Source overlay: fetch in parallel with cloud refresh.
          void hydrateSourceOverlayForAuthUser(uid).catch((e) => console.warn("[source-overlay]", e));
        }

        if (isCurrentlyOffline) {
          memState = await applyBundledLibraryToAuthenticatedState(memState);
          isHydrated = true;
          await saveStudyStateCache(uid, memState);
          notify();
          perf.log("store:hydrate.done", "offline cache + bundled library applied", "store", hydrateTraceId);
          return;
        }

        if (hasCache) {
          const lastCloudAt = Number(localStorage.getItem(LAST_CLOUD_BOOTSTRAP_AT_KEY(uid)) ?? "0");
          const shouldRefreshCloud = !Number.isFinite(lastCloudAt)
            || (Date.now() - lastCloudAt) > CLOUD_REFRESH_INTERVAL_MS;
          const knownCloudCardsTotal = getLastKnownCloudCardsCount(uid);
          const knownCloudDecksTotal = getLastKnownCloudDecksCount(uid);
          const knownCloudCategoriesTotal = getLastKnownCloudCategoriesCount(uid);
          const shouldCheckCardGap = knownCloudCardsTotal <= 0
            || (cachedState.cards.length !== knownCloudCardsTotal);
          const shouldCheckDeckGap = knownCloudDecksTotal <= 0
            || (cachedState.decks.length !== knownCloudDecksTotal);
          const shouldCheckCategoryGap = knownCloudCategoriesTotal <= 0
            || (cachedState.categories.length !== knownCloudCategoriesTotal);
          const shouldCheckStructuralGap = shouldCheckCardGap || shouldCheckDeckGap || shouldCheckCategoryGap;

          // Never block cloud->IDB pull: stale local caches cause larger correctness
          // issues than in-flight delete propagation. Tombstones resolve deletes safely.
          if (shouldRefreshCloud || shouldCheckStructuralGap) {
            window.setTimeout(() => {
              if (cancelled) return;
              void (async () => {
              const bgTraceId = perf.createTraceId("hydrate-bg");
              const restoreBgTrace = perf.pushTrace(bgTraceId);
              const stopBg = perf.startTimer("store:hydrate.bg_cloud_refresh", "store", bgTraceId);
              try {
                // Smart cache strategy:
                //   - cache age < FULL_REFRESH_TTL_MS  → DELTA sync (only changed rows)
                //   - cache age ≥ FULL_REFRESH_TTL_MS  → FULL reload (catches deletions)
                const lastFullSyncAt = Number(localStorage.getItem(LAST_FULL_SYNC_AT_KEY(uid)) ?? "0");
                const lastDeltaAnchorAt = Number(localStorage.getItem(LAST_CLOUD_BOOTSTRAP_AT_KEY(uid)) ?? "0");
                const fullAge = Number.isFinite(lastFullSyncAt) && lastFullSyncAt > 0
                  ? Date.now() - lastFullSyncAt
                  : Number.POSITIVE_INFINITY;
                const useDelta = fullAge < getFullRefreshTtlMs() && lastDeltaAnchorAt > 0;

                if (useDelta) {
                  const stopDelta = perf.startTimer("store:hydrate.delta_sync", "store", bgTraceId);
                  const delta = await loadDelta(uid, lastDeltaAnchorAt);
                  stopDelta();
                  if (cancelled) return;
                  const mergedDelta = applyDeltaToState(memState, delta);
                  const normalizedDelta = applyBidirectionalDedupeGuards(mergedDelta);
                  const cloudCardGap = delta.cloudCardsTotalCount > 0 && normalizedDelta.cards.length !== delta.cloudCardsTotalCount;
                  const cloudDeckGap = normalizedDelta.decks.length !== delta.cloudDecksTotalCount;
                  const cloudCategoryGap = normalizedDelta.categories.length !== delta.cloudCategoriesActiveTotalCount;
                  if (cloudCardGap || cloudDeckGap || cloudCategoryGap) {
                    phase2TotalCount = delta.cloudCardsTotalCount;
                    phase2BackfillNeeded = normalizedDelta.cards.length < delta.cloudCardsTotalCount;
                    const cloudBg = await loadAll(uid);
                    if (cancelled) return;
                    const mergedFull = mergeStudyStateLww(normalizedDelta, cloudBg, true);
                    const localWlCacheFull = readWidgetLayoutCache(uid);
                    const storedCloudTsFull = Number(localStorage.getItem(WIDGET_LAYOUT_CLOUD_TS_KEY(uid)) ?? "0");
                    const useLocalFull = localWlCacheFull?.layout && (localWlCacheFull.updatedAt ?? 0) > storedCloudTsFull;
                    memState = useLocalFull ? { ...mergedFull, widgetLayout: localWlCacheFull.layout } : mergedFull;
                    if (typeof mergedFull.uiPrefs?.syncEnabled === "boolean") applyCloudSyncPref(mergedFull.uiPrefs.syncEnabled);
                    await new Promise<void>((resolve) => setTimeout(resolve, 0));
                    performance.mark("pashash:notify:bg-gap-refresh");
                    requestStoreNotify();
                    performance.measure("pashash:react-render:bg-gap-refresh", "pashash:notify:bg-gap-refresh");
                    window.setTimeout(() => {
                      void saveStudyStateCache(uid, mergedFull);
                    }, 0);
                    const now = Date.now();
                    localStorage.setItem(LAST_CLOUD_BOOTSTRAP_AT_KEY(uid), String(now));
                    localStorage.setItem(LAST_FULL_SYNC_AT_KEY(uid), String(now));
                    void runPhase2CardBackfill(uid);
                    return;
                  }
                  const localWlCacheDelta = readWidgetLayoutCache(uid);
                  const storedCloudTsDelta = Number(localStorage.getItem(WIDGET_LAYOUT_CLOUD_TS_KEY(uid)) ?? "0");
                  const useLocalDelta = localWlCacheDelta?.layout && (localWlCacheDelta.updatedAt ?? 0) > storedCloudTsDelta;
                  const mergedDeltaWithLayout = useLocalDelta ? { ...normalizedDelta, widgetLayout: localWlCacheDelta.layout } : normalizedDelta;
                  const changed = mergedDeltaWithLayout !== memState;
                  memState = mergedDeltaWithLayout;
                  if (typeof normalizedDelta.uiPrefs?.syncEnabled === "boolean") applyCloudSyncPref(normalizedDelta.uiPrefs.syncEnabled);
                  if (changed) {
                    await new Promise<void>((resolve) => setTimeout(resolve, 0));
                    performance.mark("pashash:notify:bg-delta");
                    requestStoreNotify();
                    performance.measure("pashash:react-render:bg-delta", "pashash:notify:bg-delta");
                    // Persist in background; do not block interaction thread on IDB write.
                    window.setTimeout(() => {
                      void saveStudyStateCache(uid, normalizedDelta);
                    }, 0);
                  }
                  localStorage.setItem(LAST_CLOUD_BOOTSTRAP_AT_KEY(uid), String(Date.now()));
                  // Phase 2 still runs only if it's still pending (rare on cached visits).
                  void runPhase2CardBackfill(uid);
                } else {
                  const cloudBg = await loadAll(uid);
                  if (cancelled) return;
                  const mergedBg = mergeStudyStateLww(memState, cloudBg, true);
                  const localWlCacheBg = readWidgetLayoutCache(uid);
                  const storedCloudTsBg = Number(localStorage.getItem(WIDGET_LAYOUT_CLOUD_TS_KEY(uid)) ?? "0");
                  const useLocalBg = localWlCacheBg?.layout && (localWlCacheBg.updatedAt ?? 0) > storedCloudTsBg;
                  memState = useLocalBg ? { ...mergedBg, widgetLayout: localWlCacheBg.layout } : mergedBg;
                  if (typeof mergedBg.uiPrefs?.syncEnabled === "boolean") applyCloudSyncPref(mergedBg.uiPrefs.syncEnabled);
                  await new Promise<void>((resolve) => setTimeout(resolve, 0));
                  performance.mark("pashash:notify:bg-refresh");
                  requestStoreNotify();
                  performance.measure("pashash:react-render:bg-refresh", "pashash:notify:bg-refresh");
                  // Persist in background; avoid a long task right after refresh render.
                  window.setTimeout(() => {
                    void saveStudyStateCache(uid, mergedBg);
                  }, 0);
                  const now = Date.now();
                  localStorage.setItem(LAST_CLOUD_BOOTSTRAP_AT_KEY(uid), String(now));
                  localStorage.setItem(LAST_FULL_SYNC_AT_KEY(uid), String(now));
                  void runPhase2CardBackfill(uid);
                }
              } catch (e) {
                console.error("[load:bg_refresh]", e);
              } finally {
                stopBg();
                restoreBgTrace();
              }
              })();
            }, BG_CLOUD_REFRESH_DELAY_MS);
          }

          // Defer queue flushes until first interaction (or delayed fallback)
          // so startup remains network-light.
          if (existingJobs.length > 0) {
            const cancelDeferredSync = runAfterFirstInteractionOrDelay(() => {
              if (cancelled) return;
              if (typeof navigator !== "undefined" && !navigator.onLine) return;
              runWhenBrowserIdle(() => {
                void runPendingCloudSync(uid);
              }, 4000);
            }, 15_000);
            if (cancelled) cancelDeferredSync();
          } else {
            perf.log("store:hydrate.sync_skipped", "0 jobs, skipping runPendingCloudSync", "store", hydrateTraceId);
          }

          const cancelDeferredDeletes = runAfterFirstInteractionOrDelay(() => {
            if (cancelled) return;
            if (typeof navigator !== "undefined" && !navigator.onLine) return;
            runWhenBrowserIdle(() => {
              void flushPendingDeletes(uid);
            }, 4000);
          }, 20_000);
          if (cancelled) cancelDeferredDeletes();

          perf.log("store:hydrate.done", "indexeddb-first completed", "store", hydrateTraceId);
          return;
        }

        const stopCloud = perf.startTimer("store:hydrate.cloud_load", "store", hydrateTraceId);
        const cloud = await loadAll(uid);
        stopCloud();
        if (cancelled) return;

        const stopMerge = perf.startTimer("store:hydrate.merge_lww", "store", hydrateTraceId);
        const merged = mergeStudyStateLww(memState, cloud, true);
        stopMerge();

        memState = merged;
        if (typeof merged.uiPrefs?.syncEnabled === "boolean") applyCloudSyncPref(merged.uiPrefs.syncEnabled);
        isHydrated = true;

        // Yield before notify so React render runs in its own macrotask (avoids 69ms block on LCP).
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        performance.mark("pashash:notify:cloud-merge");
        notify();
        performance.measure("pashash:react-render:cloud-merge", "pashash:notify:cloud-merge");

        const coldNow = Date.now();
        localStorage.setItem(LAST_CLOUD_BOOTSTRAP_AT_KEY(uid), String(coldNow));
        localStorage.setItem(LAST_FULL_SYNC_AT_KEY(uid), String(coldNow));

        // Skip the IDB write when Phase 2 will immediately overwrite it with all cards.
        // Caching an empty/near-empty state here causes the "missing cards on refresh" bug:
        // if the user reloads before Phase 2 finishes (~4s), IDB would have 0 cards
        // and the problem would repeat on every visit until Phase 2 completes uninterrupted.
        const willPhase2Run = phase2BackfillNeeded && phase2TotalCount > 0 && merged.cards.length < phase2TotalCount;
        if (!willPhase2Run) {
          // Yield again before expensive IDB write so it doesn't share a task with the render.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          const stopCacheSave = perf.startTimer("store:hydrate.idb_save", "store", hydrateTraceId);
          await saveStudyStateCache(uid, merged);
          stopCacheSave();
        }

        // Phase 2: silently backfill unreviewed cards in the background.
        void runPhase2CardBackfill(uid);

        // Source overlay: read-only cards/categories pulled from configured source user.
        void hydrateSourceOverlayForAuthUser(uid).catch((e) => console.warn("[source-overlay]", e));


        perf.log("store:hydrate.done", "hydrate pipeline completed", "store", hydrateTraceId);
      } finally {
        if (hydrationInFlightFor === uid) hydrationInFlightFor = null;
        stopHydrateTotal();
        restoreHydrateTrace();
      }
    })().catch((e) => {
      console.error("[load]", e);
      perf.error("store:hydrate.failed", e instanceof Error ? e.message : String(e));
      if (!cancelled) {
        isHydrated = true;
        notify();
      }
    });

    return () => {
      cancelled = true;
      // If hydration was cancelled before completing (e.g. React StrictMode double-mount),
      // reset loadedFor so the next mount will retry instead of skipping silently.
      if (!isHydrated && loadedFor === uid) {
        loadedFor = null;
      }
    };
  }, [user?.id]);

  useEffect(() => {
    const uid = user?.id ?? null;
    if (!uid) return;
    const onOnline = () => {
      if (uid === GUEST_ID) {
        void reconcileOfflineQuestions(memState.cards.filter((card) => !isSourceOwnedCard(card.id)))
          .catch((err) => console.warn("[offline-questions] reconnect upload failed:", err));
        void hydrateGuestFromCloud()
          .then(() => saveStudyStateCache(GUEST_ID, memState))
          .catch((err) => console.warn("[guest] reconnect refresh failed:", err));
        return;
      }
      void runPendingCloudSync(uid);
      void flushPendingDeletes(uid);
      void hydrateSourceOverlayForAuthUser(uid)
        .then(() => saveStudyStateCache(uid, memState))
        .catch((error) => console.warn("[source-overlay] reconnect refresh failed", error));
    };
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
    };
  }, [user?.id]);

  // Upload local/guest questions after hydration. This also recovers questions
  // created by installations that predate the durable offline outbox.
  useEffect(() => {
    if (user?.id !== GUEST_ID || !isHydrated) return;
    const timer = window.setTimeout(() => {
      void reconcileOfflineQuestions(memState.cards.filter((card) => !isSourceOwnedCard(card.id)))
        .catch((err) => console.warn("[offline-questions] initial upload failed:", err));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [user?.id, memState.cards]);

  // One-time migration: rename legacy "ללא סיווג" → current UNCATEGORIZED_NAME
  useEffect(() => {
    const OLD = "ללא סיווג";
    if ((UNCATEGORIZED_NAME as string) === OLD) return;
    const uid = user?.id ?? null;
    if (!uid) return;
    const old = (memState.categories ?? []).find((c) => c.parentId === null && c.name === OLD);
    if (!old) return;
    setState((s) => ({
      ...s,
      categories: (s.categories ?? []).map((c) => c.id === old.id ? { ...c, name: UNCATEGORIZED_NAME } : c),
    }));
    bg(supabase.from("categories").update({ name: UNCATEGORIZED_NAME }).eq("id", old.id), "categories.migrate.rename");
  }, [memState.categories, user?.id]);

  const state = memState;
  const getHydrationSnapshot = useCallback(() => ({
    isHydrated,
    // Cards are "fully loaded" when no Phase 2 backfill is pending/in-flight.
    // True initially (warm boot from IDB before bootstrap → assume loaded);
    // becomes false once bootstrap detects unreviewed cards still needed;
    // becomes true again after Phase 2 completes.
    cardsFullyLoaded: !phase2BackfillNeeded && !phase2BackfillInFlight,
  }), []);
  const getCloudSyncSnapshot = useCallback(() => ({
    pendingJobs: cloudSyncPendingJobs,
    inFlight: cloudSyncInFlight,
  }), []);
  const getRecordSyncStatus = useCallback((_entity: string, _id: string) => {
    if (cloudSyncInFlight) return "syncing" as const;
    return cloudSyncPendingJobs > 0 ? "pending" as const : "synced" as const;
  }, []);

  const isCategoryChildrenLoaded = useCallback((parentId: string | null) => {
    return isCategoryParentCacheFresh(parentId);
  }, []);

  const isCategoryChildrenLoading = useCallback((parentId: string | null) => {
    return loadingCategoryParents.has(parentCacheKey(parentId));
  }, []);

  const getCategoryHasChildren = useCallback((categoryId: string) => {
    return categoryHasChildrenHint.get(categoryId);
  }, []);

  const loadCategoryChildren = useCallback(async (
    parentId: string | null,
    options?: { force?: boolean; prefetch?: boolean; reason?: "initial" | "user" | "prefetch" },
  ) => {
    const force = options?.force ?? false;
    // Strict lazy-load mode: never prefetch additional branches.
    const prefetch = false;
    const reason = options?.reason ?? "user";
    const userId = requireUser();
    ensureCategoryLocalState(userId);
    const key = parentCacheKey(parentId);

    const applyRows = (loadedRows: CategoryChildRow[], silent = false) => {
      const localChildrenCount = (memState.categories ?? []).filter((c) => c.parentId === parentId).length;
      // Guard: during restore/sync lag, server may temporarily return empty while local state already has rows.
      // Avoid wiping optimistic local categories in that case.
      if (loadedRows.length === 0 && localChildrenCount > 0) {
        markCategoryParentLoadedNow(parentId);
        if (parentId !== null) categoryHasChildrenHint.set(parentId, true);
        return localChildrenCount;
      }

      const loaded = loadedRows.map((c) => ({
        id: c.id,
        name: c.name,
        parentId: c.parent_id,
        color: c.color ?? undefined,
        createdAt: new Date(c.created_at).getTime(),
        sortOrder: c.sort_order ?? 0,
      })) as Category[];

      if (silent) {
        // Update memState directly — caller will fire a single deferred notify().
        const byId = new Map<string, Category>();
        for (const cat of memState.categories ?? []) {
          if (cat.parentId === parentId) continue;
          byId.set(cat.id, cat);
        }
        for (const cat of loaded) byId.set(cat.id, cat);
        memState = { ...memState, categories: [...byId.values()] };
        scheduleStateCachePersist();
      } else {
        setState((s) => {
          const byId = new Map<string, Category>();
          for (const cat of s.categories ?? []) {
            if (cat.parentId === parentId) continue;
            byId.set(cat.id, cat);
          }
          for (const cat of loaded) byId.set(cat.id, cat);
          return { ...s, categories: [...byId.values()] };
        });
      }

      markCategoryParentLoadedNow(parentId);
      if (parentId !== null) categoryHasChildrenHint.set(parentId, loaded.length > 0);
      for (const row of loadedRows) categoryHasChildrenHint.set(row.id, !!row.has_children);

      return loaded.length;
    };

    if (!force && isCategoryParentCacheFresh(parentId)) {
      categoryCacheHits += 1;
      if (reason === "user" && parentId) {
        categoryPrefetchScore.set(parentId, (categoryPrefetchScore.get(parentId) ?? 0) + 1);
        saveCategoryPrefetchScores(userId);
      }
      return 0;
    }

    if (!force) {
      const persisted = categoryPersistedCacheByParent.get(key);
      if (persisted && Date.now() - persisted.ts < CATEGORY_CACHE_TTL_MS) {
        categoryCacheHits += 1;
        categoryPersistedHits += 1;
        const count = applyRows(persisted.rows);
        if (reason === "user" && parentId) {
          categoryPrefetchScore.set(parentId, (categoryPrefetchScore.get(parentId) ?? 0) + 1);
          saveCategoryPrefetchScores(userId);
        }
        return count;
      }
    }

    if (reason === "prefetch") {
      const now = Date.now();
      const tooSoon = now - categoryPrefetchLastStartMs < CATEGORY_PREFETCH_MIN_GAP_MS;
      const tooManyInFlight = categoryPrefetchInFlight >= CATEGORY_PREFETCH_MAX_IN_FLIGHT;
      if (tooSoon || tooManyInFlight) {
        categoryPrefetchThrottled += 1;
        return 0;
      }
      categoryPrefetchLastStartMs = now;
      categoryPrefetchInFlight += 1;
    }

    categoryCacheMisses += 1;

    const seq = (categoryRequestSeqByParent.get(key) ?? 0) + 1;
    categoryRequestSeqByParent.set(key, seq);

    const previous = categoryAbortControllersByParent.get(key);
    if (previous) {
      previous.abort();
      categoryAbortedRequests += 1;
    }
    const controller = new AbortController();
    categoryAbortControllersByParent.set(key, controller);

    const hadInFlightBefore = loadingCategoryParents.size > 0;
    loadingCategoryParents.add(key);
    // Notify only on idle->busy transition to avoid transition storms during rapid navigation.
    if (!hadInFlightBefore) {
      requestStoreNotify();
    }
    try {
      const startedAt = performance.now();
      let loadedRows: CategoryChildRow[] = [];
      try {
        loadedRows = await fetchCategoryChildrenRpc(parentId, controller.signal);
      } catch (error) {
        if (isAbortError(error)) return 0;
        console.error("[categories.loadChildren]", error);
        return 0;
      }

      // Ignore stale response if a newer request for the same parent exists.
      if ((categoryRequestSeqByParent.get(key) ?? 0) !== seq) {
        categoryStaleDropped += 1;
        return 0;
      }

      // silent=true: skip notify() inside applyRows; a single deferred notify fires in finally.
      const loadedCount = applyRows(loadedRows, true);

      categoryPersistedCacheByParent.set(key, { ts: Date.now(), rows: loadedRows });
      saveCategoryPersistedCache(userId);

      if (reason === "user" && parentId) {
        categoryPrefetchScore.set(parentId, (categoryPrefetchScore.get(parentId) ?? 0) + 1);
        saveCategoryPrefetchScores(userId);
      }

      if (prefetch) {
        const warm = loadedRows
          .filter((r) => r.has_children)
          .sort((a, b) => (categoryPrefetchScore.get(b.id) ?? 0) - (categoryPrefetchScore.get(a.id) ?? 0))
          .slice(0, 3);
        for (const row of warm) {
          if (isCategoryParentCacheFresh(row.id)) continue;
          if (loadingCategoryParents.has(parentCacheKey(row.id))) continue;
          void loadCategoryChildren(row.id, { prefetch: false, reason: "prefetch" });
        }
      }

      const elapsed = Math.round(performance.now() - startedAt);
      pushCategoryLoadDuration(elapsed);
      perf.record("db:categories.children", "db", elapsed, `parent=${parentId ?? "root"} rows=${loadedRows.length}`);

      return loadedCount;
    } finally {
      if (reason === "prefetch") {
        categoryPrefetchInFlight = Math.max(0, categoryPrefetchInFlight - 1);
      }
      if (categoryAbortControllersByParent.get(key) === controller) {
        categoryAbortControllersByParent.delete(key);
        loadingCategoryParents.delete(key);
        // Notify only when queue becomes empty (busy->idle), coalescing multiple child loads.
        if (loadingCategoryParents.size === 0) {
          // Coalesced transition notification reduces bursty updates when many child loads finish together.
          requestStoreNotify();
        }
      }
    }
  }, []);

  const requireUser = () => {
    if (!currentUserId) throw new Error("נדרשת התחברות");
    return currentUserId;
  };

  /** Ensure the singleton uncategorized root category exists. Returns its id. */
  const ensureUncategorized = useCallback((): string => {
    // Migrate old name "ללא סיווג" → current UNCATEGORIZED_NAME
    const oldName = "ללא סיווג";
    if ((UNCATEGORIZED_NAME as string) !== oldName) {
      const old = (memState.categories ?? []).find((c) => c.parentId === null && c.name === oldName);
      if (old) {
        setState((s) => ({
          ...s,
          categories: (s.categories ?? []).map((c) => c.id === old.id ? { ...c, name: UNCATEGORIZED_NAME } : c),
        }));
        bg(supabase.from("categories").update({ name: UNCATEGORIZED_NAME }).eq("id", old.id), "categories.rename.uncategorized");
        return old.id;
      }
    }
    const existing = findUncategorized(memState.categories);
    if (existing) return existing.id;
    const userId = requireUser();
    const cat: Category = { id: uid(), name: UNCATEGORIZED_NAME, parentId: null, createdAt: Date.now() };
    setState((s) => ({ ...s, categories: [...(s.categories ?? []), cat] }));
    const promise: Promise<{ error: unknown }> = Promise.resolve(
      supabase.from("categories").insert({ id: cat.id, user_id: userId, name: cat.name, parent_id: null }),
    ).then((r) => r as unknown as { error: unknown });
    categoryInsertPromises.set(cat.id, promise);
    bg(promise, "categories.insert.uncategorized");
    return cat.id;
  }, []);

  const addDeck = useCallback((name: string, description?: string, categoryNames?: string[]) => {
    const userId = requireUser();
    // Enforce: every deck must have ≥1 category. If none provided → auto-include "ללא סיווג".
    let cats = Array.isArray(categoryNames) ? categoryNames.slice() : [];
    if (cats.length === 0) {
      ensureUncategorized();
      cats = [UNCATEGORIZED_NAME];
    }
    const deck: Deck = { id: uid(), name, description, color: "gold", createdAt: Date.now(), categoryIds: [], includeSubCategories: true };
    const profileBActive = isProfileBMode();
    setState((s) => {
      const nextDC = { ...(s.deckCategories ?? {}), [deck.id]: cats };
      writeDeckCategoriesCache(userId, nextDC);
      return { ...s, decks: [...s.decks, deck], deckCategories: nextDC };
    });
    if (profileBActive) markProfileBDeckCreated(userId, deck.id);
    bg(supabase.from("decks").insert({ id: deck.id, user_id: userId, name, description: description ?? null, color: "gold", category_ids: [], include_sub_categories: true } as never), "decks.insert");
    return deck;
  }, [ensureUncategorized]);

  const setDeckCategories = useCallback((deckId: string, categoryNames: string[]) => {
    const userId = requireUser();
    setState((s) => {
      const nextDC = { ...(s.deckCategories ?? {}), [deckId]: categoryNames.slice() };
      writeDeckCategoriesCache(userId, nextDC);
      return { ...s, deckCategories: nextDC };
    });
  }, []);

  /** Update which category IDs a deck collects cards from (new architecture) */
  const updateDeckCategoryIds = useCallback((deckId: string, categoryIds: string[], includeSubCategories: boolean) => {
    requireUser();
    setState((s) => ({
      ...s,
      decks: s.decks.map((d) =>
        d.id === deckId ? { ...d, categoryIds, includeSubCategories } : d,
      ),
    }));
    bg(supabase.from("decks").update({ category_ids: categoryIds, include_sub_categories: includeSubCategories } as never).eq("id", deckId), "decks.updateCategoryIds");
  }, []);

  /** Rename a deck */
  const renameDeck = useCallback((deckId: string, name: string) => {
    requireUser();
    const trimmed = name.trim();
    if (!trimmed) return;
    setState((s) => ({
      ...s,
      decks: s.decks.map((d) => (d.id === deckId ? { ...d, name: trimmed } : d)),
    }));
    bg(supabase.from("decks").update({ name: trimmed }).eq("id", deckId), "decks.rename");
  }, []);

  const deleteDeck = useCallback((id: string) => {
    const userId = currentUserId;
    if (isProfileBMode() && userId && !canProfileBDeleteDeck(userId, id)) {
      toast({
        title: "מחיקה חסומה בפרופיל B",
        description: "ניתן למחוק רק ערכות שנוצרו על ידך בפרופיל B.",
        variant: "destructive",
      });
      return;
    }
    if (currentUserId === GUEST_ID && isBundledLibraryItem("deck", id)) {
      toast({ ...PROTECTED_DELETE_MESSAGE, variant: "destructive" });
      return;
    }
    // Mark as deleted before touching state so that any in-flight sync that
    // completes right after cannot resurrect the deck via mergeByKeyLww.
    deletedDeckIds.add(id);
    setState((s) => {
      const nextDC = { ...(s.deckCategories ?? {}) };
      delete nextDC[id];
      if (userId) writeDeckCategoriesCache(userId, nextDC);
      return {
        ...s,
        decks: s.decks.filter((d) => d.id !== id),
        // Remove all card–deck associations for this deck from local state.
        cardDecks: (s.cardDecks ?? []).filter((cd) => cd.deckId !== id),
        // Cards are NOT deleted — they remain as category-owned cards (deckId becomes null)
        cards: s.cards.map((c) => c.deckId === id ? { ...c, deckId: null } as Card : c),
        deckCategories: nextDC,
      };
    });
    // Durable tombstone propagation for deck deletion.
    softDeleteWithQueue("decks", [id]);
    // Also detach relationships (best-effort) so cards remain category-owned.
    const nowIso = new Date().toISOString();
    bg(supabase.from("card_decks").delete().eq("deck_id", id), "card_decks.deleteByDeck");
    bg(
      supabase
        .from("cards")
        .update({ deck_id: null, updated_at: nowIso } as never)
        .eq("deck_id", id)
        .is("deleted_at", null),
      "cards.detachDeck",
    );
  }, []);

  const addCard = useCallback((card: Omit<Card, "id" | "createdAt" | "srs" | "stats">) => {
    const userId = requireUser();
    const questionKey = normalizeQuestionKey(card.question);
    const existing = memState.cards.find((c) => normalizeQuestionKey(c.question) === questionKey);
    if (existing) return existing;
    // Enforce: every card must have ≥1 cat: tag. If none → auto-tag "ללא סיווג".
    const tags = withClientSource(Array.isArray(card.tags) ? card.tags : []);
    if (!tags.some((t) => t.startsWith("cat:"))) {
      ensureUncategorized();
      tags.push(UNCATEGORIZED_TAG);
    }
    const full = {
      ...card, tags, id: uid(), createdAt: Date.now(),
      srs: defaultSrs(), stats: { totalReviews: 0, correct: 0, incorrect: 0 },
    } as Card;
    const profileBActive = isProfileBMode();
    setState((s) => ({ ...s, cards: [...s.cards, full] }));
    if (profileBActive) markProfileBCardCreated(userId, full.id);
    if (userId === GUEST_ID) {
      // Guest/local questions have their own durable outbox. Never send them
      // through the regular cloud writer: that path has no authenticated owner
      // and older builds could accidentally associate them with the bundled
      // library owner, making them disappear from admin moderation.
      enqueueOfflineQuestion(full);
    } else {
      bg(supabase.from("cards").insert(cardToRow(full, userId)));
    }
    // Only mirror into card_decks if the card has a deck
    if (full.deckId && userId !== GUEST_ID) {
      bg(supabase.from("card_decks").insert({
        card_id: full.id, deck_id: full.deckId, user_id: userId, sort_order: 0,
      }), "card_decks.insert");
      setState((s) => ({
        ...s,
        cardDecks: [...(s.cardDecks ?? []), { cardId: full.id, deckId: full.deckId!, sortOrder: 0 }],
      }));
    }
    return full;
  }, [ensureUncategorized]);

  /**
   * Bulk add many cards in one shot.
   * - ONE setState (replaces N re-renders)
   * - Chunked supabase inserts (500/chunk) for cards + card_decks
   * Used by the interactive restore flow to be 50–100× faster than per-card adds.
   */
  const bulkAddCards = useCallback((
    cards: Array<Omit<Card, "id" | "createdAt" | "srs" | "stats">>,
  ): Card[] => {
    const userId = requireUser();
    if (!cards.length) return [];
    const existingQuestionKeys = new Set(memState.cards.map((c) => normalizeQuestionKey(c.question)));
    const seenInBatch = new Set<string>();
    const filteredInput = cards.filter((card) => {
      const key = normalizeQuestionKey(card.question);
      if (!key) return false;
      if (existingQuestionKeys.has(key) || seenInBatch.has(key)) return false;
      seenInBatch.add(key);
      return true;
    });
    if (!filteredInput.length) return [];
    ensureUncategorized();
    const now = Date.now();
    const full: Card[] = filteredInput.map((card) => {
      const tags = withClientSource(Array.isArray(card.tags) ? card.tags : []);
      if (!tags.some((t) => t.startsWith("cat:"))) tags.push(UNCATEGORIZED_TAG);
      return {
        ...card, tags, id: uid(), createdAt: now,
        srs: defaultSrs(), stats: { totalReviews: 0, correct: 0, incorrect: 0 },
      } as Card;
    });
    const profileBActive = isProfileBMode();
    if (profileBActive) {
      for (const created of full) markProfileBCardCreated(userId, created.id);
    }
    if (userId === GUEST_ID) {
      for (const created of full) enqueueOfflineQuestion(created);
    }
    const links = full
      .filter((c) => c.deckId)
      .map((c) => ({ cardId: c.id, deckId: c.deckId!, sortOrder: 0 }));
    setState((s) => ({
      ...s,
      cards: [...s.cards, ...full],
      cardDecks: [...(s.cardDecks ?? []), ...links],
    }));
    if (userId !== GUEST_ID) {
      for (const part of chunk(full, 500)) {
        bg(supabase.from("cards").insert(part.map((c) => cardToRow(c, userId))), "cards.bulkInsert");
      }
    }
    if (links.length && userId !== GUEST_ID) {
      const cdRows = links.map((l) => ({
        card_id: l.cardId, deck_id: l.deckId, user_id: userId, sort_order: 0,
      }));
      for (const part of chunk(cdRows, 500)) {
        bg(supabase.from("card_decks").insert(part), "card_decks.bulkInsert");
      }
    }
    return full;
  }, [ensureUncategorized]);

  /**
   * Bulk add many decks in one shot. ONE setState + chunked cloud inserts.
   */
  const bulkAddDecks = useCallback((
    decks: Array<{ name: string; description?: string }>,
  ): Deck[] => {
    const userId = requireUser();
    if (!decks.length) return [];
    ensureUncategorized();
    const now = Date.now();
    const created: Deck[] = decks.map((d) => ({
      id: uid(), name: d.name, description: d.description, color: "gold",
      createdAt: now, categoryIds: [], includeSubCategories: true,
    }));
    const profileBActive = isProfileBMode();
    if (profileBActive) {
      for (const deck of created) markProfileBDeckCreated(userId, deck.id);
    }
    setState((s) => {
      const nextDC = { ...(s.deckCategories ?? {}) };
      for (const d of created) nextDC[d.id] = [UNCATEGORIZED_NAME];
      writeDeckCategoriesCache(userId, nextDC);
      return { ...s, decks: [...s.decks, ...created], deckCategories: nextDC };
    });
    const rows = created.map((d) => ({
      id: d.id, user_id: userId, name: d.name, description: d.description ?? null,
      color: "gold", category_ids: [], include_sub_categories: true,
    }));
    for (const part of chunk(rows, 500)) {
      bg(supabase.from("decks").insert(part as never), "decks.bulkInsert");
    }
    return created;
  }, [ensureUncategorized]);

  const updateCard = useCallback((id: string, patch: Partial<Card>) => {
    const userId = requireUser();
    let updated: Card | undefined;
    setState((s) => ({
      ...s,
      cards: s.cards.map((c) => {
        if (c.id !== id) return c;
        updated = { ...c, ...patch } as Card;
        return updated;
      }),
    }));
    if (updated) bg(supabase.from("cards").update(cardToRow(updated, userId)).eq("id", id));
  }, []);

  const duplicateCard = useCallback((id: string, targetDeckId?: string) => {
    const userId = requireUser();
    const profileBActive = isProfileBMode();
    let copy: Card | undefined;
    setState((s) => {
      const orig = s.cards.find((c) => c.id === id);
      if (!orig) return s;
      const questionKey = normalizeQuestionKey(orig.question);
      const duplicateExists = s.cards.some((c) => c.id !== id && normalizeQuestionKey(c.question) === questionKey);
      if (duplicateExists) return s;
      copy = {
        ...orig, id: uid(), deckId: targetDeckId ?? orig.deckId,
        createdAt: Date.now(), srs: defaultSrs(),
        stats: { totalReviews: 0, correct: 0, incorrect: 0 },
      } as Card;
      return { ...s, cards: [...s.cards, copy!] };
    });
    if (copy) {
      if (profileBActive) markProfileBCardCreated(userId, copy.id);
      bg(supabase.from("cards").insert(cardToRow(copy, userId)));
    }
  }, []);

  /**
   * Fork a source-overlay card into the current user's own cloud.
   * Optionally applies a patch and sends a change-note to the source user.
   * Returns the new (forked) card id, or null if nothing was done.
   */
  const forkSourceCard = useCallback(async (
    id: string,
    opts?: { patch?: Partial<Card>; note?: string }
  ): Promise<string | null> => {
    const userId = requireUser();
    if (!isSourceOwnedCard(id)) return null;
    const orig = memState.cards.find((c) => c.id === id);
    if (!orig) return null;
    const newId = uid();
    const merged = {
      ...orig,
      ...(opts?.patch ?? {}),
      id: newId,
      createdAt: Date.now(),
      srs: defaultSrs(),
      stats: { totalReviews: 0, correct: 0, incorrect: 0 },
    } as Card;
    sourceOwnedCardIds.delete(id);
    setState((s) => ({
      ...s,
      cards: [...s.cards.filter((c) => c.id !== id), merged],
    }));
    bg(supabase.from("cards").insert(cardToRow(merged, userId)), "cards.fork");
    const sourceUid = sourceOverlaySourceUserId;
    const noteText = opts?.note?.trim();
    if (noteText && sourceUid) {
      bg(
        supabase.from("source_change_notes").insert({
          user_id: userId,
          source_user_id: sourceUid,
          original_card_id: id,
          forked_card_id: newId,
          original_question: orig.question,
          note: noteText,
        } as never),
        "source_change_notes.insert",
      );
    }
    return newId;
  }, []);


  const deleteCard = useCallback((id: string) => {
    const userId = currentUserId;
    if (isProfileBMode() && userId && !canProfileBDeleteCard(userId, id)) {
      toast({
        title: "מחיקה חסומה בפרופיל B",
        description: "ניתן למחוק רק שאלות שנוצרו על ידך בפרופיל B.",
        variant: "destructive",
      });
      return;
    }
    // Offline/local workspaces have no cloud copy, so deleting shipped library
    // content would be unrecoverable. Only user-created questions may go.
    if (currentUserId === GUEST_ID && isBundledLibraryItem("card", id)) {
      toast({ ...PROTECTED_DELETE_MESSAGE, variant: "destructive" });
      return;
    }
    deletedCardIds.add(id);
    setState((s) => ({
      ...s,
      cards: s.cards.filter((c) => c.id !== id),
      cardDecks: (s.cardDecks ?? []).filter((l) => l.cardId !== id),
    }));
    softDeleteWithQueue("cards", [id]);
    bg(supabase.from("card_decks").delete().eq("card_id", id));
  }, []);

  const addCategory = useCallback((name: string, parentId: string | null = null) => {
    const userId = requireUser();
    const cat: Category = { id: uid(), name, parentId, createdAt: Date.now() };
    setState((s) => ({ ...s, categories: [...(s.categories ?? []), cat] }));
    // Chain insert after parent's pending insert (if any) to avoid FK race in Supabase
    const parentPending = parentId ? categoryInsertPromises.get(parentId) : null;
    const doInsert = () =>
      supabase.from("categories").insert({ id: cat.id, user_id: userId, name, parent_id: parentId });
    const promise: Promise<{ error: unknown }> = parentPending
      ? parentPending.then(doInsert)
      : Promise.resolve(doInsert()).then((r) => r as unknown as { error: unknown });
    categoryInsertPromises.set(cat.id, promise);
    invalidateCategoryParentCache(parentId);
    if (parentId !== null) categoryHasChildrenHint.set(parentId, true);
    bg(promise, "categories.insert");
    return cat;
  }, []);

  // === Bulk add categories from a hierarchical template ===
  // Skips names that already exist at the same parent level.
  type BulkCategoryNode = { name: string; children?: BulkCategoryNode[] };
  const addCategoriesBulk = useCallback((nodes: BulkCategoryNode[], parentId: string | null = null) => {
    const userId = requireUser();
    if (!nodes.length) return 0;

    const makeKey = (pid: string | null, name: string) => `${pid ?? "__root__"}\u0000${name}`;
    const created: Category[] = [];
    const existingByKey = new Map<string, Category>();

    for (const c of memState.categories ?? []) {
      existingByKey.set(makeKey(c.parentId, c.name), c);
    }

    // Iterative walk avoids deep recursion and repeated scans over existing categories.
    const queue: Array<{ node: BulkCategoryNode; pid: string | null }> =
      nodes.map((node) => ({ node, pid: parentId }));

    for (let i = 0; i < queue.length; i++) {
      const { node, pid } = queue[i];
      const key = makeKey(pid, node.name);
      let cat = existingByKey.get(key);
      if (!cat) {
        cat = { id: uid(), name: node.name, parentId: pid, createdAt: Date.now() };
        created.push(cat);
        existingByKey.set(key, cat);
      }

      if (node.children?.length) {
        for (const child of node.children) {
          queue.push({ node: child, pid: cat.id });
        }
      }
    }

    if (created.length === 0) return 0;
    const affectedParents = new Set<string | null>();
    created.forEach((c) => {
      affectedParents.add(c.parentId ?? null);
      if (c.parentId !== null) categoryHasChildrenHint.set(c.parentId, true);
    });
    affectedParents.forEach((pid) => invalidateCategoryParentCache(pid));
    setState((s) => ({ ...s, categories: [...(s.categories ?? []), ...created] }));

    const rows = created.map((c) => ({ id: c.id, user_id: userId, name: c.name, parent_id: c.parentId }));
    const chunkSize = 500;

    // 23505 = unique_violation: category already exists in cloud under a different local ID — safe to ignore.
    const ignoreUniqueViolation = (r: { error: unknown }) => {
      const pgErr = r?.error as { code?: string } | null;
      return pgErr?.code === '23505' ? { error: null } : r;
    };

    const uploadPromise: Promise<{ error: unknown }> = rows.length <= chunkSize
      ? Promise.resolve(
          supabase.from("categories").upsert(rows, { ignoreDuplicates: true }),
        ).then((r) => ignoreUniqueViolation(r as unknown as { error: unknown }))
      : (async () => {
          for (let i = 0; i < rows.length; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize);
            const { error } = await supabase.from("categories").upsert(chunk, { ignoreDuplicates: true });
            if (error && (error as { code?: string }).code !== '23505') return { error };
            // Yield to keep UI responsive during very large uploads.
            if (i + chunkSize < rows.length) {
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
          }
          return { error: null };
        })();

    created.forEach((c) => categoryInsertPromises.set(c.id, uploadPromise));
    bg(uploadPromise, "categories.bulk_insert");
    return created.length;
  }, []);

  const deleteCategory = useCallback((id: string) => {
    const userId = requireUser();
    const target = (memState.categories ?? []).find((c) => c.id === id);
    if (target && isUncategorized(target)) {
      console.warn('[store] refusing to delete singleton "ללא סיווג" category');
      return;
    }
    // Deleting a shipped category cascades to its children and their questions,
    // so this guard protects the whole bundled subtree, not just one row.
    if (currentUserId === GUEST_ID && isBundledLibraryItem("category", id)) {
      toast({ ...PROTECTED_DELETE_MESSAGE, variant: "destructive" });
      return;
    }
    let removedTags: Set<string> | null = null;
    const removedParents = new Set<string | null>();
    const updatedCards: Card[] = [];
    setState((s) => {
      const cats = s.categories ?? [];
      const toRemove = new Set<string>([id]);
      let changed = true;
      while (changed) {
        changed = false;
        cats.forEach((c) => {
          if (c.parentId && toRemove.has(c.parentId) && !toRemove.has(c.id)) {
            toRemove.add(c.id); changed = true;
          }
        });
      }
      const removedNames = new Set(cats.filter((c) => toRemove.has(c.id)).map((c) => `cat:${c.name}`));
      cats.forEach((c) => {
        if (toRemove.has(c.id)) removedParents.add(c.parentId ?? null);
      });
      removedTags = removedNames;
      const newCards = s.cards.map((card) => {
        const filtered = card.tags.filter((t) => !removedNames.has(t));
        if (filtered.length === card.tags.length) return card;
        const u = { ...card, tags: filtered };
        updatedCards.push(u);
        return u;
      });
      return {
        ...s,
        categories: cats.filter((c) => !toRemove.has(c.id)),
        cards: newCards,
      };
    });
    // Soft-delete: mark deleted_at instead of removing the row.
    // This produces a tombstone in the cloud so other devices don't resurrect it on hydrate.
    softDeleteWithQueue("categories", [id]);
    removedParents.forEach((pid) => {
      invalidateCategoryParentCache(pid);
      if (pid !== null) categoryHasChildrenHint.delete(pid);
    });
    // Best-effort subtree cleanup for lazy-loaded mode (descendants might not be loaded in memory yet).
    void (async () => {
      const pending = [id];
      const allIds = new Set<string>([id]);
      const allNames = new Set<string>();
      const rootName = (memState.categories ?? []).find((c) => c.id === id)?.name;
      if (rootName) allNames.add(`cat:${rootName}`);

      while (pending.length) {
        const chunk = pending.splice(0, 100);
        const { data, error } = await supabase
          .from("categories")
          .select("id,name,parent_id")
          .eq("user_id", userId)
          .is("deleted_at", null)
          .in("parent_id", chunk);
        if (error) break;
        for (const row of data ?? []) {
          if (allIds.has(row.id)) continue;
          allIds.add(row.id);
          allNames.add(`cat:${row.name}`);
          pending.push(row.id);
        }
      }

      const extraIds = [...allIds].filter((x) => x !== id);
      if (extraIds.length) softDeleteWithQueue("categories", extraIds);

      if (allNames.size) {
        setState((s) => ({
          ...s,
          categories: (s.categories ?? []).filter((c) => !allIds.has(c.id)),
          cards: s.cards.map((card) => ({
            ...card,
            tags: card.tags.filter((t) => !allNames.has(t)),
          })),
        }));
      }
    })();
    updatedCards.forEach((c) => bg(supabase.from("cards").update({ tags: c.tags }).eq("id", c.id)));
  }, []);

  // Rename a category (also re-tags all cards that referenced the old name)
  const renameCategory = useCallback((id: string, newName: string) => {
    const userId = requireUser();
    const trimmed = newName.trim();
    if (!trimmed) return;
    const target = (memState.categories ?? []).find((c) => c.id === id);
    if (target && isUncategorized(target)) {
      console.warn('[store] refusing to rename singleton "ללא סיווג" category');
      return;
    }
    const updatedCards: Card[] = [];
    let oldName = "";
    setState((s) => {
      const cats = s.categories ?? [];
      const target = cats.find((c) => c.id === id);
      if (!target || target.name === trimmed) return s;
      oldName = target.name;
      const newCats = cats.map((c) => (c.id === id ? { ...c, name: trimmed } : c));
      const oldTag = `cat:${oldName}`;
      const newTag = `cat:${trimmed}`;
      const newCards = s.cards.map((card) => {
        if (!card.tags.includes(oldTag)) return card;
        const u = { ...card, tags: card.tags.map((t) => (t === oldTag ? newTag : t)) };
        updatedCards.push(u);
        return u;
      });
      return { ...s, categories: newCats, cards: newCards };
    });
    bg(supabase.from("categories").update({ name: trimmed }).eq("id", id));
    updatedCards.forEach((c) => bg(supabase.from("cards").update({ tags: c.tags }).eq("id", c.id)));
  }, []);

  // Duplicate a category (and all of its descendants) under the same parent
  const duplicateCategory = useCallback((id: string) => {
    const userId = requireUser();
    const cats = memState.categories ?? [];
    const root = cats.find((c) => c.id === id);
    if (!root) return;
    const created: Category[] = [];
    const walk = (origId: string, newParentId: string | null) => {
      const orig = cats.find((c) => c.id === origId);
      if (!orig) return;
      const siblings = cats.filter((c) => c.parentId === newParentId).map((c) => c.name);
      let name = orig.id === id ? `${orig.name} (עותק)` : orig.name;
      let n = 2;
      while (siblings.includes(name) || created.some((c) => c.parentId === newParentId && c.name === name)) {
        name = `${orig.name} (עותק ${n++})`;
      }
      const copy: Category = { id: uid(), name, parentId: newParentId, createdAt: Date.now() };
      created.push(copy);
      cats.filter((c) => c.parentId === origId).forEach((child) => walk(child.id, copy.id));
    };
    walk(id, root.parentId);
    if (!created.length) return;
    const affectedParents = new Set<string | null>();
    created.forEach((c) => {
      affectedParents.add(c.parentId ?? null);
      if (c.parentId !== null) categoryHasChildrenHint.set(c.parentId, true);
    });
    affectedParents.forEach((pid) => invalidateCategoryParentCache(pid));
    setState((s) => ({ ...s, categories: [...(s.categories ?? []), ...created] }));
    bg(supabase.from("categories").insert(
      created.map((c) => ({ id: c.id, user_id: userId, name: c.name, parent_id: c.parentId })),
    ), "categories.duplicate");
  }, []);

  // Duplicate a category (and all of its descendants) under a DIFFERENT parent (for Ctrl+drag copy)
  const duplicateCategoryUnder = useCallback((id: string, targetParentId: string | null): string | null => {
    const userId = requireUser();
    const cats = memState.categories ?? [];
    const root = cats.find((c) => c.id === id);
    if (!root) return null;
    const created: Category[] = [];
    let newRootId: string | null = null;
    const walk = (origId: string, newParentId: string | null) => {
      const orig = cats.find((c) => c.id === origId);
      if (!orig) return;
      const siblings = cats.filter((c) => c.parentId === newParentId).map((c) => c.name);
      let name = origId === id ? `${orig.name} (עותק)` : orig.name;
      let n = 2;
      while (siblings.includes(name) || created.some((c) => c.parentId === newParentId && c.name === name)) {
        name = `${orig.name} (עותק ${n++})`;
      }
      const copy: Category = { id: uid(), name, parentId: newParentId, createdAt: Date.now() };
      if (origId === id) newRootId = copy.id;
      created.push(copy);
      cats.filter((c) => c.parentId === origId).forEach((child) => walk(child.id, copy.id));
    };
    walk(id, targetParentId);
    if (!created.length) return null;
    const affectedParents = new Set<string | null>();
    created.forEach((c) => {
      affectedParents.add(c.parentId ?? null);
      if (c.parentId !== null) categoryHasChildrenHint.set(c.parentId, true);
    });
    affectedParents.forEach((pid) => invalidateCategoryParentCache(pid));
    setState((s) => ({ ...s, categories: [...(s.categories ?? []), ...created] }));
    bg(supabase.from("categories").insert(
      created.map((c) => ({ id: c.id, user_id: userId, name: c.name, parent_id: c.parentId })),
    ), "categories.duplicateUnder");
    return newRootId;
  }, []);

  const reviewCard = useCallback((cardId: string, quality: 0 | 1 | 2 | 3 | 4 | 5, durationMs: number, useSrs: boolean, customDueAt?: number) => {
    const userId = requireUser();
    const correct = quality >= 3;
    const algo = getSrsAlgorithm(userId);
    const retention = getRetentionTarget(userId);
    let updatedCard: Card | undefined;
    let prevSrs: Card["srs"] | undefined;
    let prevStats: Card["stats"] | undefined;
    let logEntry: ReviewLog | undefined;
    setState((s) => {
      const cards = s.cards.map((c) => {
        if (c.id !== cardId) return c;
        prevSrs = c.srs;
        prevStats = c.stats;
        const baseSrs = useSrs ? applyReview(c, quality, algo, retention) : c.srs;
        const finalSrs = (customDueAt && useSrs)
          ? { ...baseSrs, dueAt: customDueAt, lastReviewedAt: Date.now() }
          : baseSrs;
        const u = {
          ...c,
          srs: finalSrs,
          stats: {
            totalReviews: c.stats.totalReviews + 1,
            correct: c.stats.correct + (correct ? 1 : 0),
            incorrect: c.stats.incorrect + (correct ? 0 : 1),
          },
        } as Card;
        updatedCard = u;
        return u;
      });
      const card = s.cards.find((c) => c.id === cardId);
      logEntry = {
        id: uid(), cardId, deckId: card?.deckId ?? null, at: Date.now(),
        quality, correct, durationMs,
      };
      return { ...s, cards, logs: [logEntry, ...s.logs].slice(0, 2000) };
    });
    if (updatedCard) {
      bg(supabase.from("cards").update({ srs: updatedCard.srs, stats: updatedCard.stats }).eq("id", cardId));
    }
    if (logEntry) {
      bg(supabase.from("review_logs").insert({
        id: logEntry.id, user_id: userId, card_id: logEntry.cardId,
        deck_id: logEntry.deckId ?? null,
        at: new Date(logEntry.at).toISOString(), quality, correct, duration_ms: durationMs,
      }));
    }
    return { logId: logEntry?.id, prevSrs, prevStats };
  }, []);

  const undoReview = useCallback((cardId: string, prevSrs: Card["srs"], prevStats: Card["stats"], logId?: string) => {
    setState((s) => ({
      ...s,
      cards: s.cards.map((c) => c.id === cardId ? { ...c, srs: prevSrs, stats: prevStats } : c),
      logs: logId ? s.logs.filter((l) => l.id !== logId) : s.logs,
    }));
    bg(supabase.from("cards").update({ srs: prevSrs, stats: prevStats }).eq("id", cardId), "cards.undo");
    if (logId) bg(supabase.from("review_logs").delete().eq("id", logId), "review_logs.undo");
  }, []);

  // Delete a single review log (without restoring SRS state). Decrements card stats.
  const deleteReviewLog = useCallback((logId: string) => {
    setState((s) => {
      const log = s.logs.find((l) => l.id === logId);
      if (!log) return s;
      const cards = s.cards.map((c) => {
        if (c.id !== log.cardId) return c;
        return {
          ...c,
          stats: {
            totalReviews: Math.max(0, c.stats.totalReviews - 1),
            correct: Math.max(0, c.stats.correct - (log.correct ? 1 : 0)),
            incorrect: Math.max(0, c.stats.incorrect - (log.correct ? 0 : 1)),
          },
        };
      });
      return { ...s, cards, logs: s.logs.filter((l) => l.id !== logId) };
    });
    bg(supabase.from("review_logs").delete().eq("id", logId), "review_logs.delete");
  }, []);

  // === Goals ===
  const addGoal = useCallback((goal: Omit<Goal, "id" | "createdAt" | "active">) => {
    const userId = requireUser();
    const full: Goal = { ...goal, id: uid(), createdAt: Date.now(), active: true };
    setState((s) => ({ ...s, goals: [...(s.goals ?? []), full] }));
    bg(supabase.from("goals").insert({
      id: full.id, user_id: userId, type: full.type, title: full.title,
      target: full.target, window_days: full.windowDays ?? null,
      deck_id: full.deckId ?? null, active: true, manual_done_dates: full.manualDoneDates ?? [],
    }));
    return full;
  }, []);

  const updateGoal = useCallback((id: string, patch: Partial<Goal>) => {
    setState((s) => ({
      ...s,
      goals: (s.goals ?? []).map((g) => (g.id === id ? { ...g, ...patch } : g)),
    }));
    const dbPatch: Record<string, unknown> = {};
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.target !== undefined) dbPatch.target = patch.target;
    if (patch.windowDays !== undefined) dbPatch.window_days = patch.windowDays;
    if (patch.deckId !== undefined) dbPatch.deck_id = patch.deckId;
    if (patch.active !== undefined) dbPatch.active = patch.active;
    if (patch.type !== undefined) dbPatch.type = patch.type;
    if (patch.manualDoneDates !== undefined) dbPatch.manual_done_dates = patch.manualDoneDates;
    if (Object.keys(dbPatch).length) bg(supabase.from("goals").update(dbPatch as never).eq("id", id));
  }, []);

  const deleteGoal = useCallback((id: string) => {
    setState((s) => ({ ...s, goals: (s.goals ?? []).filter((g) => g.id !== id) }));
    bg(supabase.from("goals").delete().eq("id", id));
  }, []);

  const toggleGoalDate = useCallback((id: string, dateKey: string) => {
    let nextDates: string[] = [];
    setState((s) => ({
      ...s,
      goals: (s.goals ?? []).map((g) => {
        if (g.id !== id) return g;
        const dates = new Set(g.manualDoneDates ?? []);
        if (dates.has(dateKey)) dates.delete(dateKey); else dates.add(dateKey);
        nextDates = Array.from(dates);
        return { ...g, manualDoneDates: nextDates };
      }),
    }));
    bg(supabase.from("goals").update({ manual_done_dates: nextDates }).eq("id", id));
  }, []);

  // === Shas plan ===
  const persistShasPlans = useCallback((userId: string, plans: ShasPlan[], activePlanId: string | null) => {
    bg(supabase.from("user_settings").upsert(
      {
        user_id: userId,
        shas_plans: plans as unknown as Json,
        active_shas_plan_id: activePlanId,
      } as never,
      { onConflict: "user_id" },
    ), "user_settings.shas_plans");

    const active = activePlanId ? (plans.find((p) => p.id === activePlanId) ?? null) : null;
    if (!active) {
      bg(supabase.from("shas_plans").delete().eq("user_id", userId), "shas_plans.clear_legacy");
      return;
    }

    bg(supabase.from("shas_plans").upsert({
      id: active.id,
      user_id: userId,
      selected_masechtos: active.selectedMasechtos,
      pages_per_day: active.pagesPerDay,
      start_date: new Date(active.startDate).toISOString(),
      current_masechta: active.currentMasechta,
      current_daf: active.currentDaf,
      completed: active.completed,
      unit: active.unit,
      current_amud: active.currentAmud,
      current_half: active.currentHalf,
      anchor_date: active.anchorDate ?? null,
      anchor_masechta: active.anchorPosition?.masechta ?? null,
      anchor_daf: active.anchorPosition?.daf ?? null,
      anchor_amud: active.anchorPosition?.amud ?? null,
    }, { onConflict: "user_id" }), "shas_plans.upsert_legacy");
  }, []);

  const setShasPlan = useCallback((
    selectedMasechtos: string[],
    pagesPerDay: number,
    unit: ShasPlan["unit"] = "daf",
    startMasechta?: string,
    startDaf?: number,
    skipWeekdays?: number[],
    skipDates?: string[],
    anchorDate?: string,
    anchorPosition?: ShasPlan["anchorPosition"],
  ) => {
    const userId = requireUser();
    const first = startMasechta ?? selectedMasechtos[0];
    const planName = selectedMasechtos.length > 1
      ? `${selectedMasechtos[0]} +${selectedMasechtos.length - 1}`
      : (selectedMasechtos[0] ?? 'ש"ס');
    const plan: ShasPlan = {
      id: uid(), selectedMasechtos, pagesPerDay, startDate: Date.now(),
      name: planName,
      unit,
      currentMasechta: first, currentDaf: startDaf ?? 2,
      currentAmud: 1, currentHalf: 1, completed: [],
      ...(skipWeekdays?.length ? { skipWeekdays } : {}),
      ...(skipDates?.length ? { skipDates } : {}),
      ...(anchorDate ? { anchorDate } : {}),
      ...(anchorPosition ? { anchorPosition } : {}),
    };
    const nextPlans = [...(memState.shasPlans ?? []), plan];
    setState((s) => ({ ...s, shasPlan: plan, shasPlans: nextPlans, activeShasPlanId: plan.id }));
    persistShasPlans(userId, nextPlans, plan.id);
    return plan;
  }, [persistShasPlans]);

  const setActiveShasPlan = useCallback((planId: string) => {
    const userId = requireUser();
    const plans = memState.shasPlans ?? [];
    const active = plans.find((p) => p.id === planId);
    if (!active) return;
    setState((s) => ({ ...s, shasPlan: active, activeShasPlanId: planId }));
    persistShasPlans(userId, plans, planId);
  }, [persistShasPlans]);

  const clearShasPlan = useCallback(() => {
    const userId = requireUser();
    const plans = memState.shasPlans ?? [];
    const activeId = memState.activeShasPlanId ?? memState.shasPlan?.id ?? null;
    const nextPlans = activeId ? plans.filter((p) => p.id !== activeId) : plans;
    const nextActive = nextPlans[0] ?? null;
    setState((s) => ({
      ...s,
      shasPlans: nextPlans,
      activeShasPlanId: nextActive?.id ?? null,
      shasPlan: nextActive,
    }));
    persistShasPlans(userId, nextPlans, nextActive?.id ?? null);
  }, [persistShasPlans]);

  const deleteShasPlan = useCallback((planId: string) => {
    const userId = requireUser();
    const plans = memState.shasPlans ?? [];
    const nextPlans = plans.filter((p) => p.id !== planId);
    const wasActive = (memState.activeShasPlanId ?? memState.shasPlan?.id) === planId;
    const nextActive = wasActive ? (nextPlans[0] ?? null) : (plans.find((p) => p.id === (memState.activeShasPlanId ?? memState.shasPlan?.id)) ?? nextPlans[0] ?? null);
    setState((s) => ({
      ...s,
      shasPlans: nextPlans,
      activeShasPlanId: nextActive?.id ?? null,
      shasPlan: nextActive,
    }));
    persistShasPlans(userId, nextPlans, nextActive?.id ?? null);
  }, [persistShasPlans]);

  // השלמת היחידה הנוכחית (דף / עמוד / חצי-עמוד) וקידום למיקום הבא
  // intervals: רשימת ימים לתזמון חזרות. ברירת מחדל = state.reviewIntervals.
  // [] (ריק) = לא לתזמן כלל (הדיאלוג יטפל בזה אחרי).
  const completeShasDaf = useCallback((opts?: { intervals?: number[] }) => {
    const userId = requireUser();
    let updated: ShasPlan | null = null;
    let learnedSnapshot: { masechta: string; daf: number; amud: 1 | 2; half: 1 | 2 | null; unit: ShasPlan["unit"] } | null = null;
    setState((s) => {
      const p = s.shasPlan;
      if (!p) return s;
      const masechta = SHAS_BAVLI.find((m) => m.name === p.currentMasechta);
      if (!masechta) return s;
      const entry = {
        masechta: p.currentMasechta,
        daf: p.currentDaf,
        amud: p.currentAmud,
        half: p.unit === "half" ? p.currentHalf : undefined,
        at: Date.now(),
      };
      const completed = [...p.completed, entry];
      learnedSnapshot = {
        masechta: p.currentMasechta,
        daf: p.currentDaf,
        amud: p.currentAmud,
        half: p.unit === "half" ? p.currentHalf : null,
        unit: p.unit,
      };

      // קידום מיקום לפי יחידה
      let nextDaf = p.currentDaf;
      let nextAmud: 1 | 2 = p.currentAmud;
      let nextHalf: 1 | 2 = p.currentHalf;
      let nextMasechta = p.currentMasechta;

      if (p.unit === "daf") {
        nextDaf = p.currentDaf + 1;
        nextAmud = 1; nextHalf = 1;
      } else if (p.unit === "amud") {
        if (p.currentAmud === 1) {
          nextAmud = 2;
        } else {
          nextAmud = 1;
          nextDaf = p.currentDaf + 1;
        }
        nextHalf = 1;
      } else {
        // half
        if (p.currentHalf === 1) {
          nextHalf = 2;
        } else {
          nextHalf = 1;
          if (p.currentAmud === 1) {
            nextAmud = 2;
          } else {
            nextAmud = 1;
            nextDaf = p.currentDaf + 1;
          }
        }
      }

      // מעבר למסכת הבאה אם סיימנו
      if (nextDaf > masechta.pages) {
        const idx = p.selectedMasechtos.indexOf(p.currentMasechta);
        const next = p.selectedMasechtos[idx + 1];
        if (next) { nextMasechta = next; nextDaf = 2; nextAmud = 1; nextHalf = 1; }
        else { nextDaf = masechta.pages; nextAmud = 2; nextHalf = 2; }
      }

      updated = {
        ...p, completed,
        currentMasechta: nextMasechta, currentDaf: nextDaf,
        currentAmud: nextAmud, currentHalf: nextHalf,
      };
      return {
        ...s,
        shasPlan: updated,
        shasPlans: (s.shasPlans ?? []).map((sp) => sp.id === updated!.id ? updated! : sp),
      };
    });
    if (updated) {
      const plans = (memState.shasPlans ?? []).map((sp) => sp.id === updated!.id ? updated! : sp);
      persistShasPlans(userId, plans, memState.activeShasPlanId ?? updated.id);
    }
    // === רישום ללוח חזרות: לימוד ראשוני (סומן כהושלם היום) + תזכורות חזרה עתידיות ===
    if (learnedSnapshot) {
      const today = new Date();
      const intervals = opts?.intervals !== undefined
        ? opts.intervals
        : ((memState.reviewIntervals && memState.reviewIntervals.length)
            ? memState.reviewIntervals : [1, 3, 7, 14, 30]);
      const todayKey = isoDate(today);
      const initial: ShasReview = {
        id: uid(),
        masechta: learnedSnapshot.masechta,
        daf: learnedSnapshot.daf,
        amud: learnedSnapshot.amud,
        half: learnedSnapshot.half,
        unit: learnedSnapshot.unit,
        reviewIndex: 1,
        dueDate: todayKey,
        doneAt: todayKey,
        isInitial: true,
        note: null,
      };
      const followUps: ShasReview[] = intervals.map((days, i) => ({
        id: uid(),
        masechta: learnedSnapshot!.masechta,
        daf: learnedSnapshot!.daf,
        amud: learnedSnapshot!.amud,
        half: learnedSnapshot!.half,
        unit: learnedSnapshot!.unit,
        reviewIndex: i + 2,
        dueDate: addDaysIso(today, days),
        doneAt: null,
        isInitial: false,
        note: null,
      }));
      const all = [initial, ...followUps];
      setState((s) => ({ ...s, shasReviews: [...(s.shasReviews ?? []), ...all] }));
      bg(supabase.from("shas_reviews").insert(all.map((r) => ({
        id: r.id, user_id: userId,
        masechta: r.masechta, daf: r.daf, amud: r.amud,
        half: r.half ?? null, unit: r.unit,
        review_index: r.reviewIndex, due_date: r.dueDate,
        done_at: r.doneAt, is_initial: r.isInitial, note: r.note ?? null,
      }))), "shas_reviews.insertBatch");
    }
  }, [persistShasPlans]);

  const undoLastShasDaf = useCallback(() => {
    const userId = requireUser();
    let updated: ShasPlan | null = null;
    let toRemove: string[] = [];
    setState((s) => {
      const p = s.shasPlan;
      if (!p || p.completed.length === 0) return s;
      const last = p.completed[p.completed.length - 1];
      updated = {
        ...p, completed: p.completed.slice(0, -1),
        currentMasechta: last.masechta, currentDaf: last.daf,
        currentAmud: (last.amud as 1 | 2) ?? 1,
        currentHalf: (last.half as 1 | 2) ?? 1,
      };
      // הסר את קבוצת תזכורות החזרה האחרונה לאותו מיקום
      const reviews = s.shasReviews ?? [];
      const matches = reviews.filter((r) =>
        r.masechta === last.masechta && r.daf === last.daf &&
        r.amud === ((last.amud as 1 | 2) ?? 1) &&
        ((r.half ?? null) === ((last.half as 1 | 2 | undefined) ?? null))
      );
      // קבוצה אחרונה: כל הרשומות מהקבוצה ש-isInitial האחרונה שלה
      // נסיר את כל ההתאמות עבור המיקום הזה (פשוט ויעיל לאיזון undo)
      toRemove = matches.map((r) => r.id);
      return {
        ...s,
        shasPlan: updated,
        shasPlans: (s.shasPlans ?? []).map((sp) => sp.id === updated!.id ? updated! : sp),
        shasReviews: reviews.filter((r) => !toRemove.includes(r.id)),
      };
    });
    if (updated) {
      const plans = (memState.shasPlans ?? []).map((sp) => sp.id === updated!.id ? updated! : sp);
      persistShasPlans(userId, plans, memState.activeShasPlanId ?? updated.id);
    }
    if (toRemove.length) {
      bg(supabase.from("shas_reviews").delete().in("id", toRemove), "shas_reviews.undo");
    }
  }, [persistShasPlans]);

  // שינוי יחידת לימוד באמצע תוכנית (מאפס מיקום בתוך-דף ל-עמוד א' חצי 1)
  const setShasUnit = useCallback((unit: ShasPlan["unit"]) => {
    const userId = requireUser();
    let updated: ShasPlan | null = null;
    setState((s) => {
      if (!s.shasPlan) return s;
      updated = { ...s.shasPlan, unit, currentAmud: 1, currentHalf: 1 };
      return {
        ...s,
        shasPlan: updated,
        shasPlans: (s.shasPlans ?? []).map((sp) => sp.id === updated!.id ? updated! : sp),
      };
    });
    if (updated) {
      const plans = (memState.shasPlans ?? []).map((sp) => sp.id === updated!.id ? updated! : sp);
      persistShasPlans(userId, plans, memState.activeShasPlanId ?? updated.id);
    }
  }, [persistShasPlans]);

  const setNotificationsEnabled = useCallback((enabled: boolean) => {
    const userId = requireUser();
    setState((s) => ({ ...s, notificationsEnabled: enabled }));
    bg(supabase.from("user_settings").upsert({ user_id: userId, notifications_enabled: enabled }, { onConflict: "user_id" }));
  }, []);

  const setReminderTime = useCallback((time: string) => {
    const userId = requireUser();
    setState((s) => ({ ...s, reminderTime: time }));
    bg(supabase.from("user_settings").upsert({ user_id: userId, reminder_time: time }, { onConflict: "user_id" }));
  }, []);

  const setDayNote = useCallback((date: string, text: string) => {
    const userId = requireUser();
    const trimmed = text.trim();
    setState((s) => {
      const notes = s.dayNotes ?? [];
      if (!trimmed) return { ...s, dayNotes: notes.filter((n) => n.date !== date) };
      const exists = notes.some((n) => n.date === date);
      const updated = exists
        ? notes.map((n) => (n.date === date ? { ...n, text: trimmed, updatedAt: Date.now() } : n))
        : [...notes, { date, text: trimmed, updatedAt: Date.now() }];
      return { ...s, dayNotes: updated };
    });
    if (!trimmed) {
      bg(supabase.from("day_notes").delete().eq("user_id", userId).eq("date", date));
    } else {
      bg(supabase.from("day_notes").upsert({ user_id: userId, date, text: trimmed }, { onConflict: "user_id,date" }));
    }
  }, []);

  // === Card <-> Deck linkage (many-to-many) ===
  const addCardToDeck = useCallback((cardId: string, deckId: string) => {
    const userId = requireUser();
    setState((s) => {
      const links = s.cardDecks ?? [];
      if (links.some((l) => l.cardId === cardId && l.deckId === deckId)) return s;
      return { ...s, cardDecks: [...links, { cardId, deckId, sortOrder: Date.now() }] };
    });
    bg(supabase.from("card_decks").upsert({
      card_id: cardId, deck_id: deckId, user_id: userId, sort_order: Date.now(),
    }, { onConflict: "card_id,deck_id" }), "card_decks.upsert");
  }, []);

  const removeCardFromDeck = useCallback((cardId: string, deckId: string) => {
    setState((s) => ({
      ...s,
      cardDecks: (s.cardDecks ?? []).filter((l) => !(l.cardId === cardId && l.deckId === deckId)),
    }));
    bg(
      supabase.from("card_decks").delete().eq("card_id", cardId).eq("deck_id", deckId),
      "card_decks.delete",
    );
  }, []);

  const setCardDecks = useCallback((cardId: string, deckIds: string[]) => {
    const userId = requireUser();
    setState((s) => {
      const others = (s.cardDecks ?? []).filter((l) => l.cardId !== cardId);
      const fresh = deckIds.map((deckId, i) => ({ cardId, deckId, sortOrder: i }));
      return { ...s, cardDecks: [...others, ...fresh] };
    });
    bg(supabase.from("card_decks").delete().eq("card_id", cardId), "card_decks.replace.delete");
    if (deckIds.length) {
      bg(supabase.from("card_decks").insert(
        deckIds.map((deckId, i) => ({
          card_id: cardId, deck_id: deckId, user_id: userId, sort_order: i,
        })),
      ), "card_decks.replace.insert");
    }
  }, []);

  // === Categories: drag/move within tree ===
  const moveCategory = useCallback((id: string, newParentId: string | null) => {
    // prevent moving under own descendant
    let oldParentId: string | null = null;
    setState((s) => {
      const cats = s.categories ?? [];
      oldParentId = cats.find((c) => c.id === id)?.parentId ?? null;
      const descendants = new Set<string>([id]);
      let changed = true;
      while (changed) {
        changed = false;
        cats.forEach((c) => {
          if (c.parentId && descendants.has(c.parentId) && !descendants.has(c.id)) {
            descendants.add(c.id); changed = true;
          }
        });
      }
      if (newParentId && descendants.has(newParentId)) return s;
      return {
        ...s,
        categories: cats.map((c) => (c.id === id ? { ...c, parentId: newParentId } : c)),
      };
    });
    invalidateCategoryParentCache(oldParentId);
    invalidateCategoryParentCache(newParentId);
    if (newParentId !== null) categoryHasChildrenHint.set(newParentId, true);
    if (oldParentId !== null) categoryHasChildrenHint.delete(oldParentId);
    bg(supabase.from("categories").update({ parent_id: newParentId }).eq("id", id), "categories.move");
  }, []);

  const reorderCategories = useCallback((orderedIds: string[]) => {
    setState((s) => {
      const cats = s.categories ?? [];
      const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
      return {
        ...s,
        categories: cats.map((c) =>
          orderMap.has(c.id) ? { ...c, sortOrder: orderMap.get(c.id)! } : c,
        ),
      };
    });
    bg(
      rpcClient.rpc("reorder_user_categories", { p_ids: orderedIds }),
      "categories.reorderBatch",
    );
  }, []);

  // === Move card to a different primary deck ===
  const moveCardToDeck = useCallback((cardId: string, newDeckId: string) => {
    const userId = requireUser();
    setState((s) => ({
      ...s,
      cards: s.cards.map((c) => (c.id === cardId ? ({ ...c, deckId: newDeckId } as Card) : c)),
    }));
    bg(supabase.from("cards").update({ deck_id: newDeckId }).eq("id", cardId), "cards.move");
    // ensure the new deck is in the linkage table
    bg(supabase.from("card_decks").upsert({
      card_id: cardId, deck_id: newDeckId, user_id: userId, sort_order: 0,
    }, { onConflict: "card_id,deck_id" }), "card_decks.upsert");
    setState((s) => {
      const links = s.cardDecks ?? [];
      if (links.some((l) => l.cardId === cardId && l.deckId === newDeckId)) return s;
      return { ...s, cardDecks: [...links, { cardId, deckId: newDeckId, sortOrder: 0 }] };
    });
  }, []);

  // === Set categories for a card (replace all cat: tags) ===
  const setCardCategories = useCallback((cardId: string, categoryNames: string[]) => {
    const userId = requireUser();
    let updated: Card | undefined;
    setState((s) => ({
      ...s,
      cards: s.cards.map((c) => {
        if (c.id !== cardId) return c;
        const plain = c.tags.filter((t) => !t.startsWith("cat:"));
        const cats = categoryNames.map((n) => `cat:${n}`);
        updated = { ...c, tags: [...plain, ...cats] } as Card;
        return updated;
      }),
    }));
    if (updated) bg(supabase.from("cards").update({ tags: updated.tags }).eq("id", cardId), "cards.setCategories");
  }, []);

  // === Shas reviews ===
  const markShasReviewDone = useCallback((id: string, dateKey?: string) => {
    const day = dateKey ?? todayIso();
    setState((s) => ({
      ...s,
      shasReviews: (s.shasReviews ?? []).map((r) => r.id === id ? { ...r, doneAt: day } : r),
    }));
    bg(supabase.from("shas_reviews").update({ done_at: day }).eq("id", id), "shas_reviews.markDone");
  }, []);

  const unmarkShasReviewDone = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      shasReviews: (s.shasReviews ?? []).map((r) => r.id === id ? { ...r, doneAt: null } : r),
    }));
    bg(supabase.from("shas_reviews").update({ done_at: null }).eq("id", id), "shas_reviews.unmark");
  }, []);

  const rescheduleShasReview = useCallback((id: string, newDueDate: string) => {
    setState((s) => ({
      ...s,
      shasReviews: (s.shasReviews ?? []).map((r) => r.id === id ? { ...r, dueDate: newDueDate } : r),
    }));
    bg(supabase.from("shas_reviews").update({ due_date: newDueDate }).eq("id", id), "shas_reviews.reschedule");
  }, []);

  const setShasReviewNote = useCallback((id: string, note: string) => {
    const v = note.trim() || null;
    setState((s) => ({
      ...s,
      shasReviews: (s.shasReviews ?? []).map((r) => r.id === id ? { ...r, note: v } : r),
    }));
    bg(supabase.from("shas_reviews").update({ note: v }).eq("id", id), "shas_reviews.note");
  }, []);

  const deleteShasReview = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      shasReviews: (s.shasReviews ?? []).filter((r) => r.id !== id),
    }));
    bg(supabase.from("shas_reviews").delete().eq("id", id), "shas_reviews.delete");
  }, []);

  const addManualShasReview = useCallback((args: {
    masechta: string; daf: number; amud: 1 | 2; half?: 1 | 2 | null;
    unit: ShasReview["unit"]; dueDate: string; doneAt?: string | null;
    isInitial?: boolean; reviewIndex?: number; note?: string;
  }) => {
    const userId = requireUser();
    const r: ShasReview = {
      id: uid(),
      masechta: args.masechta, daf: args.daf, amud: args.amud,
      half: args.half ?? null, unit: args.unit,
      reviewIndex: args.reviewIndex ?? 1, dueDate: args.dueDate,
      doneAt: args.doneAt ?? null,
      isInitial: !!args.isInitial, note: args.note?.trim() || null,
    };
    setState((s) => ({ ...s, shasReviews: [...(s.shasReviews ?? []), r] }));
    bg(supabase.from("shas_reviews").insert({
      id: r.id, user_id: userId,
      masechta: r.masechta, daf: r.daf, amud: r.amud,
      half: r.half ?? null, unit: r.unit,
      review_index: r.reviewIndex, due_date: r.dueDate,
      done_at: r.doneAt, is_initial: r.isInitial, note: r.note ?? null,
    }), "shas_reviews.insertManual");
    return r;
  }, []);

  const setReviewIntervals = useCallback((intervals: number[]) => {
    const userId = requireUser();
    const cleaned = intervals.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    setState((s) => ({ ...s, reviewIntervals: cleaned }));
    bg(supabase.from("user_settings").upsert(
      { user_id: userId, review_intervals: cleaned as unknown as Json },
      { onConflict: "user_id" },
    ), "user_settings.review_intervals");
  }, []);

  // === הוספת תזמוני חזרה למיקום ש"ס שכבר נלמד ===
  // משמש את הדיאלוג שנפתח אחרי "סיימתי" כדי לתזמן חזרות בתאריכים שהמשתמש בחר.
  const scheduleShasReviewsAt = useCallback((args: {
    masechta: string; daf: number; amud: 1 | 2; half: 1 | 2 | null; unit: "daf" | "amud" | "half";
    days: number[]; // ימים מהיום
  }) => {
    const userId = requireUser();
    if (!args.days.length) return 0;
    const today = new Date();
    const existing = (memState.shasReviews ?? []).filter((r) =>
      r.masechta === args.masechta && r.daf === args.daf &&
      r.amud === args.amud && (r.half ?? null) === (args.half ?? null) &&
      r.unit === args.unit
    );
    const startIdx = existing.length + 1;
    const dueSet = new Set(existing.map((r) => r.dueDate));
    const followUps: ShasReview[] = [];
    let i = 0;
    for (const days of args.days) {
      const due = addDaysIso(today, days);
      if (dueSet.has(due)) continue;
      dueSet.add(due);
      followUps.push({
        id: uid(),
        masechta: args.masechta, daf: args.daf, amud: args.amud,
        half: args.half, unit: args.unit,
        reviewIndex: startIdx + i,
        dueDate: due,
        doneAt: null,
        isInitial: false,
        note: null,
      });
      i++;
    }
    if (!followUps.length) return 0;
    setState((s) => ({ ...s, shasReviews: [...(s.shasReviews ?? []), ...followUps] }));
    bg(supabase.from("shas_reviews").insert(followUps.map((r) => ({
      id: r.id, user_id: userId,
      masechta: r.masechta, daf: r.daf, amud: r.amud,
      half: r.half ?? null, unit: r.unit,
      review_index: r.reviewIndex, due_date: r.dueDate,
      done_at: r.doneAt, is_initial: r.isInitial, note: r.note ?? null,
    }))), "shas_reviews.scheduleAt");
    return followUps.length;
  }, []);

  const setPlanReviewIntervals = useCallback((intervals: number[]) => {
    const userId = requireUser();
    const cleaned = intervals.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    if (cleaned.length === 0) return;
    setState((s) => ({ ...s, planReviewIntervals: cleaned }));
    bg(supabase.from("user_settings").upsert(
      { user_id: userId, plan_review_intervals: cleaned as unknown as Json } as never,
      { onConflict: "user_id" },
    ), "user_settings.plan_review_intervals");
  }, []);

  // === Learning Sessions ===
  const addLearningSession = useCallback((args: {
    date: string;
    subject: string;
    sessionType: "initial" | "review";
    quality: 1 | 2 | 3 | 4 | 5;
    durationMinutes?: number;
    note?: string;
    nextReviewDate?: string | null;
    reviewNumber?: number;
  }) => {
    const userId = requireUser();
    const session: LearningSession = {
      id: uid(),
      date: args.date,
      subject: args.subject.trim(),
      sessionType: args.sessionType,
      quality: args.quality,
      durationMinutes: args.durationMinutes,
      note: args.note?.trim() || undefined,
      nextReviewDate: args.nextReviewDate ?? null,
      reviewNumber: args.reviewNumber ?? 1,
      createdAt: Date.now(),
    };
    setState((s) => ({ ...s, learningSessions: [session, ...(s.learningSessions ?? [])] }));
    bg(supabase.from("learning_sessions").insert({
      id: session.id,
      user_id: userId,
      date: session.date,
      subject: session.subject,
      session_type: session.sessionType,
      quality: session.quality,
      duration_minutes: session.durationMinutes ?? null,
      note: session.note ?? null,
      next_review_date: session.nextReviewDate ?? null,
      review_number: session.reviewNumber,
    }), "learning_sessions.insert");
    return session;
  }, []);

  const updateLearningSession = useCallback((id: string, patch: Partial<Pick<LearningSession,
    "subject" | "sessionType" | "quality" | "durationMinutes" | "note" | "nextReviewDate" | "reviewNumber"
  >>) => {
    requireUser();
    setState((s) => ({
      ...s,
      learningSessions: (s.learningSessions ?? []).map((r) =>
        r.id === id ? { ...r, ...patch } : r
      ),
    }));
    const dbPatch: Record<string, unknown> = {};
    if (patch.subject !== undefined) dbPatch.subject = patch.subject.trim();
    if (patch.sessionType !== undefined) dbPatch.session_type = patch.sessionType;
    if (patch.quality !== undefined) dbPatch.quality = patch.quality;
    if (patch.durationMinutes !== undefined) dbPatch.duration_minutes = patch.durationMinutes ?? null;
    if (patch.note !== undefined) dbPatch.note = patch.note?.trim() || null;
    if (patch.nextReviewDate !== undefined) dbPatch.next_review_date = patch.nextReviewDate ?? null;
    if (patch.reviewNumber !== undefined) dbPatch.review_number = patch.reviewNumber;
    bg(supabase.from("learning_sessions").update(dbPatch as never).eq("id", id), "learning_sessions.update");
  }, []);

  const deleteLearningSession = useCallback((id: string) => {
    requireUser();
    setState((s) => ({
      ...s,
      learningSessions: (s.learningSessions ?? []).filter((r) => r.id !== id),
    }));
    bg(supabase.from("learning_sessions").delete().eq("id", id), "learning_sessions.delete");
  }, []);

  const setTabConfig = useCallback((tabs: TabConfig[]) => {
    const userId = requireUser();
    setState((s) => ({ ...s, tabConfig: tabs }));
    const sidebar = memState.sidebarConfig ?? [];
    bg(supabase.from("user_settings").upsert(
      { user_id: userId, tab_config: { home: tabs, sidebar } as unknown as Json },
      { onConflict: "user_id" },
    ), "user_settings.tab_config");
  }, []);

  const persistPreviewRoleScopedLayout = useCallback(async (
    roleId: string,
    scope: LayoutScope,
    patch: { sidebar?: SidebarConfig[]; layout?: WidgetLayout },
  ) => {
    const [profiles, assignments, blockProfiles, blockAssignments] = await Promise.all([
      loadRoleLayoutProfiles({ scope }),
      loadRoleLayoutProfileAssignments({ scope }),
      loadFeatureBlocklistProfiles({ scope }),
      loadRoleBlocklistAssignments({ scope }),
    ]);

    const existingAssignment = assignments.find((row) => row.roleId === roleId) ?? null;
    const existingBlockAssignment = blockAssignments.find((row) => row.roleId === roleId) ?? null;
    const profileId = existingAssignment?.profileId ?? existingBlockAssignment?.profileId ?? uid();
    const existingProfile = profiles.find((row) => row.id === profileId) ?? null;
    const existingBlockProfile = blockProfiles.find((row) => row.id === profileId) ?? null;

    const nextProfiles = [
      ...profiles.filter((row) => row.id !== profileId),
      {
        id: profileId,
        name: existingProfile?.name ?? `תצוגת תפקיד · ${roleId.slice(0, 6)}`,
        widgetLayout: patch.layout ?? existingProfile?.widgetLayout ?? {},
        sidebarConfig: patch.sidebar ?? existingProfile?.sidebarConfig ?? [],
        categoryTemplate: existingProfile?.categoryTemplate ?? [],
        updatedAt: Date.now(),
      },
    ];

    const nextAssignments = [
      ...assignments.filter((row) => row.roleId !== roleId),
      { id: existingAssignment?.id ?? uid(), roleId, profileId },
    ];
    const nextBlockProfiles = existingBlockProfile
      ? blockProfiles
      : [...blockProfiles, {
          id: profileId,
          name: existingProfile?.name ?? `תצוגת תפקיד · ${roleId.slice(0, 6)}`,
          blocklist: { sections: [], widgets: {} },
          updatedAt: Date.now(),
        }];
    const nextBlockAssignments = [
      ...blockAssignments.filter((row) => row.roleId !== roleId),
      { id: existingBlockAssignment?.id ?? uid(), roleId, profileId },
    ];

    await Promise.all([
      saveRoleLayoutProfiles(nextProfiles, { scope }),
      saveRoleLayoutProfileAssignments(nextAssignments, { scope }),
      saveFeatureBlocklistProfiles(nextBlockProfiles, { scope }),
      saveRoleBlocklistAssignments(nextBlockAssignments, { scope }),
      ...(scope === "desktop" ? [supabase.from("role_layout_defaults").delete().eq("role_id", roleId)] : []),
    ]);
  }, []);

  const setSidebarConfig = useCallback((sidebar: SidebarConfig[]) => {
    const userId = requireUser();
    setState((s) => ({ ...s, sidebarConfig: sidebar }));
    const previewRoleId = (typeof window !== "undefined")
      ? (window as unknown as { __previewRoleId?: string | null }).__previewRoleId ?? null
      : null;
    const previewLayoutScope: LayoutScope = (typeof window !== "undefined")
      ? ((window as unknown as { __previewLayoutScope?: LayoutScope | null }).__previewLayoutScope ?? "desktop")
      : "desktop";
    if (previewRoleId) {
      void (async () => {
        const { error } = await (async () => {
          try {
            await persistPreviewRoleScopedLayout(previewRoleId, previewLayoutScope, { sidebar });
            return { error: null as { message?: string } | null };
          } catch (e) {
            return { error: { message: e instanceof Error ? e.message : String(e) } };
          }
        })();
        if (error) toast({ title: "שמירה לתפקיד נכשלה", description: error.message, variant: "destructive" });
      })();
      return;
    }
    const home = memState.tabConfig ?? [];
    bg(supabase.from("user_settings").upsert(
      { user_id: userId, tab_config: { home, sidebar } as unknown as Json },
      { onConflict: "user_id" },
    ), "user_settings.sidebar_config");
  }, [persistPreviewRoleScopedLayout]);

  const setWidgetLayout = useCallback((layout: WidgetLayout) => {
    const userId = requireUser();
    const now = Date.now();
    setState((s) => ({ ...s, widgetLayout: layout }));
    const previewRoleId = (typeof window !== "undefined")
      ? (window as unknown as { __previewRoleId?: string | null }).__previewRoleId ?? null
      : null;
    const previewLayoutScope: LayoutScope = (typeof window !== "undefined")
      ? ((window as unknown as { __previewLayoutScope?: LayoutScope | null }).__previewLayoutScope ?? "desktop")
      : "desktop";
    if (previewRoleId) {
      // Preview mode: redirect save to the same unified profile used by the
      // admin editor; do NOT touch the administrator's personal settings.
      void (async () => {
        const { error } = await (async () => {
          try {
            await persistPreviewRoleScopedLayout(previewRoleId, previewLayoutScope, { layout });
            return { error: null as { message?: string } | null };
          } catch (e) {
            return { error: { message: e instanceof Error ? e.message : String(e) } };
          }
        })();
        if (error) toast({ title: "שמירה לתפקיד נכשלה", description: error.message, variant: "destructive" });
      })();
      return;
    }
    // 1. Sync writes: localStorage (instant) + IDB (immediate, survives localStorage clear)
    writeWidgetLayoutCache(userId, layout, now);
    void writeWidgetLayoutIdb(userId, layout, now);
    // 2. Cloud: 3 retries with backoff, then enqueue full-sync on exhaustion
    if (userId !== GUEST_ID && isSyncEnabled() && canPushToCloud()) {
      const MAX_RETRIES = 3;
      const trySaveToCloud = async (attempt: number): Promise<void> => {
        try {
          const { error } = await supabase.from("user_settings").upsert(
            {
              user_id: userId,
              widget_layout: layout as unknown as Json,
              widget_layout_updated_at: new Date(now).toISOString(),
            } as never,
            { onConflict: "user_id" },
          );
          if (error) {
            if (attempt < MAX_RETRIES) {
              await new Promise<void>((r) => setTimeout(r, 400 * attempt));
              return trySaveToCloud(attempt + 1);
            }
            console.error(`[widget_layout] cloud sync failed after ${MAX_RETRIES} attempts:`, error);
            void enqueueFullSyncJob(userId, `widget_layout: ${error.message ?? "unknown"}`).then(async () => {
              const jobs = await listSyncJobs(userId);
              markCloudSyncJobs(jobs.length);
            });
            toast({ title: "שגיאה בשמירה לשרת", description: "הפריסה נשמרה מקומית ותסונכרן בהמשך", variant: "destructive" });
          }
        } catch (err) {
          if (attempt < MAX_RETRIES) {
            await new Promise<void>((r) => setTimeout(r, 400 * attempt));
            return trySaveToCloud(attempt + 1);
          }
          console.error(`[widget_layout] cloud sync exception after ${MAX_RETRIES} attempts:`, err);
          void enqueueFullSyncJob(userId, `widget_layout: ${String(err)}`).then(async () => {
            const jobs = await listSyncJobs(userId);
            markCloudSyncJobs(jobs.length);
          });
        }
      };
      void trySaveToCloud(1);
    }
  }, [persistPreviewRoleScopedLayout]);

  /**
   * Non-persisting preview-mode setter. Applies a sidebar+widget layout to local
   * state ONLY (no cloud sync, no IDB/localStorage write). Used by the admin
   * "preview as role" iframe to render the app under another role's defaults
   * without overwriting the admin's own personal layout.
   */
  const _applyPreviewLayout = useCallback((sidebar: SidebarConfig[] | null, layout: WidgetLayout | null) => {
    setState((s) => ({
      ...s,
      ...(sidebar ? { sidebarConfig: sidebar } : {}),
      ...(layout ? { widgetLayout: layout } : {}),
    }));
  }, []);

  const setUiPref = useCallback(<K extends keyof UiPrefs>(key: K, value: UiPrefs[K]) => {
    const userId = requireUser();
    const next: UiPrefs = { ...(memState.uiPrefs ?? {}), [key]: value, updatedAt: Date.now() };
    setState((s) => ({ ...s, uiPrefs: next }));
    writeUiPrefsCache(userId, next);
    scheduleUiPrefsCloudSync(userId, next);
  }, []);

  // === Masechta Review Plans ===
  const addMasecthaReviewPlan = useCallback((
    title: string,
    units: string[],
    reviewScheduleType: "srs" | "fixed_interval" | "manual",
    fixedIntervalDays?: number,
    manualReviewDates?: string[],
    linkedDeckId?: string,
    reviewScopeType?: "masechta" | "perek" | "daf_range" | "custom",
    reviewScopeDetail?: string,
  ) => {
    const userId = requireUser();
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const newPlan: GeneralStudyPlan = {
      id: uid(),
      planType: "masechta_review",
      title,
      units,
      unitsPerDay: 1,
      startDate: Date.now(),
      completedUnits: [],
      reviewScheduleType,
      fixedIntervalDays,
      manualReviewDates,
      linkedDeckId,
      reviewScopeType,
      reviewScopeDetail,
    };

    const updatedPlans = [...(memState.generalPlans ?? []), newPlan];
    setState((s) => ({ ...s, generalPlans: updatedPlans }));
    bg(supabase.from("user_settings").upsert(
      { user_id: userId, general_plans: updatedPlans as unknown as Json },
      { onConflict: "user_id" },
    ), "user_settings.general_plans.masechta_review");

    // Create initial PlanReview entries
    const newReviews: PlanReview[] = [];
    if (reviewScheduleType === "manual" && manualReviewDates?.length) {
      units.forEach((unit) => {
        manualReviewDates.forEach((dueDate, i) => {
          newReviews.push({
            id: uid(), planId: newPlan.id, planTitle: title, unit,
            dueDate, doneAt: null, reviewIndex: i + 1, createdAt: Date.now(),
          });
        });
      });
    } else {
      // First review due today
      units.forEach((unit) => {
        newReviews.push({
          id: uid(), planId: newPlan.id, planTitle: title, unit,
          dueDate: todayStr, doneAt: null, reviewIndex: 1, createdAt: Date.now(),
        });
      });
    }

    if (newReviews.length > 0) {
      const updatedReviews = [...(memState.planReviews ?? []), ...newReviews];
      setState((s) => ({ ...s, planReviews: updatedReviews }));
      bg(supabase.from("user_settings").upsert(
        { user_id: userId, general_plan_reviews: updatedReviews as unknown as Json },
        { onConflict: "user_id" },
      ), "user_settings.general_plan_reviews.masechta_review");
    }
  }, []);

  // === Deck Review Plans ===
  const addDeckReviewPlan = useCallback((title: string, deckIds: string[], _opts?: Partial<GeneralStudyPlan>) => {
    const userId = requireUser();
    // units = deck names (for display); deckIds stored for session lookup
    const deckMap = Object.fromEntries((memState.decks ?? []).map((d) => [d.id, d.name]));
    const units = deckIds.map((id) => deckMap[id] ?? id);
    const newPlan: GeneralStudyPlan = {
      id: uid(),
      planType: "deck_review",
      title,
      units,
      deckIds,
      unitsPerDay: 1,
      startDate: Date.now(),
      completedUnits: [],
    };
    const updated = [...(memState.generalPlans ?? []), newPlan];
    setState((s) => ({ ...s, generalPlans: updated }));
    bg(supabase.from("user_settings").upsert(
      { user_id: userId, general_plans: updated as unknown as Json },
      { onConflict: "user_id" },
    ), "user_settings.general_plans.deck_review");
  }, []);

  // === General Study Plans ===
  const addGeneralPlan = useCallback((plan: Omit<GeneralStudyPlan, "id" | "startDate" | "completedUnits">) => {
    const userId = requireUser();
    const newPlan: GeneralStudyPlan = { ...plan, id: uid(), startDate: Date.now(), completedUnits: [] };
    const updated = [...(memState.generalPlans ?? []), newPlan];
    setState((s) => ({ ...s, generalPlans: updated }));
    bg(supabase.from("user_settings").upsert(
      { user_id: userId, general_plans: updated as unknown as Json },
      { onConflict: "user_id" },
    ), "user_settings.general_plans");
    return newPlan;
  }, []);

  const deleteGeneralPlan = useCallback((planId: string, _opts?: { purgeHistory?: boolean }) => {
    const userId = requireUser();
    const updated = (memState.generalPlans ?? []).filter((p) => p.id !== planId);
    setState((s) => ({ ...s, generalPlans: updated }));
    bg(supabase.from("user_settings").upsert(
      { user_id: userId, general_plans: updated as unknown as Json },
      { onConflict: "user_id" },
    ), "user_settings.general_plans");
  }, []);

  const updateGeneralPlan = useCallback((
    planId: string,
    patch: Partial<Omit<GeneralStudyPlan, "id" | "startDate" | "completedUnits">>,
  ) => {
    const userId = requireUser();
    const updated = (memState.generalPlans ?? []).map((p) =>
      p.id === planId ? { ...p, ...patch } : p,
    );
    const savedPlan = updated.find((p) => p.id === planId);
    setState((s) => ({ ...s, generalPlans: updated }));
    bg(supabase.from("user_settings").upsert(
      { user_id: userId, general_plans: updated as unknown as Json },
      { onConflict: "user_id" },
    ), "user_settings.general_plans");
  }, []);

  const completeGeneralPlanUnit = useCallback((planId: string, unit: string, _isoDate?: string) => {
    const userId = requireUser();
    const plan = (memState.generalPlans ?? []).find((p) => p.id === planId);
    const alreadyDone = plan?.completedUnits.includes(unit) ?? false;
    const updated = (memState.generalPlans ?? []).map((p) =>
      p.id !== planId ? p :
      { ...p, completedUnits: alreadyDone ? p.completedUnits : [...p.completedUnits, unit] }
    );
    setState((s) => ({ ...s, generalPlans: updated }));
    bg(supabase.from("user_settings").upsert(
      { user_id: userId, general_plans: updated as unknown as Json },
      { onConflict: "user_id" },
    ), "user_settings.general_plans");

    // Auto-log a learning session so it appears on the calendar / weekly summary
    if (!alreadyDone && plan) {
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const session: LearningSession = {
        id: uid(),
        date: dateStr,
        subject: `${plan.title} — ${unit}`,
        sessionType: "initial",
        quality: 5,
        durationMinutes: undefined,
        note: undefined,
        nextReviewDate: null,
        reviewNumber: 1,
        createdAt: Date.now(),
      };
      setState((s) => ({ ...s, learningSessions: [session, ...(s.learningSessions ?? [])] }));
      bg(supabase.from("learning_sessions").insert({
        id: session.id,
        user_id: userId,
        date: session.date,
        subject: session.subject,
        session_type: session.sessionType,
        quality: session.quality,
        duration_minutes: null,
        note: null,
        next_review_date: null,
        review_number: session.reviewNumber,
      }), "learning_sessions.insert.plan");

      // Schedule future review reminders based on plan schedule type
      const reviewScheduleType = plan.reviewScheduleType ?? "srs";

      let newReviews: PlanReview[];

      if (reviewScheduleType === "manual" && plan.manualReviewDates?.length) {
        // Reviews were already created at plan-creation time — skip
        newReviews = [];
      } else {
        let intervals: number[];
        if (reviewScheduleType === "fixed_interval") {
          const d = plan.fixedIntervalDays ?? 30;
          // 5 repeating reviews at d, 2d, 3d, 4d, 5d intervals
          intervals = [d, d * 2, d * 3, d * 4, d * 5];
        } else {
          // SRS default
          intervals = (memState.planReviewIntervals && memState.planReviewIntervals.length)
            ? memState.planReviewIntervals
            : [...PLAN_REVIEW_INTERVALS_DAYS];
        }
        newReviews = intervals.map((days, i) => {
          const due = new Date(today);
          due.setDate(due.getDate() + days);
          const dueDate = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
          return {
            id: uid(),
            planId,
            planTitle: plan.title,
            unit,
            dueDate,
            doneAt: null,
            reviewIndex: i + 1,
            createdAt: Date.now(),
          };
        });
      }
      const updatedReviews = [...(memState.planReviews ?? []), ...newReviews];
      setState((s) => ({ ...s, planReviews: updatedReviews }));
      bg(supabase.from("user_settings").upsert(
        { user_id: userId, general_plan_reviews: updatedReviews as unknown as Json },
        { onConflict: "user_id" },
      ), "user_settings.general_plan_reviews");
    }
  }, []);

  const undoLastGeneralPlanUnit = useCallback((planId: string) => {
    const userId = requireUser();
    const plan = (memState.generalPlans ?? []).find((p) => p.id === planId);
    const lastUnit = plan?.completedUnits[plan.completedUnits.length - 1];
    const updated = (memState.generalPlans ?? []).map((p) => {
      if (p.id !== planId) return p;
      return { ...p, completedUnits: p.completedUnits.slice(0, -1) };
    });
    setState((s) => ({ ...s, generalPlans: updated }));
    bg(supabase.from("user_settings").upsert(
      { user_id: userId, general_plans: updated as unknown as Json },
      { onConflict: "user_id" },
    ), "user_settings.general_plans");

    // Remove the most recent matching auto-logged learning session
    if (plan && lastUnit) {
      const targetSubject = `${plan.title} — ${lastUnit}`;
      const sessions = memState.learningSessions ?? [];
      const match = [...sessions]
        .filter((s) => s.subject === targetSubject && s.sessionType === "initial")
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (match) {
        setState((s) => ({
          ...s,
          learningSessions: (s.learningSessions ?? []).filter((r) => r.id !== match.id),
        }));
        bg(supabase.from("learning_sessions").delete().eq("id", match.id), "learning_sessions.delete.plan");
      }

      // Remove scheduled plan reviews for this unit
      const updatedReviews = (memState.planReviews ?? []).filter(
        (r) => !(r.planId === planId && r.unit === lastUnit)
      );
      setState((s) => ({ ...s, planReviews: updatedReviews }));
      bg(supabase.from("user_settings").upsert(
        { user_id: userId, general_plan_reviews: updatedReviews as unknown as Json },
        { onConflict: "user_id" },
      ), "user_settings.general_plan_reviews.undo");
    }
  }, []);

  const markPlanReviewDone = useCallback((reviewId: string, quality: PlanReviewQuality = 3) => {
    const userId = requireUser();
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const allReviews = memState.planReviews ?? [];
    const target = allReviews.find((r) => r.id === reviewId);
    if (!target) return;

    // Mark current review as done with grade
    let updated = allReviews.map((r) =>
      r.id === reviewId ? { ...r, doneAt: todayStr, quality } : r
    );

    // ─── SM-2 inspired: schedule the NEXT review based on quality ────────
    // quality 1 (שכחתי) → repeat in 1 day, do NOT advance reviewIndex
    // quality 2 (קשה)   → next interval × 0.7
    // quality 3 (טוב)   → next interval × 1.0 (default)
    // quality 4 (קל)    → next interval × 1.4
    const plan = (memState.generalPlans ?? []).find((p) => p.id === target.planId);
    const reviewScheduleType = plan?.reviewScheduleType ?? "srs";

    // For manual plans: reviews were pre-created, don't auto-schedule next
    if (reviewScheduleType === "manual") {
      setState((s) => ({ ...s, planReviews: updated }));
      bg(supabase.from("user_settings").upsert(
        { user_id: userId, general_plan_reviews: updated as unknown as Json },
        { onConflict: "user_id" },
      ), "user_settings.general_plan_reviews.mark");
      return;
    }

    const nextIndex = quality === 1 ? target.reviewIndex : target.reviewIndex + 1;
    const intervalsList = (memState.planReviewIntervals && memState.planReviewIntervals.length)
      ? memState.planReviewIntervals
      : [...PLAN_REVIEW_INTERVALS_DAYS];

    let intervalDays: number;
    if (reviewScheduleType === "fixed_interval") {
      const fixedDays = plan?.fixedIntervalDays ?? 30;
      // Fixed: quality still shifts ±30% but base is always fixedDays
      const qualityMult = quality === 1 ? 0.1 : quality === 2 ? 0.7 : quality === 4 ? 1.3 : 1.0;
      intervalDays = Math.max(1, Math.round(fixedDays * qualityMult));
    } else {
      const baseDays = nextIndex <= intervalsList.length
        ? intervalsList[nextIndex - 1]
        : Math.round(intervalsList[intervalsList.length - 1] * 1.5);

      const qualityMultiplier = quality === 1 ? 0.05 : quality === 2 ? 0.7 : quality === 4 ? 1.4 : 1.0;
      intervalDays = Math.max(1, Math.round(baseDays * qualityMultiplier));
    }

    // Smart scheduling: if target day already has >5 reviews due, fuzz ±2 days
    // to spread load. Only applied for intervals >= 3 days.
    if (intervalDays >= 3) {
      const candidate = new Date(today.getTime() + intervalDays * 86_400_000);
      const candidateStr = `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2, "0")}-${String(candidate.getDate()).padStart(2, "0")}`;
      const dayLoad = updated.filter((r) => r.dueDate === candidateStr && !r.doneAt).length;
      if (dayLoad > 5) {
        // Find lightest day within ±2 day window
        let bestDelta = 0;
        let bestLoad = dayLoad;
        for (const delta of [-2, -1, 1, 2]) {
          const altDays = intervalDays + delta;
          if (altDays < 1) continue;
          const alt = new Date(today.getTime() + altDays * 86_400_000);
          const altStr = `${alt.getFullYear()}-${String(alt.getMonth() + 1).padStart(2, "0")}-${String(alt.getDate()).padStart(2, "0")}`;
          const load = updated.filter((r) => r.dueDate === altStr && !r.doneAt).length;
          if (load < bestLoad) { bestLoad = load; bestDelta = delta; }
        }
        intervalDays += bestDelta;
      }
    }

    // Skip creating next review only if SRS quality=4 AND past max intervals (mastered)
    // Fixed-interval plans never "master" — they always continue
    const isMastered = reviewScheduleType === "srs" && quality === 4 && target.reviewIndex >= intervalsList.length;
    if (!isMastered) {
      const nextDue = new Date(today.getTime() + intervalDays * 86_400_000);
      const nextDueStr = `${nextDue.getFullYear()}-${String(nextDue.getMonth() + 1).padStart(2, "0")}-${String(nextDue.getDate()).padStart(2, "0")}`;
      const nextReview: PlanReview = {
        id: crypto.randomUUID(),
        planId: target.planId,
        planTitle: target.planTitle,
        unit: target.unit,
        dueDate: nextDueStr,
        doneAt: null,
        reviewIndex: nextIndex,
        createdAt: Date.now(),
      };
      updated = [...updated, nextReview];
    }

    setState((s) => ({ ...s, planReviews: updated }));
    bg(supabase.from("user_settings").upsert(
      { user_id: userId, general_plan_reviews: updated as unknown as Json },
      { onConflict: "user_id" },
    ), "user_settings.general_plan_reviews.mark");
  }, []);

  const undoPlanReviewDone = useCallback((reviewId: string) => {
    const userId = requireUser();
    const target = (memState.planReviews ?? []).find((r) => r.id === reviewId);
    // Remove any auto-scheduled NEXT review created at the same time (within 5s)
    let updated = (memState.planReviews ?? []).map((r) =>
      r.id === reviewId ? { ...r, doneAt: null, quality: undefined } : r
    );
    if (target?.doneAt) {
      // Find the most recently created future review for the same unit (auto-scheduled)
      const candidates = updated
        .filter((r) =>
          r.planId === target.planId &&
          r.unit === target.unit &&
          r.id !== reviewId &&
          !r.doneAt &&
          r.reviewIndex >= target.reviewIndex
        )
        .sort((a, b) => b.createdAt - a.createdAt);
      if (candidates.length > 0) {
        const removeId = candidates[0].id;
        updated = updated.filter((r) => r.id !== removeId);
      }
    }
    setState((s) => ({ ...s, planReviews: updated }));
    bg(supabase.from("user_settings").upsert(
      { user_id: userId, general_plan_reviews: updated as unknown as Json },
      { onConflict: "user_id" },
    ), "user_settings.general_plan_reviews.undo_done");
  }, []);

  const postponePlanReview = useCallback((reviewId: string, days: number = 1) => {
    const userId = requireUser();
    const safeDays = Math.max(1, Math.round(days));
    const updated = (memState.planReviews ?? []).map((r) => {
      if (r.id !== reviewId) return r;
      const base = new Date(r.dueDate + "T00:00:00");
      base.setDate(base.getDate() + safeDays);
      const newDue = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
      return { ...r, dueDate: newDue };
    });
    setState((s) => ({ ...s, planReviews: updated }));
    bg(supabase.from("user_settings").upsert(
      { user_id: userId, general_plan_reviews: updated as unknown as Json },
      { onConflict: "user_id" },
    ), "user_settings.general_plan_reviews.postpone");
  }, []);

  const setPlanReviewNote = useCallback((reviewId: string, note: string) => {
    const userId = requireUser();
    const trimmed = note.trim();
    const updated = (memState.planReviews ?? []).map((r) =>
      r.id === reviewId ? { ...r, note: trimmed || undefined } : r
    );
    setState((s) => ({ ...s, planReviews: updated }));
    bg(supabase.from("user_settings").upsert(
      { user_id: userId, general_plan_reviews: updated as unknown as Json },
      { onConflict: "user_id" },
    ), "user_settings.general_plan_reviews.note");
  }, []);

  // === Custom Category Templates (user-defined) ===
  const saveCustomTemplates = useCallback((list: CustomCategoryTemplate[]) => {
    const userId = requireUser();
    setState((s) => ({ ...s, customCategoryTemplates: list }));
    bg(supabase.from("user_settings").upsert(
      { user_id: userId, custom_category_templates: list as unknown as Json },
      { onConflict: "user_id" },
    ), "user_settings.custom_category_templates");
  }, []);
  const addCustomTemplate = useCallback((tpl: Omit<CustomCategoryTemplate, "id" | "createdAt" | "updatedAt">) => {
    const now = Date.now();
    const full: CustomCategoryTemplate = { ...tpl, id: uid(), createdAt: now, updatedAt: now };
    saveCustomTemplates([...(memState.customCategoryTemplates ?? []), full]);
    return full;
  }, [saveCustomTemplates]);
  const updateCustomTemplate = useCallback((id: string, patch: Partial<Omit<CustomCategoryTemplate, "id" | "createdAt">>) => {
    const list = (memState.customCategoryTemplates ?? []).map((t) =>
      t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t,
    );
    saveCustomTemplates(list);
  }, [saveCustomTemplates]);
  const deleteCustomTemplate = useCallback((id: string) => {
    saveCustomTemplates((memState.customCategoryTemplates ?? []).filter((t) => t.id !== id));
  }, [saveCustomTemplates]);

  // === Quiz Plans ===
  const persistQuizPlans = useCallback((list: QuizPlan[]) => {
    const userId = requireUser();
    setState((s) => ({ ...s, quizPlans: list }));
    bg(supabase.from("user_settings").upsert(
      { user_id: userId, quiz_plans: list as unknown as Json },
      { onConflict: "user_id" },
    ), "user_settings.quiz_plans");
  }, []);
  const persistQuizAttempts = useCallback((list: QuizAttempt[]) => {
    const userId = requireUser();
    setState((s) => ({ ...s, quizAttempts: list }));
    bg(supabase.from("user_settings").upsert(
      { user_id: userId, quiz_attempts: list as unknown as Json },
      { onConflict: "user_id" },
    ), "user_settings.quiz_attempts");
  }, []);
  const addQuizPlan = useCallback((plan: Omit<QuizPlan, "id" | "createdAt">) => {
    const newPlan: QuizPlan = { ...plan, id: uid(), createdAt: Date.now() };
    persistQuizPlans([...(memState.quizPlans ?? []), newPlan]);
    return newPlan;
  }, [persistQuizPlans]);
  const updateQuizPlan = useCallback((id: string, patch: Partial<Omit<QuizPlan, "id" | "createdAt">>) => {
    persistQuizPlans((memState.quizPlans ?? []).map((p) => p.id === id ? { ...p, ...patch } : p));
  }, [persistQuizPlans]);
  const deleteQuizPlan = useCallback((id: string) => {
    persistQuizPlans((memState.quizPlans ?? []).filter((p) => p.id !== id));
  }, [persistQuizPlans]);
  const setActiveQuizPlan = useCallback((id: string, active: boolean) => {
    persistQuizPlans((memState.quizPlans ?? []).map((p) => p.id === id ? { ...p, isActive: active } : p));
  }, [persistQuizPlans]);
  const addQuizAttempt = useCallback((attempt: Omit<QuizAttempt, "id">) => {
    const newAttempt: QuizAttempt = { ...attempt, id: uid() };
    persistQuizAttempts([...(memState.quizAttempts ?? []), newAttempt]);
    return newAttempt;
  }, [persistQuizAttempts]);
  const updateQuizAttempt = useCallback((id: string, patch: Partial<Omit<QuizAttempt, "id">>) => {
    persistQuizAttempts((memState.quizAttempts ?? []).map((a) => a.id === id ? { ...a, ...patch } : a));
  }, [persistQuizAttempts]);
  const deleteQuizAttempt = useCallback((id: string) => {
    persistQuizAttempts((memState.quizAttempts ?? []).filter((a) => a.id !== id));
  }, [persistQuizAttempts]);

  // === Delete all data for the current user ===
  const deleteAllUserData = useCallback(async () => {
    const userId = requireUser();
    const nowIso = new Date().toISOString();
    // Clear local state immediately
    setState(() => emptyState());
    // Delete from all tables (by user_id FK)
    await Promise.all([
      supabase.from("cards").update({ deleted_at: nowIso, updated_at: nowIso } as never).eq("user_id", userId).is("deleted_at", null),
      supabase.from("card_decks").delete().eq("user_id", userId),
      supabase.from("decks").update({ deleted_at: nowIso, updated_at: nowIso } as never).eq("user_id", userId).is("deleted_at", null),
      // Soft-delete categories (tombstones for multi-device sync)
      supabase.from("categories").update({ deleted_at: nowIso } as never).eq("user_id", userId).is("deleted_at", null),
      supabase.from("goals").delete().eq("user_id", userId),
      supabase.from("review_logs").delete().eq("user_id", userId),
      supabase.from("learning_sessions").delete().eq("user_id", userId),
      supabase.from("shas_reviews").delete().eq("user_id", userId),
      supabase.from("user_settings").update({
        shas_plans: null,
        active_shas_plan_id: null,
        general_plans: null,
        general_plan_reviews: null,
        custom_category_templates: null,
        quiz_plans: null,
        quiz_attempts: null,
      }).eq("user_id", userId),
    ]);
  }, []);

  // === Delete specific categories (and all their descendants + their cards + review logs) ===
  const deleteCategoriesWithData = useCallback(async (rootIds: string[]) => {
    requireUser();
    const cats = memState.categories ?? [];
    // Collect all descendant ids
    const toRemove = new Set<string>(rootIds);
    let changed = true;
    while (changed) {
      changed = false;
      cats.forEach((c) => {
        if (c.parentId && toRemove.has(c.parentId) && !toRemove.has(c.id)) {
          toRemove.add(c.id); changed = true;
        }
      });
    }
    const removedNames = new Set(
      cats.filter((c) => toRemove.has(c.id)).map((c) => c.name),
    );
    // Find all cards in those categories
    const cardIdsToDelete = new Set(
      (memState.cards ?? [])
        .filter((card) => card.tags.some((t) => t.startsWith("cat:") && removedNames.has(t.slice(4))))
        .map((c) => c.id),
    );
    // Update state
    setState((s) => ({
      ...s,
      categories: (s.categories ?? []).filter((c) => !toRemove.has(c.id)),
      cards: (s.cards ?? []).filter((c) => !cardIdsToDelete.has(c.id)),
      cardDecks: (s.cardDecks ?? []).filter((l) => !cardIdsToDelete.has(l.cardId)),
      logs: (s.logs ?? []).filter((l) => !cardIdsToDelete.has(l.cardId)),
    }));
    // Persist deletions
    const ops: PromiseLike<unknown>[] = [];
    // Categories: soft-delete with durable queue (tombstones for multi-device sync)
    softDeleteWithQueue("categories", [...toRemove]);
    // Cards
    const cardIdArr = [...cardIdsToDelete];
    if (cardIdArr.length) {
      // chunk in 100s to stay within URL limits
      for (let i = 0; i < cardIdArr.length; i += 100) {
        const chunk = cardIdArr.slice(i, i + 100);
        const nowIso = new Date().toISOString();
        ops.push(supabase.from("cards").update({ deleted_at: nowIso, updated_at: nowIso } as never).in("id", chunk).is("deleted_at", null));
        ops.push(supabase.from("card_decks").delete().in("card_id", chunk));
        ops.push(supabase.from("review_logs").delete().in("card_id", chunk));
      }
    }
    await Promise.all(ops);
  }, []);

  const requestCloudSyncNow = useCallback(async (reason = "manual") => {
    const userId = currentUserId;
    if (!userId || userId === GUEST_ID) {
      return { ok: false as const, reason: "guest-or-no-user", pendingAfter: 0 };
    }
    if (!canPushToCloud()) {
      return { ok: false as const, reason: "profile-b-pull-only", pendingAfter: 0 };
    }

    await enqueueFullSyncJob(userId, `force:${reason}`);
    await runPendingCloudSync(userId);
    const deleteFlush = await flushPendingDeletes(userId);
    const remaining = await listSyncJobs(userId);
    markCloudSyncJobs(remaining.length);
    const audit = await listDeleteAuditEvents(userId, 50);

    return {
      ok: remaining.length === 0,
      pendingAfter: remaining.length,
      deleteFlush,
      deleteAuditRecent: audit,
    };
  }, []);

  const getDeleteAuditHistory = useCallback(async (limit = 100) => {
    const userId = currentUserId;
    if (!userId || userId === GUEST_ID) {
      return {
        events: [],
        pendingCount: 0,
      };
    }

    const [events, pending] = await Promise.all([
      listDeleteAuditEvents(userId, limit),
      listPendingDeletes(userId),
    ]);

    return {
      events,
      pendingCount: pending.length,
    };
  }, []);

  return {
    state, addDeck, deleteDeck, addCard, bulkAddCards, bulkAddDecks, updateCard, duplicateCard, deleteCard,
    forkSourceCard, isCardFromSource,
    reviewCard, undoReview, deleteReviewLog, addCategory, addCategoriesBulk, deleteCategory,
    ensureUncategorized,
    renameCategory, duplicateCategory, duplicateCategoryUnder,
    addGoal, updateGoal, deleteGoal, toggleGoalDate,
    setShasPlan, setActiveShasPlan, clearShasPlan, deleteShasPlan, completeShasDaf, undoLastShasDaf, setShasUnit,
    setNotificationsEnabled, setReminderTime, setDayNote,
    addCardToDeck, removeCardFromDeck, setCardDecks, setDeckCategories, updateDeckCategoryIds,
    renameDeck,
    moveCategory, reorderCategories, moveCardToDeck, setCardCategories,
    loadCategoryChildren, isCategoryChildrenLoaded, isCategoryChildrenLoading, getCategoryHasChildren,
    getCategoryPerfSnapshot,
    markShasReviewDone, unmarkShasReviewDone, rescheduleShasReview,
    setShasReviewNote, deleteShasReview, addManualShasReview, setReviewIntervals,
    scheduleShasReviewsAt,
    setPlanReviewIntervals,
    addLearningSession, updateLearningSession, deleteLearningSession,
    setTabConfig,
    setSidebarConfig,
    setWidgetLayout,
    _applyPreviewLayout,
    setUiPref,
    addGeneralPlan, deleteGeneralPlan, updateGeneralPlan, completeGeneralPlanUnit, undoLastGeneralPlanUnit,
    /**
     * Cumulative progress setter — marks units[0..targetCount-1] as done and
     * un-marks the rest. Used to keep "כל היחידות" and "לוח ביצוע" perfectly
     * in sync: clicking any unit (or any calendar day) sets the progress to
     * that point.
     */
    setGeneralPlanProgressTo: (planId: string, targetCount: number): void => {
      const plan = (memState.generalPlans ?? []).find((p) => p.id === planId);
      if (!plan) return;
      const max = plan.units.length;
      const target = Math.max(0, Math.min(targetCount, max));
      const current = plan.completedUnits.length;
      if (target === current) return;
      if (target > current) {
        for (let i = current; i < target; i++) {
          completeGeneralPlanUnit(planId, plan.units[i]);
        }
      } else {
        for (let i = 0; i < current - target; i++) {
          undoLastGeneralPlanUnit(planId);
        }
      }
    },
    addMasecthaReviewPlan,
    addDeckReviewPlan,
    markPlanReviewDone, undoPlanReviewDone, postponePlanReview, setPlanReviewNote,
    addCustomTemplate, updateCustomTemplate, deleteCustomTemplate,
    addQuizPlan, updateQuizPlan, deleteQuizPlan, setActiveQuizPlan,
    addQuizAttempt, updateQuizAttempt, deleteQuizAttempt,
    getHydrationSnapshot,
    getCloudSyncSnapshot,
    getRecordSyncStatus,
    requestCloudSyncNow,
    getDeleteAuditHistory,
    deleteAllUserData, deleteCategoriesWithData,
    // === Stub methods (no-op shims for not-yet-implemented features) ===
    uncompleteSpecificUnit: (planId: string, unit: string): void => {
      const userId = requireUser();
      const updated = (memState.generalPlans ?? []).map((p) =>
        p.id !== planId ? p :
        { ...p, completedUnits: p.completedUnits.filter((u) => u !== unit) }
      );
      setState((s) => ({ ...s, generalPlans: updated }));
      bg(supabase.from("user_settings").upsert(
        { user_id: userId, general_plans: updated as unknown as Json },
        { onConflict: "user_id" },
      ), "user_settings.general_plans.uncomplete");
    },
    setPlanUnitNote: (planId: string, unit: string, note: string): void => {
      const userId = requireUser();
      const updated = (memState.generalPlans ?? []).map((p) => {
        if (p.id !== planId) return p;
        const next = { ...(p.unitNotes ?? {}) };
        const trimmed = note.trim();
        if (trimmed) next[unit] = trimmed;
        else delete next[unit];
        return { ...p, unitNotes: next };
      });
      setState((s) => ({ ...s, generalPlans: updated }));
      bg(supabase.from("user_settings").upsert(
        { user_id: userId, general_plans: updated as unknown as Json },
        { onConflict: "user_id" },
      ), "user_settings.general_plans.unitNote");
    },
    reschedulePlanReviews: (_planId: string): void => { /* TODO */ },
    archiveGeneralPlan: (planId: string): void => {
      const userId = requireUser();
      const updated = (memState.generalPlans ?? []).map((p) =>
        p.id === planId ? { ...p, archivedAt: Date.now() } : p,
      );
      setState((s) => ({ ...s, generalPlans: updated }));
      bg(supabase.from("user_settings").upsert(
        { user_id: userId, general_plans: updated as unknown as Json },
        { onConflict: "user_id" },
      ), "user_settings.general_plans.archive");
    },
    unarchiveGeneralPlan: (planId: string): void => {
      const userId = requireUser();
      const updated = (memState.generalPlans ?? []).map((p) =>
        p.id === planId ? { ...p, archivedAt: undefined } : p,
      );
      setState((s) => ({ ...s, generalPlans: updated }));
      bg(supabase.from("user_settings").upsert(
        { user_id: userId, general_plans: updated as unknown as Json },
        { onConflict: "user_id" },
      ), "user_settings.general_plans.unarchive");
    },
  };
}

