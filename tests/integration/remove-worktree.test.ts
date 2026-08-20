import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { GitLocator } from '../../src/main/services/git/git-discovery'
import { GitRunner } from '../../src/main/services/git/git-runner'
import { GitService } from '../../src/main/services/git/git-service'
import { makeFixtureRepo, type GitFixture } from './fixtures/git-fixture'

const service = new GitService(new GitRunner(new GitLocator()))

let fixture: GitFixture

async function branches(): Promise<string> {
  return fixture.git(['branch', '--list', '--format=%(refname:short)'])
}

beforeEach(async () => {
  fixture = await makeFixtureRepo()
}, 60_000)

afterEach(async () => {
  await fixture?.cleanup()
})

describe('removing a worktree', () => {
  it('removes a clean worktree and its directory, keeping the branch', async () => {
    const path = await fixture.addWorktree('clean', { branch: 'feature/clean' })
    const before = await branches()

    expect(await service.isDirty(path)).toBe(false)
    await service.removeWorktree(fixture.repoPath, path)

    await expect(fs.stat(path)).rejects.toThrow()
    expect(await branches()).toBe(before)
    const worktrees = await service.listWorktrees(fixture.repoPath)
    expect(worktrees.map((worktree) => worktree.path)).not.toContain(path)
  })

  it('refuses a dirty worktree until it is forced', async () => {
    const path = await fixture.addWorktree('dirty', { branch: 'feature/dirty' })
    await fs.writeFile(join(path, 'README.md'), 'edited\n', 'utf8')

    expect(await service.isDirty(path)).toBe(true)
    await expect(service.removeWorktree(fixture.repoPath, path)).rejects.toMatchObject({
      code: 'git-command-failed'
    })
    await expect(fs.stat(path)).resolves.toBeTruthy()

    await service.removeWorktree(fixture.repoPath, path, true)
    await expect(fs.stat(path)).rejects.toThrow()
  })

  it('leaves every branch in place, forced or not', async () => {
    const path = await fixture.addWorktree('doomed', { branch: 'feature/doomed' })
    await fs.writeFile(join(path, 'README.md'), 'edited\n', 'utf8')
    const before = await branches()

    await service.removeWorktree(fixture.repoPath, path, true)

    expect(await branches()).toBe(before)
    expect(before).toContain('feature/doomed')
  })

  it('prunes the entry left behind by a deleted directory', async () => {
    const path = await fixture.addWorktree('vanished', { branch: 'feature/vanished' })
    await fs.rm(path, { recursive: true, force: true, maxRetries: 3 })

    const before = await service.listWorktrees(fixture.repoPath)
    expect(before.find((worktree) => worktree.path === path)?.prunable).toBe(true)

    await service.pruneWorktrees(fixture.repoPath)

    const after = await service.listWorktrees(fixture.repoPath)
    expect(after.map((worktree) => worktree.path)).not.toContain(path)
  })

  it('refuses to remove the repository worktree', async () => {
    await expect(service.removeWorktree(fixture.repoPath, fixture.repoPath)).rejects.toMatchObject({
      code: 'git-command-failed'
    })
  })
})
