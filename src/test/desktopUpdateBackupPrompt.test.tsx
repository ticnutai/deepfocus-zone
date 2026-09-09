import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ backupResult: vi.fn() }));

vi.mock("@/hooks/usePreUpdateBackup", () => ({
  usePreUpdateBackup: () => mocks.backupResult,
}));

import { DesktopUpdateButton } from "@/components/DesktopUpdateButton";

describe("desktop update backup prompt", () => {
  beforeEach(() => {
    mocks.backupResult.mockResolvedValue({ ok: true, method: "cloud" });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete window.desktop;
  });

  it("offers a local download after the cloud backup and waits for the choice", async () => {
    let pushStatus: ((status: { type: "downloaded"; version: string }) => void) | undefined;
    const install = vi.fn().mockResolvedValue(undefined);
    window.desktop = {
      isElectron: true,
      platform: "win32",
      versions: {},
      updates: {
        getVersion: vi.fn().mockResolvedValue("2.7.13"),
        check: vi.fn().mockResolvedValue(undefined),
        download: vi.fn().mockResolvedValue(undefined),
        install,
        onStatus: vi.fn((callback) => {
          pushStatus = callback as typeof pushStatus;
          return () => undefined;
        }),
      },
    };
    render(<DesktopUpdateButton />);

    act(() => pushStatus?.({ type: "downloaded", version: "2.7.14" }));

    expect(await screen.findByText("רוצה להוריד גם עותק גיבוי למחשב?")).toBeInTheDocument();
    expect(screen.getByText("שני גיבויי העדכון האחרונים נשמרים בענן ומתחלפים אוטומטית.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /התקן עכשיו/ })).toBeDisabled();
    expect(install).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "לא עכשיו" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /התקן עכשיו/ })).not.toBeDisabled());
  });

  it("downloads the optional computer copy before continuing", async () => {
    let pushStatus: ((status: { type: "downloaded"; version: string }) => void) | undefined;
    mocks.backupResult
      .mockResolvedValueOnce({ ok: true, method: "cloud" })
      .mockResolvedValueOnce({ ok: true, method: "local" });
    window.desktop = {
      isElectron: true,
      platform: "win32",
      versions: {},
      updates: {
        getVersion: vi.fn().mockResolvedValue("2.7.13"),
        check: vi.fn().mockResolvedValue(undefined),
        download: vi.fn().mockResolvedValue(undefined),
        install: vi.fn().mockResolvedValue(undefined),
        onStatus: vi.fn((callback) => {
          pushStatus = callback as typeof pushStatus;
          return () => undefined;
        }),
      },
    };
    render(<DesktopUpdateButton />);
    act(() => pushStatus?.({ type: "downloaded", version: "2.7.14" }));

    fireEvent.click(await screen.findByRole("button", { name: "הורד למחשב" }));

    expect(await screen.findByText("עותק הגיבוי הורד גם למחשב.")).toBeInTheDocument();
    expect(mocks.backupResult).toHaveBeenLastCalledWith({ localCopyOnly: true });
  });
});
