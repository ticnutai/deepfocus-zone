import type { Card, Category } from "./types";
import { SHAS_BAVLI } from "./shasData";
import { filterCardsByDafAmud } from "./dafCards";
import { dafLabel } from "./shasGen";

export type ShasDeckSource =
  | { id: string; kind: "masechta" | "daf" | "amud"; masechta: string; daf?: number; amud?: 1 | 2 }
  | { id: string; kind: "category"; categoryId: string; categoryName: string };

export function shasDeckSourceLabel(source: ShasDeckSource): string {
  if (source.kind === "category") return `קטגוריה: ${source.categoryName}`;
  if (source.kind === "masechta") return `מסכת ${source.masechta}`;
  const page = dafLabel(source.daf ?? 2).replace(".", "");
  if (source.kind === "daf") return `${source.masechta} · דף ${page}`;
  return `${source.masechta} · דף ${page} · עמוד ${source.amud === 1 ? "א׳" : "ב׳"}`;
}

export function cardsForShasDeckSources(
  cards: Card[],
  categories: Category[],
  sources: ShasDeckSource[],
): Card[] {
  const selected = new Map<string, Card>();
  for (const source of sources) {
    if (source.kind === "category") {
      const ids = new Set([source.categoryId]);
      let changed = true;
      while (changed) {
        changed = false;
        categories.forEach((category) => {
          if (category.parentId && ids.has(category.parentId) && !ids.has(category.id)) {
            ids.add(category.id);
            changed = true;
          }
        });
      }
      const names = new Set(categories.filter((category) => ids.has(category.id)).map((category) => category.name));
      cards.filter((card) => card.tags?.some((tag) => tag.startsWith("cat:") && (ids.has(tag.slice(4)) || names.has(tag.slice(4))))).forEach((card) => selected.set(card.id, card));
      continue;
    }
    const masechta = SHAS_BAVLI.find((item) => item.name === source.masechta);
    if (!masechta) continue;
    const first = source.kind === "masechta" ? 2 : source.daf ?? 2;
    const last = source.kind === "masechta" ? masechta.pages + 1 : first;
    for (let daf = first; daf <= last; daf += 1) {
      const amud = source.kind === "amud" ? source.amud ?? null : null;
      for (const card of filterCardsByDafAmud(cards, categories, source.masechta, daf, amud)) {
        selected.set(card.id, card);
      }
    }
  }
  return [...selected.values()];
}
