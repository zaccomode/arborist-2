import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { basename } from 'path'
import type { ResolvedLocation } from '../../src/shared/worktree-location'
import { GitLocator } from '../../src/main/services/git/git-discovery'
import { GitRunner } from '../../src/main/services/git/git-runner'
import { GitService } from '../../src/main/services/git/git-service'
import { makeFixtureRepo, type GitFixture } from './fixtures/git-fixture'

const BESIDE: ResolvedLocation = { mode: 'beside', root: null }

const service = new GitService(new GitRunner(new GitLocator()))

let fixture: GitFixture

beforeEach(async () => {
  fixture = await makeFixtureRepo()
}, 60_000)

afterEach(async () => {
  await fixture?.cleanup()
})

describe('listRemoteBranches, against a bare-remote fixture', () => {
  it('lists nothing beyond main, which already has the main worktree', async () => {
    expect(await service.listRemoteBranches(fixture.repoPath)).toEqual([])
  }, 30_000)

  it('lists a branch pushed from elsewhere, once fetched, and never lists origin/HEAD', async () => {
    await fixture.commitFromElsewhere('feature-x', 'Pushed from elsewhere')
    await service.fetchAll(fixture.repoPath)

    const branches = await service.listRemoteBranches(fixture.repoPath)

    expect(branches.map((branch) => branch.name)).toEqual(['origin/feature-x'])
    expect(branches[0].shortName).toBe('feature-x')
    expect(branches[0].lastCommit).toMatchObject({ subject: 'Pushed from elsewhere' })
  }, 30_000)

  /**
   * #75: the tip commits used to come from one `git log -1` per remote
   * branch, and now come out of the `for-each-ref` that produced the list.
   * The two formats are meant to be field-for-field equivalent, which is a
   * claim worth checking against real git rather than only in the parser's
   * own tests — `commitLog` still runs `git log`, so it is the control.
   */
  it('reports the same tip commit for-each-ref that git log reports for the same ref', async () => {
    await fixture.commitFromElsewhere('feature-x', 'Pushed from elsewhere')
    await fixture.commitFromElsewhere('feature-z', 'Pushed from elsewhere too')
    await service.fetchAll(fixture.repoPath)

    const branches = await service.listRemoteBranches(fixture.repoPath)
    expect(branches).toHaveLength(2)

    for (const branch of branches) {
      const [viaLog] = await service.commitLog(fixture.repoPath, [branch.name], 1, 0)
      expect(branch.lastCommit).toMatchObject({
        hash: viaLog.hash,
        shortHash: viaLog.shortHash,
        author: viaLog.author,
        subject: viaLog.subject
      })
      // `%aI` and `%(authordate:iso-strict)` are the same instant in the same
      // notation; `commitLog` asks for `%ad --date=iso-strict`, so comparing
      // the parsed instants rather than the strings keeps this about the
      // fields rather than about date formatting.
      expect(Date.parse(branch.lastCommit!.date)).toBe(Date.parse(viaLog.date))
    }
  }, 30_000)

  it('hides a remote branch once a local worktree exists on its short name', async () => {
    await fixture.commitFromElsewhere('feature-y', 'Pushed from elsewhere')
    await service.fetchAll(fixture.repoPath)
    expect(await service.listRemoteBranches(fixture.repoPath)).toHaveLength(1)

    await fixture.addWorktree('feature-y', { branch: 'feature-y', startPoint: 'origin/feature-y' })

    expect(await service.listRemoteBranches(fixture.repoPath)).toEqual([])
  }, 30_000)

  it('hides a remote branch once a local worktree tracks it under a different branch name (#47)', async () => {
    await fixture.commitFromElsewhere('feature-y', 'Pushed from elsewhere')
    await service.fetchAll(fixture.repoPath)
    expect(await service.listRemoteBranches(fixture.repoPath)).toHaveLength(1)

    // Folder name AND branch name both differ from the remote's short name —
    // only the upstream tracking relationship ties this worktree back to it.
    await fixture.addWorktree('a-completely-different-folder', {
      branch: 'my-custom-branch-name',
      startPoint: 'origin/feature-y'
    })
    await fixture.git(['branch', '--set-upstream-to=origin/feature-y', 'my-custom-branch-name'])

    expect(await service.listRemoteBranches(fixture.repoPath)).toEqual([])
  }, 30_000)

  it('creating a worktree from a remote branch removes it from the list and gives it a working upstream', async () => {
    await fixture.commitFromElsewhere('feature-z', 'Pushed from elsewhere')
    await service.fetchAll(fixture.repoPath)

    const path = await service.suggestWorktreePath(
      fixture.repoPath,
      'feature-z',
      BESIDE,
      basename(fixture.repoPath)
    )
    await service.createWorktree(fixture.repoPath, {
      branch: 'feature-z',
      path,
      baseRef: 'origin/feature-z',
      track: true
    })

    expect(await service.listRemoteBranches(fixture.repoPath)).toEqual([])

    const worktrees = await service.listWorktrees(fixture.repoPath)
    const created = worktrees.find((worktree) => worktree.path === path)
    expect(created?.status?.upstream).toBe('origin/feature-z')

    const upstream = await fixture.git(['rev-parse', '--abbrev-ref', 'feature-z@{upstream}'])
    expect(upstream.trim()).toBe('origin/feature-z')
  }, 30_000)
})
