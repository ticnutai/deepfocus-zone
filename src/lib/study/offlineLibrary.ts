import type { GuestStudySeed } from "@/lib/auth/guestViewProfile";

export interface BundledOfflineLibraryInfo {
  generatedAt: string;
  sourceUserId: string | null;
  seed: GuestStudySeed;
}

let libraryPromise: Promise<BundledOfflineLibraryInfo | null> | null = null;

/**
 * Lazily loads the large read-only library embedded in production builds.
 * Keeping it in a separate generated module avoids slowing the login screen.
 */
export function loadBundledOfflineLibrary(): Promise<BundledOfflineLibraryInfo | null> {
  if (!libraryPromise) {
    libraryPromise = import("./offlineLibrary.generated.json")
      .then((module) => {
        const payload = module.default as BundledOfflineLibraryInfo;
        if (!payload?.seed || !Array.isArray(payload.seed.cards) || !Array.isArray(payload.seed.categories)) {
          return null;
        }
        return payload;
      })
      .catch((error) => {
        console.warn("[offline-library] bundled library could not be loaded", error);
        return null;
      });
  }
  return libraryPromise;
}
