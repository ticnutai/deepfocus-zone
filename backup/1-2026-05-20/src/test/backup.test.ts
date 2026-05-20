import { describe, it, expect } from "vitest";
import { parseCsvCards, parseJsonBackup, buildSnapshot, BACKUP_VERSION } from "@/lib/study/backup";
import type { StudyState } from "@/lib/study/types";

// ─── parseCsvCards ────────────────────────────────────────────────────────────

describe("parseCsvCards", () => {
  it("parses a basic comma-separated CSV", () => {
    const csv = "שאלה,תשובה\nמה זה שלג?,לבן\nמה זה אש?,חם";
    const cards = parseCsvCards(csv);
    expect(cards).toHaveLength(2);
    expect(cards[0].question).toBe("מה זה שלג?");
    expect(cards[0].answer).toBe("לבן");
  });

  it("auto-detects tab separator", () => {
    const csv = "שאלה\tתשובה\nשאלה1\tתשובה1";
    const cards = parseCsvCards(csv);
    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe("שאלה1");
    expect(cards[0].answer).toBe("תשובה1");
  });

  it("handles English column names (front/back)", () => {
    const csv = "front,back\nHello,World";
    const cards = parseCsvCards(csv);
    expect(cards[0].question).toBe("Hello");
    expect(cards[0].answer).toBe("World");
  });

  it("parses deck name column", () => {
    const csv = "שאלה,תשובה,חפיסה\nשאלה1,תשובה1,גמרא";
    const cards = parseCsvCards(csv);
    expect(cards[0].deckName).toBe("גמרא");
  });

  it("parses tags separated by semicolons", () => {
    const csv = "שאלה,תשובה,תגיות\nשאלה1,תשובה1,tag1;tag2;tag3";
    const cards = parseCsvCards(csv);
    expect(cards[0].tags).toEqual(["tag1", "tag2", "tag3"]);
  });

  it("filters out rows with empty question", () => {
    const csv = "שאלה,תשובה\n,תשובה1\nשאלה2,תשובה2";
    const cards = parseCsvCards(csv);
    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe("שאלה2");
  });

  it("returns empty array for only header row", () => {
    const csv = "שאלה,תשובה";
    expect(parseCsvCards(csv)).toHaveLength(0);
  });

  it("returns empty array for empty string", () => {
    expect(parseCsvCards("")).toHaveLength(0);
  });

  it("handles quoted fields containing commas", () => {
    const csv = `שאלה,תשובה\n"שאלה, עם פסיק",תשובה`;
    const cards = parseCsvCards(csv);
    expect(cards[0].question).toBe("שאלה, עם פסיק");
  });

  it("handles quoted fields containing newlines via quoted value", () => {
    const csv = `שאלה,תשובה\n"שאלה""מצוטטת""",תשובה`;
    const cards = parseCsvCards(csv);
    expect(cards[0].question).toBe('שאלה"מצוטטת"');
  });

  it("falls back to first column as question, second as answer when no header match", () => {
    // With no recognizable keywords, col 0 = question, col 1 = answer
    const csv = "col_x,col_y\nvalue_x,value_y";
    const cards = parseCsvCards(csv);
    expect(cards[0].question).toBe("value_x");
    expect(cards[0].answer).toBe("value_y");
  });
});

// ─── parseJsonBackup ──────────────────────────────────────────────────────────

describe("parseJsonBackup", () => {
  it("parses a valid backup JSON", () => {
    const snapshot = {
      version: 1,
      exportedAt: "2026-05-01T10:00:00.000Z",
      data: { decks: [], cards: [], categories: [], goals: [], shasPlan: null, dayNotes: [], shasReviews: [], learningSessions: [], generalPlans: [], reviewIntervals: [1, 3, 7] },
    };
    const result = parseJsonBackup(JSON.stringify(snapshot));
    expect(result.version).toBe(1);
    expect(result.data.decks).toEqual([]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseJsonBackup("not json")).toThrow();
  });

  it("throws when version field is missing", () => {
    expect(() => parseJsonBackup(JSON.stringify({ data: {} }))).toThrow(/version/i);
  });

  it("throws when data field is missing", () => {
    expect(() => parseJsonBackup(JSON.stringify({ version: 1 }))).toThrow(/data/i);
  });

  it("throws on null input", () => {
    expect(() => parseJsonBackup(JSON.stringify(null))).toThrow();
  });

  it("throws on array input", () => {
    expect(() => parseJsonBackup(JSON.stringify([]))).toThrow();
  });
});

// ─── buildSnapshot ────────────────────────────────────────────────────────────

describe("buildSnapshot", () => {
  const minimalState: StudyState = {
    decks: [{ id: "d1", name: "מבחן", color: "gold", createdAt: 1000, categoryIds: [], includeSubCategories: true }],
    cards: [],
    logs: [],
    categories: [],
    goals: [],
    shasPlan: null,
    dayNotes: [],
    shasReviews: [],
    reviewIntervals: [1, 3, 7, 14, 30],
    learningSessions: [],
    generalPlans: [],
  };

  it("sets version to BACKUP_VERSION", () => {
    const snap = buildSnapshot(minimalState);
    expect(snap.version).toBe(BACKUP_VERSION);
  });

  it("includes exportedAt as ISO string", () => {
    const snap = buildSnapshot(minimalState);
    expect(() => new Date(snap.exportedAt)).not.toThrow();
    expect(snap.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("includes exportedBy when provided", () => {
    const snap = buildSnapshot(minimalState, "test@example.com");
    expect(snap.exportedBy).toBe("test@example.com");
  });

  it("exportedBy is undefined when not provided", () => {
    const snap = buildSnapshot(minimalState);
    expect(snap.exportedBy).toBeUndefined();
  });

  it("copies decks into snapshot data", () => {
    const snap = buildSnapshot(minimalState);
    expect(snap.data.decks).toHaveLength(1);
    expect(snap.data.decks[0].id).toBe("d1");
  });

  it("defaults null/undefined arrays to empty arrays", () => {
    const partialState: StudyState = { ...minimalState, categories: undefined, goals: undefined };
    const snap = buildSnapshot(partialState);
    expect(snap.data.categories).toEqual([]);
    expect(snap.data.goals).toEqual([]);
  });

  it("defaults reviewIntervals to [1,3,7,14,30] when undefined", () => {
    const partialState: StudyState = { ...minimalState, reviewIntervals: undefined };
    const snap = buildSnapshot(partialState);
    expect(snap.data.reviewIntervals).toEqual([1, 3, 7, 14, 30]);
  });
});
