export type WorkspaceStartupGate = {
  authLoading: boolean;
  permissionsLoading: boolean;
  studyHydrated: boolean;
  blocklistLoading: boolean;
  presentationLayoutLoading: boolean;
  activeSectionNavigable: boolean;
  visibleSidebarCount: number;
};

/**
 * A pending startup source is not an access denial. Keep the content area
 * neutral until every source that decides the learner-facing shell has
 * settled, then (and only then) allow the real denial state to render.
 */
export function shouldSilentlyWaitForWorkspace(state: WorkspaceStartupGate): boolean {
  return state.authLoading
    || state.permissionsLoading
    || !state.studyHydrated
    || state.blocklistLoading
    || state.presentationLayoutLoading
    || (!state.activeSectionNavigable && state.visibleSidebarCount > 0);
}
