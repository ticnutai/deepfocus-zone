import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc },
}));

import { startCloudActivityTracking } from "@/lib/auth/activityTracking";

describe("cloud activity tracking", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.rpc.mockReset().mockResolvedValue({ error: null });
    sessionStorage.clear();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    delete window.desktop;
  });

  it("retries a login that started offline when connectivity returns", async () => {
    const stop = startCloudActivityTracking("user-1", "session-1");
    await vi.runAllTicks();
    expect(mocks.rpc).not.toHaveBeenCalled();

    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("record_user_activity", expect.objectContaining({
      p_event: "login",
      p_client_type: "web",
    })));

    const loginCalls = mocks.rpc.mock.calls.filter(([name, args]) =>
      name === "record_user_activity" && args?.p_event === "login");
    expect(loginCalls).toHaveLength(1);
    stop();
  });

  it("records Electron as desktop", async () => {
    window.desktop = { isElectron: true } as typeof window.desktop;
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const stop = startCloudActivityTracking("user-2", "session-2");

    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("record_user_activity", expect.objectContaining({
      p_event: "login",
      p_client_type: "desktop",
    })));
    stop();
  });
});
