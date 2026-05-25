import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { StudyState, Card as StudyCard, Deck as StudyDeck, Category as StudyCategory } from "@/lib/study/types";
import {
  RefreshCw,
  RotateCcw,
  Database,
  Key,
  Clock,
  Activity,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudOff,
  HardDrive,
  TableIcon,
  Download,
  Upload,
  Filter,
  ChevronUp,
  ArrowUp,
  ArrowDown,
  Monitor,
  ArrowLeftRight,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { isSyncEnabled, setSyncEnabled, subscribeSyncEnabled } from "@/lib/study/syncControl";
import { useStudy } from "@/lib/study/store";
import { getIndexedMonitorSnapshot, clearAllIndexedStudyStorage, clearStudyStateCache, saveStudyStateCache, enqueueFullSyncJob, loadStudyStateCache, getOrCreateDeviceId, type IndexedMonitorSnapshot } from "@/lib/study/indexedStateCache";
import { mergePartialIntoState } from "@/lib/study/backupSelection";
import { defaultSrs } from "@/lib/study/srs";
import { BackupTreeDialog } from "@/components/dev/BackupTreeDialog";
import { Progress } from "@/components/ui/progress";

/* ─────────────────────────────────────────────
   Static schema derived from types.ts
   ───────────────────────────────────────────── */

type ColDef = {
  name: string;
  type: string;
  nullable: boolean;
  isPK?: boolean;
  isFK?: boolean;
};

type TableSchema = {
  name: string;
  label: string;
  syncField: "updated_at" | "created_at" | "unlocked_at" | "assigned_at" | null;
  idField: string;
  cols: ColDef[];
};

const SCHEMA: TableSchema[] = [
  {
    name: "achievements", label: "הישגים", syncField: "unlocked_at", idField: "id",
    cols: [
      { name: "id", type: "uuid", nullable: false, isPK: true },
      { name: "user_id", type: "uuid", nullable: false, isFK: true },
      { name: "code", type: "text", nullable: false },
      { name: "unlocked_at", type: "timestamptz", nullable: false },
      { name: "meta", type: "json", nullable: false },
    ],
  },
  {
    name: "app_roles", label: "תפקידי מערכת", syncField: "updated_at", idField: "id",
    cols: [
      { name: "id", type: "uuid", nullable: false, isPK: true },
      { name: "name", type: "text", nullable: false },
      { name: "description", type: "text", nullable: true },
      { name: "is_system", type: "boolean", nullable: false },
      { name: "created_at", type: "timestamptz", nullable: false },
      { name: "updated_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "approved_emails", label: "אימיילים מאושרים", syncField: "created_at", idField: "id",
    cols: [
      { name: "id", type: "uuid", nullable: false, isPK: true },
      { name: "email", type: "text", nullable: false },
      { name: "note", type: "text", nullable: true },
      { name: "added_by", type: "uuid", nullable: true, isFK: true },
      { name: "created_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "card_categories", label: "שיוך כרטיס-קטגוריה", syncField: "updated_at", idField: "id",
    cols: [
      { name: "id", type: "uuid", nullable: false, isPK: true },
      { name: "card_id", type: "uuid", nullable: false, isFK: true },
      { name: "category_id", type: "uuid", nullable: false, isFK: true },
      { name: "user_id", type: "uuid", nullable: false, isFK: true },
      { name: "sort_order", type: "integer", nullable: false },
      { name: "created_at", type: "timestamptz", nullable: false },
      { name: "updated_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "card_decks", label: "שיוך כרטיס-מערכת", syncField: "updated_at", idField: "id",
    cols: [
      { name: "id", type: "uuid", nullable: false, isPK: true },
      { name: "card_id", type: "uuid", nullable: false, isFK: true },
      { name: "deck_id", type: "uuid", nullable: false, isFK: true },
      { name: "user_id", type: "uuid", nullable: false, isFK: true },
      { name: "sort_order", type: "integer", nullable: false },
      { name: "created_at", type: "timestamptz", nullable: false },
      { name: "updated_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "cards", label: "כרטיסי למידה", syncField: "updated_at", idField: "id",
    cols: [
      { name: "id", type: "uuid", nullable: false, isPK: true },
      { name: "user_id", type: "uuid", nullable: false, isFK: true },
      { name: "question", type: "text", nullable: false },
      { name: "answer", type: "text", nullable: true },
      { name: "type", type: "text", nullable: false },
      { name: "explanation", type: "text", nullable: true },
      { name: "options", type: "json", nullable: true },
      { name: "correct_indices", type: "json", nullable: true },
      { name: "correct_boolean", type: "boolean", nullable: true },
      { name: "tags", type: "json", nullable: false },
      { name: "srs", type: "json", nullable: false },
      { name: "stats", type: "json", nullable: false },
      { name: "deck_id", type: "uuid", nullable: true, isFK: true },
      { name: "masechta", type: "text", nullable: true },
      { name: "daf", type: "integer", nullable: true },
      { name: "amud", type: "integer", nullable: true },
      { name: "sort_order", type: "integer", nullable: false },
      { name: "created_at", type: "timestamptz", nullable: false },
      { name: "updated_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "categories", label: "קטגוריות", syncField: "updated_at", idField: "id",
    cols: [
      { name: "id", type: "uuid", nullable: false, isPK: true },
      { name: "user_id", type: "uuid", nullable: false, isFK: true },
      { name: "name", type: "text", nullable: false },
      { name: "parent_id", type: "uuid", nullable: true, isFK: true },
      { name: "color", type: "text", nullable: true },
      { name: "sort_order", type: "integer", nullable: false },
      { name: "deleted_at", type: "timestamptz", nullable: true },
      { name: "created_at", type: "timestamptz", nullable: false },
      { name: "updated_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "day_notes", label: "הערות יומיות", syncField: "updated_at", idField: "id",
    cols: [
      { name: "id", type: "uuid", nullable: false, isPK: true },
      { name: "user_id", type: "uuid", nullable: false, isFK: true },
      { name: "date", type: "date", nullable: false },
      { name: "text", type: "text", nullable: false },
      { name: "updated_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "decks", label: "מערכות שאלות", syncField: "updated_at", idField: "id",
    cols: [
      { name: "id", type: "uuid", nullable: false, isPK: true },
      { name: "user_id", type: "uuid", nullable: false, isFK: true },
      { name: "name", type: "text", nullable: false },
      { name: "description", type: "text", nullable: true },
      { name: "color", type: "text", nullable: false },
      { name: "category_ids", type: "json", nullable: false },
      { name: "include_sub_categories", type: "boolean", nullable: false },
      { name: "created_at", type: "timestamptz", nullable: false },
      { name: "updated_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "goals", label: "יעדים", syncField: "updated_at", idField: "id",
    cols: [
      { name: "id", type: "uuid", nullable: false, isPK: true },
      { name: "user_id", type: "uuid", nullable: false, isFK: true },
      { name: "title", type: "text", nullable: false },
      { name: "type", type: "text", nullable: false },
      { name: "target", type: "integer", nullable: false },
      { name: "active", type: "boolean", nullable: false },
      { name: "deck_id", type: "uuid", nullable: true, isFK: true },
      { name: "window_days", type: "integer", nullable: true },
      { name: "manual_done_dates", type: "json", nullable: false },
      { name: "created_at", type: "timestamptz", nullable: false },
      { name: "updated_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "learning_sessions", label: "סשנים", syncField: "updated_at", idField: "id",
    cols: [
      { name: "id", type: "uuid", nullable: false, isPK: true },
      { name: "user_id", type: "uuid", nullable: false, isFK: true },
      { name: "subject", type: "text", nullable: false },
      { name: "date", type: "date", nullable: false },
      { name: "session_type", type: "text", nullable: false },
      { name: "review_number", type: "integer", nullable: false },
      { name: "duration_minutes", type: "integer", nullable: true },
      { name: "quality", type: "integer", nullable: true },
      { name: "note", type: "text", nullable: true },
      { name: "next_review_date", type: "date", nullable: true },
      { name: "created_at", type: "timestamptz", nullable: false },
      { name: "updated_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "profiles", label: "פרופילי משתמשים", syncField: "updated_at", idField: "id",
    cols: [
      { name: "id", type: "uuid", nullable: false, isPK: true },
      { name: "display_name", type: "text", nullable: true },
      { name: "email", type: "text", nullable: true },
      { name: "avatar_url", type: "text", nullable: true },
      { name: "status", type: "text", nullable: false },
      { name: "created_at", type: "timestamptz", nullable: false },
      { name: "updated_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "review_logs", label: "לוג חזרות", syncField: "updated_at", idField: "id",
    cols: [
      { name: "id", type: "uuid", nullable: false, isPK: true },
      { name: "user_id", type: "uuid", nullable: false, isFK: true },
      { name: "card_id", type: "uuid", nullable: false, isFK: true },
      { name: "deck_id", type: "uuid", nullable: true, isFK: true },
      { name: "at", type: "timestamptz", nullable: false },
      { name: "correct", type: "boolean", nullable: false },
      { name: "quality", type: "integer", nullable: false },
      { name: "duration_ms", type: "integer", nullable: false },
      { name: "updated_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "role_permissions", label: "הרשאות תפקידים", syncField: null, idField: "id",
    cols: [
      { name: "id", type: "uuid", nullable: false, isPK: true },
      { name: "role_id", type: "uuid", nullable: false, isFK: true },
      { name: "module", type: "text (enum)", nullable: false },
      { name: "action", type: "text (enum)", nullable: false },
      { name: "allowed", type: "boolean", nullable: false },
    ],
  },
  {
    name: "shas_plans", label: "תוכניות ש\"ס", syncField: "updated_at", idField: "id",
    cols: [
      { name: "id", type: "uuid", nullable: false, isPK: true },
      { name: "user_id", type: "uuid", nullable: false, isFK: true },
      { name: "current_masechta", type: "text", nullable: false },
      { name: "current_daf", type: "integer", nullable: false },
      { name: "current_amud", type: "integer", nullable: false },
      { name: "current_half", type: "integer", nullable: false },
      { name: "pages_per_day", type: "integer", nullable: false },
      { name: "unit", type: "text", nullable: false },
      { name: "start_date", type: "date", nullable: false },
      { name: "selected_masechtos", type: "json", nullable: false },
      { name: "completed", type: "json", nullable: false },
      { name: "anchor_masechta", type: "text", nullable: true },
      { name: "anchor_daf", type: "integer", nullable: true },
      { name: "anchor_amud", type: "integer", nullable: true },
      { name: "anchor_date", type: "date", nullable: true },
      { name: "created_at", type: "timestamptz", nullable: false },
      { name: "updated_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "shas_reviews", label: "חזרות ש\"ס", syncField: "updated_at", idField: "id",
    cols: [
      { name: "id", type: "uuid", nullable: false, isPK: true },
      { name: "user_id", type: "uuid", nullable: false, isFK: true },
      { name: "masechta", type: "text", nullable: false },
      { name: "daf", type: "integer", nullable: false },
      { name: "amud", type: "integer", nullable: false },
      { name: "half", type: "integer", nullable: true },
      { name: "unit", type: "text", nullable: false },
      { name: "due_date", type: "date", nullable: false },
      { name: "done_at", type: "timestamptz", nullable: true },
      { name: "review_index", type: "integer", nullable: false },
      { name: "is_initial", type: "boolean", nullable: false },
      { name: "note", type: "text", nullable: true },
      { name: "created_at", type: "timestamptz", nullable: false },
      { name: "updated_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "site_settings", label: "הגדרות אתר", syncField: "updated_at", idField: "key",
    cols: [
      { name: "key", type: "text", nullable: false, isPK: true },
      { name: "value", type: "json", nullable: false },
      { name: "updated_by", type: "uuid", nullable: true, isFK: true },
      { name: "updated_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "study_general_plans", label: "תוכניות לימוד כלליות", syncField: "updated_at", idField: "id",
    cols: [
      { name: "id", type: "uuid", nullable: false, isPK: true },
      { name: "user_id", type: "uuid", nullable: false, isFK: true },
      { name: "data", type: "json", nullable: false },
      { name: "plan_updated_at", type: "timestamptz", nullable: false },
      { name: "created_at", type: "timestamptz", nullable: false },
      { name: "updated_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "study_plan_reviews", label: "חזרות תוכנית לימוד", syncField: "updated_at", idField: "id",
    cols: [
      { name: "id", type: "uuid", nullable: false, isPK: true },
      { name: "user_id", type: "uuid", nullable: false, isFK: true },
      { name: "data", type: "json", nullable: false },
      { name: "review_updated_at", type: "timestamptz", nullable: false },
      { name: "created_at", type: "timestamptz", nullable: false },
      { name: "updated_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "user_backup_chunks", label: "חלקי גיבוי", syncField: "created_at", idField: "backup_id",
    cols: [
      { name: "backup_id", type: "uuid", nullable: false, isPK: true, isFK: true },
      { name: "chunk_index", type: "integer", nullable: false, isPK: true },
      { name: "user_id", type: "uuid", nullable: false, isFK: true },
      { name: "chunk_data", type: "text", nullable: false },
      { name: "created_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "user_backups", label: "גיבויים", syncField: "created_at", idField: "id",
    cols: [
      { name: "id", type: "uuid", nullable: false, isPK: true },
      { name: "user_id", type: "uuid", nullable: false, isFK: true },
      { name: "name", type: "text", nullable: false },
      { name: "snapshot", type: "json", nullable: false },
      { name: "size_bytes", type: "integer", nullable: false },
      { name: "storage_mode", type: "text", nullable: false },
      { name: "total_chunks", type: "integer", nullable: false },
      { name: "topic_ids", type: "text[]", nullable: true },
      { name: "created_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "user_permission_overrides", label: "הרשאות אישיות", syncField: "created_at", idField: "id",
    cols: [
      { name: "id", type: "uuid", nullable: false, isPK: true },
      { name: "user_id", type: "uuid", nullable: false, isFK: true },
      { name: "module", type: "text (enum)", nullable: false },
      { name: "action", type: "text (enum)", nullable: false },
      { name: "allowed", type: "boolean", nullable: false },
      { name: "set_by", type: "uuid", nullable: true, isFK: true },
      { name: "created_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "user_roles", label: "תפקידי משתמשים", syncField: "assigned_at", idField: "id",
    cols: [
      { name: "id", type: "uuid", nullable: false, isPK: true },
      { name: "user_id", type: "uuid", nullable: false, isFK: true },
      { name: "role_id", type: "uuid", nullable: false, isFK: true },
      { name: "assigned_by", type: "uuid", nullable: true, isFK: true },
      { name: "assigned_at", type: "timestamptz", nullable: false },
    ],
  },
  {
    name: "user_settings", label: "הגדרות משתמש", syncField: "updated_at", idField: "user_id",
    cols: [
      { name: "user_id", type: "uuid", nullable: false, isPK: true, isFK: true },
      { name: "reminder_time", type: "text", nullable: false },
      { name: "notifications_enabled", type: "boolean", nullable: false },
      { name: "review_intervals", type: "json", nullable: false },
      { name: "ui_prefs", type: "json", nullable: false },
      { name: "shas_plans", type: "json", nullable: false },
      { name: "active_shas_plan_id", type: "uuid", nullable: true },
      { name: "general_plans", type: "json", nullable: false },
      { name: "general_plan_reviews", type: "json", nullable: false },
      { name: "plan_review_intervals", type: "json", nullable: false },
      { name: "quiz_plans", type: "json", nullable: false },
      { name: "quiz_attempts", type: "json", nullable: false },
      { name: "custom_category_templates", type: "json", nullable: false },
      { name: "tab_config", type: "json", nullable: true },
      { name: "widget_layout", type: "json", nullable: true },
      { name: "updated_at", type: "timestamptz", nullable: false },
    ],
  },
];

const SUPABASE_PROJECT_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? "";

/* ─────────────────────────────────────────────
   Dynamic stats
   ───────────────────────────────────────────── */

type TableStats = {
  name: string;
  count: number | null;
  lastSync: string | null;
  error?: string;
};

type SyncEvent = {
  table: string;
  label: string;
  id: string;
  at: string;
};

type DirectionalSyncSnapshot = {
  cloudToIdb: {
    lastCloudChangeAt: string | null;
    lastIdbWriteAt: string | null;
    lastDeleteAt: string | null;
  };
  idbToCloud: {
    lastWriteAt: string | null;
    lastDeleteAt: string | null;
    queuedWriteJobs: number;
    queuedDeleteJobs: number;
    deleteSuccessCount: number;
    deleteFailedCount: number;
  };
};

type CompareTableName = "cards" | "decks" | "categories";
type CompareSide = "idb" | "supabase";

type CompareCardRow = {
  id: string;
  deckId: string | null;
  type: string;
  question: string | null;
  updatedAt: string | null;
  createdAt: string | null;
};

type CompareSimpleRow = {
  id: string;
  name: string | null;
  updatedAt: string | null;
  createdAt: string | null;
};

type CompareTableSnapshot<T extends { id: string }> = {
  rows: T[];
  count: number;
  maxUpdatedAt: string | null;
  maxCreatedAt: string | null;
};

type CompareTableDiff = {
  onlyInIdb: string[];
  onlyInSupabase: string[];
};

type CompareSnapshot = {
  scannedAt: string;
  idb: {
    cards: CompareTableSnapshot<CompareCardRow>;
    decks: CompareTableSnapshot<CompareSimpleRow>;
    categories: CompareTableSnapshot<CompareSimpleRow>;
  };
  supabase: {
    cards: CompareTableSnapshot<CompareCardRow>;
    decks: CompareTableSnapshot<CompareSimpleRow>;
    categories: CompareTableSnapshot<CompareSimpleRow>;
  };
  diff: Record<CompareTableName, CompareTableDiff>;
};

const COMPARE_VISIBLE_LIMIT = 100;

function toIsoFromMs(ms?: number | null): string | null {
  if (!ms || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function newestIso<T extends { updatedAt: string | null; createdAt: string | null }>(rows: T[], field: "updatedAt" | "createdAt"): string | null {
  let best: string | null = null;
  for (const r of rows) {
    const v = r[field];
    if (!v) continue;
    best = maxIso(best, v);
  }
  return best;
}

function buildDiff<T extends { id: string }>(idbRows: T[], supabaseRows: T[]): CompareTableDiff {
  const idbIds = new Set(idbRows.map((r) => r.id));
  const sbIds = new Set(supabaseRows.map((r) => r.id));
  const onlyInIdb: string[] = [];
  const onlyInSupabase: string[] = [];
  idbIds.forEach((id) => { if (!sbIds.has(id)) onlyInIdb.push(id); });
  sbIds.forEach((id) => { if (!idbIds.has(id)) onlyInSupabase.push(id); });
  return { onlyInIdb, onlyInSupabase };
}

function pickTopByUpdated(rows: CompareCardRow[], n = COMPARE_VISIBLE_LIMIT): CompareCardRow[] {
  return [...rows]
    .sort((a, b) => new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() - new Date(a.updatedAt ?? a.createdAt ?? 0).getTime())
    .slice(0, n);
}

function countBy<T>(rows: T[], keyOf: (row: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const key = keyOf(r) || "—";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function compactText(value: string | null | undefined, maxLen = 64): string {
  if (!value) return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length <= maxLen ? normalized : `${normalized.slice(0, maxLen)}…`;
}

function compareRowLabel(table: CompareTableName, row: CompareCardRow | CompareSimpleRow | undefined): string {
  if (!row) return "";
  if (table === "cards") {
    return compactText((row as CompareCardRow).question, 80);
  }
  return compactText((row as CompareSimpleRow).name, 80);
}

function compareSelectionKey(table: CompareTableName, side: CompareSide, id: string): string {
  return `${table}:${side}:${id}`;
}

function toMs(iso: string | null | undefined): number {
  if (!iso) return Date.now();
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : Date.now();
}

function mergeById<T extends { id: string }>(base: T[], incoming: T[]): T[] {
  const map = new Map(base.map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return Array.from(map.values());
}

function cardToSupabaseRow(c: StudyCard, userId: string) {
  const cAny = c as StudyCard & {
    answer?: string;
    options?: string[];
    correctIndices?: number[];
    correct?: boolean;
    explanation?: string;
  };
  return {
    id: c.id,
    user_id: userId,
    deck_id: c.deckId,
    type: c.type,
    question: c.question,
    updated_at: new Date(c.updatedAt ?? c.createdAt).toISOString(),
    answer: cAny.answer ?? null,
    options: cAny.options ?? null,
    correct_indices: cAny.correctIndices ?? null,
    correct_boolean: c.type === "boolean" ? (cAny.correct ?? false) : null,
    explanation: cAny.explanation ?? null,
    tags: c.tags,
    srs: c.srs,
    stats: c.stats,
    masechta: c.masechta ?? null,
    daf: c.daf ?? null,
    amud: c.amud ?? null,
  };
}

function cardFromSupabaseRow(row: {
  id: string;
  deck_id: string | null;
  type: string;
  question: string;
  answer: string | null;
  options: unknown;
  correct_indices: unknown;
  correct_boolean: boolean | null;
  explanation: string | null;
  tags: unknown;
  srs: unknown;
  stats: unknown;
  masechta: string | null;
  daf: number | null;
  amud: number | null;
  created_at: string;
  updated_at: string | null;
}): StudyCard {
  const base = {
    id: row.id,
    deckId: row.deck_id ?? null,
    type: row.type,
    question: row.question,
    tags: (row.tags as string[] | null) ?? [],
    createdAt: toMs(row.created_at),
    updatedAt: toMs(row.updated_at ?? row.created_at),
    srs: (row.srs as StudyCard["srs"] | null) ?? defaultSrs(),
    stats: (row.stats as StudyCard["stats"] | null) ?? { totalReviews: 0, correct: 0, incorrect: 0 },
    masechta: row.masechta ?? null,
    daf: row.daf ?? null,
    amud: (row.amud as 1 | 2 | null | undefined) ?? null,
  };

  if (row.type === "flashcard") {
    return { ...base, type: "flashcard", answer: row.answer ?? "" };
  }
  if (row.type === "multiple") {
    const opts = (row.options as string[] | null) ?? [];
    const correctIdxs = (row.correct_indices as number[] | null) ?? [];
    const answer = row.answer ?? (correctIdxs.length > 0 && opts.length > 0 ? (opts[correctIdxs[0]] ?? undefined) : undefined);
    return { ...base, type: "combo", answer, options: opts, correctIndices: correctIdxs, explanation: row.explanation ?? undefined };
  }
  if (row.type === "boolean") {
    return { ...base, type: "boolean", correct: !!row.correct_boolean, explanation: row.explanation ?? undefined };
  }
  return {
    ...base,
    type: "combo",
    answer: row.answer ?? undefined,
    options: (row.options as string[] | null) ?? undefined,
    correctIndices: (row.correct_indices as number[] | null) ?? undefined,
    explanation: row.explanation ?? undefined,
  };
}

function buildSimpleSnapshot(rows: CompareSimpleRow[]): CompareTableSnapshot<CompareSimpleRow> {
  return {
    rows,
    count: rows.length,
    maxUpdatedAt: newestIso(rows, "updatedAt"),
    maxCreatedAt: newestIso(rows, "createdAt"),
  };
}

function buildCardsSnapshot(rows: CompareCardRow[]): CompareTableSnapshot<CompareCardRow> {
  return {
    rows,
    count: rows.length,
    maxUpdatedAt: newestIso(rows, "updatedAt"),
    maxCreatedAt: newestIso(rows, "createdAt"),
  };
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("he-IL", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function shortId(v: string): string {
  return v.length > 12 ? `${v.slice(0, 8)}…` : v;
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function parseBrowserInfo(ua: string): { browser: string; os: string } {
  const browser = /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari"
    : "Unknown";
  const os = /Windows NT/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad/.test(ua) ? "iOS"
    : /Linux/.test(ua) ? "Linux"
    : "Unknown";
  return { browser, os };
}

function buildDirectionalSyncSnapshot(
  tableStats: TableStats[],
  snap: IndexedMonitorSnapshot | null,
): DirectionalSyncSnapshot {
  const lastCloudChangeAt = tableStats.reduce<string | null>((acc, row) => maxIso(acc, row.lastSync), null);
  const idbLastWriteAt = snap?.cacheSavedAt ? new Date(snap.cacheSavedAt).toISOString() : null;
  const lastDeleteAt = snap?.latestDeleteAuditAt ? new Date(snap.latestDeleteAuditAt).toISOString() : null;

  return {
    cloudToIdb: {
      lastCloudChangeAt,
      lastIdbWriteAt: idbLastWriteAt,
      lastDeleteAt: snap?.latestCloudToIdbDeleteAt ? new Date(snap.latestCloudToIdbDeleteAt).toISOString() : null,
    },
    idbToCloud: {
      // Full-sync jobs represent local->cloud writes waiting for push.
      lastWriteAt: snap?.syncJobsCount ? idbLastWriteAt : null,
      lastDeleteAt,
      queuedWriteJobs: snap?.syncJobsCount ?? 0,
      queuedDeleteJobs: snap?.pendingDeletesCount ?? 0,
      deleteSuccessCount: snap?.deleteAuditCounts.success ?? 0,
      deleteFailedCount: snap?.deleteAuditCounts.failed ?? 0,
    },
  };
}

const SYNC_SOURCES = SCHEMA.filter(
  (t) => t.syncField && ["updated_at", "created_at"].includes(t.syncField)
);

/* ─────────────────────────────────────────────
   Sub-components
   ───────────────────────────────────────────── */

function TableSchemaCard({ t }: { t: TableSchema }) {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(`pashash:inspector-schema-open:${t.name}`) === "1"; } catch { return false; }
  });
  const pkCols = t.cols.filter((c) => c.isPK).map((c) => c.name).join(", ");

  return (
    <Card className="gold-frame p-3">
      <button
        className="w-full flex items-center justify-between gap-2"
        onClick={() => setOpen((v) => {
          const next = !v;
          try { localStorage.setItem(`pashash:inspector-schema-open:${t.name}`, next ? "1" : "0"); } catch {}
          return next;
        })}
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="text-[10px] border-gold/40">
            {t.cols.length} עמודות
          </Badge>
          {pkCols && (
            <span className="flex items-center gap-1">
              <Key className="h-3 w-3 text-gold" />
              <span>{pkCols}</span>
            </span>
          )}
          {t.syncField && (
            <span className="flex items-center gap-1 text-blue-500">
              <Clock className="h-3 w-3" />
              {t.syncField}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 font-medium text-sm text-right">
          <span className="text-muted-foreground font-mono text-xs">{t.name}</span>
          <span>{t.label}</span>
          {open
            ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
        </div>
      </button>

      {open && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="py-1.5 px-2 text-right font-medium text-muted-foreground">עמודה</th>
                <th className="py-1.5 px-2 text-right font-medium text-muted-foreground">סוג</th>
                <th className="py-1.5 px-2 text-center font-medium text-muted-foreground">NULL?</th>
                <th className="py-1.5 px-2 text-center font-medium text-muted-foreground">PK</th>
                <th className="py-1.5 px-2 text-center font-medium text-muted-foreground">FK</th>
              </tr>
            </thead>
            <tbody>
              {t.cols.map((col) => (
                <tr
                  key={col.name}
                  className="border-b border-border/50 last:border-0 hover:bg-muted/30"
                >
                  <td className="py-1.5 px-2 text-right font-mono font-semibold">{col.name}</td>
                  <td className="py-1.5 px-2 text-right text-muted-foreground">{col.type}</td>
                  <td className="py-1.5 px-2 text-center">
                    {col.nullable ? (
                      <span className="text-amber-500">✓</span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    {col.isPK ? <span className="text-gold font-bold">PK</span> : null}
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    {col.isFK ? <span className="text-blue-500 text-[10px]">FK</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ─────────────────────────────────────────────
   Main component
   ───────────────────────────────────────────── */

export function SupabaseInspectorPage() {
  const { user } = useAuth();
  const { setUiPref } = useStudy();
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [stats, setStats] = useState<TableStats[]>([]);
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [syncOn, setSyncOn] = useState<boolean>(() => isSyncEnabled());
  const [activeTab, setActiveTab] = useState<string>(
    () => { try { return localStorage.getItem("pashash:inspector-tab") ?? "schema"; } catch { return "schema"; } }
  );
  const [idbSnap, setIdbSnap] = useState<IndexedMonitorSnapshot | null>(null);
  const [idbDatabases, setIdbDatabases] = useState<Array<{ name: string; version: number }>>([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareActionLoading, setCompareActionLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareSnapshot, setCompareSnapshot] = useState<CompareSnapshot | null>(null);
  const [compareSelection, setCompareSelection] = useState<Record<string, true>>({});

  // ── Table sort/filter state ────────────────────────────────────────────
  type SortField = "name" | "label" | "count" | "lastSync" | "syncField";
  type SortDir = "asc" | "desc" | null;
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const handleColumnHeaderClick = (field: SortField) => {
    if (sortField === field) {
      // Cycle: asc -> desc -> none
      if (sortDir === "asc") setSortDir("desc");
      else if (sortDir === "desc") {
        setSortField(null);
        setSortDir(null);
      }
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const getSortedSchema = () => {
    const sorted = [...SCHEMA];
    if (!sortField || !sortDir) return sorted;

    return sorted.sort((a, b) => {
      let aVal: any = "";
      let bVal: any = "";

      const aStat = stats.find((x) => x.name === a.name);
      const bStat = stats.find((x) => x.name === b.name);

      switch (sortField) {
        case "name":
          aVal = a.name;
          bVal = b.name;
          break;
        case "label":
          aVal = a.label;
          bVal = b.label;
          break;
        case "count":
          aVal = aStat?.count ?? 0;
          bVal = bStat?.count ?? 0;
          break;
        case "lastSync":
          aVal = aStat?.lastSync ?? "";
          bVal = bStat?.lastSync ?? "";
          break;
        case "syncField":
          aVal = a.syncField ?? "";
          bVal = b.syncField ?? "";
          break;
      }

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      return sortDir === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
  };

  // ── Rebuild state ──────────────────────────────────────────────────────
  type RebuildStep = { label: string; pct: number };
  type RebuildState = {
    active: boolean;
    pct: number;
    step: string;
    error: string | null;
    done: boolean;
    stats: { rows: Record<string, number>; sizeKb: number } | null;
  };
  const REBUILD_CHECKPOINT_KEY = (uid: string) => `pashash:rebuild-checkpoint:${uid}`;
  const [rebuild, setRebuild] = useState<RebuildState>({
    active: false, pct: 0, step: "", error: null, done: false, stats: null,
  });
  const rebuildAbort = useRef<AbortController | null>(null);
  const restoreFileRef = useRef<HTMLInputElement | null>(null);
  const [storageEst, setStorageEst] = useState<{ usageKb: number; quotaKb: number } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [treeDialog, setTreeDialog] = useState<{
    open: boolean;
    mode: "backup" | "restore";
    state: StudyState | null;
  }>({ open: false, mode: "backup", state: null });

  const refreshStorageEst = useCallback(async () => {
    try {
      const est = await navigator.storage.estimate();
      setStorageEst({
        usageKb: Math.round((est.usage ?? 0) / 1024),
        quotaKb: Math.round((est.quota ?? 0) / 1024),
      });
    } catch { /* unsupported */ }
  }, []);

  // Detect interrupted rebuild on mount
  useEffect(() => {
    refreshStorageEst();
    if (!user?.id) return;
    try {
      const raw = localStorage.getItem(REBUILD_CHECKPOINT_KEY(user.id));
      if (raw) {
        const cp = JSON.parse(raw) as { pct: number; step: string; startedAt: number };
        if (cp.pct < 100) {
          setRebuild((prev) => ({ ...prev, active: false, pct: cp.pct, step: cp.step, error: "הבנייה הופסקה באמצע — ניתן להמשיך מהנקודה הזו", done: false, stats: null }));
        }
      }
    } catch { /* ignore */ }
  }, [user?.id, refreshStorageEst]);

  // Subscribe to sync-toggle changes (other tabs / programmatic)
  useEffect(() => subscribeSyncEnabled((v) => setSyncOn(v)), []);

  const handleToggleSync = useCallback((next: boolean) => {
    if (next) {
      // Turn ON: enable locally first so bg() can fire, then persist to cloud
      setSyncEnabled(true);
      setSyncOn(true);
      setUiPref("syncEnabled", true);
    } else {
      // Turn OFF: persist to cloud first (while sync is still on), then disable locally
      setUiPref("syncEnabled", false);
      setSyncEnabled(false);
      setSyncOn(false);
    }
    toast.success(next ? "סנכרון לסופאבייס הופעל — שינויים ייסנכרנו אוטומטית" : "סנכרון כובה — האפליקציה תעבוד מול אינדקסדב בלבד");
  }, [setUiPref]);

  // Helper to refresh IDB databases list
  const refreshIdbList = useCallback(async () => {
    try {
      type IW = { databases?: () => Promise<Array<{ name?: string; version?: number }>> };
      const dbs = await (indexedDB as unknown as IW).databases?.();
      if (dbs) setIdbDatabases(dbs.filter((d): d is { name: string; version: number } => !!d.name).map(d => ({ name: d.name, version: d.version ?? 1 })).sort((a,b) => a.name.localeCompare(b.name)));
    } catch { /* unsupported */ }
  }, []);

  const handleBackup = useCallback(async () => {
    if (!user?.id) { toast.error("יש להתחבר תחילה"); return; }
    const state = await loadStudyStateCache(user.id);
    if (!state) { toast.error("אין נתונים ב-IndexedDB לגיבוי"); return; }
    setTreeDialog({ open: true, mode: "backup", state });
  }, [user?.id]);

  const handleBackupFull = useCallback(async () => {
    if (!user?.id) { toast.error("יש להתחבר תחילה"); return; }
    const state = await loadStudyStateCache(user.id);
    if (!state) { toast.error("אין נתונים ב-IndexedDB לגיבוי"); return; }
    const json = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), userId: user.id, state });
    const dateStr = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    try {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
      const compressed = await new Response(stream).blob();
      a.href = URL.createObjectURL(compressed);
      a.download = `pashash-backup-${dateStr}.json.gz`;
    } catch {
      a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      a.download = `pashash-backup-${dateStr}.json`;
    }
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("הגיבוי המלא הורד בהצלחה");
  }, [user?.id]);

  /** Called when user confirms selection in backup tree dialog */
  const handleBackupConfirm = useCallback(async (partial: Partial<StudyState>) => {
    if (!user?.id) return;
    setTreeDialog((p) => ({ ...p, open: false }));
    const json = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), userId: user.id, state: partial });
    const dateStr = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    try {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
      const compressed = await new Response(stream).blob();
      a.href = URL.createObjectURL(compressed);
      a.download = `pashash-backup-selected-${dateStr}.json.gz`;
    } catch {
      a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      a.download = `pashash-backup-selected-${dateStr}.json`;
    }
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("הגיבוי הנבחר הורד בהצלחה");
  }, [user?.id]);

  /** Called when user confirms selection in restore tree dialog */
  const handleRestoreConfirm = useCallback(async (partial: Partial<StudyState>) => {
    if (!user?.id) return;
    setTreeDialog((p) => ({ ...p, open: false }));
    setRestoring(true);
    try {
      const current = await loadStudyStateCache(user.id);
      const merged = mergePartialIntoState(current ?? ({} as StudyState), partial);
      if (syncOn) {
        setSyncEnabled(false);
        setSyncOn(false);
        toast.info("הסנכרון הושבת זמנית. יש לרענן את הדף לאחר השחזור.");
      }
      await saveStudyStateCache(user.id, merged);
      await refreshIdbList();
      await refreshStorageEst();
      toast.success("השחזור הושלם — יש לרענן את הדף כדי להפעיל את הנתונים");
    } catch (e) {
      toast.error("שגיאה בשחזור: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRestoring(false);
    }
  }, [user?.id, syncOn, refreshIdbList, refreshStorageEst]);

  const handleRestoreFile = useCallback(async (file: File) => {
    if (!user?.id) { toast.error("יש להתחבר תחילה"); return; }
    setRestoring(true);
    try {
      let text: string;
      if (file.name.endsWith(".gz")) {
        const stream = file.stream().pipeThrough(new DecompressionStream("gzip"));
        text = await new Response(stream).text();
      } else {
        text = await file.text();
      }
      await new Promise<void>((r) => setTimeout(r, 30));
      const parsed = JSON.parse(text) as { version?: number; userId?: string; state?: StudyState };
      if (!parsed.state || typeof parsed.state !== "object") {
        toast.error("קובץ הגיבוי אינו תקין — חסר שדה state");
        return;
      }
      const isDifferentUser = parsed.userId && parsed.userId !== user.id;
      if (isDifferentUser) {
        const ok = window.confirm(`קובץ זה שייך למשתמש אחר (${parsed.userId?.slice(0, 8)}…). האם לשחזר בכל זאת?`);
        if (!ok) return;
      }
      // Open tree dialog for selective restore
      setTreeDialog({ open: true, mode: "restore", state: parsed.state });
    } catch (e) {
      toast.error("שגיאה בקריאת הקובץ: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRestoring(false);
    }
  }, [user?.id]);

  const runRebuild = useCallback(async (resume = false) => {
    if (!user?.id) { toast.error("יש להתחבר תחילה"); return; }
    const checkpointKey = REBUILD_CHECKPOINT_KEY(user.id);

    const setStep = (step: string, pct: number) => {
      setRebuild((r) => ({ ...r, step, pct, error: null }));
      try { localStorage.setItem(checkpointKey, JSON.stringify({ step, pct, startedAt: Date.now() })); } catch { /* ignore */ }
    };

    rebuildAbort.current = new AbortController();
    setRebuild({ active: true, pct: 0, step: resume ? "ממשיך מהנקודה שנעצרה…" : "מתחיל בנייה מחדש…", error: null, done: false, stats: null });

    try {
      if (!resume) {
        setStep("מוחק נתונים קיימים…", 8);
        await clearStudyStateCache(user.id);
      }

      setStep("מתחבר ל-Supabase…", 15);

      // Fetch bootstrap snapshot (all user data in one RPC call)
      setStep("טוען נתונים מהשרת…", 20);

      // Animate progress while waiting for the RPC
      let fakePct = 20;
      const animInterval = window.setInterval(() => {
        fakePct = Math.min(fakePct + 3, 75);
        setRebuild((r) => (r.active ? { ...r, pct: fakePct } : r));
      }, 400);

      let bootstrapData: Record<string, unknown> | null = null;
      try {
        const result = await (supabase as unknown as { rpc: (name: string) => Promise<{ data: Record<string, unknown> | null; error: unknown }> }).rpc("get_bootstrap_snapshot");
        if (result.error) throw new Error(typeof result.error === "object" && result.error !== null && "message" in result.error ? String((result.error as { message?: unknown }).message) : "שגיאת שרת");
        bootstrapData = result.data;
      } finally {
        window.clearInterval(animInterval);
      }

      setStep("מעבד נתונים…", 78);

      // Count rows for display
      const rowCounts: Record<string, number> = {};
      if (bootstrapData && typeof bootstrapData === "object") {
        for (const [k, v] of Object.entries(bootstrapData)) {
          if (Array.isArray(v)) rowCounts[k] = v.length;
        }
      }

      setStep("שומר ב-IndexedDB…", 88);

      // We save the raw bootstrap payload as the state (the real shape is resolved by store on next load)
      // Instead, enqueue a full sync job so the store does a proper re-hydration on reload
      await enqueueFullSyncJob(user.id);

      setStep("מחשב גודל אחסון…", 94);
      let sizeKb = 0;
      try {
        const est = await navigator.storage.estimate();
        sizeKb = Math.round((est.usage ?? 0) / 1024);
      } catch { /* unsupported */ }

      // Clear checkpoint — finished successfully
      try { localStorage.removeItem(checkpointKey); } catch { /* ignore */ }

      await refreshIdbList();
      setRebuild({ active: false, pct: 100, step: "הבנייה הושלמה — טוען מחדש…", error: null, done: true, stats: { rows: rowCounts, sizeKb } });
      toast.success("הבנייה הושלמה — מרענן את הדף לטעינת הנתונים החדשים");
      // Auto-reload so the cold-hydrate path runs and IDB is rebuilt from cloud immediately.
      window.setTimeout(() => { window.location.reload(); }, 1200);

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRebuild((r) => ({ ...r, active: false, error: msg }));
    }
  }, [user?.id, refreshIdbList]);

  const loadCompare = useCallback(async () => {
    if (!user?.id) {
      setCompareSnapshot(null);
      setCompareError("יש להתחבר כדי להשוות נתונים");
      return;
    }

    setCompareLoading(true);
    setCompareError(null);
    try {
      const localState = await loadStudyStateCache(user.id);
      const idbCards: CompareCardRow[] = (localState?.cards ?? []).map((c) => ({
        id: c.id,
        deckId: c.deckId ?? null,
        type: c.type,
        question: c.question ?? null,
        updatedAt: toIsoFromMs(c.updatedAt ?? c.createdAt),
        createdAt: toIsoFromMs(c.createdAt),
      }));
      const idbDecks: CompareSimpleRow[] = (localState?.decks ?? []).map((d) => ({
        id: d.id,
        name: d.name ?? null,
        updatedAt: toIsoFromMs(d.updatedAt ?? d.createdAt),
        createdAt: toIsoFromMs(d.createdAt),
      }));
      const idbCategories: CompareSimpleRow[] = (localState?.categories ?? []).map((c) => ({
        id: c.id,
        name: c.name ?? null,
        updatedAt: toIsoFromMs(c.updatedAt ?? c.createdAt),
        createdAt: toIsoFromMs(c.createdAt),
      }));

      const fetchAllRows = async (table: "cards" | "decks" | "categories", selectFields: string) => {
        const PAGE = 1000;
        let from = 0;
        const all: Array<Record<string, unknown>> = [];
        while (true) {
          let query = supabase
            .from(table)
            .select(selectFields)
            .eq("user_id", user.id)
            // Compare only active rows so soft-deleted tombstones don't skew counts.
            .is("deleted_at", null)
            // Stable ordering across pages: prevents skip/duplicate rows when many
            // records share the same updated_at timestamp.
            .order("updated_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, from + PAGE - 1);
          const { data, error } = await query;
          if (error) throw new Error(`${table}: ${error.message}`);
          const page = (data ?? []) as Array<Record<string, unknown>>;
          all.push(...page);
          if (page.length < PAGE) break;
          from += PAGE;
        }
        return all;
      };

      const [cardsData, decksData, categoriesData] = await Promise.all([
        fetchAllRows("cards", "id, deck_id, type, question, updated_at, created_at"),
        fetchAllRows("decks", "id, name, updated_at, created_at"),
        fetchAllRows("categories", "id, name, updated_at, created_at"),
      ]);

      const sbCards: CompareCardRow[] = cardsData.map((r) => ({
        id: String(r.id ?? ""),
        deckId: (r.deck_id as string | null | undefined) ?? null,
        type: (r.type as string | null | undefined) ?? "unknown",
        question: (r.question as string | null | undefined) ?? null,
        updatedAt: (r.updated_at as string | null | undefined) ?? null,
        createdAt: (r.created_at as string | null | undefined) ?? null,
      }));
      const sbDecks: CompareSimpleRow[] = decksData.map((r) => ({
        id: String(r.id ?? ""),
        name: (r.name as string | null | undefined) ?? null,
        updatedAt: (r.updated_at as string | null | undefined) ?? null,
        createdAt: (r.created_at as string | null | undefined) ?? null,
      }));
      const sbCategories: CompareSimpleRow[] = categoriesData.map((r) => ({
        id: String(r.id ?? ""),
        name: (r.name as string | null | undefined) ?? null,
        updatedAt: (r.updated_at as string | null | undefined) ?? null,
        createdAt: (r.created_at as string | null | undefined) ?? null,
      }));

      setCompareSnapshot({
        scannedAt: new Date().toISOString(),
        idb: {
          cards: buildCardsSnapshot(idbCards),
          decks: buildSimpleSnapshot(idbDecks),
          categories: buildSimpleSnapshot(idbCategories),
        },
        supabase: {
          cards: buildCardsSnapshot(sbCards),
          decks: buildSimpleSnapshot(sbDecks),
          categories: buildSimpleSnapshot(sbCategories),
        },
        diff: {
          cards: buildDiff(idbCards, sbCards),
          decks: buildDiff(idbDecks, sbDecks),
          categories: buildDiff(idbCategories, sbCategories),
        },
      });
      setCompareSelection({});
    } catch (err) {
      const msg = err instanceof Error ? err.message : "שגיאה בהשוואה";
      setCompareError(msg);
    } finally {
      setCompareLoading(false);
    }
  }, [user?.id]);

  const getSelectedCompareIds = useCallback((table: CompareTableName, side: CompareSide): string[] => {
    const prefix = `${table}:${side}:`;
    return Object.keys(compareSelection)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  }, [compareSelection]);

  const toggleCompareSelection = useCallback((table: CompareTableName, side: CompareSide, id: string) => {
    const key = compareSelectionKey(table, side, id);
    setCompareSelection((prev) => {
      if (prev[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: true };
    });
  }, []);

  const setBulkCompareSelection = useCallback((table: CompareTableName, side: CompareSide, ids: string[], selected: boolean) => {
    setCompareSelection((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        const key = compareSelectionKey(table, side, id);
        if (selected) next[key] = true;
        else delete next[key];
      }
      return next;
    });
  }, []);

  const deleteSelectedFromIdb = useCallback(async (table: CompareTableName, side: CompareSide) => {
    if (!user?.id) {
      toast.error("יש להתחבר כדי למחוק נתונים");
      return;
    }
    const ids = getSelectedCompareIds(table, side);
    if (ids.length === 0) {
      toast.error("לא נבחרו פריטים למחיקה");
      return;
    }
    if (!window.confirm(`למחוק ${ids.length} פריטים מתוך ${table} מ-IndexedDB?`)) return;

    const state = await loadStudyStateCache(user.id);
    if (!state) {
      toast.error("לא נמצאו נתונים ב-IndexedDB");
      return;
    }

    const idSet = new Set(ids);
    const nextState: StudyState = { ...state };

    if (table === "cards") {
      nextState.cards = (state.cards ?? []).filter((row) => !idSet.has(row.id));
      nextState.logs = (state.logs ?? []).filter((row) => !idSet.has(row.cardId));
      if (state.cardDecks) nextState.cardDecks = state.cardDecks.filter((row) => !idSet.has(row.cardId));
    } else if (table === "decks") {
      nextState.decks = (state.decks ?? []).filter((row) => !idSet.has(row.id));
      nextState.cards = (state.cards ?? []).map((row) => (idSet.has(row.deckId ?? "") ? { ...row, deckId: null } : row));
      if (state.cardDecks) nextState.cardDecks = state.cardDecks.filter((row) => !idSet.has(row.deckId));
      if (state.goals) nextState.goals = state.goals.map((goal) => (idSet.has(goal.deckId ?? "") ? { ...goal, deckId: null } : goal));
    } else {
      if (state.categories) nextState.categories = state.categories.filter((row) => !idSet.has(row.id));
      nextState.decks = (state.decks ?? []).map((row) => ({
        ...row,
        categoryIds: (row.categoryIds ?? []).filter((catId) => !idSet.has(catId)),
      }));
      if (nextState.categories) {
        nextState.categories = nextState.categories.map((row) => (idSet.has(row.parentId ?? "") ? { ...row, parentId: null } : row));
      }
    }

    await saveStudyStateCache(user.id, nextState);
    setBulkCompareSelection(table, side, ids, false);
    toast.success(`נמחקו ${ids.length} פריטים מ-IndexedDB (${table})`);
    await loadCompare();
  }, [getSelectedCompareIds, loadCompare, setBulkCompareSelection, user?.id]);

  const deleteSelectedFromSupabase = useCallback(async (table: CompareTableName, side: CompareSide) => {
    if (!user?.id) {
      toast.error("יש להתחבר כדי למחוק נתונים");
      return;
    }
    const ids = getSelectedCompareIds(table, side);
    if (ids.length === 0) {
      toast.error("לא נבחרו פריטים למחיקה");
      return;
    }
    if (!window.confirm(`למחוק ${ids.length} פריטים מתוך ${table} מ-Supabase?`)) return;

    let errorMsg: string | null = null;
    if (table === "cards") {
      const { error } = await supabase.from("cards").delete().eq("user_id", user.id).in("id", ids);
      if (error) errorMsg = error.message;
    } else if (table === "decks") {
      const { error } = await supabase.from("decks").delete().eq("user_id", user.id).in("id", ids);
      if (error) errorMsg = error.message;
    } else {
      const { error } = await supabase.from("categories").delete().eq("user_id", user.id).in("id", ids);
      if (error) errorMsg = error.message;
    }

    if (errorMsg) {
      toast.error(`מחיקה מ-Supabase נכשלה: ${errorMsg}`);
      return;
    }

    setBulkCompareSelection(table, side, ids, false);
    toast.success(`נמחקו ${ids.length} פריטים מ-Supabase (${table})`);
    await loadCompare();
  }, [getSelectedCompareIds, loadCompare, setBulkCompareSelection, user?.id]);

  const copySelectedIdbToSupabase = useCallback(async (table: CompareTableName) => {
    if (!user?.id) {
      toast.error("יש להתחבר כדי להעתיק נתונים");
      return;
    }
    const ids = getSelectedCompareIds(table, "idb");
    if (ids.length === 0) {
      toast.error("לא נבחרו פריטים להעתקה");
      return;
    }
    if (!window.confirm(`להעתיק ${ids.length} פריטים מ-IndexedDB ל-Supabase בטבלת ${table}?`)) return;

    setCompareActionLoading(true);
    try {
      const state = await loadStudyStateCache(user.id);
      if (!state) {
        toast.error("לא נמצאו נתונים ב-IndexedDB");
        return;
      }
      const idSet = new Set(ids);

      if (table === "cards") {
        const rows = (state.cards ?? []).filter((card) => idSet.has(card.id)).map((card) => cardToSupabaseRow(card, user.id));
        if (rows.length > 0) {
          const { error } = await supabase.from("cards").upsert(rows as never[], { onConflict: "id" });
          if (error) throw new Error(error.message);
        }
      } else if (table === "decks") {
        const rows = (state.decks ?? []).filter((deck) => idSet.has(deck.id)).map((deck) => ({
          id: deck.id,
          user_id: user.id,
          name: deck.name,
          description: deck.description ?? null,
          color: deck.color,
          created_at: new Date(deck.createdAt).toISOString(),
          updated_at: new Date(deck.updatedAt ?? deck.createdAt).toISOString(),
          category_ids: deck.categoryIds ?? [],
          include_sub_categories: deck.includeSubCategories !== false,
        }));
        if (rows.length > 0) {
          const { error } = await supabase.from("decks").upsert(rows as never[], { onConflict: "id" });
          if (error) throw new Error(error.message);
        }
      } else {
        const rows = (state.categories ?? []).filter((cat) => idSet.has(cat.id)).map((cat) => ({
          id: cat.id,
          user_id: user.id,
          name: cat.name,
          parent_id: cat.parentId,
          color: cat.color ?? null,
          created_at: new Date(cat.createdAt).toISOString(),
          updated_at: new Date(cat.updatedAt ?? cat.createdAt).toISOString(),
          sort_order: cat.sortOrder ?? 0,
          deleted_at: null,
        }));
        if (rows.length > 0) {
          const { error } = await supabase.from("categories").upsert(rows as never[], { onConflict: "id" });
          if (error) throw new Error(error.message);
        }
      }

      setBulkCompareSelection(table, "idb", ids, false);
      toast.success(`הועתקו ${ids.length} פריטים מ-IDB ל-Supabase (${table})`);
      await loadCompare();
    } catch (err) {
      toast.error(`העתקה ל-Supabase נכשלה: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCompareActionLoading(false);
    }
  }, [getSelectedCompareIds, loadCompare, setBulkCompareSelection, user?.id]);

  const copySelectedSupabaseToIdb = useCallback(async (table: CompareTableName) => {
    if (!user?.id) {
      toast.error("יש להתחבר כדי להעתיק נתונים");
      return;
    }
    const ids = getSelectedCompareIds(table, "supabase");
    if (ids.length === 0) {
      toast.error("לא נבחרו פריטים להעתקה");
      return;
    }
    if (!window.confirm(`להעתיק ${ids.length} פריטים מ-Supabase ל-IndexedDB בטבלת ${table}?`)) return;

    setCompareActionLoading(true);
    try {
      const state = (await loadStudyStateCache(user.id)) ?? ({ decks: [], cards: [], logs: [] } as StudyState);

      if (table === "cards") {
        const { data, error } = await supabase
          .from("cards")
          .select("id, deck_id, type, question, answer, options, correct_indices, correct_boolean, explanation, tags, srs, stats, masechta, daf, amud, created_at, updated_at")
          .eq("user_id", user.id)
          .in("id", ids);
        if (error) throw new Error(error.message);
        const incoming = (data ?? []).map((row) => cardFromSupabaseRow(row));
        state.cards = mergeById(state.cards ?? [], incoming);
      } else if (table === "decks") {
        const { data, error } = await supabase
          .from("decks")
          .select("id, name, description, color, category_ids, include_sub_categories, created_at, updated_at")
          .eq("user_id", user.id)
          .in("id", ids);
        if (error) throw new Error(error.message);
        const incoming: StudyDeck[] = (data ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description ?? undefined,
          color: row.color,
          categoryIds: Array.isArray(row.category_ids) ? (row.category_ids as string[]) : [],
          includeSubCategories: row.include_sub_categories !== false,
          createdAt: toMs(row.created_at),
          updatedAt: toMs(row.updated_at ?? row.created_at),
        }));
        state.decks = mergeById(state.decks ?? [], incoming);
      } else {
        const { data, error } = await supabase
          .from("categories")
          .select("id, name, parent_id, color, sort_order, created_at, updated_at")
          .eq("user_id", user.id)
          .in("id", ids);
        if (error) throw new Error(error.message);
        const incoming: StudyCategory[] = (data ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          parentId: row.parent_id,
          color: row.color ?? undefined,
          sortOrder: row.sort_order ?? 0,
          createdAt: toMs(row.created_at),
          updatedAt: toMs(row.updated_at ?? row.created_at),
        }));
        state.categories = mergeById(state.categories ?? [], incoming);
      }

      await saveStudyStateCache(user.id, state);
      setBulkCompareSelection(table, "supabase", ids, false);
      toast.success(`הועתקו ${ids.length} פריטים מ-Supabase ל-IDB (${table})`);
      await loadCompare();
    } catch (err) {
      toast.error(`העתקה ל-IndexedDB נכשלה: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCompareActionLoading(false);
    }
  }, [getSelectedCompareIds, loadCompare, setBulkCompareSelection, user?.id]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // ── IndexedDB snapshot (always, regardless of sync state) ──────────
      if (user?.id) {
        try {
          const snap = await getIndexedMonitorSnapshot(user.id);
          setIdbSnap(snap);
        } catch {
          setIdbSnap(null);
        }
      }
      // List of all IndexedDB databases (Chrome/Edge/Firefox 126+)
      try {
        type IdbWithDatabases = { databases?: () => Promise<Array<{ name?: string; version?: number }>> };
        const idb = (typeof indexedDB !== "undefined" ? indexedDB : null) as unknown as IdbWithDatabases | null;
        if (idb && typeof idb.databases === "function") {
          const dbs = await idb.databases();
          setIdbDatabases(
            (dbs ?? [])
              .filter((d): d is { name: string; version: number } => !!d.name)
              .map((d) => ({ name: d.name, version: d.version ?? 1 }))
              .sort((a, b) => a.name.localeCompare(b.name))
          );
        }
      } catch {
        /* browser does not support indexedDB.databases() */
      }

      // ── Skip cloud queries if sync is OFF ──────────────────────────────
      if (!syncOn) {
        setStats([]);
        setEvents([]);
        setLastRefresh(new Date().toISOString());
        return;
      }

      const statResults = await Promise.all(
        SCHEMA.map(async (t): Promise<TableStats> => {
          try {
            const countRes = await (supabase
              .from(t.name as "cards")
              .select("*", { count: "exact", head: true }) as unknown as Promise<{
                count: number | null;
                error: { message: string } | null;
              }>);

            if (countRes.error) {
              return { name: t.name, count: null, lastSync: null, error: countRes.error.message };
            }

            let lastSync: string | null = null;
            if (t.syncField) {
              const latestRes = await (supabase
                .from(t.name as "cards")
                .select(t.syncField)
                .order(t.syncField, { ascending: false })
                .limit(1)
                .maybeSingle() as unknown as Promise<{
                  data: Record<string, string | null> | null;
                  error: { message: string } | null;
                }>);
              if (!latestRes.error && latestRes.data) {
                lastSync = (latestRes.data[t.syncField] as string | null) ?? null;
              }
            }

            return { name: t.name, count: countRes.count ?? 0, lastSync };
          } catch (err) {
            return {
              name: t.name, count: null, lastSync: null,
              error: err instanceof Error ? err.message : "שגיאה",
            };
          }
        })
      );

      // Fetch recent events from each sync source
      const eventBuckets = await Promise.all(
        SYNC_SOURCES.map(async (t) => {
          try {
            const sf = t.syncField!;
            const evRes = await (supabase
              .from(t.name as "cards")
              .select(`${t.idField}, ${sf}`)
              .order(sf, { ascending: false })
              .limit(5) as unknown as Promise<{
                data: Array<Record<string, string | null>> | null;
                error: { message: string } | null;
              }>);
            if (evRes.error || !evRes.data) return [];
            return evRes.data.map((row): SyncEvent => ({
              table: t.name,
              label: t.label,
              id: (row[t.idField] as string | null) ?? "?",
              at: (row[sf] as string | null) ?? new Date(0).toISOString(),
            }));
          } catch {
            return [];
          }
        })
      );

      const merged = eventBuckets
        .flat()
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, 50);

      setStats(statResults);
      setEvents(merged);
      setLastRefresh(new Date().toISOString());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "שגיאה לא צפויה";
      toast.error(`שגיאה בטעינת נתוני Supabase: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [user?.id, syncOn]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (activeTab !== "compare") return;
    void loadCompare();
    const timer = window.setInterval(() => {
      void loadCompare();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [activeTab, loadCompare]);

  const totalRows = stats.reduce((acc, s) => acc + (s.count ?? 0), 0);
  const activeTables = stats.filter((s) => s.count != null && s.count > 0).length;
  const errorTables = stats.filter((s) => s.error).length;
  const directionalSync = buildDirectionalSyncSnapshot(stats, idbSnap);
  const copySupabaseValue = useCallback(async (label: "URL" | "anon key", value: string) => {
    if (!value) {
      toast.error(`אין ${label} תקין להעתקה`);
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} הועתק`);
    } catch {
      toast.error(`העתקת ${label} נכשלה`);
    }
  }, []);

  return (
    <div className="space-y-4 pb-8" dir="rtl">
      {/* Header */}
      <Card className="gold-frame p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button onClick={() => void load()} disabled={loading} variant="outline" size="sm" className="gap-1.5">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              רענן
            </Button>
            {/* Sync toggle */}
            <div
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
                syncOn
                  ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-600"
                  : "border-amber-500/40 bg-amber-500/5 text-amber-600"
              }`}
              title={syncOn ? "סנכרון לסופאבייס פעיל" : "סנכרון כובה — IndexedDB בלבד"}
            >
              {syncOn
                ? <Cloud className="h-4 w-4" />
                : <CloudOff className="h-4 w-4" />}
              <span className="text-xs font-medium hidden sm:inline">
                {syncOn ? "סנכרון פעיל" : "סנכרון כבוי"}
              </span>
              <Switch checked={syncOn} onCheckedChange={handleToggleSync} />
            </div>
          </div>
          <div className="text-right">
            <h2 className="font-display text-xl font-bold flex items-center justify-end gap-2">
              <Cloud className="h-5 w-5 text-blue-500" />
              בדיקת Supabase
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              עודכן: {fmtDate(lastRefresh)} · משתמש: {user?.email ?? "לא מזוהה"}
            </p>
            <div className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground" dir="ltr">
              <div className="flex items-start gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0"
                  onClick={() => void copySupabaseValue("URL", SUPABASE_PROJECT_URL)}
                  title="העתק URL"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <p className="break-all">
                  URL: {SUPABASE_PROJECT_URL || "(missing VITE_SUPABASE_URL)"}
                </p>
              </div>
              <div className="flex items-start gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0"
                  onClick={() => void copySupabaseValue("anon key", SUPABASE_ANON_KEY)}
                  title="העתק anon key"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <p className="break-all">
                  anon key: {SUPABASE_ANON_KEY || "(missing VITE_SUPABASE_PUBLISHABLE_KEY)"}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 justify-end mt-3">
          <Badge variant="outline" className="border-gold/60">
            {SCHEMA.length} טבלאות
          </Badge>
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">
            סה"כ רשומות: {totalRows.toLocaleString()}
          </Badge>
          <Badge variant="outline" className="border-blue-500/40 text-blue-600">
            טבלאות פעילות: {activeTables}
          </Badge>
          {errorTables > 0 && (
            <Badge variant="outline" className="border-red-500/40 text-red-600">
              שגיאות: {errorTables}
            </Badge>
          )}
        </div>
      </Card>

      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); try { localStorage.setItem("pashash:inspector-tab", v); } catch {} }} className="w-full">
        <Card className="gold-frame p-2">
          <TabsList className="w-full bg-transparent h-auto flex-wrap justify-between gap-1">
            <TabsTrigger value="schema" className="flex-1 gap-1.5 rounded-xl px-2 py-2 text-sm data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground">
              <TableIcon className="h-4 w-4" /><span>סכמה</span>
            </TabsTrigger>
            <TabsTrigger value="data" className="flex-1 gap-1.5 rounded-xl px-2 py-2 text-sm data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground">
              <Database className="h-4 w-4" /><span>נתונים</span>
            </TabsTrigger>
            <TabsTrigger value="idb" className="flex-1 gap-1.5 rounded-xl px-2 py-2 text-sm data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground">
              <HardDrive className="h-4 w-4" /><span>IndexedDB</span>
            </TabsTrigger>
            <TabsTrigger value="sync" className="flex-1 gap-1.5 rounded-xl px-2 py-2 text-sm data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground">
              <Activity className="h-4 w-4" /><span>סנכרון</span>
            </TabsTrigger>
            <TabsTrigger value="compare" className="flex-1 gap-1.5 rounded-xl px-2 py-2 text-sm data-[state=active]:bg-gradient-navy data-[state=active]:text-primary-foreground">
              <ArrowLeftRight className="h-4 w-4" /><span>השוואה</span>
            </TabsTrigger>
          </TabsList>
        </Card>

        {/* Schema tab */}
        <TabsContent value="schema" className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground text-right px-1">
            לחץ על שורת טבלה כדי לפתוח את עמודותיה · PK = מפתח ראשי · FK = מפתח זר · NULL = ניתן לריק
          </p>
          {SCHEMA.map((t) => (
            <TableSchemaCard key={t.name} t={t} />
          ))}
        </TabsContent>

        {/* Data tab */}
        <TabsContent value="data" className="mt-4">
          <Card className="gold-frame p-4 mb-3">
            <h4 className="font-semibold text-right mb-3 flex items-center justify-end gap-2">
              <Activity className="h-4 w-4" />
              כיווני סנכרון (כתוב/מחק)
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-right space-y-2">
                <div className="flex items-center justify-end gap-2 font-medium">
                  <span>ענן → IndexedDB</span>
                  <ArrowDown className="h-4 w-4 text-blue-600" />
                </div>
                <Row label="שינוי אחרון בענן" value={fmtDate(directionalSync.cloudToIdb.lastCloudChangeAt)} />
                <Row label="כתיבה אחרונה ל-IndexedDB" value={fmtDate(directionalSync.cloudToIdb.lastIdbWriteAt)} />
                <Row label="מחיקה ענן→IndexedDB" value={fmtDate(directionalSync.cloudToIdb.lastDeleteAt)} />
              </div>

              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-right space-y-2">
                <div className="flex items-center justify-end gap-2 font-medium">
                  <span>IndexedDB → ענן</span>
                  <ArrowUp className="h-4 w-4 text-emerald-600" />
                </div>
                <Row label="כתיבה אחרונה לענן" value={fmtDate(directionalSync.idbToCloud.lastWriteAt)} />
                <Row label="מחיקה אחרונה לענן" value={fmtDate(directionalSync.idbToCloud.lastDeleteAt)} />
                <Row label="כתיבות בתור לענן" value={String(directionalSync.idbToCloud.queuedWriteJobs)} />
                <Row label="מחיקות בתור לענן" value={String(directionalSync.idbToCloud.queuedDeleteJobs)} />
                <Row
                  label="מחיקות לענן (הצליחו / נכשלו)"
                  value={`${directionalSync.idbToCloud.deleteSuccessCount} / ${directionalSync.idbToCloud.deleteFailedCount}`}
                />
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground text-right mt-3">
              מחיקות ענן→IndexedDB נרשמות ב-audit ייעודי בכל רענון full-sync או delta-sync.
            </p>
          </Card>

          {/* Device & Browser fingerprint */}
          <Card className="gold-frame p-4">
            <h4 className="font-semibold text-right mb-3 flex items-center justify-end gap-2">
              <Monitor className="h-4 w-4" />
              מכשיר ודפדפן (מזהה קבוע לדפדפן זה)
            </h4>
            {(() => {
              const deviceId = getOrCreateDeviceId();
              const { browser, os } = parseBrowserInfo(navigator.userAgent);
              const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
              const lastBootstrap = user?.id
                ? localStorage.getItem(`last-cloud-bootstrap-at:${user.id}`)
                : null;
              const lastFullSync = user?.id
                ? localStorage.getItem(`last-cloud-full-sync-at:${user.id}`)
                : null;
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-right">
                  <Row label="מזהה מכשיר" value={deviceId} />
                  <Row label="דפדפן" value={browser} />
                  <Row label="מערכת הפעלה" value={os} />
                  <Row label="אזור זמן" value={tz} />
                  <Row label="שפה" value={navigator.language} />
                  <Row label="רזולוציית מסך" value={`${window.screen.width}×${window.screen.height}`} />
                  <Row
                    label="רענון ענן אחרון"
                    value={lastBootstrap ? new Date(Number(lastBootstrap)).toLocaleString("he-IL") : "—"}
                  />
                  <Row
                    label="full-sync אחרון"
                    value={lastFullSync ? new Date(Number(lastFullSync)).toLocaleString("he-IL") : "—"}
                  />
                </div>
              );
            })()}
          </Card>

          <Card className="gold-frame p-4">
            <h4 className="font-semibold text-right mb-3 flex items-center justify-end gap-2">
              <Database className="h-4 w-4" />
              כמות רשומות לפי טבלה
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="py-2 px-2 text-right font-medium">
                      <button
                        onClick={() => handleColumnHeaderClick("name")}
                        className="flex items-center justify-end gap-1.5 w-full hover:text-foreground/80 transition-colors group"
                      >
                        <span className="flex items-center gap-1">
                          {sortField === "name" ? (
                            sortDir === "asc" ? (
                              <ArrowUp className="h-3.5 w-3.5 text-gold" />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5 text-gold" />
                            )
                          ) : (
                            <Filter className="h-3.5 w-3.5 opacity-0 group-hover:opacity-40 transition-opacity" />
                          )}
                        </span>
                        שם DB
                      </button>
                    </th>
                    <th className="py-2 px-2 text-right font-medium">
                      <button
                        onClick={() => handleColumnHeaderClick("label")}
                        className="flex items-center justify-end gap-1.5 w-full hover:text-foreground/80 transition-colors group"
                      >
                        <span className="flex items-center gap-1">
                          {sortField === "label" ? (
                            sortDir === "asc" ? (
                              <ArrowUp className="h-3.5 w-3.5 text-gold" />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5 text-gold" />
                            )
                          ) : (
                            <Filter className="h-3.5 w-3.5 opacity-0 group-hover:opacity-40 transition-opacity" />
                          )}
                        </span>
                        תיאור
                      </button>
                    </th>
                    <th className="py-2 px-2 text-right font-medium">
                      <button
                        onClick={() => handleColumnHeaderClick("count")}
                        className="flex items-center justify-end gap-1.5 w-full hover:text-foreground/80 transition-colors group"
                      >
                        <span className="flex items-center gap-1">
                          {sortField === "count" ? (
                            sortDir === "asc" ? (
                              <ArrowUp className="h-3.5 w-3.5 text-gold" />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5 text-gold" />
                            )
                          ) : (
                            <Filter className="h-3.5 w-3.5 opacity-0 group-hover:opacity-40 transition-opacity" />
                          )}
                        </span>
                        רשומות
                      </button>
                    </th>
                    <th className="py-2 px-2 text-right font-medium">
                      <button
                        onClick={() => handleColumnHeaderClick("lastSync")}
                        className="flex items-center justify-end gap-1.5 w-full hover:text-foreground/80 transition-colors group"
                      >
                        <span className="flex items-center gap-1">
                          {sortField === "lastSync" ? (
                            sortDir === "asc" ? (
                              <ArrowUp className="h-3.5 w-3.5 text-gold" />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5 text-gold" />
                            )
                          ) : (
                            <Filter className="h-3.5 w-3.5 opacity-0 group-hover:opacity-40 transition-opacity" />
                          )}
                        </span>
                        עדכון אחרון
                      </button>
                    </th>
                    <th className="py-2 px-2 text-right font-medium">
                      <button
                        onClick={() => handleColumnHeaderClick("syncField")}
                        className="flex items-center justify-end gap-1.5 w-full hover:text-foreground/80 transition-colors group"
                      >
                        <span className="flex items-center gap-1">
                          {sortField === "syncField" ? (
                            sortDir === "asc" ? (
                              <ArrowUp className="h-3.5 w-3.5 text-gold" />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5 text-gold" />
                            )
                          ) : (
                            <Filter className="h-3.5 w-3.5 opacity-0 group-hover:opacity-40 transition-opacity" />
                          )}
                        </span>
                        שדה זמן
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {getSortedSchema().map((t) => {
                    const s = stats.find((x) => x.name === t.name);
                    return (
                      <tr key={t.name} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                        <td className="py-2 px-2 text-right font-mono text-xs text-muted-foreground">{t.name}</td>
                        <td className="py-2 px-2 text-right text-sm">{t.label}</td>
                        <td className="py-2 px-2 text-right">
                          {s?.error ? (
                            <span className="text-red-500 text-xs">שגיאת RLS</span>
                          ) : s?.count == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className={s.count > 0 ? "font-semibold text-emerald-600" : "text-muted-foreground"}>
                              {s.count.toLocaleString()}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right text-xs text-muted-foreground">
                          {s ? fmtDate(s.lastSync) : "—"}
                        </td>
                        <td className="py-2 px-2 text-right text-xs text-blue-500 font-mono">
                          {t.syncField ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* IndexedDB tab */}
        <TabsContent value="idb" className="mt-4 space-y-3">
          {/* Snapshot card */}
          <Card className="gold-frame p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  disabled={rebuild.active}
                  title="מחק את ה-cache המקומי ובנה מחדש מ-Supabase"
                  onClick={() => {
                    if (!window.confirm("האם לבנות מחדש את IndexedDB? ה-cache המקומי יימחק וייטען מחדש מ-Supabase.")) return;
                    runRebuild(false);
                  }}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  בנה מחדש
                </Button>
                {rebuild.error && !rebuild.active && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="text-xs gap-1.5"
                    onClick={() => runRebuild(true)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    המשך מנקודת העצירה
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  disabled={rebuild.active || restoring}
                  title="בחר מה לגבות — פותח עץ בחירה"
                  onClick={handleBackup}
                >
                  <Download className="h-3.5 w-3.5" />
                  גיבוי נבחר
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  disabled={rebuild.active || restoring}
                  title="ייצא את כל ה-IndexedDB ללא בחירה"
                  onClick={handleBackupFull}
                >
                  <Download className="h-3.5 w-3.5" />
                  גיבוי מלא
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  disabled={rebuild.active || restoring}
                  title="שחזר IndexedDB מקובץ גיבוי (.json / .json.gz)"
                  onClick={() => restoreFileRef.current?.click()}
                >
                  {restoring
                    ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    : <Upload className="h-3.5 w-3.5" />}
                  {restoring ? "מעבד…" : "שחזור"}
                </Button>
                <input
                  ref={restoreFileRef}
                  type="file"
                  accept=".json,.json.gz,.gz,application/json,application/gzip"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleRestoreFile(file);
                    e.target.value = "";
                  }}
                />
              </div>
              <h4 className="font-semibold flex items-center gap-2">
                <HardDrive className="h-4 w-4" />
                תמונת IndexedDB (state cache)
              </h4>
            </div>

            {/* Progress panel */}
            {(rebuild.active || rebuild.pct > 0) && (
              <div className="mb-4 p-3 rounded-lg border border-border bg-muted/30 space-y-2 text-right">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{rebuild.pct}%</span>
                  <span className={rebuild.error ? "text-destructive" : rebuild.done ? "text-green-600" : "text-foreground"}>
                    {rebuild.step}
                  </span>
                </div>
                <Progress value={rebuild.pct} className="h-2" />
                {rebuild.error && (
                  <p className="text-xs text-destructive text-right">{rebuild.error}</p>
                )}
                {rebuild.done && rebuild.stats && (
                  <div className="mt-2 space-y-1">
                    <p className="text-xs font-medium text-right">פרטי הבנייה:</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                      {Object.entries(rebuild.stats.rows).map(([k, v]) => (
                        <div key={k} className="flex justify-between text-xs bg-background/60 px-2 py-1 rounded border border-border/40">
                          <span className="text-muted-foreground">{k}</span>
                          <span className="font-mono font-semibold">{v}</span>
                        </div>
                      ))}
                    </div>
                    {rebuild.stats.sizeKb > 0 && (
                      <p className="text-xs text-muted-foreground text-right mt-1">
                        גודל אחסון כולל: <span className="font-mono font-semibold">
                          {rebuild.stats.sizeKb >= 1024
                            ? `${(rebuild.stats.sizeKb / 1024).toFixed(1)} MB`
                            : `${rebuild.stats.sizeKb} KB`}
                        </span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {!idbSnap ? (
              <div className="text-sm text-muted-foreground text-right py-3">
                {user?.id ? "אין נתונים מקומיים שנטענו עדיין" : "יש להתחבר כדי לצפות במידע המקומי"}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                  <Stat label="כרטיסים" value={idbSnap.counts.cards} />
                  <Stat label="מערכות" value={idbSnap.counts.decks} />
                  <Stat label="קטגוריות" value={idbSnap.counts.categories} />
                  <Stat label="יעדים" value={idbSnap.counts.goals} />
                  <Stat label="שיוכי כרטיס-מערכת" value={idbSnap.counts.cardDecks} />
                  <Stat label="הערות יומיות" value={idbSnap.counts.dayNotes} />
                  <Stat label='חזרות ש"ס' value={idbSnap.counts.shasReviews} />
                  <Stat label="סשני לימוד" value={idbSnap.counts.learningSessions} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-right">
                  <Row label="נשמר אחרון" value={idbSnap.cacheSavedAt ? new Date(idbSnap.cacheSavedAt).toLocaleString("he-IL") : "—"} />
                  <Row label="עבודות סנכרון בתור" value={String(idbSnap.syncJobsCount)} />
                  <Row label="מחיקות ממתינות" value={String(idbSnap.pendingDeletesCount)} />
                  <Row
                    label="מחיקות (הצליחו / נכשלו / בתור / ללא שינוי)"
                    value={`${idbSnap.deleteAuditCounts.success} / ${idbSnap.deleteAuditCounts.failed} / ${idbSnap.deleteAuditCounts.queued} / ${idbSnap.deleteAuditCounts.noop}`}
                  />
                  <Row
                    label="אירוע מחיקה אחרון (IDB→ענן)"
                    value={idbSnap.latestDeleteAuditAt ? new Date(idbSnap.latestDeleteAuditAt).toLocaleString("he-IL") : "—"}
                  />
                  <Row
                    label="מחיקה אחרונה (ענן→IDB)"
                    value={idbSnap.latestCloudToIdbDeleteAt ? new Date(idbSnap.latestCloudToIdbDeleteAt).toLocaleString("he-IL") : "—"}
                  />
                </div>
              </>
            )}
          </Card>

          {/* Raw IndexedDB databases on this origin */}
          <Card className="gold-frame p-4">
            <div className="flex items-center justify-between mb-3">
              <Button variant="ghost" size="icon" className="h-7 w-7" title="רענן רשימה" onClick={async () => { await refreshIdbList(); await refreshStorageEst(); }}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              <h4 className="font-semibold flex items-center gap-2">
                <Database className="h-4 w-4" />
                מסדי IndexedDB באתר ({idbDatabases.length})
              </h4>
            </div>
            {storageEst && (
              <div className="flex flex-col items-end mb-3 gap-1">
                <div className="flex items-center justify-end gap-3 text-xs text-muted-foreground">
                  <span>מכסה: <span className="font-mono font-semibold">
                    {storageEst.quotaKb >= 1024 * 1024
                      ? `${(storageEst.quotaKb / 1024 / 1024).toFixed(1)} GB`
                      : storageEst.quotaKb >= 1024
                      ? `${(storageEst.quotaKb / 1024).toFixed(0)} MB`
                      : `${storageEst.quotaKb} KB`}
                  </span></span>
                  <span>שימוש: <span className="font-mono font-semibold">
                    {storageEst.usageKb >= 1024
                      ? `${(storageEst.usageKb / 1024).toFixed(1)} MB`
                      : `${storageEst.usageKb} KB`}
                  </span></span>
                </div>
                {storageEst.quotaKb > 0 && (
                  <div className="w-full">
                    <Progress value={Math.min(100, (storageEst.usageKb / storageEst.quotaKb) * 100)} className="h-1.5" />
                  </div>
                )}
              </div>
            )}
            {idbDatabases.length === 0 ? (
              <div className="text-sm text-muted-foreground text-right py-3">
                הדפדפן לא חושף את רשימת המסדים, או שאין מסדים פעילים.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="py-2 px-2 text-right font-medium">שם</th>
                        <th className="py-2 px-2 text-right font-medium">גרסה</th>
                        <th className="py-2 px-2 text-right font-medium">מחיקה</th>
                      </tr>
                    </thead>
                    <tbody>
                      {idbDatabases.map((d) => (
                        <tr key={d.name} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                          <td className="py-2 px-2 text-right font-mono text-xs">{d.name}</td>
                          <td className="py-2 px-2 text-right text-muted-foreground">v{d.version}</td>
                          <td className="py-2 px-2 text-right">
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={async () => {
                                if (window.confirm(`האם למחוק את המסד "${d.name}"? פעולה זו אינה הפיכה.`)) {
                                  try {
                                    const isMainDb = d.name === "pashash-study-state-v1";
                                    if (isMainDb && syncOn) {
                                      setSyncEnabled(false);
                                      setSyncOn(false);
                                    }
                                    await new Promise<void>((resolve, reject) => {
                                      const req = window.indexedDB.deleteDatabase(d.name!);
                                      req.onsuccess = () => resolve();
                                      req.onerror = () => reject(req.error);
                                    });
                                    toast.success(isMainDb && !syncOn
                                      ? `המסד "${d.name}" נמחק. הסנכרון הושבת — יש לרענן את הדף.`
                                      : `המסד "${d.name}" נמחק. יש לרענן את הדף.`);
                                    const dbs2 = await (indexedDB as unknown as { databases?: () => Promise<Array<{ name?: string; version?: number }>> }).databases?.();
                                    if (dbs2) setIdbDatabases(dbs2.filter((x): x is { name: string; version: number } => !!x.name).map(x => ({ name: x.name, version: x.version ?? 1 })).sort((a,b)=>a.name.localeCompare(b.name)));
                                    await refreshStorageEst();
                                  } catch (e) {
                                    toast.error("שגיאה במחיקה: " + (e instanceof Error ? e.message : e));
                                  }
                                }
                              }}
                            >
                              מחק
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* מחק את כולם */}
                <div className="flex justify-end mt-3">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={async () => {
                      if (window.confirm(`האם למחוק את כל ${idbDatabases.length} המסדים? פעולה זו אינה הפיכה.`)) {
                        const hasMainDb = idbDatabases.some(d => d.name === "pashash-study-state-v1");
                        if (hasMainDb && syncOn) {
                          setSyncEnabled(false);
                          setSyncOn(false);
                        }
                        const errors: string[] = [];
                        for (const d of idbDatabases) {
                          try {
                            await new Promise<void>((resolve, reject) => {
                              const req = window.indexedDB.deleteDatabase(d.name!);
                              req.onsuccess = () => resolve();
                              req.onerror = () => reject(req.error);
                            });
                          } catch (e) {
                            errors.push(d.name ?? "?");
                          }
                        }
                        if (errors.length) {
                          toast.error("שגיאה במחיקת: " + errors.join(", "));
                        } else {
                          toast.success(hasMainDb
                            ? "כל המסדים נמחקו. הסנכרון הושבת — יש לרענן את הדף."
                            : "כל המסדים נמחקו. יש לרענן את הדף.");
                        }
                        const dbs3 = await (indexedDB as unknown as { databases?: () => Promise<Array<{ name?: string; version?: number }>> }).databases?.();
                        if (dbs3) setIdbDatabases(dbs3.filter((x): x is { name: string; version: number } => !!x.name).map(x => ({ name: x.name, version: x.version ?? 1 })).sort((a,b)=>a.name.localeCompare(b.name)));
                        await refreshStorageEst();
                      }
                    }}
                  >
                    מחק את כולם
                  </Button>
                </div>
              </>
            )}
            <div className="text-[11px] text-right mt-2 space-y-0.5">
              <p className="text-muted-foreground">הסטטוס של הסנכרון נקבע על ידי הטוגל בכותרת — כשהוא כבוי, הנתונים נשמרים אך ורק כאן ב-IndexedDB ולא נשלחים ל-Supabase.</p>
              <p className="text-amber-600 dark:text-amber-400">⚠️ בטיחות: מחיקת <span className="font-mono">pashash-study-state-v1</span> מכבה את הסנכרון אוטומטית. יש לרענן את הדף לפני הפעלתו מחדש, כדי שהנתונים ייטענו מ-Supabase תחילה.</p>
            </div>
          </Card>
        </TabsContent>

        {/* Sync events tab */}
        <TabsContent value="sync" className="mt-4">
          <Card className="gold-frame p-4">
            <h4 className="font-semibold text-right mb-3 flex items-center justify-end gap-2">
              <Activity className="h-4 w-4" />
              אירועי סנכרון אחרונים ({events.length})
            </h4>
            {events.length === 0 ? (
              <div className="text-sm text-muted-foreground text-right py-4">
                {loading ? "טוען…" : "אין אירועים"}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[560px] overflow-y-auto">
                {events.map((ev, i) => (
                  <div
                    key={`${ev.table}-${ev.id}-${i}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-gold/20 bg-card/50 px-3 py-2"
                  >
                    <span className="text-xs text-muted-foreground flex-shrink-0">{fmtDate(ev.at)}</span>
                    <div className="flex items-center gap-2 text-sm text-right min-w-0">
                      <span className="text-muted-foreground font-mono text-xs hidden sm:inline truncate">
                        {shortId(ev.id)}
                      </span>
                      <span className="font-medium flex-shrink-0">{ev.label}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 flex-shrink-0">
                        {ev.table}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="compare" className="mt-4 space-y-3">
          <Card className="gold-frame p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <Button onClick={() => void loadCompare()} disabled={compareLoading} variant="outline" size="sm" className="gap-1.5">
                <RefreshCw className={`h-4 w-4 ${compareLoading ? "animate-spin" : ""}`} />
                רענן השוואה
              </Button>
              <h4 className="font-semibold text-right flex items-center gap-2">
                <ArrowLeftRight className="h-4 w-4" />
                השוואת IndexedDB מול Supabase
              </h4>
            </div>
            <p className="text-xs text-muted-foreground text-right">
              טבלאות: cards, decks, categories · הצגה עד {COMPARE_VISIBLE_LIMIT} מזהים בכל צד · רענון אוטומטי רק כשהטאב פתוח.
            </p>
            <p className="text-xs text-muted-foreground text-right mt-1">
              זמן סריקה אחרון: {fmtDate(compareSnapshot?.scannedAt ?? null)}
            </p>
            {compareError && (
              <div className="mt-3 text-sm text-destructive text-right">{compareError}</div>
            )}
          </Card>

          {!compareSnapshot ? (
            <Card className="gold-frame p-4 text-sm text-muted-foreground text-right">
              {compareLoading ? "מבצע השוואה…" : "אין נתוני השוואה להצגה"}
            </Card>
          ) : (
            <>
              {(["cards", "decks", "categories"] as CompareTableName[]).map((table) => {
                const idbTable = compareSnapshot.idb[table];
                const sbTable = compareSnapshot.supabase[table];
                const diff = compareSnapshot.diff[table];
                const idbById = new Map(idbTable.rows.map((row) => [row.id, row]));
                const sbById = new Map(sbTable.rows.map((row) => [row.id, row]));
                const visibleIdbOnly = diff.onlyInIdb.slice(0, COMPARE_VISIBLE_LIMIT);
                const visibleSbOnly = diff.onlyInSupabase.slice(0, COMPARE_VISIBLE_LIMIT);
                const deckRowsForDisplay = table === "decks"
                  ? (() => {
                      const idbDeckRows = compareSnapshot.idb.decks.rows;
                      const sbDeckRows = compareSnapshot.supabase.decks.rows;
                      const idbCards = compareSnapshot.idb.cards.rows;
                      const sbCards = compareSnapshot.supabase.cards.rows;
                      const byDeckIdb = countBy(idbCards, (r) => r.deckId ?? "(ללא deck)");
                      const byDeckSb = countBy(sbCards, (r) => r.deckId ?? "(ללא deck)");
                      const nameByDeckId = new Map<string, string>();
                      for (const d of idbDeckRows) if (d.name) nameByDeckId.set(d.id, d.name);
                      for (const d of sbDeckRows) if (d.name) nameByDeckId.set(d.id, d.name);
                      const allDeckIds = Array.from(new Set([
                        ...idbDeckRows.map((d) => d.id),
                        ...sbDeckRows.map((d) => d.id),
                      ])).sort((a, b) => {
                        const byCount = (byDeckSb[b] ?? 0) + (byDeckIdb[b] ?? 0) - (byDeckSb[a] ?? 0) - (byDeckIdb[a] ?? 0);
                        if (byCount !== 0) return byCount;
                        return (nameByDeckId.get(a) ?? a).localeCompare(nameByDeckId.get(b) ?? b, "he");
                      });
                      return allDeckIds.map((deckId) => {
                        const idbCount = byDeckIdb[deckId] ?? 0;
                        const sbCount = byDeckSb[deckId] ?? 0;
                        return {
                          id: deckId,
                          name: nameByDeckId.get(deckId) ?? "ללא שם",
                          idbCount,
                          sbCount,
                          hasGap: idbCount !== sbCount,
                        };
                      });
                    })()
                  : [];
                const idbSelectableIds = table === "decks" ? deckRowsForDisplay.map((r) => r.id) : visibleIdbOnly;
                const sbSelectableIds = table === "decks" ? deckRowsForDisplay.map((r) => r.id) : visibleSbOnly;
                const idbSelectedCount = idbSelectableIds.filter((id) => !!compareSelection[compareSelectionKey(table, "idb", id)]).length;
                const sbSelectedCount = sbSelectableIds.filter((id) => !!compareSelection[compareSelectionKey(table, "supabase", id)]).length;
                const deckGapCount = deckRowsForDisplay.filter((r) => r.hasGap).length;
                return (
                  <Card key={table} className="gold-frame p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{table}</span>
                      <h4 className="font-semibold text-right">השוואת {table}</h4>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                      <Row label="IDB: כמות" value={idbTable.count.toLocaleString()} />
                      <Row label="Supabase: כמות" value={sbTable.count.toLocaleString()} />
                      <Row label="IDB: עדכון אחרון" value={fmtDate(idbTable.maxUpdatedAt)} />
                      <Row label="Supabase: עדכון אחרון" value={fmtDate(sbTable.maxUpdatedAt)} />
                      <Row label="IDB: יצירה אחרונה" value={fmtDate(idbTable.maxCreatedAt)} />
                      <Row label="Supabase: יצירה אחרונה" value={fmtDate(sbTable.maxCreatedAt)} />
                    </div>

                    <div className={`grid grid-cols-1 ${table === "decks" ? "lg:grid-cols-[1fr_auto_1fr]" : "lg:grid-cols-2"} gap-3`}>
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => setBulkCompareSelection(table, "idb", idbSelectableIds, true)}
                              disabled={idbSelectableIds.length === 0}
                            >
                              בחר הכל
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => setBulkCompareSelection(table, "idb", visibleIdbOnly, false)}
                              disabled={idbSelectedCount === 0}
                            >
                              נקה
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs gap-1"
                              onClick={() => void copySelectedIdbToSupabase(table)}
                              disabled={idbSelectedCount === 0 || compareActionLoading}
                            >
                              <Copy className="h-3.5 w-3.5" />
                              העתק ל-SB ({idbSelectedCount})
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => void deleteSelectedFromIdb(table, "idb")}
                              disabled={idbSelectedCount === 0 || compareActionLoading}
                            >
                              מחק מ-IDB ({idbSelectedCount})
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => void deleteSelectedFromSupabase(table, "idb")}
                              disabled={idbSelectedCount === 0 || compareActionLoading}
                            >
                              מחק מ-SB ({idbSelectedCount})
                            </Button>
                          </div>
                          <div className="text-sm font-semibold text-right">קיים רק ב-IndexedDB ({diff.onlyInIdb.length})</div>
                        </div>
                        <div className="max-h-48 overflow-y-auto space-y-1">
                          {table === "decks" ? deckRowsForDisplay.map((row) => (
                            <button
                              key={`idb-${row.id}`}
                              type="button"
                              onClick={() => toggleCompareSelection(table, "idb", row.id)}
                              className={`w-full rounded border px-2 py-1.5 text-xs text-right space-y-0.5 transition ${compareSelection[compareSelectionKey(table, "idb", row.id)] ? "border-amber-500 bg-amber-500/20" : "border-amber-500/20 hover:border-amber-500/50"}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className={`text-[11px] ${row.hasGap ? "text-amber-700" : "text-emerald-700"}`}>{row.hasGap ? "יש פער" : "תואם"}</span>
                                <span className="font-mono">IDB {row.idbCount} | SB {row.sbCount}</span>
                              </div>
                              <div className="truncate">{row.name}</div>
                              <div className="font-mono text-[10px] text-muted-foreground truncate">{row.id}</div>
                            </button>
                          )) : visibleIdbOnly.map((id) => {
                            const selected = !!compareSelection[compareSelectionKey(table, "idb", id)];
                            return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => toggleCompareSelection(table, "idb", id)}
                              className={`w-full rounded border px-2 py-1.5 text-xs text-right space-y-0.5 transition ${selected ? "border-amber-500 bg-amber-500/20" : "border-transparent hover:border-amber-500/40"}`}
                            >
                              <div className="font-mono">{id}</div>
                              {compareRowLabel(table, idbById.get(id)) && (
                                <div className="text-[11px] text-muted-foreground">{compareRowLabel(table, idbById.get(id))}</div>
                              )}
                            </button>
                          )})}
                          {table === "decks"
                            ? deckRowsForDisplay.length === 0 && <div className="text-xs text-muted-foreground text-right">אין דאקס להצגה</div>
                            : diff.onlyInIdb.length === 0 && <div className="text-xs text-muted-foreground text-right">אין</div>}
                        </div>
                      </div>

                      {table === "decks" && (
                        <div className="hidden lg:flex items-center justify-center px-1">
                          <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${deckGapCount > 0 ? "border-amber-500/50 bg-amber-500/10 text-amber-700" : "border-emerald-500/50 bg-emerald-500/10 text-emerald-700"}`}>
                            {deckGapCount > 0 ? `יש הפרש (${deckGapCount})` : "אין הפרש"}
                          </div>
                        </div>
                      )}

                      <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => setBulkCompareSelection(table, "supabase", sbSelectableIds, true)}
                              disabled={sbSelectableIds.length === 0}
                            >
                              בחר הכל
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => setBulkCompareSelection(table, "supabase", visibleSbOnly, false)}
                              disabled={sbSelectedCount === 0}
                            >
                              נקה
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs gap-1"
                              onClick={() => void copySelectedSupabaseToIdb(table)}
                              disabled={sbSelectedCount === 0 || compareActionLoading}
                            >
                              <Copy className="h-3.5 w-3.5" />
                              העתק ל-IDB ({sbSelectedCount})
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => void deleteSelectedFromIdb(table, "supabase")}
                              disabled={sbSelectedCount === 0 || compareActionLoading}
                            >
                              מחק מ-IDB ({sbSelectedCount})
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => void deleteSelectedFromSupabase(table, "supabase")}
                              disabled={sbSelectedCount === 0 || compareActionLoading}
                            >
                              מחק מ-SB ({sbSelectedCount})
                            </Button>
                          </div>
                          <div className="text-sm font-semibold text-right">קיים רק ב-Supabase ({diff.onlyInSupabase.length})</div>
                        </div>
                        <div className="max-h-48 overflow-y-auto space-y-1">
                          {table === "decks" ? deckRowsForDisplay.map((row) => (
                            <button
                              key={`sb-${row.id}`}
                              type="button"
                              onClick={() => toggleCompareSelection(table, "supabase", row.id)}
                              className={`w-full rounded border px-2 py-1.5 text-xs text-right space-y-0.5 transition ${compareSelection[compareSelectionKey(table, "supabase", row.id)] ? "border-blue-500 bg-blue-500/20" : "border-blue-500/20 hover:border-blue-500/50"}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className={`text-[11px] ${row.hasGap ? "text-amber-700" : "text-emerald-700"}`}>{row.hasGap ? "יש פער" : "תואם"}</span>
                                <span className="font-mono">IDB {row.idbCount} | SB {row.sbCount}</span>
                              </div>
                              <div className="truncate">{row.name}</div>
                              <div className="font-mono text-[10px] text-muted-foreground truncate">{row.id}</div>
                            </button>
                          )) : visibleSbOnly.map((id) => {
                            const selected = !!compareSelection[compareSelectionKey(table, "supabase", id)];
                            return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => toggleCompareSelection(table, "supabase", id)}
                              className={`w-full rounded border px-2 py-1.5 text-xs text-right space-y-0.5 transition ${selected ? "border-blue-500 bg-blue-500/20" : "border-transparent hover:border-blue-500/40"}`}
                            >
                              <div className="font-mono">{id}</div>
                              {compareRowLabel(table, sbById.get(id)) && (
                                <div className="text-[11px] text-muted-foreground">{compareRowLabel(table, sbById.get(id))}</div>
                              )}
                            </button>
                          )})}
                          {table === "decks"
                            ? deckRowsForDisplay.length === 0 && <div className="text-xs text-muted-foreground text-right">אין דאקס להצגה</div>
                            : diff.onlyInSupabase.length === 0 && <div className="text-xs text-muted-foreground text-right">אין</div>}
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}

              <Card className="gold-frame p-4 space-y-3">
                <h4 className="font-semibold text-right">פירוק כרטיסים (cards)</h4>
                {(() => {
                  const idbCards = compareSnapshot.idb.cards.rows;
                  const sbCards = compareSnapshot.supabase.cards.rows;
                  const idbDeckRows = compareSnapshot.idb.decks.rows;
                  const sbDeckRows = compareSnapshot.supabase.decks.rows;
                  const byTypeIdb = countBy(idbCards, (r) => r.type || "unknown");
                  const byTypeSb = countBy(sbCards, (r) => r.type || "unknown");
                  const byDeckIdb = countBy(idbCards, (r) => r.deckId ?? "(ללא deck)");
                  const byDeckSb = countBy(sbCards, (r) => r.deckId ?? "(ללא deck)");
                  const typeKeys = Array.from(new Set([...Object.keys(byTypeIdb), ...Object.keys(byTypeSb)])).sort();
                  const deckNamesById = new Map<string, string>();
                  for (const deck of idbDeckRows) {
                    if (deck.name) deckNamesById.set(deck.id, deck.name);
                  }
                  for (const deck of sbDeckRows) {
                    if (deck.name) deckNamesById.set(deck.id, deck.name);
                  }
                  const deckKeys = Array.from(
                    new Set([
                      ...idbDeckRows.map((d) => d.id),
                      ...sbDeckRows.map((d) => d.id),
                      ...Object.keys(byDeckIdb),
                      ...Object.keys(byDeckSb),
                    ])
                  )
                    .filter((k) => k !== "(ללא deck)")
                    .sort((a, b) => {
                      const delta = (byDeckSb[b] ?? 0) + (byDeckIdb[b] ?? 0) - (byDeckSb[a] ?? 0) - (byDeckIdb[a] ?? 0);
                      if (delta !== 0) return delta;
                      return (deckNamesById.get(a) ?? a).localeCompare(deckNamesById.get(b) ?? b, "he");
                    });
                  const unassignedRow = {
                    key: "(ללא deck)",
                    name: "ללא מערכת",
                    idb: byDeckIdb["(ללא deck)"] ?? 0,
                    sb: byDeckSb["(ללא deck)"] ?? 0,
                  };
                  const idbRecent = pickTopByUpdated(idbCards, COMPARE_VISIBLE_LIMIT);
                  const sbRecent = pickTopByUpdated(sbCards, COMPARE_VISIBLE_LIMIT);

                  return (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                        <Row label="סה״כ cards ב-IDB" value={idbCards.length.toLocaleString()} />
                        <Row label="סה״כ cards ב-Supabase" value={sbCards.length.toLocaleString()} />
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div className="rounded-lg border p-3">
                          <div className="font-semibold text-right mb-2">לפי סוג שאלה</div>
                          <div className="space-y-1">
                            {typeKeys.map((k) => (
                              <div key={k} className="flex items-center justify-between text-xs">
                                <span className="font-mono">IDB {byTypeIdb[k] ?? 0} | SB {byTypeSb[k] ?? 0}</span>
                                <span>{k}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="font-semibold text-right mb-2">לפי מערכת (שם + כמות כרטיסיות)</div>
                          <div className="max-h-56 overflow-y-auto space-y-1">
                            {deckKeys.slice(0, COMPARE_VISIBLE_LIMIT).map((k) => (
                              <div key={k} className="flex items-center justify-between text-xs gap-2">
                                <span className="font-mono">IDB {byDeckIdb[k] ?? 0} | SB {byDeckSb[k] ?? 0}</span>
                                <div className="min-w-0 text-right">
                                  <div className="truncate max-w-[26rem]">{deckNamesById.get(k) ?? "ללא שם"}</div>
                                  <div className="font-mono text-[10px] text-muted-foreground truncate max-w-[26rem]">{k}</div>
                                </div>
                              </div>
                            ))}
                            {(unassignedRow.idb > 0 || unassignedRow.sb > 0) && (
                              <div className="flex items-center justify-between text-xs gap-2 border-t pt-1 mt-1">
                                <span className="font-mono">IDB {unassignedRow.idb} | SB {unassignedRow.sb}</span>
                                <div className="min-w-0 text-right">
                                  <div className="truncate max-w-[26rem]">{unassignedRow.name}</div>
                                  <div className="font-mono text-[10px] text-muted-foreground truncate max-w-[26rem]">{unassignedRow.key}</div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div className="rounded-lg border p-3">
                          <div className="font-semibold text-right mb-2">כרטיסים ששונו לאחרונה ב-IDB</div>
                          <div className="max-h-56 overflow-y-auto space-y-1">
                            {idbRecent.map((r) => (
                              <div key={`idb-${r.id}`} className="flex items-center justify-between text-xs gap-2">
                                <span className="font-mono text-muted-foreground">{fmtDate(r.updatedAt ?? r.createdAt)}</span>
                                <div className="min-w-0 text-right">
                                  <div className="font-mono truncate">{r.id}</div>
                                  {compactText(r.question, 56) && <div className="text-[11px] text-muted-foreground truncate">{compactText(r.question, 56)}</div>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="font-semibold text-right mb-2">כרטיסים ששונו לאחרונה ב-Supabase</div>
                          <div className="max-h-56 overflow-y-auto space-y-1">
                            {sbRecent.map((r) => (
                              <div key={`sb-${r.id}`} className="flex items-center justify-between text-xs gap-2">
                                <span className="font-mono text-muted-foreground">{fmtDate(r.updatedAt ?? r.createdAt)}</span>
                                <div className="min-w-0 text-right">
                                  <div className="font-mono truncate">{r.id}</div>
                                  {compactText(r.question, 56) && <div className="text-[11px] text-muted-foreground truncate">{compactText(r.question, 56)}</div>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>

      {treeDialog.state && (
        <BackupTreeDialog
          open={treeDialog.open}
          onClose={() => setTreeDialog((p) => ({ ...p, open: false }))}
          mode={treeDialog.mode}
          state={treeDialog.state}
          onConfirm={treeDialog.mode === "backup" ? handleBackupConfirm : handleRestoreConfirm}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Small UI helpers (IndexedDB tab)
   ───────────────────────────────────────────── */

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gold/30 bg-card/40 px-3 py-2 text-right">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-bold">{value.toLocaleString()}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card/40 px-3 py-2">
      <span className="font-mono text-xs text-muted-foreground truncate">{value}</span>
      <span className="text-xs">{label}</span>
    </div>
  );
}
