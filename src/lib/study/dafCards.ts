import type { Card, Category } from "./types";
import { displayCategoryName, dafLabel } from "./shasGen";

type DafBucket = { a: Set<string>; b: Set<string>; generic: Set<string> };

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
  const matchingCatIds = new Set<string>();
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
    matchingCatIds.add(cat.id);
  }

  return cards.filter((c) => {
    // 1) שיוך מובנה
    if (c.masechta && c.masechta === masechta && c.daf === daf) {
      if (!amud || !c.amud || c.amud === amud) return true;
    }
    // 2) תגיות קטגוריה ישנות
    if (c.tags?.some((t) => {
      if (!t.startsWith("cat:")) return false;
      const payload = t.slice(4);
      return matchingCatNames.has(payload) || matchingCatIds.has(payload);
    })) {
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
  const cats = categories ?? [];
  const catsById = new Map(cats.map((c) => [c.id, c]));

  const variantToDaf = new Map<string, number>();
  for (let d = 2; d <= totalPages + 1; d++) {
    const lbl = dafLabel(d);
    const noDot = lbl.replace(".", "");
    variantToDaf.set(lbl, d);
    variantToDaf.set(noDot, d);
    variantToDaf.set(`דף ${noDot}`, d);
  }

  const buckets = new Map<number, DafBucket>();
  const getBucket = (d: number): DafBucket => {
    let b = buckets.get(d);
    if (!b) {
      b = { a: new Set<string>(), b: new Set<string>(), generic: new Set<string>() };
      buckets.set(d, b);
    }
    return b;
  };

  for (const cat of cats) {
    let cur: Category | undefined = cat;
    let guard = 0;
    let hasMasechta = false;
    let foundDaf: number | null = null;
    let foundAmud: 1 | 2 | null = null;

    while (cur && guard < 32) {
      const leaf = displayCategoryName(cur.name);
      if (leaf === masechta) hasMasechta = true;
      if (leaf === 'ע"א') foundAmud = 1;
      else if (leaf === 'ע"ב') foundAmud = 2;

      const d = variantToDaf.get(leaf);
      if (d) foundDaf = d;

      cur = cur.parentId ? catsById.get(cur.parentId) : undefined;
      guard += 1;
    }

    if (!hasMasechta || !foundDaf) continue;
    const bucket = getBucket(foundDaf);
    if (foundAmud === 1) bucket.a.add(cat.name);
    else if (foundAmud === 2) bucket.b.add(cat.name);
    else bucket.generic.add(cat.name);
  }

  for (const card of cards) {
    const structuredMatch = card.masechta === masechta && !!card.daf;
    if (structuredMatch) {
      const d = card.daf as number;
      if (d >= 2 && d <= totalPages + 1) {
        const current = out.get(d) ?? { a: 0, b: 0, total: 0 };
        if (card.amud === 1) {
          current.a += 1;
          current.total += 1;
        } else if (card.amud === 2) {
          current.b += 1;
          current.total += 1;
        } else {
          // Preserve legacy behavior where cards without explicit amud appear in both badges.
          current.a += 1;
          current.b += 1;
          current.total += 2;
        }
        out.set(d, current);
      }
      continue;
    }

    if (!card.tags || card.tags.length === 0) continue;

    const byDafHit = new Map<number, { hasA: boolean; hasB: boolean }>();
    for (const tag of card.tags) {
      if (!tag.startsWith("cat:")) continue;
      const catName = tag.slice(4);
      for (const [d, bucket] of buckets) {
        const hitA = bucket.a.has(catName) || bucket.generic.has(catName);
        const hitB = bucket.b.has(catName) || bucket.generic.has(catName);
        if (!hitA && !hitB) continue;
        const hit = byDafHit.get(d) ?? { hasA: false, hasB: false };
        if (hitA) hit.hasA = true;
        if (hitB) hit.hasB = true;
        byDafHit.set(d, hit);
      }
    }

    for (const [d, hit] of byDafHit) {
      const current = out.get(d) ?? { a: 0, b: 0, total: 0 };
      if (hit.hasA) {
        current.a += 1;
        current.total += 1;
      }
      if (hit.hasB) {
        current.b += 1;
        current.total += 1;
      }
      out.set(d, current);
    }
  }

  for (const [d, counts] of Array.from(out.entries())) {
    if (d < 2 || d > totalPages + 1 || counts.total === 0) out.delete(d);
  }

  return out;
}