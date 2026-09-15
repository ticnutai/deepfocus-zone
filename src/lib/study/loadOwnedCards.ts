/** Bootstrap fallback: RLS alone is not an owner filter for administrators. */
export async function loadOwnedCardPages<T>(userId: string, readPage: (owner: string, from: number, to: number) => PromiseLike<{data: T[] | null; error: unknown}>, pageSize = 1000): Promise<T[]> {
  if (!userId) throw new Error('An authenticated owner is required');
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await readPage(userId, from, from + pageSize - 1);
    if (result.error) throw result.error;
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
