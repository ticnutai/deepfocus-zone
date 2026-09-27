import { describe, expect, it } from 'vitest';
import { shouldSilentlyWaitForWorkspace, type WorkspaceStartupGate } from '@/lib/auth/workspaceStartupGate';

const settled: WorkspaceStartupGate = {
  authLoading: false,
  permissionsLoading: false,
  studyHydrated: true,
  blocklistLoading: false,
  presentationLayoutLoading: false,
  activeSectionNavigable: true,
  visibleSidebarCount: 1,
};

describe('workspace startup gate', () => {
  it.each([
    ['authLoading', true],
    ['permissionsLoading', true],
    ['studyHydrated', false],
    ['blocklistLoading', true],
    ['presentationLayoutLoading', true],
  ] as const)('waits silently while %s is unresolved', (key, value) => {
    expect(shouldSilentlyWaitForWorkspace({ ...settled, [key]: value })).toBe(true);
  });

  it('waits during a section handoff instead of flashing access denied', () => {
    expect(shouldSilentlyWaitForWorkspace({
      ...settled,
      activeSectionNavigable: false,
      visibleSidebarCount: 2,
    })).toBe(true);
  });

  it('allows a genuine denial only after every startup source settled', () => {
    expect(shouldSilentlyWaitForWorkspace({
      ...settled,
      activeSectionNavigable: false,
      visibleSidebarCount: 0,
    })).toBe(false);
  });
});
