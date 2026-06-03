import type { Card, Category } from "./types";
import { displayCategoryName, dafLabel } from "./shasGen";

/**
 * אינדוקס קטגוריות לפי מסכת/דף/עמוד.
 * נבנה פעם אחת לכל (categories, masechta, totalPages) ומשמש גם לסינון וגם לספירה.
 * השדרוג: במקום לטייל בשרשרת הקטגוריות עבור כל כרטיס×כל באקט,
 * נטייל פעם אחת לכל קטגוריה ונבנה lookup ב-O(1) לפי name/id.
 */
type CatHit = { daf: number; amud: 0 | 1 | 2 }; // 0 = generic (ללא ע"א/ע"ב)
type CatIndex = {
  byName: Map<string, CatHit[]>;
  byId: Map<string, CatHit[]>;
  variantToDaf: Map<string, number>;
};

const _indexCache = new WeakMap<Category[], Map<string, CatIndex>>();

function buildCatIndex(
  categories: Category[] | undefined,
  masechta: string,
  totalPages: number,
): CatIndex {
  const cats = categories ?? [];
  let perCats = _indexCache.get(cats);
  if (!perCats) {
    perCats = new Map();
    _indexCache.set(cats, perCats);
  }
  const key = `${masechta}::${totalPages}`;
  const cached = perCats.get(key);
  if (cached) return cached;

  const variantToDaf = new Map<string, number>();
  for (let d = 2; d <= totalPages + 1; d++) {
    const lbl = dafLabel(d);
    const noDot = lbl.replace(".", "");
    variantToDaf.set(lbl, d);
    variantToDaf.set(noDot, d);
    variantToDaf.set(`דף ${noDot}`, d);
  }

  const catsById = new Map(cats.map((c) => [c.id, c]));
  const byName = new Map<string, CatHit[]>();
  const byId = new Map<string, CatHit[]>();

  for (const cat of cats) {
    let cur: Category | undefined = cat;
    let guard = 0;
    let hasMasechta = false;
    let foundDaf: number | null = null;
    let foundAmud: 0 | 1 | 2 = 0;
    while (cur && guard < 32) {
      const leaf = displayCategoryName(cur.name);
      if (leaf === masechta) hasMasechta = true;
      else if (leaf === 'ע"א') foundAmud = 1;
      else if (leaf === 'ע"ב') foundAmud = 2;
      else {
        const d = variantToDaf.get(leaf);
        if (d && foundDaf === null) foundDaf = d;
      }
      cur = cur.parentId ? catsById.get(cur.parentId) : undefined;
      guard += 1;
    }
    if (!hasMasechta || foundDaf === null) continue;
    const hit: CatHit = { daf: foundDaf, amud: foundAmud };
    const nameArr = byName.get(cat.name);
    if (nameArr) nameArr.push(hit); else byName.set(cat.name, [hit]);
    byId.set(cat.id, [hit]);
  }

  const idx: CatIndex = { byName, byId, variantToDaf };
  perCats.set(key, idx);
  return idx;
}

/**
 * מסנן כרטיסים השייכים לדף/עמוד נתון של מסכת.
 * תומך גם בשיוך מובנה (masechta/daf/amud) וגם בתגיות `cat:<categoryName|id>`.
 */
export function filterCardsByDafAmud(
  cards: Card[],
  categories: Category[] | undefined,
  masechta: string,
  daf: number,
  amud: 1 | 2 | null,
): Card[] {
  const totalPagesHint = Math.max(daf + 1, 200);
  const idx = buildCatIndex(categories, masechta, totalPagesHint);

  const matches = (hits: CatHit[] | undefined): boolean => {
    if (!hits) return false;
    for (const h of hits) {
      if (h.daf !== daf) continue;
      if (!amud) return true;
      if (h.amud === 0 || h.amud === amud) return true;
    }
    return false;
  };

  const out: Card[] = [];
  for (const c of cards) {
    if (c.masechta === masechta && c.daf === daf) {
      if (!amud || !c.amud || c.amud === amud) { out.push(c); continue; }
    }
    const tags = c.tags;
    if (!tags || tags.length === 0) continue;
    for (const t of tags) {
      if (!t.startsWith("cat:")) continue;
      const payload = t.slice(4);
      if (matches(idx.byName.get(payload)) || matches(idx.byId.get(payload))) {
        out.push(c);
        break;
      }
    }
  }
  return out;
}

/** מחזיר ספירת כרטיסים פר-עמוד למסכת — לשימוש ב-badges של בורר הדפים. */
export function countCardsPerDaf(
  cards: Card[],
  categories: Category[] | undefined,
  masechta: string,
  totalPages: number,
): Map<number, { a: number; b: number; total: number }> {
  const out = new Map<number, { a: number; b: number; total: number }>();
  const idx = buildCatIndex(categories, masechta, totalPages);

  const bump = (d: number, a: boolean, b: boolean) => {
    const cur = out.get(d) ?? { a: 0, b: 0, total: 0 };
    if (a) { cur.a += 1; cur.total += 1; }
    if (b) { cur.b += 1; cur.total += 1; }
    out.set(d, cur);
  };

  for (const card of cards) {
    if (card.masechta === masechta && card.daf) {
      const d = card.daf;
      if (d >= 2 && d <= totalPages + 1) {
        if (card.amud === 1) bump(d, true, false);
        else if (card.amud === 2) bump(d, false, true);
        else bump(d, true, true);
      }
      continue;
    }
    const tags = card.tags;
    if (!tags || tags.length === 0) continue;

    // איסוף ייחודי של (daf,amud) לכרטיס כדי לא לספור פעמיים על אותה תגית
    let perDaf: Map<number, { hasA: boolean; hasB: boolean }> | null = null;
    for (const t of tags) {
      if (!t.startsWith("cat:")) continue;
      const payload = t.slice(4);
      const hits = idx.byName.get(payload) ?? idx.byId.get(payload);
      if (!hits) continue;
      for (const h of hits) {
        if (h.daf < 2 || h.daf > totalPages + 1) continue;
        if (!perDaf) perDaf = new Map();
        const e = perDaf.get(h.daf) ?? { hasA: false, hasB: false };
        if (h.amud === 1) e.hasA = true;
        else if (h.amud === 2) e.hasB = true;
        else { e.hasA = true; e.hasB = true; }
        perDaf.set(h.daf, e);
      }
    }
    if (!perDaf) continue;
    for (const [d, hit] of perDaf) bump(d, hit.hasA, hit.hasB);
  }

  for (const [d, c] of Array.from(out.entries())) {
    if (c.total === 0) out.delete(d);
  }
  return out;
}
