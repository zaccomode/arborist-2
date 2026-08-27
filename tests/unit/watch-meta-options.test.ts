import { describe, it, expect } from 'vitest'
import { metaWatchOptions } from '../../src/main/services/watch/worktree-watcher'

/**
 * `metaWatchOptions` is the one piece of the linked-worktree Windows fix
 * that can be exercised directly in this suite, regardless of which
 * platform the suite itself runs on: whether the metadata watchers
 * (`index`/`HEAD`/`packed-refs`'s directories, `refs/heads`) fall back to
 * `fs.watchFile`-backed polling rather than `fs.watch`. See the constant's
 * own doc comment in `worktree-watcher.ts` for why `fs.watch` alone isn't
 * enough on Windows: a rename onto an already-tracked name — exactly what
 * `git add` does to `index` — is invisible to it.
 */
describe('metaWatchOptions', () => {
  it('enables polling on win32', () => {
    expect(metaWatchOptions('win32')).toEqual({ usePolling: true })
  })

  it('leaves macOS on native fs.watch', () => {
    expect(metaWatchOptions('darwin')).toEqual({})
  })

  it('leaves Linux on native fs.watch', () => {
    expect(metaWatchOptions('linux')).toEqual({})
  })
})
