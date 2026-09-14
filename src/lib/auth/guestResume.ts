const KEY = 'guest-resume-path:v1';
export function getGuestResumePath(): string | null {
  try {
    const path = localStorage.getItem(KEY);
    if (path && /^\/(?:\?|$|plan\/|split-view(?:\?|$))/.test(path) && !path.includes('\\')) return path;
  } catch { /* storage unavailable */ }
  return null;
}
export function rememberGuestResumePath(): void {
  const path = window.location.hash.startsWith('#/')
    ? window.location.hash.slice(1)
    : window.location.pathname + window.location.search;
  try { localStorage.setItem(KEY, path); } catch { /* storage unavailable */ }
}
