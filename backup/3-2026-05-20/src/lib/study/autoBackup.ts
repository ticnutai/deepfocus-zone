/**
 * Auto-backup system
 * Handles: config persistence, local-folder rotation, snapshot building by topic.
 */
import type { StudyState } from "./types";
import {
  buildSnapshot, buildTopicSnapshot, buildSettingsSnapshot,
  type BackupSnapshot,
} from "./backup";

// ─── Topic config ──────────────────────────────────────────────────────────

export interface AutoBackupTopics {
  /** קטגוריות, מערכות, כרטיסים + SRS */
  categories: boolean;
  /** תוכניות, יעדים, סשנים, הערות, חזרות ש"ס */
  plans: boolean;
  /** הגדרות ממשק: טאבים, סיידבר, ווידג'טים, uiPrefs */
  settings: boolean;
  /** גיבוי מלא — מחליף את שאר הנושאים */
  full: boolean;
}

export interface AutoBackupConfig {
  enabled: boolean;
  intervalMinutes: number;
  maxLocalBackups: number;
  localEnabled: boolean;
  cloudEnabled: boolean;
  lastRunAt: string | null;
  folderName: string | null;
  topics: AutoBackupTopics;
}

export const INTERVAL_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 5,    label: "כל 5 דקות"  },
  { value: 15,   label: "כל 15 דקות" },
  { value: 30,   label: "כל 30 דקות" },
  { value: 60,   label: "כל שעה"     },
  { value: 120,  label: "כל שעתיים"  },
  { value: 360,  label: "כל 6 שעות"  },
  { value: 720,  label: "כל 12 שעות" },
  { value: 1440, label: "פעם ביום"   },
];

export const DEFAULT_AUTO_BACKUP_CONFIG: AutoBackupConfig = {
  enabled: false,
  intervalMinutes: 60,
  maxLocalBackups: 50,
  localEnabled: true,
  cloudEnabled: false,
  lastRunAt: null,
  folderName: null,
  topics: { categories: true, plans: true, settings: false, full: false },
};

// ─── Config persistence ────────────────────────────────────────────────────

const CFG_KEY = "pashash_autobackup_v2";

export function loadAutoBackupConfig(): AutoBackupConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return deepClone(DEFAULT_AUTO_BACKUP_CONFIG);
    const p = JSON.parse(raw) as Partial<AutoBackupConfig>;
    return {
      ...DEFAULT_AUTO_BACKUP_CONFIG,
      ...p,
      topics: { ...DEFAULT_AUTO_BACKUP_CONFIG.topics, ...(p.topics ?? {}) },
    };
  } catch {
    return deepClone(DEFAULT_AUTO_BACKUP_CONFIG);
  }
}

export function saveAutoBackupConfig(cfg: AutoBackupConfig): void {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* quota */ }
}

function deepClone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

// ─── IndexedDB — persist FileSystemDirectoryHandle across sessions ──────────

const IDB_NAME    = "pashash_fs_handles_v1";
const IDB_STORE   = "handles";
const IDB_DIR_KEY = "auto_backup_dir";

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function persistFolderHandle(h: FileSystemDirectoryHandle): Promise<void> {
  const db = await openHandleDb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(h, IDB_DIR_KEY);
    tx.oncomplete = () => { db.close(); res(); };
    tx.onerror    = () => { db.close(); rej(tx.error); };
  });
}

export async function retrieveFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openHandleDb();
    return await new Promise((res, rej) => {
      const tx  = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_DIR_KEY);
      req.onsuccess = () => { db.close(); res((req.result as FileSystemDirectoryHandle | undefined) ?? null); };
      req.onerror   = () => { db.close(); rej(req.error); };
    });
  } catch { return null; }
}

export async function removeFolderHandle(): Promise<void> {
  try {
    const db = await openHandleDb();
    await new Promise<void>((res) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(IDB_DIR_KEY);
      tx.oncomplete = () => { db.close(); res(); };
    });
  } catch { /* ignore */ }
}

// ─── Permission helpers ────────────────────────────────────────────────────

export async function queryFolderPermission(h: FileSystemDirectoryHandle): Promise<PermissionState> {
  try { return await (h as unknown as { queryPermission: (o: { mode: string }) => Promise<PermissionState> }).queryPermission({ mode: "readwrite" }); }
  catch { return "denied"; }
}

export async function requestFolderAccess(h: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const r = await (h as unknown as { requestPermission: (o: { mode: string }) => Promise<PermissionState> }).requestPermission({ mode: "readwrite" });
    return r === "granted";
  } catch { return false; }
}

// ─── File operations with rotation ────────────────────────────────────────

const FILE_PREFIX = "pashash_auto_";

function makeAutoFilename(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
  const hms = `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  return `${FILE_PREFIX}${ymd}_${hms}.json`;
}
function p2(n: number): string { return String(n).padStart(2, "0"); }

/** List backup files, oldest first */
export async function listAutoBackupFiles(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  for await (const [name] of dir.entries()) {
    if (name.startsWith(FILE_PREFIX) && name.endsWith(".json")) names.push(name);
  }
  return names.sort(); // lexicographic = chronological (date prefix)
}

/**
 * Write snapshot to local folder, then remove oldest files if count exceeds maxFiles.
 * Returns the filename written.
 */
export async function writeAutoBackup(
  dir: FileSystemDirectoryHandle,
  snapshot: BackupSnapshot,
  maxFiles: number,
): Promise<string> {
  const filename = makeAutoFilename();
  const fh       = await dir.getFileHandle(filename, { create: true });
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify(snapshot, null, 2));
  await writable.close();

  // Rotate oldest
  const all = await listAutoBackupFiles(dir);
  if (all.length > maxFiles) {
    const stale = all.slice(0, all.length - maxFiles);
    await Promise.allSettled(stale.map((n) => dir.removeEntry(n)));
  }
  return filename;
}

// ─── Snapshot builder respecting topic selection ───────────────────────────

export function buildAutoSnapshot(
  state: StudyState,
  topics: AutoBackupTopics,
  exportedBy?: string,
): BackupSnapshot {
  if (topics.full) return buildSnapshot(state, exportedBy);

  // Selective: merge topics
  const snap = buildTopicSnapshot(state, {
    categoryIds: null,
    deckIds:     null,
    includeSrs:      topics.categories,
    includeGoals:    topics.plans,
    includePlans:    topics.plans,
    includeSessions: topics.plans,
    includeDayNotes: topics.plans,
    includeShasPlan: topics.plans,
    exportedBy,
  });

  // Zero out categories/decks/cards when topic not selected
  if (!topics.categories) {
    snap.data.decks       = [];
    snap.data.cards       = [];
    snap.data.categories  = [];
    snap.data.shasReviews = [];
    snap.data.reviewIntervals = [];
  }

  // Embed settings as extra field when topic selected (backward-compatible)
  if (topics.settings) {
    const s = buildSettingsSnapshot(state, exportedBy);
    (snap as BackupSnapshot & { settings?: unknown }).settings = s.settings;
  }

  return snap;
}
