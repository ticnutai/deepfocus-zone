/**
 * Lets the first-visit guides hub open a REAL per-feature interactive guide
 * (e.g. DeckCreationGuide, the question-creation walkthrough) after
 * navigating to its page — instead of just landing there silently.
 *
 * Flow: hub click → requestGuideOpen(id) → navigate → target page mounts →
 * its own auto-open effect calls consumePendingGuideRequest(id) once, which
 * force-opens it even if the user had previously dismissed it forever.
 */
const KEY = "pending-guide-open:v1";

export function requestGuideOpen(guideId: string): void {
  try { sessionStorage.setItem(KEY, guideId); } catch { /* ignore */ }
}

/** Returns true (and clears the request) exactly once per navigation. */
export function consumePendingGuideRequest(guideId: string): boolean {
  try {
    const pending = sessionStorage.getItem(KEY);
    if (pending !== guideId) return false;
    sessionStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
