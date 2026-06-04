/**
 * Backup, Restore, Export & Import utilities
 * Supports: JSON (full backup), CSV, TXT, XLSX (Excel)
 */
import type { StudyState, Category, Card, TabConfig, SidebarConfig, WidgetLayout, UiPrefs } from "./types";
import { supabase } from "@/integrations/supabase/client";

// ─── Snapshot type ─────────────────────────────────────────────────────────

export interface CardCategoryLink {
  id?: string;
  cardId: string;
  categoryId: string;
  sortOrder?: number;
}

export interface BackupSnapshot {
  version: number;
  exportedAt: string;       // ISO timestamp
  exportedBy?: string;      // user email (optional)
  data: {
    decks:            StudyState["decks"];
    cards:            StudyState["cards"];
    categories:       StudyState["categories"];
    /** Card↔Category associations from the cloud `card_categories` table. v2+ */
    cardCategories?:  CardCategoryLink[];
    goals:            StudyState["goals"];
    shasPlan:         StudyState["shasPlan"];
    dayNotes:         StudyState["dayNotes"];
    shasReviews:      StudyState["shasReviews"];
    learningSessions: StudyState["learningSessions"];
    generalPlans:     StudyState["generalPlans"];
    reviewIntervals:  StudyState["reviewIntervals"];
    /** Shas board preferences/data kept in uiPrefs + active main tab in localStorage */
    shasBoard?: {
      progress?: unknown;
      viewPrefs?: unknown;
      activeTab?: string | null;
    };
  };
}

export const BACKUP_VERSION = 2;

function readActiveMainTab(): string | null {
  try {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("active-tab");
  } catch {
    return null;
  }
}

function extractShasBoardData(state: StudyState): NonNullable<BackupSnapshot["data"]["shasBoard"]> {
  const uiPrefs = (state.uiPrefs ?? {}) as Record<string, unknown>;
  return {
    progress: uiPrefs.shasBoardProgress,
    viewPrefs: uiPrefs.shasBoardViewPrefs,
    activeTab: readActiveMainTab(),
  };
}

// ─── Cloud helpers for card↔category associations ─────────────────────────

/** Fetch all card_categories rows for the current user from the cloud. */
export async function fetchCloudCardCategories(): Promise<CardCategoryLink[]> {
  const out: CardCategoryLink[] = [];
  const pageSize = 1000;
  let from = 0;
  // page through to bypass the 1000-row default cap
  while (true) {
    const { data, error } = await supabase
      .from("card_categories")
      .select("id, card_id, category_id, sort_order")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message || "Failed to fetch card_categories");
    if (!data || data.length === 0) break;
    for (const r of data) {
      out.push({
        id: r.id as string,
        cardId: r.card_id as string,
        categoryId: r.category_id as string,
        sortOrder: (r.sort_order as number) ?? 0,
      });
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

/** Upsert links into the cloud `card_categories` table for the current user. */
export async function restoreCloudCardCategories(
  links: CardCategoryLink[],
  userId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ inserted: number }> {
  if (!links.length) return { inserted: 0 };
  const batchSize = 500;
  let inserted = 0;
  for (let i = 0; i < links.length; i += batchSize) {
    const slice = links.slice(i, i + batchSize).map((l) => ({
      user_id: userId,
      card_id: l.cardId,
      category_id: l.categoryId,
      sort_order: l.sortOrder ?? 0,
    }));
    const { error, count } = await supabase
      .from("card_categories")
      .upsert(slice, { onConflict: "card_id,category_id", count: "exact" });
    if (error) throw new Error(error.message);
    inserted += count ?? slice.length;
    onProgress?.(Math.min(i + batchSize, links.length), links.length);
  }
  return { inserted };
}

// ─── Card type-safe helpers ─────────────────────────────────────────────────

/** Upsert categories into the cloud, parents before children (topological order). */
export async function restoreCloudCategories(
  categories: Category[],
  userId: string,
): Promise<{ upserted: number }> {
  if (!categories.length) return { upserted: 0 };
  // Topological sort: roots first, then children whose parent was already emitted
  const sorted: Category[] = [];
  const emitted = new Set<string>();
  let remaining = [...categories];
  while (remaining.length > 0) {
    const before = remaining.length;
    const next: Category[] = [];
    for (const c of remaining) {
      if (c.parentId === null || emitted.has(c.parentId)) {
        sorted.push(c);
        emitted.add(c.id);
      } else {
        next.push(c);
      }
    }
    // Prevent infinite loop if there are orphaned categories (parentId not in set)
    if (next.length === before) {
      // Push remaining as-is to avoid infinite loop
      sorted.push(...next);
      break;
    }
    remaining = next;
  }
  const batchSize = 500;
  let upserted = 0;
  for (let i = 0; i < sorted.length; i += batchSize) {
    const slice = sorted.slice(i, i + batchSize).map((c) => ({
      id: c.id,
      user_id: userId,
      name: c.name,
      parent_id: c.parentId ?? null,
      sort_order: c.sortOrder ?? 0,
      color: c.color ?? null,
      updated_at: new Date(c.updatedAt ?? c.createdAt ?? Date.now()).toISOString(),
    }));
    const { error } = await supabase
      .from("categories")
      .upsert(slice, { onConflict: "id" });
    if (error) throw new Error(error.message);
    upserted += slice.length;
  }
  return { upserted };
}

/** Upsert cards into the cloud `cards` table. */
export async function restoreCloudCards(
  cards: Card[],
  userId: string,
): Promise<{ upserted: number }> {
  if (!cards.length) return { upserted: 0 };
  const batchSize = 500;
  let upserted = 0;
  for (let i = 0; i < cards.length; i += batchSize) {
    const slice = cards.slice(i, i + batchSize).map((c) => {
      const ac = c as Card & Record<string, unknown>;
      return {
        id: c.id,
        user_id: userId,
        deck_id: c.deckId ?? null,
        type: c.type,
        question: c.question,
        updated_at: new Date((ac.updatedAt as number | undefined) ?? Date.now()).toISOString(),
        answer: (ac.answer as string | undefined) ?? null,
        options: (ac.options as unknown[] | undefined) ?? null,
        correct_indices: (ac.correctIndices as number[] | undefined) ?? null,
        correct_boolean: c.type === "boolean" ? (ac.correct as boolean | undefined) ?? null : null,
        explanation: (ac.explanation as string | undefined) ?? null,
        tags: c.tags,
        srs: c.srs,
        stats: c.stats,
        masechta: c.masechta ?? null,
        daf: c.daf ?? null,
        amud: c.amud ?? null,
      };
    });
    const { error } = await supabase
      .from("cards")
      .upsert(slice as never, { onConflict: "id" });
    if (error) throw new Error(error.message);
    upserted += slice.length;
  }
  return { upserted };
}

// ─── Card type-safe helpers ─────────────────────────────────────────────────

function cardAnswer(card: StudyState["cards"][number]): string {
  switch (card.type) {
    case "flashcard": return card.answer;
    case "multiple":  return card.options.filter((_, i) => card.correctIndices.includes(i)).join("; ");
    case "boolean":   return card.correct ? "נכון" : "לא נכון";
    case "combo":     return card.answer ?? "";
  }
}

function cardOptions(card: StudyState["cards"][number]): string {
  if (card.type === "multiple") return card.options.join("; ");
  if (card.type === "combo")    return (card.options ?? []).join("; ");
  return "";
}

// ─── Build snapshot from state ────────────────────────────────────────────

export function buildSnapshot(state: StudyState, exportedBy?: string): BackupSnapshot {
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy,
    data: {
      decks:            state.decks ?? [],
      cards:            state.cards ?? [],
      categories:       state.categories ?? [],
      goals:            state.goals ?? [],
      shasPlan:         state.shasPlan ?? null,
      dayNotes:         state.dayNotes ?? [],
      shasReviews:      state.shasReviews ?? [],
      learningSessions: state.learningSessions ?? [],
      generalPlans:     state.generalPlans ?? [],
      reviewIntervals:  state.reviewIntervals ?? [1, 3, 7, 14, 30],
      shasBoard:        extractShasBoardData(state),
    },
  };
}

export interface BackupProgress {
  phase: string;
  processed: number;
  total: number;
  percent: number;
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function copyChunked<T>(
  items: T[] | undefined,
  chunkSize: number,
  onChunk: (count: number) => void,
): Promise<T[]> {
  const src = items ?? [];
  if (src.length === 0) return [];
  const out: T[] = [];
  for (let i = 0; i < src.length; i += chunkSize) {
    const chunk = src.slice(i, i + chunkSize);
    out.push(...chunk);
    onChunk(chunk.length);
    await nextTick();
  }
  return out;
}

/**
 * Builds a snapshot in small async chunks so large datasets won't block the UI thread.
 */
export async function buildSnapshotAsync(
  state: StudyState,
  exportedBy: string | undefined,
  onProgress?: (p: BackupProgress) => void,
): Promise<BackupSnapshot> {
  const total =
    (state.decks?.length ?? 0) +
    (state.cards?.length ?? 0) +
    (state.categories?.length ?? 0) +
    (state.goals?.length ?? 0) +
    (state.shasReviews?.length ?? 0) +
    (state.learningSessions?.length ?? 0) +
    (state.generalPlans?.length ?? 0) +
    (state.dayNotes?.length ?? 0) +
    2; // shasPlan + reviewIntervals

  let processed = 0;
  const emit = (phase: string, inc = 0) => {
    processed += inc;
    onProgress?.({
      phase,
      processed,
      total,
      percent: total > 0 ? Math.round((processed / total) * 100) : 100,
    });
  };

  emit("מתחיל גיבוי", 0);

  const decks = await copyChunked(state.decks, 400, (n) => emit("אוסף מערכות", n));
  const cards = await copyChunked(state.cards, 400, (n) => emit("אוסף כרטיסים", n));
  const categories = await copyChunked(state.categories, 400, (n) => emit("אוסף קטגוריות", n));
  const goals = await copyChunked(state.goals, 400, (n) => emit("אוסף יעדים", n));
  const shasReviews = await copyChunked(state.shasReviews, 400, (n) => emit("אוסף חזרות ש\"ס", n));
  const learningSessions = await copyChunked(state.learningSessions, 400, (n) => emit("אוסף סשנים", n));
  const generalPlans = await copyChunked(state.generalPlans, 400, (n) => emit("אוסף תוכניות", n));
  const dayNotes = await copyChunked(state.dayNotes, 400, (n) => emit("אוסף הערות יומיות", n));

  const shasPlan = state.shasPlan ?? null;
  emit("מכין תכנית ש\"ס", 1);
  const reviewIntervals = state.reviewIntervals ?? [1, 3, 7, 14, 30];
  emit("מכין מרווחי חזרה", 1);

  // Fetch card↔category associations from cloud (v2+)
  let cardCategories: CardCategoryLink[] = [];
  try {
    emit("אוסף שיוכי כרטיס↔קטגוריה", 0);
    cardCategories = await fetchCloudCardCategories();
  } catch (err) {
    console.warn("[backup] Failed to fetch card_categories", err);
  }

  emit("הושלם", 0);
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy,
    data: {
      decks,
      cards,
      categories,
      cardCategories,
      goals,
      shasPlan,
      dayNotes,
      shasReviews,
      learningSessions,
      generalPlans,
      reviewIntervals,
      shasBoard: extractShasBoardData(state),
    },
  };
}

// ─── JSON ─────────────────────────────────────────────────────────────────

export function exportJson(snapshot: BackupSnapshot): void {
  const json = JSON.stringify(snapshot, null, 2);
  downloadBlob(json, `backup_${dateSuffix()}.json`, "application/json");
}

export function parseJsonBackup(text: string): BackupSnapshot {
  const parsed = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) throw new Error("Invalid backup file");
  if (!parsed.version || !parsed.data) throw new Error("Invalid backup format — missing version or data");
  return parsed as BackupSnapshot;
}

// ─── TXT (human-readable summary) ────────────────────────────────────────

export function exportTxt(snapshot: BackupSnapshot): void {
  const { data } = snapshot;
  const lines: string[] = [];

  lines.push("=== גיבוי נתוני לימוד ===");
  lines.push(`תאריך: ${new Date(snapshot.exportedAt).toLocaleString("he-IL")}`);
  lines.push("");

  // Groups
  lines.push("--- קבוצות ---");
  for (const d of data.decks ?? []) {
    lines.push(`• ${d.name}${d.description ? ` — ${d.description}` : ""}`);
  }
  lines.push("");

  // Cards grouped by deck
  lines.push("--- שאלות וכרטיסיות ---");
  for (const deck of data.decks ?? []) {
    const deckCards = (data.cards ?? []).filter((c) => c.deckId === deck.id);
    if (deckCards.length === 0) continue;
    lines.push(`\n[${deck.name}]`);
    for (const card of deckCards) {
      lines.push(`  שאלה: ${card.question}`);
      const answer = cardAnswer(card);
      if (answer) lines.push(`  תשובה: ${answer}`);
      if (card.tags?.length) lines.push(`  תגיות: ${card.tags.join(", ")}`);
      lines.push("");
    }
  }

  // Categories
  if ((data.categories ?? []).length > 0) {
    lines.push("--- קטגוריות ---");
    for (const c of data.categories ?? []) {
      lines.push(`• ${c.name}`);
    }
    lines.push("");
  }

  // Goals
  if ((data.goals ?? []).length > 0) {
    lines.push("--- יעדים ---");
    for (const g of data.goals ?? []) {
      lines.push(`• ${g.title} (${g.type}) — יעד: ${g.target}`);
    }
    lines.push("");
  }

  // Learning sessions
  if ((data.learningSessions ?? []).length > 0) {
    lines.push("--- סשנים לימודיים ---");
    for (const s of data.learningSessions ?? []) {
      lines.push(`• ${s.date} | ${s.subject} | ${s.sessionType} | איכות: ${s.quality}`);
    }
    lines.push("");
  }

  // General plans
  if ((data.generalPlans ?? []).length > 0) {
    lines.push("--- תוכניות לימוד ---");
    for (const p of data.generalPlans ?? []) {
      lines.push(`• ${p.title} — ${p.completedUnits?.length ?? 0}/${p.units?.length ?? 0} יחידות`);
    }
    lines.push("");
  }

  // Day notes
  if ((data.dayNotes ?? []).length > 0) {
    lines.push("--- הערות יומיות ---");
    for (const n of data.dayNotes ?? []) {
      lines.push(`• ${n.date}: ${n.text}`);
    }
    lines.push("");
  }

  downloadBlob(lines.join("\n"), `backup_${dateSuffix()}.txt`, "text/plain;charset=utf-8");
}

// ─── CSV ──────────────────────────────────────────────────────────────────

export function exportCsv(snapshot: BackupSnapshot): void {
  const { data } = snapshot;
  const deckMap = new Map((data.decks ?? []).map((d) => [d.id, d.name]));

  const rows: string[][] = [
    ["קבוצה", "סוג", "שאלה", "תשובה", "אפשרויות", "תגיות", "חזרות", "נכונות", "אחוז הצלחה"],
  ];

  for (const card of data.cards ?? []) {
    const deckName = deckMap.get(card.deckId) ?? card.deckId;
    const answer  = cardAnswer(card);
    const options = cardOptions(card);
    const { totalReviews = 0, correct: correctCount = 0 } = card.stats ?? {};
    const rate = totalReviews > 0 ? `${Math.round((correctCount / totalReviews) * 100)}%` : "";

    rows.push([
      deckName, card.type, card.question,
      answer, options,
      (card.tags ?? []).join("; "),
      String(totalReviews), String(correctCount), rate,
    ]);
  }

  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
  downloadBlob("\uFEFF" + csv, `cards_${dateSuffix()}.csv`, "text/csv;charset=utf-8");
}

// ─── Excel (.xlsx) ────────────────────────────────────────────────────────

export async function exportXlsx(snapshot: BackupSnapshot): Promise<void> {
  const XLSX = await import("xlsx");
  const { data } = snapshot;
  const deckMap = new Map((data.decks ?? []).map((d) => [d.id, d.name]));
  const wb = XLSX.utils.book_new();

  // Sheet 1: Cards
  const cardRows = [["קבוצה", "סוג", "שאלה", "תשובה", "אפשרויות", "תגיות", "סה\"כ חזרות", "נכונות", "אחוז הצלחה"]];
  for (const card of data.cards ?? []) {
    const deckName = deckMap.get(card.deckId) ?? "";
    const answer  = cardAnswer(card);
    const options = cardOptions(card);
    const { totalReviews = 0, correct: correctCount = 0 } = card.stats ?? {};
    const rate = totalReviews > 0 ? Math.round((correctCount / totalReviews) * 100) : 0;
    cardRows.push([deckName, card.type, card.question, answer,
      options,
      (card.tags ?? []).join("; "), String(totalReviews), String(correctCount),
      totalReviews > 0 ? `${rate}%` : ""]);
  }
  const wsCards = XLSX.utils.aoa_to_sheet(cardRows);
  wsCards["!cols"] = [12, 10, 40, 30, 30, 20, 8, 8, 8].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, wsCards, "כרטיסיות");

  // Sheet 2: Decks
  const deckRows = [["שם", "תיאור", "צבע", "תאריך יצירה"]];
  for (const d of data.decks ?? []) {
    deckRows.push([d.name, d.description ?? "", d.color, new Date(d.createdAt).toLocaleDateString("he-IL")]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(deckRows), "קבוצות");

  // Sheet 3: Categories
  const catRows = [["שם", "קטגוריית אב"]];
  const catMap = new Map((data.categories ?? []).map((c) => [c.id, c.name]));
  for (const c of data.categories ?? []) {
    catRows.push([c.name, c.parentId ? (catMap.get(c.parentId) ?? "") : ""]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(catRows), "קטגוריות");

  // Sheet 4: Goals
  const goalRows = [["כותרת", "סוג", "יעד", "ימי חלון", "פעיל"]];
  for (const g of data.goals ?? []) {
    goalRows.push([g.title, g.type, String(g.target), String(g.windowDays ?? ""), g.active ? "כן" : "לא"]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(goalRows), "יעדים");

  // Sheet 5: Learning sessions
  const sessionRows = [["תאריך", "נושא", "סוג", "איכות", "משך (דק)", "הערה"]];
  for (const s of data.learningSessions ?? []) {
    sessionRows.push([s.date, s.subject, s.sessionType, String(s.quality), String(s.durationMinutes ?? ""), s.note ?? ""]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sessionRows), "סשנים לימודיים");

  // Sheet 6: Day notes
  const noteRows = [["תאריך", "הערה"]];
  for (const n of data.dayNotes ?? []) {
    noteRows.push([n.date, n.text]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(noteRows), "הערות יומיות");

  // Sheet 7: Shas reviews
  const shasRows = [["מסכת", "דף", "עמוד", "סוג", "יחידה", "מועד חזרה", "בוצע", "ראשוני"]];
  for (const r of data.shasReviews ?? []) {
    shasRows.push([r.masechta, String(r.daf), r.amud === 1 ? "א" : "ב", String(r.reviewIndex), r.unit, r.dueDate, r.doneAt ?? "", r.isInitial ? "כן" : "לא"]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(shasRows), "חזרות ש\"ס");

  // Sheet 8: General plans
  const planRows = [["כותרת", "סוג", "יחידות", "הושלמו", "קצב ביום", "תאריך התחלה"]];
  for (const p of data.generalPlans ?? []) {
    planRows.push([p.title, p.planType, String(p.units?.length ?? 0), String(p.completedUnits?.length ?? 0),
      String(p.unitsPerDay), new Date(p.startDate).toLocaleDateString("he-IL")]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(planRows), "תוכניות לימוד");

  XLSX.writeFile(wb, `backup_${dateSuffix()}.xlsx`);
}

// ─── Import CSV cards ─────────────────────────────────────────────────────

export interface ImportedCard {
  question: string;
  answer: string;
  tags: string[];
  deckName: string;
}

export function parseCsvCards(text: string): ImportedCard[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  // Try to auto-detect separator
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const headers = parseCsvLine(lines[0], sep).map((h) => h.toLowerCase().trim());

  // Flexible column detection — require at least 2 chars for keyword match to avoid false positives
  const matchKey = (h: string, keys: string[]) =>
    keys.some((k) => (k.length <= 2 ? h === k : h.includes(k)));
  const qi = headers.findIndex((h) => matchKey(h, ["שאלה", "question", "front"]));
  const ai = headers.findIndex((h) => matchKey(h, ["תשובה", "answer", "back"]));
  const di = headers.findIndex((h) => ["קבוצה", "חפיסה", "deck", "set", "group"].some((k) => h.includes(k)));
  const ti = headers.findIndex((h) => ["תגיות", "tags", "tag"].some((k) => h.includes(k)));

  const qCol = qi >= 0 ? qi : 0;
  const aCol = ai >= 0 ? ai : 1;

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line, sep);
    return {
      question: cells[qCol]?.trim() ?? "",
      answer: cells[aCol]?.trim() ?? "",
      deckName: di >= 0 ? (cells[di]?.trim() ?? "") : "",
      tags: ti >= 0 ? (cells[ti]?.split(";").map((t) => t.trim()).filter(Boolean) ?? []) : [],
    };
  }).filter((c) => c.question);
}

export async function parseXlsxCards(buffer: ArrayBuffer): Promise<ImportedCard[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "array" });
  // Try to find a sheet named "כרטיסיות" or use the first
  const sheetName = wb.SheetNames.find((n) => n.includes("כרטיסי")) ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" });

  return rows.map((row) => {
    // Accept Hebrew or English column names
    const question =
      row["שאלה"] ?? row["question"] ?? row["Question"] ?? row["front"] ?? "";
    const answer =
      row["תשובה"] ?? row["answer"] ?? row["Answer"] ?? row["back"] ?? "";
    const deck =
      row["קבוצה"] ?? row["חפיסה"] ?? row["deck"] ?? row["Deck"] ?? row["group"] ?? row["Group"] ?? "";
    const tags =
      (row["תגיות"] ?? row["tags"] ?? row["Tags"] ?? "")
        .split(";").map((t: string) => t.trim()).filter(Boolean);

    return { question: String(question).trim(), answer: String(answer).trim(), deckName: String(deck).trim(), tags };
  }).filter((c) => c.question);
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function dateSuffix(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
}

function downloadBlob(content: string | Uint8Array, filename: string, mimeType: string): void {
  const blob = new Blob([content as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function parseCsvLine(line: string, sep = ","): string[] {
  const result: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === sep && !inQ) {
      result.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

// ─── Topic/Scoped Snapshot ────────────────────────────────────────────────

export interface TopicBackupOptions {
  /** Category IDs to include (with all descendants). null/undefined = all categories. */
  categoryIds?: string[] | null;
  /** Deck IDs to include explicitly. null/undefined = all decks. */
  deckIds?: string[] | null;
  includeSrs: boolean;
  includeGoals: boolean;
  includePlans: boolean;
  includeSessions: boolean;
  includeDayNotes: boolean;
  includeShasPlan: boolean;
  exportedBy?: string;
  snapshotName?: string;
}

function getAllDescendantIds(rootId: string, allCats: Category[]): string[] {
  const ids: string[] = [rootId];
  for (const c of allCats) {
    if (c.parentId === rootId) ids.push(...getAllDescendantIds(c.id, allCats));
  }
  return ids;
}

export function buildTopicSnapshot(
  state: StudyState,
  opts: TopicBackupOptions,
): BackupSnapshot {
  const allCats = state.categories ?? [];
  const allCards = state.cards ?? [];
  const allDecks = state.decks ?? [];

  // ── Resolve category scope ──────────────────────────────────────────
  let catIdsSet: Set<string> | null = null;
  let catNamesSet: Set<string> | null = null;
  if (opts.categoryIds != null) {
    const expanded = new Set<string>();
    for (const cid of opts.categoryIds) {
      for (const id of getAllDescendantIds(cid, allCats)) expanded.add(id);
    }
    catIdsSet = expanded;
    catNamesSet = new Set(allCats.filter((c) => expanded.has(c.id)).map((c) => c.name));
  }

  // ── Resolve deck scope ──────────────────────────────────────────────
  let deckIdsSet: Set<string> | null = null;
  if (opts.deckIds != null) deckIdsSet = new Set(opts.deckIds);

  // ── Filter cards ─────────────────────────────────────────────────
  let filteredCards = allCards;
  if (catNamesSet || deckIdsSet) {
    filteredCards = allCards.filter((card) => {
      const inCat = catNamesSet
        ? (card.tags ?? []).some((t) => t.startsWith("cat:") && catNamesSet!.has(t.slice(4)))
        : false;
      const inDeck = deckIdsSet
        ? card.deckId != null && deckIdsSet.has(card.deckId)
        : false;
      return catNamesSet && deckIdsSet ? inCat || inDeck : catNamesSet ? inCat : inDeck;
    });
  }

  // ── Filter categories ─────────────────────────────────────────────
  const filteredCats = catIdsSet ? allCats.filter((c) => catIdsSet!.has(c.id)) : allCats;

  // ── Filter decks ─────────────────────────────────────────────────
  // Include decks explicitly selected OR decks referenced by filtered cards
  const cardDeckIds = new Set(filteredCards.map((c) => c.deckId).filter(Boolean) as string[]);
  const filteredDecks = allDecks.filter((d) => {
    if (deckIdsSet) return deckIdsSet.has(d.id);
    if (catIdsSet) return cardDeckIds.has(d.id) || (d.categoryIds ?? []).some((cid) => catIdsSet!.has(cid));
    return true;
  });

  // ── Strip SRS data if not wanted ──────────────────────────────────
  const processedCards = opts.includeSrs
    ? filteredCards
    : filteredCards.map((card) => ({
        ...card,
        srs: { ease: 2.5, interval: 0, repetitions: 0, dueAt: Date.now(), lastReviewedAt: null },
        stats: { totalReviews: 0, correct: 0, incorrect: 0 },
      }));

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: opts.exportedBy,
    data: {
      decks: filteredDecks,
      cards: processedCards,
      categories: filteredCats,
      goals: opts.includeGoals ? (state.goals ?? []) : [],
      shasPlan: opts.includeShasPlan ? (state.shasPlan ?? null) : null,
      shasReviews: opts.includeShasPlan ? (state.shasReviews ?? []) : [],
      learningSessions: opts.includeSessions ? (state.learningSessions ?? []) : [],
      generalPlans: opts.includePlans ? (state.generalPlans ?? []) : [],
      dayNotes: opts.includeDayNotes ? (state.dayNotes ?? []) : [],
      reviewIntervals: state.reviewIntervals ?? [1, 3, 7, 14, 30],
      shasBoard: extractShasBoardData(state),
    } as BackupSnapshot["data"],
  };
}

// ─── Restore diff ─────────────────────────────────────────────────────────
// Implementation lives in restoreDiff.ts (worker-friendly, no xlsx dep).
// Re-exported here for backward compatibility.
export type { DiffStatus, DiffItem, RestoreDiff } from "./restoreDiff";
export { buildRestoreDiff } from "./restoreDiff";

// ─── Auto-save to localStorage ────────────────────────────────────────────

const AUTO_SAVE_KEY = (userId: string) => `pashash_autosave:${userId}`;
const AUTO_SAVE_META_KEY = (userId: string) => `pashash_autosave_meta:${userId}`;

export interface AutoSaveMeta {
  savedAt: string;  // ISO
  cardCount: number;
  deckCount: number;
  sizeKb: number;
}

export function autoSaveSnapshot(state: StudyState, userId: string, exportedBy?: string): void {
  try {
    const snapshot = buildSnapshot(state, exportedBy);
    const json = JSON.stringify(snapshot);
    localStorage.setItem(AUTO_SAVE_KEY(userId), json);
    const meta: AutoSaveMeta = {
      savedAt: snapshot.exportedAt,
      cardCount: snapshot.data.cards?.length ?? 0,
      deckCount: snapshot.data.decks?.length ?? 0,
      sizeKb: Math.round(new Blob([json]).size / 1024),
    };
    localStorage.setItem(AUTO_SAVE_META_KEY(userId), JSON.stringify(meta));
  } catch {
    // Storage quota exceeded or unavailable — silently ignore
  }
}

export function loadAutoSaveMeta(userId: string): AutoSaveMeta | null {
  try {
    const raw = localStorage.getItem(AUTO_SAVE_META_KEY(userId));
    if (!raw) return null;
    return JSON.parse(raw) as AutoSaveMeta;
  } catch {
    return null;
  }
}

export function loadAutoSaveSnapshot(userId: string): BackupSnapshot | null {
  try {
    const raw = localStorage.getItem(AUTO_SAVE_KEY(userId));
    if (!raw) return null;
    return parseJsonBackup(raw);
  } catch {
    return null;
  }
}

// ─── Cloud backup helpers (Supabase) ─────────────────────────────────────

export interface CloudBackupRecord {
  id: string;
  name: string;
  created_at: string;
  size_bytes: number;
  topic_ids: string[];
}

interface CloudBackupMetaRow {
  id: string;
  snapshot: BackupSnapshot | null;
  storage_mode?: "inline" | "chunked";
  total_chunks?: number;
}

interface CloudChunkRow {
  chunk_index: number;
  chunk_data: string;
}

export interface CloudTransferProgress {
  phase: string;
  processed: number;
  total: number;
  percent: number;
}

const CLOUD_CHUNK_SIZE = 250_000;
const CLOUD_UPLOAD_CHECKPOINT_PREFIX = "pashash_cloud_upload_cp_v1:";

function supabaseErrorMessage(error: unknown, fallback: string): string {
  if (!error) return fallback;
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;

  const obj = error as {
    message?: string;
    details?: string;
    hint?: string;
    code?: string;
    status?: number;
    statusText?: string;
  };

  const parts = [obj.message, obj.details, obj.hint].filter(Boolean);
  if (parts.length > 0) return parts.join(" | ");

  if (obj.code || obj.status) {
    return [obj.code, obj.status ? `HTTP ${obj.status}` : undefined, obj.statusText]
      .filter(Boolean)
      .join(" ");
  }

  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
}

function cloudUploadCheckpointKey(userId: string, name: string, snapshot: BackupSnapshot): string {
  const marker = `${snapshot.exportedAt}:${snapshot.data.cards?.length ?? 0}:${snapshot.data.decks?.length ?? 0}:${snapshot.data.categories?.length ?? 0}`;
  return `${CLOUD_UPLOAD_CHECKPOINT_PREFIX}${userId}:${name}:${marker}`;
}

function splitStringIntoChunks(input: string, chunkSize: number): string[] {
  if (!input) return [""];
  const chunks: string[] = [];
  for (let i = 0; i < input.length; i += chunkSize) {
    chunks.push(input.slice(i, i + chunkSize));
  }
  return chunks;
}

function emitTransferProgress(
  onProgress: ((p: CloudTransferProgress) => void) | undefined,
  phase: string,
  processed: number,
  total: number,
): void {
  onProgress?.({
    phase,
    processed,
    total,
    percent: total > 0 ? Math.round((processed / total) * 100) : 100,
  });
}

function loadUploadCheckpoint(key: string): { backupId: string; nextChunk: number; totalChunks: number } | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { backupId: string; nextChunk: number; totalChunks: number };
    if (!parsed?.backupId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveUploadCheckpoint(key: string, data: { backupId: string; nextChunk: number; totalChunks: number }): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // ignore storage quota issues
  }
}

function clearUploadCheckpoint(key: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export async function saveCloudBackup(
  supabaseClient: { from: (table: string) => unknown },
  userId: string,
  name: string,
  snapshot: BackupSnapshot,
  topicIds: string[] = [],
  onProgress?: (p: CloudTransferProgress) => void,
): Promise<void> {
  const json = JSON.stringify(snapshot);
  const sizeBytes = new Blob([json]).size;
  const chunks = splitStringIntoChunks(json, CLOUD_CHUNK_SIZE);

  const db = supabaseClient as {
    from: (t: string) => {
      insert: (row: object) => {
        select: (cols: string) => {
          single: () => Promise<{ data: { id: string } | null; error: unknown }>;
        };
      };
      upsert: (row: object, opts: object) => Promise<{ error: unknown }>;
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: { id: string } | null; error: unknown }>;
        };
      };
    };
  };

  const checkpointKey = cloudUploadCheckpointKey(userId, name, snapshot);
  const checkpoint = loadUploadCheckpoint(checkpointKey);

  emitTransferProgress(onProgress, "מכין גיבוי לענן", 0, chunks.length + 1);

  let backupId: string | null = checkpoint?.backupId ?? null;
  let startChunk = checkpoint?.nextChunk ?? 0;

  if (backupId) {
    const { data: existing, error: checkError } = await db
      .from("user_backups")
      .select("id")
      .eq("id", backupId)
      .maybeSingle();
    if (checkError || !existing) {
      backupId = null;
      startChunk = 0;
      clearUploadCheckpoint(checkpointKey);
    }
  }

  if (!backupId) {
    const placeholder: BackupSnapshot = {
      version: snapshot.version,
      exportedAt: snapshot.exportedAt,
      exportedBy: snapshot.exportedBy,
      data: {
        decks: [],
        cards: [],
        categories: [],
        goals: [],
        shasPlan: null,
        dayNotes: [],
        shasReviews: [],
        learningSessions: [],
        generalPlans: [],
        reviewIntervals: snapshot.data.reviewIntervals ?? [1, 3, 7, 14, 30],
      },
    };

    const { data: created, error: createError } = await db
      .from("user_backups")
      .insert({
        user_id: userId,
        name,
        size_bytes: sizeBytes,
        topic_ids: topicIds,
        snapshot: chunks.length > 1 ? placeholder : snapshot,
        storage_mode: chunks.length > 1 ? "chunked" : "inline",
        total_chunks: chunks.length > 1 ? chunks.length : 0,
      })
      .select("id")
      .single();

    if (createError || !created) {
      throw new Error(supabaseErrorMessage(createError, "שגיאה בשמירה לענן"));
    }
    backupId = created.id;
  }

  if (chunks.length <= 1) {
    clearUploadCheckpoint(checkpointKey);
    emitTransferProgress(onProgress, "נשמר לענן", 1, 1);
    return;
  }

  const total = chunks.length + 1;
  emitTransferProgress(onProgress, "מעלה לענן (במקטעים)", Math.min(startChunk + 1, total), total);

  for (let i = startChunk; i < chunks.length; i++) {
    const { error: chunkError } = await db.from("user_backup_chunks").upsert({
      backup_id: backupId,
      user_id: userId,
      chunk_index: i,
      chunk_data: chunks[i],
    }, { onConflict: "backup_id,chunk_index" });

    if (chunkError) {
      saveUploadCheckpoint(checkpointKey, { backupId, nextChunk: i, totalChunks: chunks.length });
      throw new Error(supabaseErrorMessage(chunkError, `שגיאה בהעלאת מקטע ${i + 1}/${chunks.length}`));
    }

    saveUploadCheckpoint(checkpointKey, { backupId, nextChunk: i + 1, totalChunks: chunks.length });
    emitTransferProgress(onProgress, "מעלה לענן (במקטעים)", i + 2, total);
  }

  clearUploadCheckpoint(checkpointKey);
  emitTransferProgress(onProgress, "נשמר לענן", total, total);
}

export async function listCloudBackups(
  supabaseClient: { from: (table: string) => unknown },
  userId: string,
): Promise<CloudBackupRecord[]> {
  const client = supabaseClient as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          order: (col: string, opts: object) => {
            limit: (n: number) => Promise<{ data: CloudBackupRecord[] | null; error: unknown }>;
          };
        };
      };
    };
  };
  const { data, error } = await client
    .from("user_backups")
    .select("id, name, created_at, size_bytes, topic_ids")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(supabaseErrorMessage(error, "שגיאה בטעינת גיבויים מהענן"));
  return data ?? [];
}

export async function loadCloudBackup(
  supabaseClient: { from: (table: string) => unknown },
  backupId: string,
  onProgress?: (p: CloudTransferProgress) => void,
): Promise<BackupSnapshot> {
  const client = supabaseClient as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          single: () => Promise<{ data: CloudBackupMetaRow | null; error: unknown }>;
          order: (col: string, opts: object) => Promise<{ data: CloudChunkRow[] | null; error: unknown }>;
        };
      };
    };
  };

  emitTransferProgress(onProgress, "טוען מטא-דאטה", 0, 1);
  const { data, error } = await client
    .from("user_backups")
    .select("id,snapshot,storage_mode,total_chunks")
    .eq("id", backupId)
    .single();
  if (error || !data) throw new Error("לא ניתן לטעון את הגיבוי");

  if ((data.storage_mode ?? "inline") !== "chunked") {
    emitTransferProgress(onProgress, "נטען", 1, 1);
    return data.snapshot as BackupSnapshot;
  }

  const totalChunks = data.total_chunks ?? 0;
  if (totalChunks <= 0) throw new Error("גיבוי ענן מקוטע פגום (אין מקטעים)");

  emitTransferProgress(onProgress, "מוריד מקטעים", 0, totalChunks);
  const { data: rows, error: chunksError } = await client
    .from("user_backup_chunks")
    .select("chunk_index,chunk_data")
    .eq("backup_id", backupId)
    .order("chunk_index", { ascending: true });

  if (chunksError) throw new Error(supabaseErrorMessage(chunksError, "שגיאה בטעינת מקטעי הגיבוי"));
  const chunks = rows ?? [];
  if (chunks.length < totalChunks) {
    throw new Error(`גיבוי ענן לא שלם: התקבלו ${chunks.length}/${totalChunks} מקטעים`);
  }

  const byIndex = new Map(chunks.map((r) => [r.chunk_index, r.chunk_data]));
  const ordered: string[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const value = byIndex.get(i);
    if (value == null) throw new Error(`גיבוי ענן פגום: חסר מקטע ${i + 1}`);
    ordered.push(value);
    emitTransferProgress(onProgress, "מוריד מקטעים", i + 1, totalChunks);
  }

  const json = ordered.join("");
  try {
    return parseJsonBackup(json);
  } catch {
    throw new Error("תוכן הגיבוי בענן פגום או לא תקין");
  }
}

export async function deleteCloudBackup(
  supabaseClient: { from: (table: string) => unknown },
  backupId: string,
): Promise<void> {
  const client = supabaseClient as {
    from: (t: string) => {
      delete: () => {
        eq: (col: string, val: string) => Promise<{ error: unknown }>;
      };
    };
  };
  const { error } = await client.from("user_backups").delete().eq("id", backupId);
  if (error) throw new Error(supabaseErrorMessage(error, "שגיאה במחיקת גיבוי מהענן"));
}

// ─── Settings Snapshot ────────────────────────────────────────────────────

export const SETTINGS_VERSION = 1;

export const SHAS_BOARD_SETTINGS_VERSION = 1;

export interface SettingsSnapshot {
  version: number;
  exportedAt: string;
  exportedBy?: string;
  settings: {
    uiPrefs?: UiPrefs;
    tabConfig?: TabConfig[];
    sidebarConfig?: SidebarConfig[];
    widgetLayout?: WidgetLayout;
  };
}

export interface ShasBoardSettingsSnapshot {
  version: number;
  exportedAt: string;
  exportedBy?: string;
  shasBoard: {
    progress?: unknown;
    viewPrefs?: unknown;
    activeTab?: string | null;
  };
}

export function buildSettingsSnapshot(state: StudyState, exportedBy?: string): SettingsSnapshot {
  return {
    version: SETTINGS_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy,
    settings: {
      uiPrefs: state.uiPrefs ?? {},
      tabConfig: state.tabConfig ?? [],
      sidebarConfig: state.sidebarConfig ?? [],
      widgetLayout: state.widgetLayout,
    },
  };
}

export function exportSettingsJson(state: StudyState, exportedBy?: string): void {
  const snap = buildSettingsSnapshot(state, exportedBy);
  const json = JSON.stringify(snap, null, 2);
  downloadBlob(json, `settings_backup_${dateSuffix()}.json`, "application/json");
}

export function parseSettingsBackup(text: string): SettingsSnapshot {
  const parsed = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) throw new Error("Invalid settings backup file");
  if (!parsed.version || !parsed.settings) throw new Error("Invalid settings backup format");
  return parsed as SettingsSnapshot;
}

export function buildShasBoardSettingsSnapshot(state: StudyState, exportedBy?: string): ShasBoardSettingsSnapshot {
  const shasBoard = extractShasBoardData(state);
  return {
    version: SHAS_BOARD_SETTINGS_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy,
    shasBoard,
  };
}

export function exportShasBoardSettingsJson(state: StudyState, exportedBy?: string): void {
  const snap = buildShasBoardSettingsSnapshot(state, exportedBy);
  const json = JSON.stringify(snap, null, 2);
  downloadBlob(json, `shas_board_backup_${dateSuffix()}.json`, "application/json");
}

export function parseShasBoardSettingsBackup(text: string): ShasBoardSettingsSnapshot {
  const parsed = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) throw new Error("Invalid shas-board backup file");
  if (!parsed.version || !parsed.shasBoard) throw new Error("Invalid shas-board backup format");
  return parsed as ShasBoardSettingsSnapshot;
}
