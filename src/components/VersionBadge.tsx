/**
 * Tiny version + update-date label, fixed at the bottom left of
 * the window. Values are injected at build time (see vite.config.ts `define`).
 */
import { useLocation } from 'react-router-dom';
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
  const location = useLocation();
  const section = new URLSearchParams(location.search).get('section');
  if (location.pathname !== '/' || (section && section !== 'home')) return null;
  const date = formatBuildDate(BUILD_ISO);
  return (
    <div
      dir="ltr"
      data-testid="app-version"
      className="app-version-badge pointer-events-none fixed z-[2000] select-none rounded bg-background/90 px-1.5 py-0.5 text-[9px] leading-tight text-muted-foreground"
      style={{ left: "max(4px, env(safe-area-inset-left, 0px))", bottom: "max(2px, env(safe-area-inset-bottom, 0px))" }}
      aria-hidden="true"
    >
      v{VERSION}{date ? ` · ${date}` : ""}
    </div>
  );
}
