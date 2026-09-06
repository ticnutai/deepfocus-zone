import type { Card, Category } from "./types";
import { SHAS_BAVLI } from "./shasData";
import { filterCardsByDafAmud } from "./dafCards";

export type ShasDeckSource = {
  id: string;
  kind: "masechta" | "daf" | "amud";
  masechta: string;
  daf?: number;
  amud?: 1 | 2;
};

export function shasDeckSourceLabel(source: ShasDeckSource): string {
  if (source.kind === "masechta") return `מסכת ${source.masechta}`;
  if (source.kind === "daf") return `${source.masechta} · דף ${source.daf}`;
  return `${source.masechta} · דף ${source.daf} · עמוד ${source.amud === 1 ? "א׳" : "ב׳"}`;
}

export function cardsForShasDeckSources(
  cards: Card[],
  categories: Category[],
  sources: ShasDeckSource[],
): Card[] {
  const selected = new Map<string, Card>();
  for (const source of sources) {
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
