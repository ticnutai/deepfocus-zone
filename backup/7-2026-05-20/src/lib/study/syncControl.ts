/**
 * Global cloud-sync toggle.
 * When disabled, all writes from `bg()` and the pending-sync runner are skipped.
 * IndexedDB / local state continues to work normally so the app stays usable offline.
 *
 * Toggle is persisted in localStorage so it survives reloads.
 */

const STORAGE_KEY = "pashash:sync-enabled";
const EVENT_NAME = "pashash:sync-enabled-change";

type Listener = (enabled: boolean) => void;
const listeners = new Set<Listener>();

function readFromStorage(): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true; // default: ON
    return raw === "1" || raw === "true";
  } catch {
    return true;
  }
}

let cached: boolean = readFromStorage();

export function isSyncEnabled(): boolean {
  return cached;
}

/**
 * Apply a value read from the cloud WITHOUT firing any events or cross-tab notifications.
 * Used during store hydration so cloud preferences propagate to this toggle.
 * Only updates if the incoming value differs from the current cached value.
 */
export function applyCloudSyncPref(enabled: boolean): void {
  const next = !!enabled;
  if (next === cached) return; // no-op
  cached = next;
  try {
    localStorage.setItem(STORAGE_KEY, cached ? "1" : "0");
  } catch {
    /* ignore */
  }
  // Notify in-process listeners (e.g. the inspector UI) without cross-tab events
  for (const fn of listeners) {
    try { fn(cached); } catch { /* swallow */ }
  }
}

export function setSyncEnabled(enabled: boolean): void {
  cached = !!enabled;
  try {
    localStorage.setItem(STORAGE_KEY, cached ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
  // Notify in-process listeners
  for (const fn of listeners) {
    try { fn(cached); } catch { /* swallow listener error */ }
  }
  // Notify other tabs
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: cached }));
  } catch {
    /* ignore */
  }
}

export function subscribeSyncEnabled(fn: Listener): () => void {
  listeners.add(fn);

  // Cross-tab via the storage event
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cached = readFromStorage();
      try { fn(cached); } catch { /* swallow */ }
    }
  };
  // Same-tab via custom event
  const onCustom = (e: Event) => {
    const detail = (e as CustomEvent<boolean>).detail;
    if (typeof detail === "boolean") {
      cached = detail;
      try { fn(cached); } catch { /* swallow */ }
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT_NAME, onCustom);
  }

  return () => {
    listeners.delete(fn);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT_NAME, onCustom);
    }
  };
}
