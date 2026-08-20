import { describe, it, expect } from 'vitest'
import { mapWithConcurrency } from '@shared/concurrency'

/** Resolves when told to, so a test can hold work in flight deliberately. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

describe('mapWithConcurrency', () => {
  it('returns results in input order', async () => {
    const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10)

    expect(results).toEqual([
      { status: 'fulfilled', value: 10 },
      { status: 'fulfilled', value: 20 },
      { status: 'fulfilled', value: 30 },
      { status: 'fulfilled', value: 40 }
    ])
  })

  it('never runs more than the limit at once', async () => {
    const gates = Array.from({ length: 10 }, gate)
    let inFlight = 0
    let peak = 0

    const pending = mapWithConcurrency(gates, 3, async (item) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await item.promise
      inFlight--
    })

    // Release in reverse, so slots free up in an order the pool did not pick.
    for (const item of [...gates].reverse()) {
      item.open()
      await Promise.resolve()
    }
    await pending

    expect(peak).toBe(3)
  })

  it('settles a rejection instead of losing the rest of the batch', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('worktree is unreadable')
      return n
    })

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
    expect((results[1] as PromiseRejectedResult).reason.message).toBe('worktree is unreadable')
  })

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([])
  })

  it('rejects a limit below one, rather than hanging', async () => {
    await expect(mapWithConcurrency([1], 0, async () => 1)).rejects.toThrow(/at least 1/)
  })
})
