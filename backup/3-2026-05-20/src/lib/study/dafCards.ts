import type { Card, Category } from "./types";
import { displayCategoryName, dafLabel } from "./shasGen";

/**
 * מסנן כרטיסים השייכים לדף/עמוד נתון של מסכת.
 * תומך גם בשיוך מובנה (masechta/daf/amud) וגם בתגיות `cat:<categoryName>` ישנות.
 * אם amud=null מחזיר את שני העמודים.
 */
export function filterCardsByDafAmud(
  cards: Card[],
  categories: Category[] | undefined,
  masechta: string,
  daf: number,
  amud: 1 | 2 | null,
): Card[] {
  const amudLabel = amud === 1 ? 'ע"א' : amud === 2 ? 'ע"ב' : null;
  const dafLbl = dafLabel(daf);
  const dafNoDot = dafLbl.replace(".", "");
  const dafWithPrefix = `דף ${dafNoDot}`;
  const dafVariants = new Set([dafLbl, dafNoDot, dafWithPrefix]);

  // מצא את שמות הקטגוריות הרלוונטיות (הדף + העמודים שלו) — לחיפוש לפי תגיות
  const cats = categories ?? [];
  const catsById = new Map(cats.map((c) => [c.id, c]));

  const isInChain = (cat: Category, predicate: (leaf: string) => boolean): boolean => {
    let cur: Category | undefined = cat;
    let guard = 0;
    while (cur && guard < 32) {
      if (predicate(displayCategoryName(cur.name))) return true;
      cur = cur.parentId ? catsById.get(cur.parentId) : undefined;
      guard += 1;
    }
    return false;
  };

  // קטגוריה רלוונטית = יש לה אב מסכת + אב דף + (אם amud נבחר) האב/עצמה הוא העמוד
  const matchingCatNames = new Set<string>();
  for (const cat of cats) {
    const leaf = displayCategoryName(cat.name);
    const hasMasechta = isInChain(cat, (l) => l === masechta);
    const hasDaf = isInChain(cat, (l) => dafVariants.has(l));
    if (!hasMasechta || !hasDaf) continue;
    if (amudLabel) {
      const hasAmud = isInChain(cat, (l) => l === amudLabel);
      if (!hasAmud && !dafVariants.has(leaf)) continue;
      // אם amud נבחר — לא לכלול כרטיסים של העמוד השני
      const otherAmud = amudLabel === 'ע"א' ? 'ע"ב' : 'ע"א';
      if (isInChain(cat, (l) => l === otherAmud)) continue;
    }
    // Keep fallback matching strict to concrete category names only.
    // Generic leaf labels like "ב." or "דף ב" can exist across many masechtot
    // and cause cross-tractate pollution in Daf Learning counts.
    matchingCatNames.add(cat.name);
  }

  return cards.filter((c) => {
    // 1) שיוך מובנה
    if (c.masechta && c.masechta === masechta && c.daf === daf) {
      if (!amud || !c.amud || c.amud === amud) return true;
    }
    // 2) תגיות קטגוריה ישנות
    if (c.tags?.some((t) => t.startsWith("cat:") && matchingCatNames.has(t.slice(4)))) {
      return true;
    }
    return false;
  });
}

/** מחזיר ספירת כרטיסים פר-עמוד למסכת — לשימוש ב-badges של בורר הדפים. */
export function countCardsPerDaf(
  cards: Card[],
  categories: Category[] | undefined,
  masechta: string,
  totalPages: number,
): Map<number, { a: number; b: number; total: number }> {
  const out = new Map<number, { a: number; b: number; total: number }>();
  for (let d = 2; d <= totalPages + 1; d++) {
    const a = filterCardsByDafAmud(cards, categories, masechta, d, 1).length;
    const b = filterCardsByDafAmud(cards, categories, masechta, d, 2).length;
    if (a + b > 0) out.set(d, { a, b, total: a + b });
  }
  return out;
}