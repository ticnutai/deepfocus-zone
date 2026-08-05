const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CategoryLabelSource = {
  id: string;
  name: string;
};

/**
 * Deck category caches historically contained either category names or ids.
 * Resolve known ids to their names and never expose orphaned internal UUIDs
 * in the user interface.
 */
export function resolveDeckCategoryLabels(
  rawLabels: readonly string[] | null | undefined,
  categories: readonly CategoryLabelSource[],
): string[] {
  const nameById = new Map(categories.map((category) => [category.id, category.name.trim()]));
  const labels = (rawLabels ?? [])
    .map((rawLabel) => {
      const label = rawLabel.trim();
      if (!label) return null;
      return nameById.get(label) || (UUID_PATTERN.test(label) ? null : label);
    })
    .filter((label): label is string => Boolean(label));

  return Array.from(new Set(labels));
}
