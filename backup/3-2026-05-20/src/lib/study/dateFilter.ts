export type DateField = "createdAt" | "lastReviewedAt";

export interface DateRangeFilter {
  field: DateField;
  from: number | null; // ms timestamp, inclusive
  to: number | null; // ms timestamp, inclusive end-of-day
}

// Filter cards by date range and chosen field.
export function applyDateFilter<T extends { createdAt: number; srs: { lastReviewedAt: number | null } }>(
  cards: T[],
  filter: DateRangeFilter,
): T[] {
  if (filter.from === null && filter.to === null) return cards;
  return cards.filter((c) => {
    const ts = filter.field === "createdAt" ? c.createdAt : c.srs.lastReviewedAt;
    if (ts === null) return false;
    if (filter.from !== null && ts < filter.from) return false;
    if (filter.to !== null && ts > filter.to) return false;
    return true;
  });
}
