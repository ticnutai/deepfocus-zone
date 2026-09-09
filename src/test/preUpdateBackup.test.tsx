import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestCloudSyncNow: vi.fn(),
  buildSnapshot: vi.fn(() => ({ version: 1, exportedAt: "now", data: {} })),
  saveCloudBackup: vi.fn(),
  exportJson: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/study/store", () => ({
  useStudy: () => ({ state: { cards: [] }, requestCloudSyncNow: mocks.requestCloudSyncNow }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1", email: "user@example.com" }, isGuest: false }),
}));
vi.mock("@/lib/study/backup", () => ({
  buildSnapshot: mocks.buildSnapshot,
  saveCloudBackup: mocks.saveCloudBackup,
  exportJson: mocks.exportJson,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc },
}));
describe("pre-update backup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestCloudSyncNow.mockResolvedValue(undefined);
    mocks.saveCloudBackup.mockResolvedValue(undefined);
    mocks.rpc.mockResolvedValue({ data: 1, error: null });
  });

  afterEach(() => {
    delete window.desktop;
  });

  it("tags cloud update backups and keeps only the newest two", async () => {
    vi.resetModules();
    const { usePreUpdateBackup } = await import("@/hooks/usePreUpdateBackup");
    const { result } = renderHook(() => usePreUpdateBackup());

    await act(async () => { await result.current(); });

    expect(mocks.requestCloudSyncNow).toHaveBeenCalledWith("pre-update-backup");
    expect(mocks.saveCloudBackup).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.stringContaining("גיבוי אוטומטי לפני עדכון"),
      expect.anything(),
      ["system:pre-update"],
    );
    expect(mocks.rpc).toHaveBeenCalledWith("prune_preupdate_backups", { p_keep: 2 });
  });

  it("downloads a manual local copy without creating another cloud backup", async () => {
    vi.resetModules();
    const { usePreUpdateBackup } = await import("@/hooks/usePreUpdateBackup");
    const { result } = renderHook(() => usePreUpdateBackup());

    await act(async () => { await result.current({ localCopyOnly: true }); });

    expect(mocks.exportJson).toHaveBeenCalledOnce();
    expect(mocks.requestCloudSyncNow).not.toHaveBeenCalled();
    expect(mocks.saveCloudBackup).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

});
