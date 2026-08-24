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

describe('fileDiff', () => {
  it('diffs an unstaged edit against the index', async () => {
    await fs.writeFile(join(fixture.repoPath, 'README.md'), '# fixture\nedited\n', 'utf8')

    const diff = await service.fileDiff({
      kind: 'unstaged',
      worktreePath: fixture.repoPath,
      path: 'README.md'
    })

    expect(diff.changeKind).toBe('modified')
    expect(diff.hunks[0].lines.some((line) => line.kind === 'add' && line.text === 'edited')).toBe(
      true
    )
  }, 30_000)

  it('diffs a staged edit against HEAD', async () => {
    await fs.writeFile(join(fixture.repoPath, 'README.md'), '# fixture\nstaged\n', 'utf8')
    await fixture.git(['add', 'README.md'])

    const diff = await service.fileDiff({
      kind: 'staged',
      worktreePath: fixture.repoPath,
      path: 'README.md'
    })

    expect(diff.hunks[0].lines.some((line) => line.kind === 'add' && line.text === 'staged')).toBe(
      true
    )
  }, 30_000)

  it('synthesises a diff for an untracked file with no git call', async () => {
    await fs.writeFile(join(fixture.repoPath, 'new-file.txt'), 'hello\nworld\n', 'utf8')

    const diff = await service.fileDiff({
      kind: 'untracked',
      worktreePath: fixture.repoPath,
      path: 'new-file.txt'
    })

    expect(diff).toMatchObject({ oldPath: null, newPath: 'new-file.txt', changeKind: 'added' })
    expect(diff.hunks[0].lines.map((line) => line.text)).toEqual(['hello', 'world'])
  }, 30_000)

  it('marks an untracked binary file as binary without reading it as text', async () => {
    await fs.writeFile(join(fixture.repoPath, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02]))

    const diff = await service.fileDiff({
      kind: 'untracked',
      worktreePath: fixture.repoPath,
      path: 'blob.bin'
    })

    expect(diff).toMatchObject({ binary: true, hunks: [] })
  }, 30_000)

  it('diffs a file inside a commit', async () => {
    const sha = await fixture.commit('Second commit', { 'README.md': '# fixture\nfrom commit\n' })

    const diff = await service.fileDiff({
      kind: 'commit',
      repoPath: fixture.repoPath,
      hash: sha,
      path: 'README.md'
    })

    expect(
      diff.hunks[0].lines.some((line) => line.kind === 'add' && line.text === 'from commit')
    ).toBe(true)
  }, 30_000)

  it('keeps rename detection when both paths are passed', async () => {
    // Git's rename heuristic skips near-empty files, so this needs enough
    // content for it to trigger at all.
    const original = Array.from({ length: 50 }, () => 'line').join('\n') + '\n'
    await fs.writeFile(join(fixture.repoPath, 'README.md'), original, 'utf8')
    await fixture.git(['add', 'README.md'])
    await fixture.git(['commit', '-m', 'Grow the readme'])

    // `git mv` stages the rename immediately, so it has to be compared
    // against HEAD (`--cached`) to see it as a rename at all — an unstaged
    // diff would compare against the index, which already has the new name.
    await fixture.git(['mv', 'README.md', 'RENAMED.md'])
    await fs.appendFile(join(fixture.repoPath, 'RENAMED.md'), 'and edited\n', 'utf8')
    await fixture.git(['add', 'RENAMED.md'])

    const diff = await service.fileDiff({
      kind: 'staged',
      worktreePath: fixture.repoPath,
      path: 'RENAMED.md',
      origPath: 'README.md'
    })

    expect(diff).toMatchObject({
      oldPath: 'README.md',
      newPath: 'RENAMED.md',
      changeKind: 'renamed'
    })
  }, 30_000)

  it('produces no hunks for a mode-only change', async () => {
    await fs.chmod(join(fixture.repoPath, 'README.md'), 0o755)

    const diff = await service.fileDiff({
      kind: 'unstaged',
      worktreePath: fixture.repoPath,
      path: 'README.md'
    })

    // Windows has no execute bit to flip, so git reports no difference at
    // all there and this exercises the empty-output branch instead — which
    // has to come back as a file with no hunks either way, never an error.
    expect(diff.hunks).toEqual([])
    if (process.platform !== 'win32') {
      expect(diff.changeKind).toBe('mode-change')
    }
  }, 30_000)

  it('returns a file with no hunks when git reports no difference at all', async () => {
    // Nothing has been edited, so git prints nothing. The panel renders
    // that as "No changes"; throwing would surface a hard error whenever
    // the status the panel opened from had gone stale.
    const diff = await service.fileDiff({
      kind: 'unstaged',
      worktreePath: fixture.repoPath,
      path: 'README.md'
    })

    expect(diff).toMatchObject({ newPath: 'README.md', hunks: [], binary: false })
  }, 30_000)
})
