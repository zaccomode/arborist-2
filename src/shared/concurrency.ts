/**
 * Runs `fn` over `items` with at most `limit` in flight, settling every one.
 *
 * Both bounds matter. v1 enriched worktrees one after another, roughly four
 * process spawns each, so a ten-worktree repository fired forty sequential
 * spawns per refresh. An unbounded `Promise.all` fixes the wait and replaces
 * it with ninety concurrent processes on a thirty-worktree repository, which
 * is its own kind of rude.
 *
 * Results come back in input order, settled, so one broken item cannot take
 * the whole refresh with it.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  if (limit < 1) throw new Error(`Concurrency limit must be at least 1, got ${limit}`)

  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
