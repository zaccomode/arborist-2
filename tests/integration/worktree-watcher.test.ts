import { promises as fs } from 'fs'
import { join } from 'path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GitLocator } from '../../src/main/services/git/git-discovery'
import { GitRunner } from '../../src/main/services/git/git-runner'
import { WorktreeWatcher } from '../../src/main/services/watch/worktree-watcher'
import type { WorktreeChangeReason } from '../../src/shared/ipc-contract'
import { makeFixtureRepo, type GitFixture } from './fixtures/git-fixture'

const git = new GitRunner(new GitLocator())

interface Change {
  worktreePath: string
  reason: WorktreeChangeReason
}

let fixture: GitFixture
let events: Change[]
let watcher: WorktreeWatcher

beforeEach(async () => {
  fixture = await makeFixtureRepo()
  events = []
  watcher = new WorktreeWatcher(git, (worktreePath, reason) => {
    events.push({ worktreePath, reason })
  })
}, 60_000)

afterEach(async () => {
  await watcher.stop()
  await fixture?.cleanup()
})

/**
 * Polls `events` until one matches, rather than a fixed sleep, since the
 * debounce (250ms trailing, 1s max) plus filesystem latency makes the exact
 * timing untestable-on-the-nose without becoming flaky. The 20s budget is
 * generous on purpose: a real change lands in well under a second, but this
 * suite runs alongside every other integration test's own git subprocesses
 * and filesystem activity, and this file is the one place CPU contention
 * shows up as a symptom that looks like a watcher bug rather than what it
 * is — a slow test host.
 */
async function waitForChange(
  reason: WorktreeChangeReason,
  worktreePath?: string,
  timeoutMs = 20_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (
      events.some(
        (change) =>
          change.reason === reason &&
          (worktreePath === undefined || change.worktreePath === worktreePath)
      )
    ) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(
    `Timed out waiting for a '${reason}' event${worktreePath ? ` on ${worktreePath}` : ''}; saw ${JSON.stringify(events)}`
  )
}

/** Asserts nothing fires in `timeoutMs` — the only way to check a negative. */
async function assertNothingFires(timeoutMs = 1200): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, timeoutMs))
}

describe('WorktreeWatcher: the worktree tree', () => {
  it('fires a worktree-reason event for a file changed inside the watched worktree', async () => {
    await watcher.watch(fixture.repoPath)

    await fs.writeFile(join(fixture.repoPath, 'README.md'), 'edited on disk\n', 'utf8')

    await waitForChange('worktree', fixture.repoPath)
  }, 25_000)

  it('never fires for a change under the hardcoded floor (node_modules)', async () => {
    await watcher.watch(fixture.repoPath)

    await fs.mkdir(join(fixture.repoPath, 'node_modules', 'pkg'), { recursive: true })
    await fs.writeFile(join(fixture.repoPath, 'node_modules', 'pkg', 'index.js'), 'x', 'utf8')

    await assertNothingFires()
    expect(events).toEqual([])
  }, 25_000)

  it('never fires for a change under a directory only .gitignore names, resolved via git itself', async () => {
    // Committed, so `.gitignore` is in effect from the start rather than
    // being itself an uncommitted change the tree watcher would also see.
    await fixture.commit('Ignore a build directory', { '.gitignore': 'ignored-dir/\n' })
    // `--no-empty-directory` means the directory only shows up in
    // `git ls-files` once it has something in it, which is why this is
    // written before `watch()` runs its one `ls-files` call.
    await fs.mkdir(join(fixture.repoPath, 'ignored-dir'), { recursive: true })
    await fs.writeFile(join(fixture.repoPath, 'ignored-dir', 'placeholder.txt'), 'first\n', 'utf8')

    await watcher.watch(fixture.repoPath)
    await fs.writeFile(join(fixture.repoPath, 'ignored-dir', 'placeholder.txt'), 'second\n', 'utf8')

    await assertNothingFires()
    expect(events).toEqual([])
  }, 25_000)
})

describe('WorktreeWatcher: git metadata, resolved per worktree', () => {
  it('fires an index-reason event when `git add` touches the resolved index', async () => {
    await fs.writeFile(join(fixture.repoPath, 'README.md'), 'edited\n', 'utf8')
    await watcher.watch(fixture.repoPath)

    await fixture.git(['add', 'README.md'])

    await waitForChange('index', fixture.repoPath)
  }, 25_000)

  it('fires a refs-reason event when a commit moves the branch ref', async () => {
    await watcher.watch(fixture.repoPath)

    await fixture.commit('Second commit', { 'a.txt': 'a\n' })

    await waitForChange('refs', fixture.repoPath)
  }, 25_000)

  it('fires a refs-reason event when a new branch is created', async () => {
    await watcher.watch(fixture.repoPath)

    // Flat, deliberately: a nested name (`feature/new`) makes chokidar
    // detect a brand-new `refs/heads` subdirectory before it can detect the
    // file inside it, which is real behaviour (covered by the linked-worktree
    // case elsewhere in this file, whose `refs/heads` starts empty) but adds
    // enough latency under a loaded test run to make this particular
    // assertion flaky for a reason that has nothing to do with what it's
    // checking.
    await fixture.git(['branch', 'newbranch'])

    await waitForChange('refs', fixture.repoPath)
  }, 25_000)

  it('fires a head-reason event when HEAD itself moves to a different branch', async () => {
    await fixture.git(['branch', 'other'])
    await watcher.watch(fixture.repoPath)

    await fixture.git(['checkout', 'other'])

    await waitForChange('head', fixture.repoPath)
  }, 25_000)

  it(
    "watches a linked worktree's own resolved index, not the main worktree's — " +
      'the case a naive `.git/index` watch never fires for',
    async () => {
      const linked = await fixture.addWorktree('feature-linked', { branch: 'feature/linked' })
      await watcher.watch(linked)

      await fs.writeFile(join(fixture.repoPath, 'README.md'), 'edited in main\n', 'utf8')
      await fixture.git(['add', 'README.md'], fixture.repoPath)
      await assertNothingFires(800)
      expect(events.filter((change) => change.reason === 'index')).toEqual([])

      await fs.writeFile(join(linked, 'README.md'), 'edited in linked\n', 'utf8')
      await fixture.git(['add', 'README.md'], linked)
      await waitForChange('index', linked)
    },
    30_000
  )
})

describe('WorktreeWatcher: suppression and lifecycle', () => {
  it('suppress() swallows an event on that worktree for the given window', async () => {
    await watcher.watch(fixture.repoPath)
    watcher.suppress(fixture.repoPath, 2000)

    await fs.writeFile(join(fixture.repoPath, 'README.md'), 'edited\n', 'utf8')

    await assertNothingFires()
    expect(events).toEqual([])
  }, 25_000)

  it('does not suppress a different worktree', async () => {
    const other = await fixture.addWorktree('unsuppressed', { branch: 'feature/unsuppressed' })
    await watcher.watch(other)
    watcher.suppress(fixture.repoPath, 2000) // a different path entirely

    await fs.writeFile(join(other, 'README.md'), 'edited\n', 'utf8')

    await waitForChange('worktree', other)
  }, 25_000)

  it('stops firing once watch(null) replaces the selection', async () => {
    await watcher.watch(fixture.repoPath)
    await watcher.watch(null)

    await fs.writeFile(join(fixture.repoPath, 'README.md'), 'edited\n', 'utf8')

    await assertNothingFires()
    expect(events).toEqual([])
  }, 25_000)

  it('switching the watched worktree stops reporting the previous one', async () => {
    const second = await fixture.addWorktree('second', { branch: 'feature/second' })
    await watcher.watch(fixture.repoPath)
    await watcher.watch(second)

    await fs.writeFile(join(fixture.repoPath, 'README.md'), 'edited\n', 'utf8')
    await assertNothingFires(800)
    expect(events).toEqual([])

    await fs.writeFile(join(second, 'README.md'), 'edited\n', 'utf8')
    await waitForChange('worktree', second)
  }, 30_000)

  it('is a no-op, not a rejection, for a worktree whose directory has already gone (prunable)', async () => {
    const gone = await fixture.addWorktree('gone', { branch: 'feature/gone' })
    await fs.rm(gone, { recursive: true, force: true, maxRetries: 3 })

    await expect(watcher.watch(gone)).resolves.toBeUndefined()
  }, 25_000)

  it('does nothing at all when ARBORIST_DISABLE_WATCHER=1, the determinism escape hatch', async () => {
    const original = process.env['ARBORIST_DISABLE_WATCHER']
    process.env['ARBORIST_DISABLE_WATCHER'] = '1'
    try {
      await watcher.watch(fixture.repoPath)
      await fs.writeFile(join(fixture.repoPath, 'README.md'), 'edited\n', 'utf8')
      await assertNothingFires(800)
      expect(events).toEqual([])
    } finally {
      if (original === undefined) delete process.env['ARBORIST_DISABLE_WATCHER']
      else process.env['ARBORIST_DISABLE_WATCHER'] = original
    }
  }, 25_000)
})
