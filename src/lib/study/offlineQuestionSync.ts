import { supabase } from "@/integrations/supabase/client";
import { getLocalAccount } from "@/lib/auth/localAccount";
import { getActiveGuestViewProfile } from "@/lib/auth/guestViewProfile";
import { loadBundledLibraryIds } from "./bundledLibraryGuard";
import type { Card } from "./types";

const QUEUE_KEY = "lemaan:offline-question-outbox:v1";
const DEVICE_KEY = "lemaan:offline-device-id:v1";
type QueuedQuestion = { card: Card; queuedAt: number; attempts: number; lastError?: string };

function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, id); }
  return id;
}

function readQueue(): QueuedQuestion[] {
  try {
    const value = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as QueuedQuestion[];
    return Array.isArray(value) ? value.filter((row) => row?.card?.id && row?.card?.question) : [];
  } catch { return []; }
}

function writeQueue(rows: QueuedQuestion[]): void { localStorage.setItem(QUEUE_KEY, JSON.stringify(rows)); }

function identity(): { displayName: string; username: string | null } {
  const account = getLocalAccount();
  if (account) return { displayName: account.displayName || account.username, username: account.username };
  const profile = getActiveGuestViewProfile();
  return { displayName: profile?.label || "אורח אופליין", username: null };
}

export function enqueueOfflineQuestion(card: Card): void {
  const queue = readQueue();
  if (!queue.some((row) => row.card.id === card.id)) {
    queue.push({ card, queuedAt: Date.now(), attempts: 0 });
    writeQueue(queue);
  }
  if (typeof navigator === "undefined" || navigator.onLine) void flushOfflineQuestionQueue();
}

/** Recovers questions created by older versions before the outbox existed. */
export async function reconcileOfflineQuestions(cards: Card[]): Promise<void> {
  const bundled = await loadBundledLibraryIds();
  const queue = readQueue();
  const known = new Set(queue.map((row) => row.card.id));
  let changed = false;
  for (const card of cards) {
    if (
      bundled.cards.has(card.id)
      || known.has(card.id)
      || card.tags?.some((tag) => tag === "source:site_library" || tag.startsWith("source:builtin"))
    ) continue;
    queue.push({ card, queuedAt: card.createdAt || Date.now(), attempts: 0 });
    known.add(card.id); changed = true;
  }
  if (changed) writeQueue(queue);
  if (typeof navigator === "undefined" || navigator.onLine) await flushOfflineQuestionQueue();
}

let flushInFlight: Promise<{ sent: number; pending: number }> | null = null;

export function flushOfflineQuestionQueue(): Promise<{ sent: number; pending: number }> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = (async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return { sent: 0, pending: readQueue().length };
    const info = identity();
    const queue = readQueue();
    let sent = 0;
    for (const row of [...queue]) {
      const { error } = await supabase.rpc("submit_offline_question" as never, {
        p_device_key: deviceId(), p_display_name: info.displayName,
        p_local_username: info.username, p_card: row.card,
      } as never);
      if (error) {
        row.attempts += 1; row.lastError = error.message; writeQueue(queue); break;
      }
      const index = queue.findIndex((item) => item.card.id === row.card.id);
      if (index >= 0) queue.splice(index, 1);
      writeQueue(queue); sent += 1;
    }
    return { sent, pending: queue.length };
  })().finally(() => { flushInFlight = null; });
  return flushInFlight;
}

export function getOfflineQuestionQueueSize(): number { return readQueue().length; }
