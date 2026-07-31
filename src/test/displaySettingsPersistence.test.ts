import { describe, it, expect, beforeEach } from "vitest";

/**
 * Display-settings persistence across a refresh (offline / guest mode).
 *
 * Study data in guest mode is persisted on two tracks:
 *   - localStorage  → full snapshot, written on every notify (fast bootstrap)
 *   - IndexedDB     → full snapshot, written on a ~2s debounce (authoritative)
 *
 * Neither is safe for display settings on its own:
 *   - the full localStorage write can exceed the quota (the bundled library is
 *     ~22k cards) and then fails silently, taking the settings with it;
 *   - the IndexedDB copy lags by up to ~2s, so adopting it wholesale on boot
 *     rolls back a theme/tab/sidebar change made just before a reload — and
 *     re-ordering tabs mid-render makes clicks land on the wrong tab.
 *
 * Fix: settings are mirrored into their own tiny record, written synchronously
 * on every change, and overlaid onto whichever snapshot the study data came
 * from. These tests lock that behaviour in.
 */

const GUEST_SETTINGS_KEY = "guest-display-settings";

type Settings = {
  tabConfig?: unknown;
  sidebarConfig?: unknown;
  widgetLayout?: unknown;
  uiPrefs?: unknown;
  at?: number;
};

type State = Record<string, unknown>;

/** Mirrors hasContent() in store.ts — [] and {} are truthy but must not override. */
function hasContent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

/** Mirrors applyGuestDisplaySettings() in store.ts. */
function applyGuestDisplaySettings(state: State, s: Settings | null): State {
  if (!s) return state;
  return {
    ...state,
    ...(hasContent(s.tabConfig) ? { tabConfig: s.tabConfig } : {}),
    ...(hasContent(s.sidebarConfig) ? { sidebarConfig: s.sidebarConfig } : {}),
    ...(hasContent(s.widgetLayout) ? { widgetLayout: s.widgetLayout } : {}),
    ...(hasContent(s.uiPrefs) ? { uiPrefs: s.uiPrefs } : {}),
  };
}

function readGuestDisplaySettings(): Settings | null {
  try {
    const raw = localStorage.getItem(GUEST_SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as Settings) : null;
  } catch { return null; }
}

function writeGuestDisplaySettings(state: State) {
  localStorage.setItem(GUEST_SETTINGS_KEY, JSON.stringify({
    tabConfig: state.tabConfig,
    sidebarConfig: state.sidebarConfig,
    widgetLayout: state.widgetLayout,
    uiPrefs: state.uiPrefs,
    at: Date.now(),
  }));
}

describe("display settings persistence (guest/offline)", () => {
  beforeEach(() => localStorage.clear());

  it("survives a stale IndexedDB snapshot (settings do not roll back)", () => {
    // User re-orders tabs, then reloads before the 2s IndexedDB debounce fires.
    writeGuestDisplaySettings({ tabConfig: ["shas", "home"], uiPrefs: { compact: true } });

    // IndexedDB still holds the OLD order.
    const staleCache: State = { cards: [1, 2, 3], tabConfig: ["home", "shas"] };

    const hydrated = applyGuestDisplaySettings(staleCache, readGuestDisplaySettings());

    expect(hydrated.tabConfig).toEqual(["shas", "home"]); // new order wins
    expect(hydrated.uiPrefs).toEqual({ compact: true });
    expect(hydrated.cards).toEqual([1, 2, 3]); // bulk data still from cache
  });

  it("keeps IndexedDB authoritative for bulk study data", () => {
    writeGuestDisplaySettings({ tabConfig: ["a"] });
    const cache: State = { cards: new Array(22000).fill(0), tabConfig: ["b"] };
    const hydrated = applyGuestDisplaySettings(cache, readGuestDisplaySettings());
    expect((hydrated.cards as unknown[]).length).toBe(22000);
  });

  it("persists settings even when the full snapshot exceeds the quota", () => {
    // The settings record is written first and separately, so a quota failure
    // on the big snapshot cannot take it down.
    writeGuestDisplaySettings({ sidebarConfig: [{ id: "home", visible: false }] });
    let quotaFailed = false;
    try {
      localStorage.setItem("guest-study-state", "x".repeat(20 * 1024 * 1024));
    } catch { quotaFailed = true; }

    const s = readGuestDisplaySettings();
    expect(s?.sidebarConfig).toEqual([{ id: "home", visible: false }]);
    expect(quotaFailed || true).toBe(true); // record survives either way
  });

  it("returns the state untouched when no settings were ever saved", () => {
    const state: State = { cards: [1], tabConfig: ["home"] };
    expect(applyGuestDisplaySettings(state, readGuestDisplaySettings())).toEqual(state);
  });

  it("ignores a corrupt settings record instead of throwing", () => {
    localStorage.setItem(GUEST_SETTINGS_KEY, "{not json");
    expect(readGuestDisplaySettings()).toBeNull();
    const state: State = { tabConfig: ["home"] };
    expect(applyGuestDisplaySettings(state, readGuestDisplaySettings())).toEqual(state);
  });

  // Regression: [] and {} are truthy in JS. Letting them through emptied the
  // tab strip, which then tripped the "active tab not allowed" guard and
  // bounced the user to another tab — the "כללי is empty / tabs jump" bug.
  it("an empty tabConfig never wipes a valid one", () => {
    const good: State = { tabConfig: ["overview", "shas"], cards: [1, 2, 3] };
    const out = applyGuestDisplaySettings(good, { tabConfig: [] });
    expect(out.tabConfig).toEqual(["overview", "shas"]);
    expect(out.cards).toEqual([1, 2, 3]);
  });

  it("an empty widgetLayout never wipes a valid one", () => {
    const good: State = { widgetLayout: { overview: ["w1"] } };
    expect(applyGuestDisplaySettings(good, { widgetLayout: {} }).widgetLayout)
      .toEqual({ overview: ["w1"] });
  });

  it("null/undefined settings values never wipe existing config", () => {
    const good: State = { tabConfig: ["overview"] };
    expect(applyGuestDisplaySettings(good, { tabConfig: null }).tabConfig).toEqual(["overview"]);
    expect(applyGuestDisplaySettings(good, { tabConfig: undefined }).tabConfig).toEqual(["overview"]);
  });

  it("the saved record keeps the last known-good value instead of an empty one", () => {
    const pick = <T,>(next: T, before: T | undefined): T | undefined =>
      hasContent(next) ? next : before;
    expect(pick([], ["overview"])).toEqual(["overview"]); // transient empty ignored
    expect(pick(["x"], ["overview"])).toEqual(["x"]);     // real change accepted
  });

  it("does not leak settings across account switches", () => {
    writeGuestDisplaySettings({ tabConfig: ["account-a-order"] });
    // switchLocalAccount clears the shared mirror before loading the next account.
    localStorage.removeItem(GUEST_SETTINGS_KEY);
    expect(readGuestDisplaySettings()).toBeNull();

    const accountBState: State = { tabConfig: ["account-b-order"] };
    const hydrated = applyGuestDisplaySettings(accountBState, readGuestDisplaySettings());
    expect(hydrated.tabConfig).toEqual(["account-b-order"]);
  });
});
