/**
 * Tiny always-visible version + update-date label, fixed at the very top of
 * the window. Values are injected at build time (see vite.config.ts `define`).
 */
const VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";
const BUILD_ISO = typeof __BUILD_DATE__ !== "undefined" ? __BUILD_DATE__ : "";

function formatBuildDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

export function VersionBadge() {
  const date = formatBuildDate(BUILD_ISO);
  return (
    <div
      dir="ltr"
      className="pointer-events-none fixed top-0 left-1/2 z-[2000] -translate-x-1/2 select-none rounded-b-md bg-foreground/5 px-2 py-[1px] text-[9px] leading-tight tracking-wide text-muted-foreground/70"
      aria-hidden="true"
    >
      v{VERSION}{date ? ` · ${date}` : ""}
    </div>
  );
}
