export type DeepRefreshResult = {
  clearedCaches: string[];
  swRegistrations: number;
};

export async function performDeepRefresh(): Promise<DeepRefreshResult> {
  const clearedCaches: string[] = [];
  let swRegistrations = 0;

  // 1) Ask active service workers to update before we reload.
  if ("serviceWorker" in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      swRegistrations = registrations.length;
      await Promise.all(
        registrations.map(async (registration) => {
          try {
            await registration.update();
          } catch {
            // Ignore per-registration failures and continue.
          }
        }),
      );
    } catch {
      // Ignore if the platform blocks SW introspection.
    }
  }

  // 2) Clear Cache Storage entries (Workbox/runtime caches).
  if ("caches" in window) {
    try {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map(async (name) => {
          const deleted = await caches.delete(name);
          if (deleted) clearedCaches.push(name);
        }),
      );
    } catch {
      // Ignore cache API failures; reload still proceeds.
    }
  }

  return { clearedCaches, swRegistrations };
}

export function navigateWithCacheBuster(): void {
  const next = new URL(window.location.href);
  next.searchParams.set("__deep_refresh", String(Date.now()));
  window.location.replace(next.toString());
}
