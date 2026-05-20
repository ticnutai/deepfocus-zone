import type { Card, CardType } from "./types";

export interface ParsedCard {
  type: CardType;
  question: string;
  answer?: string;
  options?: string[];
  correctIndices?: number[];
  correct?: boolean;
  explanation?: string;
  tags: string[];
}

export type BulkMode = "flashcard" | "multiple" | "boolean";

/**
 * Parse bulk text input into cards based on mode.
 *
 * Modes:
 *  - "flashcard": each line is "question | answer" (separator: | or ; or tab)
 *  - "multiple": blocks separated by blank lines
 *      line 1: question
 *      lines 2+: options. Mark correct with leading "*" or "[x]"
 *  - "boolean": each line is "question | true/false [| explanation]"
 *      Hebrew supported: נכון/לא נכון, true/false, t/f, 1/0, +/-
 *
 * Tags: append "  #tag1 #tag2" anywhere on the question line.
 */
export function parseBulk(text: string, mode: BulkMode): { cards: ParsedCard[]; errors: string[] } {
  const cards: ParsedCard[] = [];
  const errors: string[] = [];

  const extractTags = (s: string): { text: string; tags: string[] } => {
    const tags: string[] = [];
    const cleaned = s.replace(/#([^\s#]+)/g, (_, t: string) => {
      // #shuffle is an editor hint — not a real tag
      if (t.toLowerCase() === "shuffle") return "";
      tags.push(t);
      return "";
    }).trim();
    return { text: cleaned, tags };
  };

  if (mode === "flashcard") {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    lines.forEach((line, i) => {
      const parts = line.split(/\s*[|;\t]\s*/);
      if (parts.length < 2) {
        errors.push(`שורה ${i + 1}: חסר מפריד | בין השאלה לתשובה`);
        return;
      }
      const { text: question, tags } = extractTags(parts[0]);
      const answer = parts.slice(1).join(" | ").trim();
      if (!question || !answer) {
        errors.push(`שורה ${i + 1}: שאלה או תשובה ריקות`);
        return;
      }
      cards.push({ type: "flashcard", question, answer, tags });
    });
  } else if (mode === "boolean") {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const truthy = new Set(["נכון", "true", "t", "1", "+", "yes", "כן", "v"]);
    const falsy = new Set(["לא נכון", "לא-נכון", "false", "f", "0", "-", "no", "לא", "x"]);
    lines.forEach((line, i) => {
      const parts = line.split(/\s*[|;\t]\s*/);
      if (parts.length < 2) {
        errors.push(`שורה ${i + 1}: חסר מפריד | בין השאלה לתשובה`);
        return;
      }
      const { text: question, tags } = extractTags(parts[0]);
      const ansRaw = parts[1].trim().toLowerCase();
      let correct: boolean | null = null;
      if (truthy.has(ansRaw)) correct = true;
      else if (falsy.has(ansRaw)) correct = false;
      if (correct === null) {
        errors.push(`שורה ${i + 1}: התשובה "${parts[1]}" לא מזוהה (השתמש בנכון/לא נכון)`);
        return;
      }
      const explanation = parts[2]?.trim() || undefined;
      if (!question) {
        errors.push(`שורה ${i + 1}: שאלה ריקה`);
        return;
      }
      cards.push({ type: "boolean", question, correct, explanation, tags });
    });
  } else if (mode === "multiple") {
    // Split by blank lines into blocks
    const blocks = text.split(/\r?\n\s*\r?\n/).map((b) => b.trim()).filter(Boolean);
    blocks.forEach((block, bIdx) => {
      const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 3) {
        errors.push(`בלוק ${bIdx + 1}: צריך לפחות שאלה + 2 אפשרויות`);
        return;
      }
      const { text: question, tags } = extractTags(lines[0]);
      const options: string[] = [];
      const correctIndices: number[] = [];
      lines.slice(1).forEach((raw, idx) => {
        let opt = raw;
        // Strip leading list markers: "1.", "1)", "a.", "-", "•"
        opt = opt.replace(/^([0-9]+|[a-zA-Zא-ת])[.)]\s+/, "").replace(/^[-•*]\s+(?!\*)/, "");
        let isCorrect = false;
        if (opt.startsWith("**") || opt.startsWith("*")) {
          isCorrect = true;
          opt = opt.replace(/^\*+\s*/, "");
        } else if (/^\[(x|X|v|V|✓)\]\s*/.test(opt)) {
          isCorrect = true;
          opt = opt.replace(/^\[[xXvV✓]\]\s*/, "");
        }
        opt = opt.trim();
        if (!opt) return;
        if (isCorrect) correctIndices.push(options.length);
        options.push(opt);
      });
      if (!question) { errors.push(`בלוק ${bIdx + 1}: שאלה ריקה`); return; }
      if (options.length < 2) { errors.push(`בלוק ${bIdx + 1}: צריך לפחות 2 אפשרויות`); return; }
      if (correctIndices.length === 0) {
        errors.push(`בלוק ${bIdx + 1}: לא סומנה תשובה נכונה (השתמש ב-* בתחילת השורה)`);
        return;
      }
      cards.push({ type: "multiple", question, options, correctIndices, tags });
    });
  }

  return { cards, errors };
}

export const BULK_EXAMPLES: Record<BulkMode, string> = {
  flashcard: `מה הבירה של צרפת? | פריז
מי כתב את "המלט"? | שייקספיר #ספרות
H2O | מים #מדע`,
  multiple: `איזו שפת תכנות פותחה ע"י Brendan Eich?
Python
* JavaScript
Ruby
Go

מי גילה את אמריקה? #היסטוריה
* קולומבוס
ויקינגים
מגלן`,
  boolean: `כדור הארץ שטוח | לא נכון | זוהי תפיסה שגויה
המים קופאים ב-0 מעלות | נכון
שיקספיר חי במאה ה-20 | לא נכון | הוא חי במאות 16-17 #ספרות`,
};
