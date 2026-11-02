/**
 * The least time between two automatic fetches of one repository (#94).
 *
 * Focus fires every time the user alt-tabs, so without a floor a fetch would
 * go out to the remote on each of those. Manual fetches are never throttled.
 */
export const AUTO_FETCH_MIN_GAP_MS = 30_000

/**
 * Whether an automatic fetch should run now. `lastFetchAt` is when this
 * repository was last fetched automatically, or undefined if never.
 */
export function shouldAutoFetch(
  lastFetchAt: number | undefined,
  now: number,
  minGapMs: number = AUTO_FETCH_MIN_GAP_MS
): boolean {
  if (lastFetchAt === undefined) return true
  // A clock that went backwards must not suppress fetching until it catches up.
  if (now < lastFetchAt) return true
  return now - lastFetchAt >= minGapMs
}
