/**
 * Guarded service-worker registration.
 * Per Lovable PWA skill: never register in dev / preview / iframe.
 * Also supports `?sw=off` kill-switch which unregisters any existing /sw.js.
 */
const APP_SW_URL = "/sw.js";

function isPreviewHost(host: string): boolean {
  return (
    host.startsWith("id-preview--") ||
    host.startsWith("preview--") ||
    host === "lovableproject.com" ||
    host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" ||
    host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" ||
    host.endsWith(".beta.lovable.dev")
  );
}

async function unregisterAppSW(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      regs
        .filter((r) => {
          const u = r.active?.scriptURL || r.waiting?.scriptURL || r.installing?.scriptURL || "";
          return u.endsWith(APP_SW_URL);
        })
        .map((r) => r.unregister()),
    );
  } catch {
    /* ignore */
  }
}

export function registerAppServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  // Dev builds never register
  if (!import.meta.env.PROD) {
    void unregisterAppSW();
    return;
  }
  // Inside an iframe → likely Lovable preview embed
  try {
    if (window.top !== window.self) {
      void unregisterAppSW();
      return;
    }
  } catch {
    void unregisterAppSW();
    return;
  }
  const host = window.location.hostname;
  if (isPreviewHost(host)) {
    void unregisterAppSW();
    return;
  }
  // Kill switch: ?sw=off
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("sw") === "off") {
      void unregisterAppSW();
      return;
    }
  } catch {
    /* ignore */
  }

  // Register once page is loaded so initial paint isn't slowed.
  const doRegister = () => {
    navigator.serviceWorker
      .register(APP_SW_URL, { scope: "/" })
      .catch(() => {
        /* silent */
      });
  };
  if (document.readyState === "complete") doRegister();
  else window.addEventListener("load", doRegister, { once: true });
}
