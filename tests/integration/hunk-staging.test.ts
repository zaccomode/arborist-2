import { promises as fs } from 'fs'
import { join } from 'path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GitLocator } from '../../src/main/services/git/git-discovery'
import { GitRunner } from '../../src/main/services/git/git-runner'
import { GitService } from '../../src/main/services/git/git-service'
import {
  makeFixtureRepo,
  makeStatusV2Fixture,
  type GitFixture,
  type StatusV2Fixture
} from './fixtures/git-fixture'

const service = new GitService(new GitRunner(new GitLocator()))

let fixture: GitFixture

beforeEach(async () => {
  fixture = await makeFixtureRepo()
}, 60_000)

afterEach(async () => {
  await fixture?.cleanup()
})

// Trims only the trailing newline, same as staging.test.ts: `status
// --porcelain`'s leading column is a meaningful space (unstaged-only), which
// a plain `.trim()` would eat.
async function statusPorcelain(): Promise<string> {
  return (await fixture.git(['status', '--porcelain'])).replace(/\n+$/, '')
}

describe('applyHunk', () => {
  it('stages one hunk of a multi-hunk file without line-count arithmetic, then unstaging it round-trips the status', async () => {
    // Mirrors the case #49 says needs no recomputed header: hunk 1 inserts
    // near the top, hunk 2 edits around line 30 — whose header's new-side
    // start is offset from where the index base would put it once hunk 1's
    // insertion is excluded. `git apply`'s own context search is what
    // makes staging hunk 2 alone still apply cleanly.
    const original = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') + '\n'
    await fs.writeFile(join(fixture.repoPath, 'f.txt'), original, 'utf8')
    await fixture.git(['add', 'f.txt'])
    await fixture.git(['commit', '-m', 'Add f.txt'])

    const edited = original
      .split('\n')
      .flatMap((line, index) => (index === 1 ? ['inserted near the top', line] : [line]))
      .map((line, index) => (index === 31 ? 'edited near line 30' : line))
      .join('\n')
    await fs.writeFile(join(fixture.repoPath, 'f.txt'), edited, 'utf8')

    const before = await statusPorcelain()
    expect(before).toBe(' M f.txt')

    const diff = await service.fileDiff({
      kind: 'unstaged',
      worktreePath: fixture.repoPath,
      path: 'f.txt'
    })
    expect(diff.hunks).toHaveLength(2)
    const secondHunk = diff.hunks[1]
    expect(secondHunk.id).toMatch(/^[0-9a-f]{12}$/)
    expect(secondHunk.header).not.toMatch(/^@@ -1,/)

    await service.applyHunk(fixture.repoPath, { path: 'f.txt' }, secondHunk.id!, 'stage')

    // Partially staged: the first hunk's insertion is still only in the
    // worktree, so the row would show indeterminate in the Working Tree tab.
    expect(await statusPorcelain()).toBe('MM f.txt')
    const staged = await fixture.git(['show', ':f.txt'])
    expect(staged).toContain('edited near line 30')
    expect(staged).not.toContain('inserted near the top')

    const stagedDiff = await service.fileDiff({
      kind: 'staged',
      worktreePath: fixture.repoPath,
      path: 'f.txt'
    })
    expect(stagedDiff.hunks).toHaveLength(1)

    await service.applyHunk(fixture.repoPath, { path: 'f.txt' }, stagedDiff.hunks[0].id!, 'unstage')

    expect(await statusPorcelain()).toBe(before)
  }, 30_000)

  it('throws diff-stale when the hunk no longer matches the file shown', async () => {
    await fs.writeFile(join(fixture.repoPath, 'README.md'), '# fixture\nedited\n', 'utf8')
    const diff = await service.fileDiff({
      kind: 'unstaged',
      worktreePath: fixture.repoPath,
      path: 'README.md'
    })
    const hunk = diff.hunks[0]

    // Reverts the edit outside the app, exactly what "the file changed since
    // the diff was shown" means: nothing in a fresh diff can match the id
    // anymore.
    await fixture.git(['checkout', '--', 'README.md'])

    await expect(
      service.applyHunk(fixture.repoPath, { path: 'README.md' }, hunk.id!, 'stage')
    ).rejects.toMatchObject({ code: 'diff-stale' })
  }, 30_000)

  it('unstages a rename-plus-edit hunk; re-staging by path reproduces the exact R status', async () => {
    // Git's rename heuristic skips near-empty files.
    const original = Array.from({ length: 50 }, () => 'line').join('\n') + '\n'
    await fs.writeFile(join(fixture.repoPath, 'README.md'), original, 'utf8')
    await fixture.git(['add', 'README.md'])
    await fixture.git(['commit', '-m', 'Grow the readme'])

    // `git mv` stages the rename immediately, so a content edit on top of it
    // is staged too by `git add` — the file-diff.test.ts rename fixture does
    // the same, and for the same reason: an unstaged diff would compare
    // against the already-renamed index and never show a rename at all.
    await fixture.git(['mv', 'README.md', 'RENAMED.md'])
    await fs.appendFile(join(fixture.repoPath, 'RENAMED.md'), 'and edited\n', 'utf8')
    await fixture.git(['add', 'RENAMED.md'])
    expect(await statusPorcelain()).toBe('R  README.md -> RENAMED.md')

    const diff = await service.fileDiff({
      kind: 'staged',
      worktreePath: fixture.repoPath,
      path: 'RENAMED.md',
      origPath: 'README.md'
    })
    expect(diff.changeKind).toBe('renamed')
    expect(diff.hunks).toHaveLength(1)

    await service.applyHunk(
      fixture.repoPath,
      { path: 'RENAMED.md', origPath: 'README.md' },
      diff.hunks[0].id!,
      'unstage'
    )

    // Reversing the file's only hunk unstages the whole rename-plus-edit at
    // once: the index reverts to HEAD's README.md, and the renamed file the
    // worktree still holds looks untracked to git until it's added again —
    // a hunk-level `git diff` can't see it to restage by hunk, since an
    // untracked path is outside its comparison entirely regardless of `-M`.
    expect(await statusPorcelain()).toBe(' D README.md\n?? RENAMED.md')

    // `--all`, not just `add RENAMED.md`: the plain `git add` above would
    // leave README.md's now-stale index entry untouched (its worktree file
    // is long gone, physically moved by `git mv`), so status would see an
    // unrelated `D`/`A` pair rather than a rename — `-A` stages that
    // deletion too, which is what lets `git status`'s similarity heuristic
    // pair the two back into one `R` line.
    await fixture.git(['add', '--all'])
    expect(await statusPorcelain()).toBe('R  README.md -> RENAMED.md')
  }, 30_000)

  it('stages a hunk from a file that is not valid UTF-8, from the raw bytes', async () => {
    // `makeStatusV2Fixture` already leaves latin1.txt with an unstaged edit
    // that isn't valid UTF-8 — see its own doc comment. Round-tripping the
    // diff through a JS string would corrupt it (see the byte-accuracy
    // invariant in status-v2.test.ts); this exercises that the same buffer
    // mode carries all the way through `applyHunk`, not just `fileDiff`.
    const f: StatusV2Fixture = await makeStatusV2Fixture()
    try {
      const before = (await f.fixture.git(['status', '--porcelain'], f.repoPath)).replace(
        /\n+$/,
        ''
      )
      expect(before).toContain(' M latin1.txt')

      const diff = await service.fileDiff({
        kind: 'unstaged',
        worktreePath: f.repoPath,
        path: 'latin1.txt'
      })
      expect(diff.hunks).toHaveLength(1)

      await service.applyHunk(f.repoPath, { path: 'latin1.txt' }, diff.hunks[0].id!, 'stage')

      const after = (await f.fixture.git(['status', '--porcelain'], f.repoPath)).replace(/\n+$/, '')
      expect(after).toContain('M  latin1.txt')
    } finally {
      await f.fixture.cleanup()
    }
  }, 30_000)
})
