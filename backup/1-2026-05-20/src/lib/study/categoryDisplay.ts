import { displayCategoryName } from "@/lib/study/shasGen";
import type { Category } from "@/lib/study/types";

const RAMBAM_BOOK_NAMES = new Set<string>([
  "ספר המדע",
  "ספר אהבה",
  "ספר זמנים",
  "ספר נשים",
  "ספר קדושה",
  "ספר הפלאה",
  "ספר זרעים",
  "ספר עבודה",
  "ספר קרבנות",
  "ספר טהרה",
  "ספר נזיקין",
  "ספר קנין",
  "ספר משפטים",
  "ספר שופטים",
]);

export function buildCategoryIndex(categories: Category[]): Map<string, Category> {
  return new Map(categories.map((cat) => [cat.id, cat]));
}

function hasRambamAncestor(cat: Category, categoriesById: Map<string, Category>): boolean {
  let current: Category | undefined = cat;
  let guard = 0;
  while (current && guard < 2048) {
    if (RAMBAM_BOOK_NAMES.has(current.name)) return true;
    current = current.parentId ? categoriesById.get(current.parentId) : undefined;
    guard += 1;
  }
  return false;
}

function normalizeRambamChapterName(cat: Category, categoriesById: Map<string, Category>): string {
  if (!cat.name.startsWith("סימן ")) return cat.name;
  if (!hasRambamAncestor(cat, categoriesById)) return cat.name;
  return cat.name.replace("סימן ", "פרק ");
}

export function getDisplayCategoryLabel(cat: Category, categoriesById: Map<string, Category>): string {
  return displayCategoryName(normalizeRambamChapterName(cat, categoriesById));
}

export function getDisplayCategoryPath(cat: Category, categoriesById: Map<string, Category>): string {
  const parts: string[] = [];
  let current: Category | undefined = cat;
  let guard = 0;
  while (current && guard < 2048) {
    parts.unshift(getDisplayCategoryLabel(current, categoriesById));
    current = current.parentId ? categoriesById.get(current.parentId) : undefined;
    guard += 1;
  }
  return parts.join(" › ");
}
