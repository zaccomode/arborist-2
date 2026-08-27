import { promises as fs } from 'fs'
import { join } from 'path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GitLocator } from '../../src/main/services/git/git-discovery'
import { GitRunner } from '../../src/main/services/git/git-runner'
import { GitService } from '../../src/main/services/git/git-service'
import { makeFixtureRepo, type GitFixture } from './fixtures/git-fixture'

/**
 * Every mutating `GitService` operation is supposed to open a suppression
 * window on the watcher before it runs — belt-and-braces against the
 * feedback loop described in `worktree-watcher.ts`'s doc comment. This
 * exercises the wiring with a real repository and a real `GitService`,
 * rather than mocking `GitRunner`: a fake runner would prove the callback
 * gets invoked but not that it happens against a call that actually
 * succeeds, which is the case that matters (a call that throws before
 * mutating anything has nothing worth suppressing).
 */
let fixture: GitFixture
let suppressed: string[]
let service: GitService

beforeEach(async () => {
  fixture = await makeFixtureRepo()
  suppressed = []
  service = new GitService(new GitRunner(new GitLocator()), (worktreePath) => {
    suppressed.push(worktreePath)
  })
}, 60_000)

afterEach(async () => {
  await fixture?.cleanup()
})

describe('GitService suppresses the watcher before every mutating operation', () => {
  it('stageFiles', async () => {
    await fs.writeFile(join(fixture.repoPath, 'README.md'), 'edited\n', 'utf8')
    await service.stageFiles(fixture.repoPath, ['README.md'])
    expect(suppressed).toEqual([fixture.repoPath])
  }, 30_000)

  it('unstageFiles', async () => {
    await fs.writeFile(join(fixture.repoPath, 'README.md'), 'edited\n', 'utf8')
    await fixture.git(['add', 'README.md'])
    suppressed = [] // clear whatever a setup step above would have logged
    await service.unstageFiles(fixture.repoPath, ['README.md'])
    expect(suppressed).toEqual([fixture.repoPath])
  }, 30_000)

  it('discardFiles', async () => {
    await fs.writeFile(join(fixture.repoPath, 'README.md'), 'edited\n', 'utf8')
    await service.discardFiles(fixture.repoPath, { tracked: ['README.md'], untracked: [] })
    expect(suppressed).toEqual([fixture.repoPath])
  }, 30_000)

  it('commit', async () => {
    await fs.writeFile(join(fixture.repoPath, 'README.md'), 'edited\n', 'utf8')
    await fixture.git(['add', 'README.md'])
    suppressed = []
    await service.commit(fixture.repoPath, 'A commit', false)
    expect(suppressed).toEqual([fixture.repoPath])
  }, 30_000)

  it('applyHunk', async () => {
    await fs.writeFile(join(fixture.repoPath, 'README.md'), 'edited\nsecond line\n', 'utf8')
    const diff = await service.fileDiff({
      kind: 'unstaged',
      worktreePath: fixture.repoPath,
      path: 'README.md'
    })
    const hunkId = diff.hunks[0]?.id
    if (!hunkId) throw new Error('expected at least one hunk')

    await service.applyHunk(fixture.repoPath, { path: 'README.md' }, hunkId, 'stage')
    expect(suppressed).toEqual([fixture.repoPath])
  }, 30_000)

  it('does not suppress a read-only operation like workingTreeChanges', async () => {
    await service.workingTreeChanges(fixture.repoPath)
    expect(suppressed).toEqual([])
  }, 30_000)

  it('does not suppress applyHunk when the hunk id is stale — nothing mutating ran', async () => {
    await expect(
      service.applyHunk(fixture.repoPath, { path: 'README.md' }, 'not-a-real-hunk-id', 'stage')
    ).rejects.toThrow()
    expect(suppressed).toEqual([])
  }, 30_000)
})
