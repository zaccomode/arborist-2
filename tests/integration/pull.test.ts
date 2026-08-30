import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GitLocator } from '../../src/main/services/git/git-discovery'
import { GitRunner } from '../../src/main/services/git/git-runner'
import { GitService } from '../../src/main/services/git/git-service'
import { makeFixtureRepo, type GitFixture } from './fixtures/git-fixture'

const service = new GitService(new GitRunner(new GitLocator()))

let fixture: GitFixture

beforeEach(async () => {
  fixture = await makeFixtureRepo()
}, 60_000)

afterEach(async () => {
  await fixture?.cleanup()
})

/** How far `main` is from `origin/main`, straight from git rather than the DTO. */
async function counts(): Promise<{ ahead: number; behind: number }> {
  const [main] = await service.listWorktrees(fixture.repoPath)
  return { ahead: main.status?.ahead ?? 0, behind: main.status?.behind ?? 0 }
}

describe('pull, against a bare-remote fixture', () => {
  it('fast-forwards onto a commit pushed from elsewhere', async () => {
    await fixture.commitFromElsewhere('main', 'Pushed while nobody was looking')
    await service.fetchAll(fixture.repoPath)
    expect(await counts()).toEqual({ ahead: 0, behind: 1 })

    const result = await service.pull(fixture.repoPath, 'ff-only')

    expect(result).toEqual({ conflict: false, diverged: false })
    expect(await counts()).toEqual({ ahead: 0, behind: 0 })
  }, 30_000)

  it('succeeds with nothing to do when the branch is already level', async () => {
    expect(await service.pull(fixture.repoPath, 'ff-only')).toEqual({
      conflict: false,
      diverged: false
    })
  }, 30_000)

  /**
   * The case the whole `diverged` flag exists for. `--ff-only` refuses, and
   * that refusal is reported as an answer rather than thrown, because it is
   * what the renderer turns into the offer of a rebase or a merge.
   */
  it('reports a diverged branch rather than throwing, when a fast-forward is impossible', async () => {
    await fixture.commitFromElsewhere('main', 'Their commit')
    await fixture.commit('Our commit', { 'ours.txt': 'ours\n' })
    await service.fetchAll(fixture.repoPath)
    expect(await counts()).toEqual({ ahead: 1, behind: 1 })

    const result = await service.pull(fixture.repoPath, 'ff-only')

    expect(result).toEqual({ conflict: false, diverged: true })
    // Refusing changed nothing, which is the point of --ff-only.
    expect(await counts()).toEqual({ ahead: 1, behind: 1 })
  }, 30_000)

  it('rebases a diverged branch onto its upstream, leaving nothing behind', async () => {
    await fixture.commitFromElsewhere('main', 'Their commit')
    await fixture.commit('Our commit', { 'ours.txt': 'ours\n' })
    await service.fetchAll(fixture.repoPath)

    const result = await service.pull(fixture.repoPath, 'rebase')

    expect(result).toEqual({ conflict: false, diverged: false })
    expect(await counts()).toEqual({ ahead: 1, behind: 0 })
  }, 30_000)

  /**
   * A merge pull opens `core.editor` for its commit message by default, and
   * `GIT_TERMINAL_PROMPT=0` does nothing about an editor — the child would
   * hang until the timeout. This passing at all is the check on
   * `pullArgsFor`'s `core.editor=true`/`--no-edit`.
   */
  it('merges a diverged branch without stopping for a commit message', async () => {
    await fixture.commitFromElsewhere('main', 'Their commit')
    await fixture.commit('Our commit', { 'ours.txt': 'ours\n' })
    await service.fetchAll(fixture.repoPath)

    const result = await service.pull(fixture.repoPath, 'merge')

    expect(result).toEqual({ conflict: false, diverged: false })
    // Two ahead now: our own commit plus the merge commit that landed it.
    expect(await counts()).toEqual({ ahead: 2, behind: 0 })
  }, 30_000)

  it('reports a conflicting merge as a conflict rather than an error, for the Conflicts section', async () => {
    await fixture.commitFromElsewhere('main', 'Their edit')
    // The same file, edited differently on both sides: a real UU.
    await fixture.git(['fetch', 'origin'])
    const theirFile = 'main.txt'
    await fixture.commit('Our edit', { [theirFile]: 'ours\n' })
    await service.fetchAll(fixture.repoPath)

    const result = await service.pull(fixture.repoPath, 'merge')

    expect(result).toEqual({ conflict: true, diverged: false })
    const state = await service.conflictState(fixture.repoPath)
    expect(state.operation).toBe('merge')

    // And the conflict machinery that already exists can get out of it.
    await service.abortConflict(fixture.repoPath, 'merge')
    expect((await service.conflictState(fixture.repoPath)).operation).toBeNull()
  }, 30_000)

  it('fails rather than hanging against an unreachable remote', async () => {
    await fixture.git(['remote', 'set-url', 'origin', 'https://127.0.0.1:1/nope.git'])

    await expect(service.pull(fixture.repoPath, 'ff-only')).rejects.toThrow()
  }, 30_000)
})
