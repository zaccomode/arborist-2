import { promises as fs } from 'fs'
import { join } from 'path'
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

// Trims only the trailing newline: `status --porcelain`'s leading column is
// a meaningful space (unstaged-only), which a plain `.trim()` would eat.
async function statusPorcelain(): Promise<string> {
  return (await fixture.git(['status', '--porcelain'])).replace(/\n+$/, '')
}

describe('stageFiles', () => {
  it('stages an edited tracked file', async () => {
    await fs.writeFile(join(fixture.repoPath, 'README.md'), 'edited\n', 'utf8')

    await service.stageFiles(fixture.repoPath, ['README.md'])

    expect(await statusPorcelain()).toBe('M  README.md')
  }, 30_000)

  it('stages a deletion', async () => {
    await fs.rm(join(fixture.repoPath, 'README.md'))

    await service.stageFiles(fixture.repoPath, ['README.md'])

    expect(await statusPorcelain()).toBe('D  README.md')
  }, 30_000)

  it('stages an untracked file as an addition', async () => {
    await fs.writeFile(join(fixture.repoPath, 'new.txt'), 'new\n', 'utf8')

    await service.stageFiles(fixture.repoPath, ['new.txt'])

    expect(await statusPorcelain()).toBe('A  new.txt')
  }, 30_000)
})

describe('unstageFiles', () => {
  it('moves a staged edit back to the worktree', async () => {
    await fs.writeFile(join(fixture.repoPath, 'README.md'), 'edited\n', 'utf8')
    await fixture.git(['add', 'README.md'])

    await service.unstageFiles(fixture.repoPath, ['README.md'])

    expect(await statusPorcelain()).toBe(' M README.md')
  }, 30_000)
})

describe('discardFiles', () => {
  it('restores a tracked file to the index', async () => {
    await fs.writeFile(join(fixture.repoPath, 'README.md'), 'edited\n', 'utf8')

    await service.discardFiles(fixture.repoPath, { tracked: ['README.md'], untracked: [] })

    expect(await statusPorcelain()).toBe('')
    expect(await fs.readFile(join(fixture.repoPath, 'README.md'), 'utf8')).toBe('# fixture\n')
  }, 30_000)

  it('removes an untracked file entirely', async () => {
    await fs.writeFile(join(fixture.repoPath, 'scratch.txt'), 'temp\n', 'utf8')

    await service.discardFiles(fixture.repoPath, { tracked: [], untracked: ['scratch.txt'] })

    expect(await statusPorcelain()).toBe('')
    await expect(fs.stat(join(fixture.repoPath, 'scratch.txt'))).rejects.toThrow()
  }, 30_000)

  it('handles both kinds together', async () => {
    await fs.writeFile(join(fixture.repoPath, 'README.md'), 'edited\n', 'utf8')
    await fs.writeFile(join(fixture.repoPath, 'scratch.txt'), 'temp\n', 'utf8')

    await service.discardFiles(fixture.repoPath, {
      tracked: ['README.md'],
      untracked: ['scratch.txt']
    })

    expect(await statusPorcelain()).toBe('')
  }, 30_000)
})

describe('commit', () => {
  it('commits staged content with a multi-line message', async () => {
    await fs.writeFile(join(fixture.repoPath, 'README.md'), 'edited\n', 'utf8')
    await fixture.git(['add', 'README.md'])

    await service.commit(fixture.repoPath, 'Subject line\n\nBody paragraph.', false)

    const log = await fixture.git(['log', '-1', '--format=%B'])
    expect(log.trim()).toBe('Subject line\n\nBody paragraph.')
    expect(await statusPorcelain()).toBe('')
  }, 30_000)

  it('amends the previous commit instead of creating a new one', async () => {
    const before = await fixture.git(['rev-parse', 'HEAD'])
    await fs.writeFile(join(fixture.repoPath, 'README.md'), 'edited\n', 'utf8')
    await fixture.git(['add', 'README.md'])

    await service.commit(fixture.repoPath, 'Amended message', true)

    const after = await fixture.git(['rev-parse', 'HEAD'])
    expect(after.trim()).not.toBe(before.trim())
    const log = await fixture.git(['log', '--oneline'])
    expect(log.trim().split('\n')).toHaveLength(1)
  }, 30_000)

  it('rejects a commit with nothing staged', async () => {
    await expect(service.commit(fixture.repoPath, 'Nothing to commit', false)).rejects.toThrow()
  }, 30_000)
})

describe('push', () => {
  it('pushes a fast-forward to origin', async () => {
    await fixture.commit('Second commit', { 'a.txt': 'a\n' })

    await service.push(fixture.repoPath, 'main', false)

    const remoteLog = await fixture.git(['log', '-1', '--format=%H', 'origin/main'])
    const localLog = await fixture.git(['log', '-1', '--format=%H'])
    expect(remoteLog.trim()).toBe(localLog.trim())
  }, 30_000)

  it('sets the upstream for a branch that has none', async () => {
    await fixture.git(['checkout', '-b', 'feature/no-upstream'])
    await fixture.commit('On the new branch', { 'b.txt': 'b\n' })

    await service.push(fixture.repoPath, 'feature/no-upstream', true)

    const upstream = await fixture.git([
      'for-each-ref',
      '--format=%(upstream:short)',
      'refs/heads/feature/no-upstream'
    ])
    expect(upstream.trim()).toBe('origin/feature/no-upstream')
  }, 30_000)
})

describe('hasIdentity', () => {
  it('is true when user.email resolves', async () => {
    expect(await service.hasIdentity(fixture.repoPath)).toBe(true)
  }, 30_000)

  it('is false once user.email is unset for this repo', async () => {
    await fixture.git(['config', '--unset', 'user.email'])

    // This container has a global user.email configured, which `git config
    // --get` falls back to once the repo-local one is gone — the same
    // fallback that lets git guess an identity and commit anyway. HOME
    // points git at that global config, so this isolates the check the way
    // an actually-unconfigured machine would look, and restores it
    // immediately: nothing else in this file touches process.env.
    const originalHome = process.env['HOME']
    process.env['HOME'] = fixture.root
    try {
      expect(await service.hasIdentity(fixture.repoPath)).toBe(false)
    } finally {
      process.env['HOME'] = originalHome
    }
  }, 30_000)
})
