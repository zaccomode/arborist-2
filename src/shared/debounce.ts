/**
 * A trailing-edge debouncer, keyed independently per value bucket, with a
 * max-wait ceiling on top of the trailing edge.
 *
 * Built for the working-tree watcher (main/services/watch/worktree-watcher.ts):
 * chokidar can fire hundreds of raw events for one `npm install`, and the
 * spec calls for coalescing those into one push every 250ms of quiet, or at
 * least once a second if the quiet never comes. Keying per bucket — the
 * watcher keys by `WorktreeChangeReason` — means a burst of `'worktree'`
 * events never delays an unrelated `'index'` event that lands mid-burst;
 * each reason gets its own independent trailing window.
 *
 * No Node or Electron import here (just `setTimeout`/`clearTimeout`, which
 * are ambient globals, not a Node built-in import), so this is exercised
 * directly with `vi.useFakeTimers()` rather than through a real filesystem.
 */
export interface Debouncer<K> {
  /** Schedules `key` to fire, resetting its own trailing window. */
  trigger(key: K): void
  /** Cancels every pending timer without firing them — for teardown. */
  cancel(): void
}

/**
 * `wait`: how long a bucket must go quiet before it fires.
 * `maxWait`: the longest a bucket can be deferred by continuous triggers.
 */
export function createDebouncer<K>(
  emit: (key: K) => void,
  wait: number,
  maxWait: number
): Debouncer<K> {
  const pending = new Map<
    K,
    { trailing: ReturnType<typeof setTimeout>; max: ReturnType<typeof setTimeout> }
  >()

  const flush = (key: K): void => {
    const timers = pending.get(key)
    if (!timers) return
    clearTimeout(timers.trailing)
    clearTimeout(timers.max)
    pending.delete(key)
    emit(key)
  }

  return {
    trigger(key: K): void {
      const existing = pending.get(key)
      if (existing) clearTimeout(existing.trailing)

      const trailing = setTimeout(() => flush(key), wait)
      const max = existing ? existing.max : setTimeout(() => flush(key), maxWait)
      pending.set(key, { trailing, max })
    },
    cancel(): void {
      for (const timers of pending.values()) {
        clearTimeout(timers.trailing)
        clearTimeout(timers.max)
      }
      pending.clear()
    }
  }
}
