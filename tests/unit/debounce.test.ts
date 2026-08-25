import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDebouncer } from '../../src/shared/debounce'

describe('createDebouncer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires once, after the trailing wait, for a single trigger', () => {
    const emit = vi.fn()
    const debouncer = createDebouncer(emit, 250, 1000)

    debouncer.trigger('a')
    vi.advanceTimersByTime(249)
    expect(emit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('a')
  })

  it('resets the trailing wait on every trigger within the window', () => {
    const emit = vi.fn()
    const debouncer = createDebouncer(emit, 250, 1000)

    debouncer.trigger('a')
    vi.advanceTimersByTime(200)
    debouncer.trigger('a') // resets the 250ms trailing clock
    vi.advanceTimersByTime(200)
    expect(emit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(50)
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('fires at the max wait even under continuous triggers, per the npm-install case', () => {
    const emit = vi.fn()
    const debouncer = createDebouncer(emit, 250, 1000)

    // A trigger every 100ms never lets the 250ms trailing edge land quiet,
    // so only the 1000ms ceiling can fire this.
    for (let elapsed = 0; elapsed < 1000; elapsed += 100) {
      debouncer.trigger('a')
      vi.advanceTimersByTime(100)
    }
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('keeps firing at roughly the max wait under sustained continuous triggers', () => {
    const emit = vi.fn()
    const debouncer = createDebouncer(emit, 250, 1000)

    for (let elapsed = 0; elapsed < 3000; elapsed += 100) {
      debouncer.trigger('a')
      vi.advanceTimersByTime(100)
    }
    // ~1000ms, ~2000ms, ~3000ms — a floor of one push a second, not a single
    // push for the whole burst.
    expect(emit).toHaveBeenCalledTimes(3)
  })

  it('debounces each key independently, so a burst on one never delays another', () => {
    const emit = vi.fn()
    const debouncer = createDebouncer(emit, 250, 1000)

    debouncer.trigger('a')
    vi.advanceTimersByTime(100)
    debouncer.trigger('b')
    vi.advanceTimersByTime(150)
    // 'a' has now gone 250ms quiet; 'b' has only gone 150ms quiet.
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('a')

    vi.advanceTimersByTime(100)
    expect(emit).toHaveBeenCalledTimes(2)
    expect(emit).toHaveBeenLastCalledWith('b')
  })

  it('cancel() drops every pending timer without firing it', () => {
    const emit = vi.fn()
    const debouncer = createDebouncer(emit, 250, 1000)

    debouncer.trigger('a')
    debouncer.trigger('b')
    debouncer.cancel()
    vi.advanceTimersByTime(5000)

    expect(emit).not.toHaveBeenCalled()
  })
})
