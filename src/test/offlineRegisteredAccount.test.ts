import { beforeEach, describe, expect, it, vi } from "vitest";

const { cache, enqueueFullSyncJob, signInWithPassword } = vi.hoisted(() => ({
  cache: new Map<string, unknown>(),
  enqueueFullSyncJob: vi.fn(async () => undefined),
  signInWithPassword: vi.fn(),
}));

vi.mock("@/lib/study/indexedStateCache", () => ({
  enqueueFullSyncJob,
  loadStudyStateCache: vi.fn(async (key: string) => cache.get(key) ?? null),
  saveStudyStateCache: vi.fn(async (key: string, value: unknown) => { cache.set(key, value); }),
  clearStudyStateCache: vi.fn(async (key: string) => { cache.delete(key); }),
  flushGuestWorkspace: vi.fn(async () => undefined),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithPassword,
      signOut: vi.fn(async () => ({ error: null })),
    },
  },
}));

import {
  attemptRegisteredAccountReconnect,
  findLocalAccountByCredentials,
  listLocalAccounts,
  prepareRegisteredAccountReconnect,
  rememberOnlineAccountForOfflineLogin,
  switchLocalAccount,
} from "@/lib/auth/localAccount";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const PASSWORD = "correct horse battery staple";

describe("registered cloud account offline login", () => {
  beforeEach(() => {
    localStorage.clear();
    cache.clear();
    vi.clearAllMocks();
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
  });

  it("remembers only a salted verifier after a successful online login", async () => {
    await rememberOnlineAccountForOfflineLogin({
      userId: USER_ID,
      email: "learner@example.com",
      username: "learner",
      displayName: "לומד רשום",
      password: PASSWORD,
    });

    const [account] = listLocalAccounts();
    const serialized = localStorage.getItem("local-accounts:v1") ?? "";
    expect(account.status).toBe("registered");
    expect(account.userId).toBe(USER_ID);
    expect(account.passwordSalt).toBeTruthy();
    expect(account.passwordIterations).toBeGreaterThanOrEqual(200_000);
    expect(account.passwordObf).toBe("");
    expect(serialized).not.toContain(PASSWORD);
    expect(await findLocalAccountByCredentials("learner@example.com", PASSWORD)).toMatchObject({ userId: USER_ID });
    expect(await findLocalAccountByCredentials("learner", PASSWORD)).toMatchObject({ userId: USER_ID });
    expect(await findLocalAccountByCredentials("learner", "wrong password")).toBeNull();
  });

  it("restores the same cached workspace and queues a full sync after reconnect", async () => {
    const cloudState = { cards: [{ id: "cloud-card" }], categories: [], decks: [] };
    cache.set(USER_ID, cloudState);
    const account = await rememberOnlineAccountForOfflineLogin({
      userId: USER_ID,
      email: "learner@example.com",
      username: "learner",
      password: PASSWORD,
    });
    await switchLocalAccount(account.username);
    expect(cache.get("guest")).toEqual(cloudState);

    const offlineState = { cards: [{ id: "offline-card" }], categories: [], decks: [] };
    localStorage.setItem("guest-study-state", JSON.stringify(offlineState));
    prepareRegisteredAccountReconnect(account, PASSWORD);
    signInWithPassword.mockResolvedValue({
      data: { user: { id: USER_ID }, session: { user: { id: USER_ID } } },
      error: null,
    });

    await expect(attemptRegisteredAccountReconnect()).resolves.toEqual({ status: "reconnected" });
    expect(cache.get(USER_ID)).toEqual(offlineState);
    expect(enqueueFullSyncJob).toHaveBeenCalledWith(USER_ID, "registered-account-offline-reconnect");
  });

  it("never reconnects local data into a different cloud identity", async () => {
    const account = await rememberOnlineAccountForOfflineLogin({
      userId: USER_ID,
      email: "learner@example.com",
      username: "learner",
      password: PASSWORD,
    });
    await switchLocalAccount(account.username);
    prepareRegisteredAccountReconnect(account, PASSWORD);
    signInWithPassword.mockResolvedValue({
      data: { user: { id: "99999999-2222-4333-8444-555555555555" }, session: null },
      error: null,
    });

    await expect(attemptRegisteredAccountReconnect()).resolves.toMatchObject({ status: "failed" });
    expect(enqueueFullSyncJob).not.toHaveBeenCalled();
  });

  it("resumes pending offline work after the app restarts online", async () => {
    const account = await rememberOnlineAccountForOfflineLogin({
      userId: USER_ID,
      email: "learner@example.com",
      username: "learner",
      password: PASSWORD,
    });
    await switchLocalAccount(account.username);
    const offlineState = { cards: [{ id: "created-before-restart" }], categories: [], decks: [] };
    localStorage.setItem("guest-study-state", JSON.stringify(offlineState));
    enqueueFullSyncJob.mockClear();

    await rememberOnlineAccountForOfflineLogin({
      userId: USER_ID,
      email: "learner@example.com",
      username: "learner",
      password: PASSWORD,
    });

    expect(cache.get(USER_ID)).toEqual(offlineState);
    expect(enqueueFullSyncJob).toHaveBeenCalledWith(USER_ID, "registered-account-online-login-resume");
  });
});
