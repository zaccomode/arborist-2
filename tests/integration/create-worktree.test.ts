import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { basename, dirname, join } from 'path'
import { parseBranchInput, sanitizeForFolder } from '../../src/shared/branch-name'
import type { ResolvedLocation } from '../../src/shared/worktree-location'
import { GitLocator } from '../../src/main/services/git/git-discovery'
import { GitRunner } from '../../src/main/services/git/git-runner'
import { GitService } from '../../src/main/services/git/git-service'
import { makeFixtureRepo, type GitFixture } from './fixtures/git-fixture'

const service = new GitService(new GitRunner(new GitLocator()))
const BESIDE: ResolvedLocation = { mode: 'beside', root: null }

let fixture: GitFixture

beforeEach(async () => {
  fixture = await makeFixtureRepo()
}, 60_000)

afterEach(async () => {
  await fixture?.cleanup()
})

describe('creating a worktree', () => {
  it('creates the branch and folder a pasted checkout command implies', async () => {
    const branch = parseBranchInput('git checkout -b feature/ABC-123')
    const path = await service.suggestWorktreePath(
      fixture.repoPath,
      branch,
      BESIDE,
      basename(fixture.repoPath)
    )

    expect(basename(path)).toBe('feature-ABC-123')
    expect(dirname(path)).toBe(dirname(fixture.repoPath))

    await service.createWorktree(fixture.repoPath, { branch, path })

    const worktrees = await service.listWorktrees(fixture.repoPath)
    expect(worktrees.map((worktree) => worktree.branch)).toContain('feature/ABC-123')
    expect(await fs.stat(join(path, '.git'))).toBeTruthy()
  })

  it('checks out an existing branch rather than trying to create it', async () => {
    await fixture.git(['branch', 'feature/existing'])
    expect(await service.branchExists(fixture.repoPath, 'feature/existing')).toBe(true)

    const path = await service.suggestWorktreePath(
      fixture.repoPath,
      'feature/existing',
      BESIDE,
      basename(fixture.repoPath)
    )
    await service.createWorktree(fixture.repoPath, { branch: 'feature/existing', path })

    const worktrees = await service.listWorktrees(fixture.repoPath)
    expect(worktrees.find((worktree) => worktree.path === path)?.branch).toBe('feature/existing')
  })

  it('starts a new branch from the base ref it is given', async () => {
    const first = (await fixture.git(['rev-parse', 'HEAD'])).trim()
    await fixture.commit('Second commit', { 'second.txt': 'second' })

    const path = await service.suggestWorktreePath(
      fixture.repoPath,
      'feature/from-base',
      BESIDE,
      basename(fixture.repoPath)
    )
    await service.createWorktree(fixture.repoPath, {
      branch: 'feature/from-base',
      path,
      baseRef: first
    })

    expect((await fixture.git(['rev-parse', 'HEAD'], path)).trim()).toBe(first)
  })

  it('suggests a suffixed folder when the sibling name is taken', async () => {
    const taken = join(dirname(fixture.repoPath), sanitizeForFolder('feature/x'))
    await fs.mkdir(taken, { recursive: true })

    expect(
      await service.suggestWorktreePath(
        fixture.repoPath,
        'feature/x',
        BESIDE,
        basename(fixture.repoPath)
      )
    ).toBe(`${taken}-2`)
  })

  it('refuses a path that already exists, without asking git', async () => {
    const path = join(dirname(fixture.repoPath), 'occupied')
    await fs.mkdir(path, { recursive: true })

    await expect(
      service.createWorktree(fixture.repoPath, { branch: 'feature/y', path })
    ).rejects.toMatchObject({ code: 'path-already-exists' })

    // The pre-check is the point: a failed create must not leave a branch.
    expect(await service.branchExists(fixture.repoPath, 'feature/y')).toBe(false)
  })
})
