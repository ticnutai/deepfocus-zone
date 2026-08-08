/**
 * localAccount — offline-first registration.
 *
 * Lets a user REGISTER while offline: the account (username, display name,
 * optional email, password) is stored locally and the app enters local mode
 * immediately. When connectivity returns, `attemptDeferredRegistration()`
 * signs the account up on the server automatically (synthetic
 * `<username>@users.local` email when none was given — email verification is
 * not required by the server), migrates the offline study data into the new
 * account, wipes the locally-kept password, and signs the user in.
 *
 * The plaintext password must be kept (obfuscated) until server registration
 * succeeds — the server cannot accept a hash. It is deleted immediately after.
 */
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  enqueueFullSyncJob,
  loadStudyStateCache,
  saveStudyStateCache,
  clearStudyStateCache,
  flushGuestWorkspace,
} from "@/lib/study/indexedStateCache";
import type { StudyState } from "@/lib/study/types";

// Multiple local accounts can live on one machine, each with its own isolated
// offline study workspace. Only the ACTIVE account's data occupies the shared
// GUEST_ID slot (so the store's guest logic is untouched); every other
// account's data is parked in its own IndexedDB slot ("acct:<username>") and
// swapped into GUEST_ID on switch.
const ACCOUNTS_KEY = "local-accounts:v1";
const ACTIVE_KEY = "local-account-active:v1";
const OLD_SINGLE_KEY = "local-account:v1"; // pre-multi-account format (migrated)
const GUEST_STATE_LS_KEY = "guest-study-state";
// Must match store.ts — the small display-settings mirror for the guest slot.
const GUEST_SETTINGS_LS_KEY = "guest-display-settings";
const GUEST_ID = "guest";
// Must match store.ts — pre-marking skips the one-time legacy cache wipe so
// the migrated snapshot seeded below survives the first hydration.
const BROWSER_CACHE_RESET_KEY = "study-browser-reset-v3";

const dataKeyFor = (username: string) => `acct:${username}`;

export interface LocalAccount {
  username: string;
  displayName: string;
  email: string; // "" when not provided — synthetic address is used server-side
  passwordObf: string; // present only while status === "pending"
  passwordHash: string; // SHA-256, for offline sign-in verification
  status: "pending" | "registered";
  createdAt: number;
  registeredAt?: number;
  userId?: string;
}

/* ---------- storage ---------- */

function readAccounts(): LocalAccount[] {
  // One-time migration from the single-account format.
  try {
    const old = localStorage.getItem(OLD_SINGLE_KEY);
    if (old && !localStorage.getItem(ACCOUNTS_KEY)) {
      const parsed = JSON.parse(old) as LocalAccount;
      if (parsed && typeof parsed.username === "string") {
        localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([parsed]));
        localStorage.setItem(ACTIVE_KEY, parsed.username);
      }
      localStorage.removeItem(OLD_SINGLE_KEY);
    }
  } catch { /* ignore */ }
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as LocalAccount[];
    return Array.isArray(list) ? list.filter((a) => a && typeof a.username === "string") : [];
  } catch {
    return [];
  }
}

function writeAccounts(list: LocalAccount[]) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
}

export function listLocalAccounts(): LocalAccount[] {
  return readAccounts();
}

export function getActiveUsername(): string | null {
  const active = localStorage.getItem(ACTIVE_KEY);
  const list = readAccounts();
  if (active && list.some((a) => a.username === active)) return active;
  return list[0]?.username ?? null;
}

/** The account whose data currently occupies the shared workspace. */
export function getActiveLocalAccount(): LocalAccount | null {
  const active = getActiveUsername();
  if (!active) return null;
  return readAccounts().find((a) => a.username === active) ?? null;
}

// Backward-compatible alias used across the app for "the current local account".
export function getLocalAccount(): LocalAccount | null {
  return getActiveLocalAccount();
}

function upsertAccount(account: LocalAccount) {
  const list = readAccounts();
  const idx = list.findIndex((a) => a.username === account.username);
  if (idx >= 0) list[idx] = account;
  else list.push(account);
  writeAccounts(list);
}

/* ---------- per-account data slot swapping ---------- */

async function readGuestSlot(): Promise<StudyState | null> {
  // localStorage is written on every store notify → freshest snapshot.
  try {
    const raw = localStorage.getItem(GUEST_STATE_LS_KEY);
    if (raw) return JSON.parse(raw) as StudyState;
  } catch { /* fall through */ }
  try { return await loadStudyStateCache(GUEST_ID); } catch { return null; }
}

async function parkActiveData() {
  const active = getActiveUsername();
  if (!active) return;
  // Force the live store to persist its newest (throttled) edit first, so the
  // parked snapshot can never be a frame behind the workspace on screen.
  await flushGuestWorkspace();
  const state = await readGuestSlot();
  if (state) await saveStudyStateCache(dataKeyFor(active), state);
}

async function loadDataIntoGuestSlot(username: string) {
  const parked = await loadStudyStateCache(dataKeyFor(username)).catch(() => null);
  try { localStorage.setItem(BROWSER_CACHE_RESET_KEY, "1"); } catch { /* ignore */ }
  // Display settings are mirrored in their own record keyed to the shared guest
  // slot; drop it so the incoming account uses its OWN settings (carried inside
  // its parked state) instead of inheriting the previous account's.
  try { localStorage.removeItem(GUEST_SETTINGS_LS_KEY); } catch { /* ignore */ }
  if (parked) {
    await saveStudyStateCache(GUEST_ID, parked);
    try { localStorage.setItem(GUEST_STATE_LS_KEY, JSON.stringify(parked)); } catch { /* ignore */ }
  } else {
    // Fresh account → empty workspace (the store re-seeds the offline library).
    await clearStudyStateCache(GUEST_ID).catch(() => {});
    try { localStorage.removeItem(GUEST_STATE_LS_KEY); } catch { /* ignore */ }
  }
}

/**
 * Switches the active account: parks the current workspace, loads the target's
 * workspace into the shared slot, and marks it active. The caller should reload
 * the app afterwards so the store re-hydrates from the swapped data.
 */
export async function switchLocalAccount(username: string): Promise<boolean> {
  const list = readAccounts();
  if (!list.some((a) => a.username === username)) return false;
  if (getActiveUsername() === username) return true;
  await parkActiveData();
  await loadDataIntoGuestSlot(username);
  localStorage.setItem(ACTIVE_KEY, username);
  return true;
}

/**
 * Deletes a local account (defaults to the active one) and its parked data.
 * If the deleted account was active, switches to another account (or clears
 * the workspace when none remain).
 */
export async function deleteLocalAccount(username?: string): Promise<void> {
  const target = username ?? getActiveUsername();
  if (!target) return;
  const wasActive = getActiveUsername() === target;
  const remaining = readAccounts().filter((a) => a.username !== target);
  writeAccounts(remaining);
  await clearStudyStateCache(dataKeyFor(target)).catch(() => {});
  if (wasActive) {
    const next = remaining[0]?.username ?? null;
    if (next) {
      await loadDataIntoGuestSlot(next);
      localStorage.setItem(ACTIVE_KEY, next);
    } else {
      localStorage.removeItem(ACTIVE_KEY);
      await clearStudyStateCache(GUEST_ID).catch(() => {});
      try { localStorage.removeItem(GUEST_STATE_LS_KEY); } catch { /* ignore */ }
    }
  }
}

/* ---------- password helpers ---------- */

const OBF_KEY = "lemaan-local";

function obfuscate(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const key = new TextEncoder().encode(OBF_KEY);
  const mixed = bytes.map((b, i) => b ^ key[i % key.length]);
  let bin = "";
  mixed.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function deobfuscate(obf: string): string {
  const bin = atob(obf);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const key = new TextEncoder().encode(OBF_KEY);
  const orig = bytes.map((b, i) => b ^ key[i % key.length]);
  return new TextDecoder().decode(orig);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- public API ---------- */

// Usernames may contain any Unicode letter (Hebrew included), digits, dot and
// underscore — no spaces. Min 2 chars. The server strips non-ASCII from the
// username column, so a Hebrew username is kept locally and as display data,
// while server auth uses the ASCII synthetic email below.
export const USERNAME_RE = /^[\p{L}\p{N}_.]{2,}$/u;

/**
 * A valid ASCII email used for server auth when the user gave no email.
 * ASCII usernames keep the historical `<username>@users.local` form (so
 * previously-created accounts resolve unchanged); non-ASCII usernames (e.g.
 * Hebrew) map deterministically to an ASCII local-part derived from a stable
 * hash, because `hebrew@users.local` is not a legal email address.
 */
export function syntheticEmailForUsername(username: string): string {
  const u = username.trim().toLowerCase();
  if (/^[a-z0-9_.]{3,}$/.test(u)) return `${u}@users.local`;
  const ascii = u.replace(/[^a-z0-9_.]/g, "");
  let h = 2166136261;
  for (let i = 0; i < u.length; i++) { h ^= u.charCodeAt(i); h = Math.imul(h, 16777619); }
  const hash = (h >>> 0).toString(36);
  const base = ascii.length >= 2 ? ascii.slice(0, 20) : "user";
  return `${base}.${hash}@users.local`;
}

export interface CreateLocalAccountResult {
  ok: boolean;
  error?: string;
}

export async function createLocalAccount(input: {
  username: string;
  displayName?: string;
  email?: string;
  password: string;
}): Promise<CreateLocalAccountResult> {
  const username = input.username.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    return { ok: false, error: "שם המשתמש חייב להכיל לפחות 2 תווים (עברית/אנגלית, מספרים, נקודה או קו תחתון) וללא רווחים." };
  }
  // Offline mode: no password quality/length limits — any non-empty password.
  if (!(input.password ?? "").length) {
    return { ok: false, error: "יש להזין סיסמה." };
  }
  if (readAccounts().some((a) => a.username === username)) {
    return { ok: false, error: `כבר קיים חשבון בשם "${username}" במחשב זה. בחר שם אחר או התחבר אליו.` };
  }
  // Park the currently-active account's workspace, then give the new account a
  // fresh, isolated workspace.
  await parkActiveData();
  await loadDataIntoGuestSlot(username); // no parked data yet → clears the slot
  upsertAccount({
    username,
    displayName: (input.displayName ?? "").trim() || username,
    email: (input.email ?? "").trim(),
    passwordObf: obfuscate(input.password),
    passwordHash: await sha256(input.password),
    status: "pending",
    createdAt: Date.now(),
  });
  localStorage.setItem(ACTIVE_KEY, username);
  return { ok: true };
}

/**
 * Verifies credentials against ANY local account on this machine. Returns the
 * matching account (so the caller can switch to it) or null.
 */
export async function findLocalAccountByCredentials(usernameOrEmail: string, password: string): Promise<LocalAccount | null> {
  const id = usernameOrEmail.trim().toLowerCase();
  const hash = await sha256(password);
  for (const account of readAccounts()) {
    const matchesId = id === account.username
      || (!!account.email && id === account.email.toLowerCase())
      || id === syntheticEmailForUsername(account.username);
    if (matchesId && hash === account.passwordHash) return account;
  }
  return null;
}

export async function verifyLocalCredentials(usernameOrEmail: string, password: string): Promise<boolean> {
  return (await findLocalAccountByCredentials(usernameOrEmail, password)) !== null;
}

export function getPendingRegistration(): LocalAccount | null {
  const account = getActiveLocalAccount();
  return account?.status === "pending" && account.passwordObf ? account : null;
}

function markRegistered(userId: string | null) {
  const account = getActiveLocalAccount();
  if (!account) return;
  upsertAccount({
    ...account,
    passwordObf: "", // never keep the password after server registration
    status: "registered",
    registeredAt: Date.now(),
    userId: userId ?? account.userId,
  });
}

/* ---------- deferred server registration ---------- */

async function readGuestState(): Promise<StudyState | null> {
  try {
    const idb = await loadStudyStateCache(GUEST_ID);
    if (idb) return idb;
  } catch { /* fall back to localStorage */ }
  try {
    const raw = localStorage.getItem(GUEST_STATE_LS_KEY);
    if (raw) return JSON.parse(raw) as StudyState;
  } catch { /* ignore */ }
  return null;
}

async function migrateGuestDataToUser(userId: string) {
  const guestState = await readGuestState();
  if (!guestState) return;
  // Skip the store's one-time legacy cache wipe so this snapshot survives.
  try { localStorage.setItem(BROWSER_CACHE_RESET_KEY, "1"); } catch { /* ignore */ }
  await saveStudyStateCache(userId, guestState);
  await enqueueFullSyncJob(userId, "offline-registration-migration");
}

let attemptInFlight = false;

export interface DeferredRegistrationResult {
  status: "registered" | "no-pending" | "offline" | "failed" | "in-flight";
  message?: string;
}

/**
 * Registers the pending local account on the server, migrates the offline
 * data into it, and signs the main client in. Safe to call repeatedly (boot,
 * `online` events) — it no-ops unless there is pending work.
 */
const DBG = "[offline-reg]";

export async function attemptDeferredRegistration(): Promise<DeferredRegistrationResult> {
  if (attemptInFlight) { console.log(DBG, "skip: already in-flight"); return { status: "in-flight" }; }
  const pending = getPendingRegistration();
  if (!pending) { console.log(DBG, "skip: no pending account"); return { status: "no-pending" }; }
  if (typeof navigator !== "undefined" && !navigator.onLine) { console.log(DBG, "skip: navigator offline"); return { status: "offline" }; }

  attemptInFlight = true;
  try {
    const email = pending.email || syntheticEmailForUsername(pending.username);
    const password = deobfuscate(pending.passwordObf);
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    console.log(DBG, "start", {
      username: pending.username,
      email,
      hasUrl: !!url,
      urlHost: (() => { try { return new URL(url).host; } catch { return "INVALID:" + String(url); } })(),
      hasKey: !!key,
      keyLen: key ? String(key).length : 0,
      onLine: navigator.onLine,
    });

    // Isolated client: registering must not clobber the main client's session
    // state until data migration is staged.
    const isolated = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    let userId: string | null = null;
    console.log(DBG, "calling isolated.auth.signUp …");
    const { data, error } = await isolated.auth.signUp({
      email,
      password,
      options: { data: { display_name: pending.displayName, username: pending.username } },
    });
    console.log(DBG, "signUp returned", { hasSession: !!data?.session, userId: data?.user?.id ?? null, error: error ? { name: error.name, status: (error as { status?: number }).status, message: error.message } : null });
    if (error) {
      // A previous attempt may have succeeded without being recorded locally.
      if (/already registered|already exists/i.test(error.message)) {
        console.log(DBG, "already registered → trying sign-in");
        const { data: signInData, error: signInError } =
          await isolated.auth.signInWithPassword({ email, password });
        if (signInError) { console.error(DBG, "sign-in after already-registered failed", signInError); return { status: "failed", message: error.message }; }
        userId = signInData.user?.id ?? null;
        await isolated.auth.signOut();
      } else {
        console.error(DBG, "signUp failed", error);
        return { status: "failed", message: error.message };
      }
    } else {
      userId = data.user?.id ?? null;
    }

    if (userId) { console.log(DBG, "migrating guest data → user", userId); await migrateGuestDataToUser(userId); }

    // Hand the session to the main client — hydration will pick up the seeded
    // snapshot and the queued full-sync job pushes it to the cloud.
    console.log(DBG, "signing main client in …");
    const { error: mainSignInError } = await supabase.auth.signInWithPassword({ email, password });
    if (mainSignInError) {
      console.error(DBG, "main client sign-in failed", mainSignInError);
      // Keep the retry secret and pending state. Previously this path was
      // incorrectly marked registered and the queued data became stranded.
      return { status: "failed", message: mainSignInError.message };
    }
    markRegistered(userId);
    console.log(DBG, "registered ✓");
    return { status: "registered" };
  } catch (err) {
    console.error(DBG, "threw", err);
    return { status: "failed", message: err instanceof Error ? err.message : String(err) };
  } finally {
    attemptInFlight = false;
  }
}
