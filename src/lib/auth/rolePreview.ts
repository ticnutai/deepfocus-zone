/** Preview is read-only from initial load, before React effects run. */
export function isRolePreview(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('previewRole');
}
