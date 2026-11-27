import { describe, it, expect } from 'vitest'
import type { Worktree } from '../../src/shared/domain'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  fetchCaller,
  projectHasRemote,
  toRemoteCaller,
  pullArgsFor,
  pullLabel,
  pushAction,
  syncAvailability
} from '../../src/shared/sync'

function worktree(
  overrides: Partial<Worktree> = {},
  status: Record<string, unknown> = {}
): Worktree {
  return {
    path: '/repo/feature',
    head: 'a'.repeat(40),
    branch: 'feature/x',
    isMain: false,
    isBare: false,
    locked: false,
    lockReason: null,
    prunable: false,
    prunableReason: null,
    statusError: null,
    position: null,
    status: {
      dirty: false,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      upstream: 'origin/feature/x',
      ahead: 0,
      behind: 0,
      gone: false,
      lastCommit: null,
      ...status
    },
    ...overrides
  } as Worktree
}

describe('pullArgsFor', () => {
  /**
   * `-c` is a global option, so it has to precede the subcommand — after it,
   * git reads it as an argument to `pull` and fails. `execGitAt` prepends its
   * own `-C <repo>`, which is global too, so the two sit side by side.
   */
  it('puts the no-op editor config before the subcommand, where git will read it', () => {
    for (const mode of ['ff-only', 'rebase', 'merge'] as const) {
      const args = pullArgsFor(mode)
      expect(args.slice(0, 3)).toEqual(['-c', 'core.editor=true', 'pull'])
    }
  })

  it('fast-forwards by default and never merges', () => {
    expect(pullArgsFor('ff-only')).toContain('--ff-only')
    expect(pullArgsFor('ff-only')).not.toContain('--rebase')
  })

  it('rebases or merges explicitly, never leaving the choice to pull.rebase config', () => {
    expect(pullArgsFor('rebase')).toContain('--rebase')
    expect(pullArgsFor('merge')).toContain('--no-rebase')
    expect(pullArgsFor('merge')).toContain('--no-edit')
  })
})

describe('pullLabel', () => {
  it('names the count, which is the only case it is rendered in', () => {
    expect(pullLabel(3)).toBe('Pull 3')
    expect(pullLabel(1)).toBe('Pull 1')
  })
})

describe('syncAvailability', () => {
  it('offers both actions on a branch that is ahead and behind at once', () => {
    const result = syncAvailability(worktree({}, { ahead: 2, behind: 1 }))

    expect(result).toMatchObject({ canPull: true, canPush: true })
  })

  /**
   * #79 review: each button exists only when it has work to do, rather than
   * standing there disabled. A branch level with its upstream therefore shows
   * neither, and the component renders nothing at all.
   */
  it('offers neither on a branch level with its upstream', () => {
    const result = syncAvailability(worktree({}, { ahead: 0, behind: 0 }))

    expect(result).toMatchObject({ canPull: false, canPush: false })
  })

  it('offers pull alone when the branch is only behind', () => {
    expect(syncAvailability(worktree({}, { behind: 3 }))).toMatchObject({
      canPull: true,
      canPush: false
    })
  })

  it('offers push alone when the branch is only ahead', () => {
    expect(syncAvailability(worktree({}, { ahead: 3 }))).toMatchObject({
      canPull: false,
      canPush: true
    })
  })

  it('offers neither on a detached HEAD, which has no branch to name', () => {
    const result = syncAvailability(worktree({ branch: null }, { ahead: 2, behind: 1 }))

    expect(result).toMatchObject({ canPull: false, canPush: false })
  })

  it('offers neither on a worktree whose folder has gone', () => {
    const result = syncAvailability(worktree({ prunable: true }, { ahead: 2, behind: 1 }))

    expect(result).toMatchObject({ canPull: false, canPush: false })
  })

  it('offers neither while enrichment has not produced a status', () => {
    const result = syncAvailability(worktree({ status: null }))

    expect(result).toMatchObject({ canPull: false, canPush: false })
  })

  it('offers push on a branch that was never pushed, where 0 ahead is not nothing to do', () => {
    const result = syncAvailability(worktree({}, { upstream: null, ahead: 0 }))

    expect(result.canPush).toBe(true)
    expect(result.canPull).toBe(false)
  })

  it('drops pull once the upstream is deleted on the remote, whatever the stale count says', () => {
    expect(syncAvailability(worktree({}, { gone: true, behind: 4 })).canPull).toBe(false)
  })
})

describe('projectHasRemote (#175)', () => {
  it('is not known until read, nor for a project added since', () => {
    expect(projectHasRemote(undefined, 'p1')).toBeNull()
    expect(projectHasRemote({ p1: true }, 'p2')).toBeNull()
  })

  it('reads the answer for a project it covers', () => {
    const hasRemote = { p1: true, p2: false }
    expect(projectHasRemote(hasRemote, 'p1')).toBe(true)
    expect(projectHasRemote(hasRemote, 'p2')).toBe(false)
  })

  it('sends a newly added project without a remote to publishing once it is read', () => {
    expect(pushAction(false, projectHasRemote({ old: true }, 'new'))).toBe('push')
    expect(pushAction(false, projectHasRemote({ old: true, new: false }, 'new'))).toBe(
      'publish-repository'
    )
  })
})

describe('pushAction', () => {
  it('offers to publish the repository when the project has no remote at all (#150)', () => {
    expect(pushAction(false, false)).toBe('publish-repository')
  })

  it('pushes whenever there is a remote, or an upstream, or it is not known yet', () => {
    expect(pushAction(false, true)).toBe('push')
    expect(pushAction(true, true)).toBe('push')
    expect(pushAction(false, null)).toBe('push')
    // An upstream means a remote, whatever the cached answer says.
    expect(pushAction(true, false)).toBe('push')
  })
})

describe('fetchCaller (#185, #187)', () => {
  it('makes a button press the user’s fetch', () => {
    expect(fetchCaller('button')).toBe('user')
  })
  it.each(['select', 'focus', 'interval'] as const)('makes %s a background fetch', (trigger) => {
    expect(fetchCaller(trigger)).toBe('background')
  })
})

describe('toRemoteCaller', () => {
  it('keeps user', () => {
    expect(toRemoteCaller('user')).toBe('user')
  })
  it.each([undefined, null, 'background', 'USER', 1, {}])('makes %s background', (value) => {
    expect(toRemoteCaller(value)).toBe('background')
  })
})

/**
 * The fix for #185 depends on the Fetch and Refresh buttons fetching as the
 * user, and auto-fetch as the background. `FetchRequest` requires a trigger,
 * so none can be left out, but a wrong one would type-check: this pins each
 * call site in `App.tsx` to the trigger it should send (#187).
 */
describe('the fetch triggers App.tsx sends (#187)', () => {
  const app = readFileSync(resolve(__dirname, '../../src/renderer/src/App.tsx'), 'utf8')
  const body = (start: string): string => {
    const from = app.indexOf(start)
    expect(from, `App.tsx no longer contains ${start}`).toBeGreaterThanOrEqual(0)
    return app.slice(from, app.indexOf('\n  }', from))
  }

  it('fetches as the button from handleFetch, which both buttons call', () => {
    expect(body('const handleFetch =')).toMatch(
      /fetchProject\.mutate\(\s*\{ repoPath: path, trigger: 'button' \}/
    )
    expect(app).toMatch(/onFetch=\{\(\) => selected && handleFetch\(/)
    expect(body('onRefresh={() => {')).toContain('handleFetch(selected.path)')
  })

  it('sends no auto-fetch through the buttons’ mutation, whose toast it would drop', () => {
    expect(app).toContain('const fetchMutate = autoFetchProject.mutate')
    // `trigger` alone is autoFetch's parameter, which is only ever 'select' or 'focus'.
    const sent = [...app.matchAll(/fetchMutate\(\{ repoPath, trigger(?:: '(\w+)')? \}\)/g)].map(
      (m) => m[1] ?? 'trigger'
    )
    expect(sent.sort()).toEqual(['interval', 'trigger'])
    expect(app).toContain("autoFetch('select')")
    expect(app).toContain("autoFetch('focus')")
    expect(app.match(/fetchProject\.mutate\(/g)).toHaveLength(1)
  })
})
