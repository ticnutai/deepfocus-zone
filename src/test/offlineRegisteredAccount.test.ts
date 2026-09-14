import { beforeEach, describe, expect, it, vi } from "vitest";

const { cache, enqueueFullSyncJob, signInWithPassword, signUp } = vi.hoisted(() => ({
  signUp: vi.fn(),
  cache: new Map<string, unknown>(),
  enqueueFullSyncJob: vi.fn(async () => undefined),
  signInWithPassword: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { signUp, signInWithPassword, signOut: vi.fn() } }) }));

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
  createLocalAccount,
  attemptDeferredRegistration,
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

  it('keeps an offline registration pending without calling the server', async () => {
    await createLocalAccount({ username: 'offline', password: PASSWORD });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    expect(await attemptDeferredRegistration()).toEqual({ status: 'offline' });
    expect(signUp).not.toHaveBeenCalled();
    expect(listLocalAccounts()[0].status).toBe('pending');
  });

  it('queues the saved study data and removes the registration secret on success', async () => {
    await createLocalAccount({ username: 'offline', password: PASSWORD });
    const saved = { cards: [{ id: 'offline-question' }], decks: [], categories: [] };
    localStorage.setItem('guest-study-state', JSON.stringify(saved));
    signUp.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    signInWithPassword.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    expect(await attemptDeferredRegistration()).toEqual({ status: 'registered' });
    expect(cache.get(USER_ID)).toEqual(saved);
    expect(enqueueFullSyncJob).toHaveBeenCalledWith(USER_ID, 'offline-registration-migration');
    expect(listLocalAccounts()[0].passwordObf).toBe('');
    expect(await attemptDeferredRegistration()).toEqual({ status: 'no-pending' });
  });

  it('retains registration and local data when the server rejects registration', async () => {
    await createLocalAccount({ username: 'offline', password: PASSWORD });
    localStorage.setItem('guest-study-state', '{"cards":[]}');
    signUp.mockResolvedValue({ data: {}, error: { message: 'email confirmation required' } });
    expect((await attemptDeferredRegistration()).status).toBe('failed');
    expect(listLocalAccounts()[0].passwordObf).toBe('');
    expect(listLocalAccounts()[0].status).toBe('pending');
    expect(localStorage.getItem('guest-study-state')).toBe('{"cards":[]}');
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

  it('does not finalize registration when durable sync queuing fails', async () => {
    await createLocalAccount({ username: 'queuefail', password: PASSWORD });
    localStorage.setItem('guest-study-state', '{"cards":[]}');
    signUp.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    signInWithPassword.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    enqueueFullSyncJob.mockRejectedValueOnce(new Error('storage full'));
    expect((await attemptDeferredRegistration()).status).toBe('failed');
    expect(listLocalAccounts()[0].status).toBe('pending');
  });

  it('does not mark another account registered when switching during signup', async () => {
    await createLocalAccount({ username: 'first', password: PASSWORD });
    signUp.mockImplementationOnce(async () => {
      await createLocalAccount({ username: 'second', password: PASSWORD });
      return { data: { user: { id: USER_ID } }, error: null };
    });
    expect((await attemptDeferredRegistration()).status).toBe('failed');
    expect(listLocalAccounts().map(a => a.status)).toEqual(['pending', 'pending']);
    expect(enqueueFullSyncJob).not.toHaveBeenCalled();
  });

  it('aborts registration when its auth owner is invalidated', async () => {
    await createLocalAccount({ username: 'cancelled', password: PASSWORD });
    signUp.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    expect((await attemptDeferredRegistration(() => false)).status).toBe('failed');
    expect(enqueueFullSyncJob).not.toHaveBeenCalled();
  });

  it('rejects a reconnect if the active local account changes during server login', async () => {
    const account = await rememberOnlineAccountForOfflineLogin({ userId: USER_ID, email: 'learner@example.com', username: 'learner', password: PASSWORD });
    await switchLocalAccount(account.username);
    prepareRegisteredAccountReconnect(account, PASSWORD);
    signInWithPassword.mockImplementationOnce(async () => {
      await createLocalAccount({ username: 'other', password: PASSWORD });
      return { data: { user: { id: USER_ID }, session: { user: { id: USER_ID } } }, error: null };
    });
    const result = await attemptRegisteredAccountReconnect();
    expect(result.status).toBe('failed');
  });

  it('does not finalize a pending account when the final login returns another identity', async () => {
    await createLocalAccount({ username: 'identityrace', password: PASSWORD });
    signUp.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    signInWithPassword
      .mockResolvedValueOnce({ data: { user: { id: USER_ID } }, error: null })
      .mockResolvedValueOnce({ data: { user: { id: 'different-user' } }, error: null });
    const result = await attemptDeferredRegistration();
    expect(result.status).toBe('failed');
    expect(listLocalAccounts()[0].status).toBe('pending');
    expect(localStorage.getItem('study-browser-reset-v3')).toBe('1');
  });

  it('does not queue offline data after logout invalidates a reconnect', async () => {
    const account = await rememberOnlineAccountForOfflineLogin({ userId: USER_ID, email: 'learner@example.com', username: 'learner', password: PASSWORD });
    await switchLocalAccount(account.username);
    localStorage.setItem('guest-study-state', '{"cards":[]}');
    prepareRegisteredAccountReconnect(account, PASSWORD);
    let current = true;
    signInWithPassword.mockImplementationOnce(async () => {
      current = false;
      return { data: { user: { id: USER_ID } }, error: null };
    });
    expect((await attemptRegisteredAccountReconnect(() => current)).status).toBe('failed');
    expect(enqueueFullSyncJob).not.toHaveBeenCalled();
  });

  it('retains retry credentials when reconnect queue storage fails', async () => {
    const account = await rememberOnlineAccountForOfflineLogin({ userId: USER_ID, email: 'learner@example.com', username: 'learner', password: PASSWORD });
    await switchLocalAccount(account.username);
    localStorage.setItem('guest-study-state', '{"cards":[]}');
    prepareRegisteredAccountReconnect(account, PASSWORD);
    signInWithPassword.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    enqueueFullSyncJob.mockRejectedValueOnce(new Error('quota exceeded'));
    expect((await attemptRegisteredAccountReconnect()).status).toBe('failed');
    expect((await attemptRegisteredAccountReconnect()).status).toBe('reconnected');
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
