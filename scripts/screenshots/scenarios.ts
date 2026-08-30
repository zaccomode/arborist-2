import { chmod, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { Page } from 'playwright'
// Node's native type stripping resolves ESM imports literally, so this needs
// the real file extension rather than a bare specifier.
import { GitFixture, makeBadgeMatrixIn } from '../../tests/integration/fixtures/git-fixture.ts'

/**
 * Captures the window as it currently stands, in both themes, as
 * `<scenario>-<step>-<theme>.png`. Call it at each point worth showing.
 */
export type Shot = (step: string) => Promise<void>

export interface Scenario {
  /** File name stem: `<name>-<theme>.png`, or `<name>-<step>-<theme>.png`. */
  name: string
  /** What the capture is meant to show, for whoever reviews it. */
  description: string
  /**
   * Drives the app to the state worth capturing. Receives the Electron
   * window as a Playwright page, so the full locator API is available.
   * Omit it to capture the app as it opens.
   *
   * Call `shot` to capture partway through, as many times as the change
   * needs — a before and an after belong in one scenario rather than two,
   * since they share the setup that got the app there. A scenario that
   * never calls `shot` is captured once, at the end.
   *
   * Anything awaited here must settle before the capture, so assert on the
   * end state rather than sleeping — `waitFor()`-style waits are what keep
   * a capture from racing the UI it is showing.
   */
  drive?: (window: Page, shot: Shot) => Promise<void>
  /**
   * Prepares whatever the scenario needs before Electron launches: fixture
   * repositories under `workDir`, a seeded `arborist-data.json` under
   * `userDataDir`, or both. Returns environment variables to launch with.
   * Both directories are temporary and removed after the capture.
   *
   * `workDir` is a fixed path derived from the scenario name, because a
   * fixture path can end up on screen and a random one would change the
   * pixels on every run.
   */
  setup?: (context: {
    userDataDir: string
    workDir: string
  }) => Promise<Record<string, string> | void>
  /**
   * Keep the pointer where `drive` left it. The runner otherwise parks it in
   * the corner, so a click doesn't leave its target stuck in `hover:` styling.
   * Set this only to capture a hover state, and hover as the last step.
   */
  keepPointer?: boolean
}

/**
 * Fills a field and waits for the value to settle. Playwright's `fill` writes
 * the DOM value directly, so a controlled input can still be rewritten by the
 * render that follows — capturing in between catches an empty box.
 *
 * `within` disambiguates a testid that appears more than once at once, e.g. a
 * dialog's own notes editor over a worktree detail pane's, which stays
 * mounted behind it.
 */
async function fillAndSettle(
  window: Page,
  testId: string,
  value: string,
  within?: string
): Promise<void> {
  const selector = `${within ?? ''} [data-testid="${testId}"]`.trim()
  await window.locator(selector).fill(value)
  await window.waitForFunction(
    ({ selector, value }) =>
      (document.querySelector(selector) as HTMLTextAreaElement | null)?.value === value,
    { selector, value }
  )
}

/**
 * Waits for the sidebar's worktree list to settle on exactly `count` rows.
 * A filter re-renders the list rather than replacing it, so waiting on any
 * one row's presence would pass while the previous, longer list was still on
 * screen.
 */
async function expectRowCount(window: Page, count: number): Promise<void> {
  await window.waitForFunction(
    (expected) =>
      document.querySelectorAll('[data-testid="worktree-list"] > li').length === expected,
    count
  )
}

/**
 * Waits for the worktree list's last row to be the one named `title`.
 *
 * Changing the sort writes to settings and re-reads them, so the reorder
 * lands a round trip after the menu closes. Waiting on the menu alone
 * captures the previous order and reads as the toggle having done nothing —
 * which is exactly what it looked like before this wait existed.
 */
async function expectLastWorktreeRow(window: Page, title: string): Promise<void> {
  await window.waitForFunction((expected) => {
    const rows = document.querySelectorAll('[data-testid="worktree-list"] > li')
    return (rows[rows.length - 1]?.textContent ?? '').startsWith(expected)
  }, title)
}

/**
 * Seeds `arborist-data.json` with a repository already registered, so the
 * scenario opens straight to it rather than going through the folder
 * picker — which frees `ARBORIST_PICK_FOLDER` for a scenario that also
 * needs to script picking a *different* folder, such as a central worktree
 * directory.
 */
async function seedProject(
  userDataDir: string,
  repoPath: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await writeFile(
    join(userDataDir, 'arborist-data.json'),
    JSON.stringify({
      schemaVersion: 4,
      repositories: [
        { id: 'p1', path: repoPath, name: 'Arborist', addedAt: '2026-01-05T09:00:00.000Z' }
      ],
      ...extra
    }),
    'utf8'
  )
}

/**
 * Set by `working-tree-external-change`'s `setup` and read by its `drive` —
 * the one scenario that writes to the fixture's working tree *after* the app
 * has already launched, which needs the repository path in both places and
 * `setup`/`drive` share no other channel.
 */
let externalChangeRepoPath = ''

/**
 * Set by `stash-list`'s `setup`, read by its `drive` — which needs to commit
 * a genuinely conflicting change directly through git (not through the app,
 * which has no editor of its own) between the stash and the pop that
 * conflicts with it.
 */
let stashListFixture: GitFixture | null = null

export const scenarios: Scenario[] = [
  {
    name: 'shell',
    description:
      'The two-pane shell as the app opens, with no project selected. This is ' +
      'the capture to compare against concept.png.'
  },
  {
    name: 'add-project',
    description:
      'Adding a project: the empty state, the switcher menu that offers it, ' +
      'and the project view that follows.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await shot('empty')
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menu').waitFor({ state: 'visible' })
      await shot('menu')
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      // Lands on the main worktree rather than an empty state, since nothing
      // was ever selected for this project before.
      await window.getByTestId('worktree-detail').waitFor({ state: 'visible' })
      await shot('added')
    }
  },
  {
    name: 'add-project-error',
    description:
      'Adding a project that turns out not to be a git repository (#64): the ' +
      'error carries a copy button, same as every other inline error banner ' +
      'in the app.',
    setup: async ({ workDir }) => {
      const plainFolder = join(workDir, 'not-a-repo')
      await mkdir(plainFolder, { recursive: true })
      return { ARBORIST_PICK_FOLDER: plainFolder }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByTestId('add-project-error').waitFor({ state: 'visible' })
      await shot('error')
    }
  },
  {
    name: 'project-actions',
    description:
      'The switcher menu, which now carries the project list and nothing ' +
      'else, and the removal that used to sit in it — at the foot of the ' +
      "project's own settings, behind a confirmation that says what it does " +
      'and does not touch.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByTestId('worktree-detail').waitFor({ state: 'visible' })

      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'App settings…' }).waitFor()
      await shot('menu')
      await window.keyboard.press('Escape')
      await window.getByRole('menu').waitFor({ state: 'detached' })

      await window.getByRole('button', { name: 'Project settings' }).click()
      await window.getByRole('tab', { name: 'Danger zone' }).click()
      await window.getByRole('button', { name: 'Remove…' }).click()
      await window.getByTestId('remove-project-dialog').waitFor({ state: 'visible' })
      await shot('remove')
    }
  },
  {
    name: 'prune-worktrees',
    description:
      'Pruning, which used to be a permanent menu item and is now a button ' +
      'under the rows it is about, present only while git is still listing a ' +
      'worktree whose folder has gone. Before and after.',
    setup: async ({ workDir }) => {
      const { fixture } = await makeBadgeMatrixIn(workDir, 'Arborist')
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByTestId('prune-worktrees').waitFor({ state: 'visible' })
      await shot('offered')

      await window.getByTestId('prune-worktrees').click()
      // The button goes with the row it was about, which is the whole point
      // of it being conditional.
      await window.getByTestId('prune-worktrees').waitFor({ state: 'detached' })
      await shot('pruned')
    }
  },
  {
    name: 'worktree-badges',
    description:
      'The sidebar over the full badge matrix: ahead/behind, dirty, locked, ' +
      'a missing folder, a deleted upstream, and a detached checkout. The ' +
      'capture to check any change to a row or a badge against.',
    setup: async ({ workDir }) => {
      const { fixture } = await makeBadgeMatrixIn(workDir, 'Arborist')
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByRole('listitem').filter({ hasText: 'feature/ahead-behind' }).waitFor()
    }
  },
  {
    name: 'list-sort-search',
    description:
      "The Worktrees and Remote Branches lists' sort and search controls " +
      '(#77): the two new icon buttons in each header, the sort menu open ' +
      'with its orders and the "keep main at the top" toggle, the list with ' +
      'the pin switched off, the list reordered by tip commit date, the ' +
      'search field open and filtering, and the no-matches state.',
    setup: async ({ workDir }) => {
      const { fixture } = await makeBadgeMatrixIn(workDir, 'Arborist')
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByRole('listitem').filter({ hasText: 'feature/ahead-behind' }).waitFor()
      await shot('default')

      await window.getByRole('button', { name: 'Sort Worktrees' }).click()
      await window.getByRole('menu').waitFor({ state: 'visible' })
      await shot('sort-menu')

      // Unpinned first, while the order is still alphabetical: that is where
      // the toggle is legible, since `main` visibly drops from the top into
      // its alphabetical place rather than staying put by coincidence.
      await window.getByRole('menuitemcheckbox', { name: 'Keep main at the top' }).click()
      await window.getByRole('menu').waitFor({ state: 'detached' })
      // `main` sorts last alphabetically, so it dropping to the bottom is
      // both the visible point of the shot and the settled state to wait on.
      await expectLastWorktreeRow(window, 'main')
      await shot('unpinned')

      await window.getByRole('button', { name: 'Sort Worktrees' }).click()
      await window.getByRole('menuitemradio', { name: 'Recently updated' }).click()
      await window.getByRole('menu').waitFor({ state: 'detached' })
      // The prunable worktree's folder is gone, so it has no commit date and
      // sorts last under this order — see `byDateDescending`.
      await expectLastWorktreeRow(window, 'feature/prunable')
      await shot('recently-updated')

      await window.getByRole('button', { name: 'Search Worktrees' }).click()
      await window.getByLabel('Filter worktrees').fill('feature/')
      // Six of the matrix's eight worktrees are on a `feature/` branch, and
      // the slash keeps the folder paths (which use hyphens) out of it.
      // Waiting on the count is what keeps the capture from racing the filter
      // it is showing.
      await expectRowCount(window, 6)
      await shot('searching')

      await window.getByLabel('Filter worktrees').fill('nothing-like-this')
      await window.getByText('Nothing matches').waitFor({ state: 'visible' })
      await shot('no-matches')
    }
  },
  {
    name: 'worktree-detail',
    description:
      'The worktree detail pane across its three tabs: Overview (with the ' +
      'branch/commit/path information block and notes), Working Tree over ' +
      'a dirty worktree so a row exists, Working Tree over a clean one for ' +
      'its empty state, and Commit Graph.',
    setup: async ({ workDir }) => {
      const { fixture } = await makeBadgeMatrixIn(workDir, 'Arborist')
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()

      await window.getByRole('button', { name: /feature\/ahead-behind/ }).click()
      await window.getByTestId('worktree-detail').waitFor({ state: 'visible' })
      await fillAndSettle(window, 'notes-editor', 'Waiting on review before merging.')
      await shot('overview')

      await window.getByRole('button', { name: /feature\/dirty/ }).click()
      await window.getByRole('tab', { name: 'Working Tree' }).click()
      await window.getByTestId('working-tree-files').waitFor({ state: 'visible' })
      await shot('working-tree')

      await window.getByRole('button', { name: /main/ }).first().click()
      await window.getByRole('tab', { name: 'Working Tree' }).click()
      await window.getByText('No changes.').waitFor({ state: 'visible' })
      await shot('working-tree-clean')

      await window.getByRole('tab', { name: 'Commit Graph' }).click()
      await window.getByTestId('commit-graph-rows').waitFor({ state: 'visible' })
      await shot('commit-graph')
    }
  },
  {
    name: 'recent-commits',
    description:
      "The flat Recent Commits list — RemoteBranchDetail's own, for a " +
      'remote branch with no local checkout, which stays a plain list ' +
      "rather than a lane graph since there's only the one ref to show: " +
      'cards with the shortstat line, and load more revealing the page ' +
      'behind it.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      for (let i = 0; i < 25; i++) {
        await fixture.commitFromElsewhere('feature-remote', `Change ${i}`)
      }
      // Long enough to wrap onto a second line rather than fit on one, so
      // the capture shows the subject wrapping rather than truncating.
      await fixture.commitFromElsewhere(
        'feature-remote',
        'Rework the badge matrix fixture so every worktree state the sidebar can show — ahead/behind, dirty, locked, missing, deleted upstream, detached — has its own row and its own fixture helper'
      )
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Fetch' }).click()
      await window.getByRole('button', { name: /origin\/feature-remote/ }).waitFor({
        state: 'visible'
      })
      await window.getByRole('button', { name: /origin\/feature-remote/ }).click()
      await window.getByTestId('remote-branch-detail').waitFor({ state: 'visible' })
      await window.getByTestId('recent-commits').waitFor({ state: 'visible' })
      await shot('list')

      await window.getByRole('button', { name: 'Load more' }).click()
      await window.getByRole('button', { name: 'Load more' }).waitFor({ state: 'detached' })
      await shot('loaded-more')
    }
  },
  {
    name: 'commit-graph',
    description:
      'The Commit Graph tab (#52): lanes for a linear stretch and a ' +
      "merge's visible fork and join, a long subject wrapping onto " +
      'several lines rather than truncating (right where a lane is also ' +
      'passing through, so the rail keeps tracking a taller row), the ' +
      'commit inspector open on an ordinary commit — with a deeply ' +
      "nested file's location truncating ahead of its name — and on a " +
      "merge, with a file's patch open from inside the merge, and back " +
      'again, and load more paged twice so the lane fold staying ' +
      'continuous across pages is visible.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()

      // Plain, single-parent padding, oldest first — pages two and three
      // are a clean straight line, which is what makes "the fold keeps
      // going correctly across a page boundary" checkable by eye.
      for (let i = 0; i < 40; i++) {
        await fixture.commit(`Housekeeping ${i}`, { 'internals.txt': `pass ${i}\n` })
      }

      // A linear stretch right above the fork, so both are on the very
      // first page without loading anything more.
      await fixture.commit('Add feature flag scaffold', {
        'flags.ts': 'export const flags = {}\n'
      })
      await fixture.commit('Wire up telemetry', { 'telemetry.ts': 'track()\n' })
      await fixture.commit('Bump dependencies', { 'package.json': '{}\n' })
      await fixture.commit('Fix lint warnings', { 'lint.ts': '// clean\n' })

      await fixture.git(['checkout', '-b', 'feature/graph-demo'])
      await fixture.commit('Start graph demo feature', { 'demo.ts': 'start\n' })
      // Long enough to wrap onto several lines rather than truncate, and
      // placed on the fork's own lane so the row it grows into still has
      // main's lane passing through behind it the whole time — the case
      // that actually exercises the rail's tail past a fixed `ROW_HEIGHT`.
      await fixture.commit(
        'Finish graph demo feature, with a subject long enough that it has ' +
          'to wrap onto several lines instead of being truncated with an ' +
          'ellipsis, so long messages stay readable in the commit graph',
        { 'demo.ts': 'start\nfinish\n' }
      )

      await fixture.git(['checkout', 'main'])
      const deepDocPath =
        'docs/guides/getting-started/installation/prerequisites/system-requirements.md'
      await mkdir(
        join(fixture.repoPath, 'docs/guides/getting-started/installation/prerequisites'),
        {
          recursive: true
        }
      )
      await fixture.commit('Tidy up docs', { [deepDocPath]: '# Requirements\ntidied\n' })
      // A pinned date, unlike `fixture.commit()`'s own auto-incrementing one
      // — `git merge` isn't routed through that helper, and without this the
      // merge commit's hash (and its "now" timestamp) would be real
      // wall-clock time, breaking the byte-for-byte reproducibility every
      // other capture in this file relies on.
      await fixture.git(
        ['merge', '--no-ff', 'feature/graph-demo', '-m', 'Merge feature/graph-demo into main'],
        undefined,
        { GIT_AUTHOR_DATE: '2026-01-05T09:48:00Z', GIT_COMMITTER_DATE: '2026-01-05T09:48:00Z' }
      )

      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByRole('tab', { name: 'Commit Graph' }).click()
      await window.getByTestId('commit-graph-rows').waitFor({ state: 'visible' })
      await shot('graph')

      await window.getByRole('button', { name: /Tidy up docs/ }).click()
      await window.getByTestId('commit-inspector').waitFor({ state: 'visible' })
      await window.getByTestId('commit-files').waitFor({ state: 'visible' })
      await shot('inspector-plain')

      await window.getByRole('button', { name: /Merge feature\/graph-demo into main/ }).click()
      await window.getByTestId('commit-files').waitFor({ state: 'visible' })
      await shot('inspector-merge')

      await window.getByRole('button', { name: 'demo.ts', exact: true }).click()
      await window.getByTestId('diff-panel').waitFor({ state: 'visible' })
      await window.getByText('+finish').waitFor({ state: 'visible' })
      await shot('inspector-file')

      await window.getByRole('button', { name: 'Back to commit' }).click()
      await window.getByTestId('commit-files').waitFor({ state: 'visible' })

      await window.getByRole('button', { name: 'Close' }).click()
      await window.getByTestId('commit-inspector').waitFor({ state: 'detached' })

      await window.getByRole('button', { name: 'Load more' }).click()
      await window.waitForFunction(
        () => document.querySelectorAll('[data-testid="commit-graph-rows"] > li').length >= 40
      )
      await shot('paging-a')

      await window.getByRole('button', { name: 'Load more' }).click()
      await window.getByRole('button', { name: 'Load more' }).waitFor({ state: 'detached' })
      await shot('paging-b')
    }
  },
  {
    name: 'commit-graph-crossing-lanes',
    description:
      'Two feature branches open at once and merged back one after the ' +
      "other: the second merge's own edge has to cross the first merge's " +
      'still-open lane on its way to a free column. The through lane ' +
      'stays unbroken and the crossing edge visibly ducks behind it, ' +
      'rather than the edge painting a gap into a lane it has nothing to ' +
      'do with.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      await fixture.commit('Base work', { 'a.txt': 'a\n' })

      await fixture.git(['checkout', '-b', 'feature/one'])
      await fixture.commit('Feature one, step 1', { 'f1.txt': '1\n' })
      await fixture.commit('Feature one, step 2', { 'f1.txt': '1\n2\n' })

      await fixture.git(['checkout', 'main'])
      await fixture.commit('More main work', { 'b.txt': 'b\n' })

      await fixture.git(['checkout', '-b', 'feature/two'])
      await fixture.commit('Feature two, step 1', { 'f2.txt': '1\n' })

      await fixture.git(['checkout', 'main'])
      // Pinned dates for the same reason as the `commit-graph` scenario's
      // own merge: `git merge` bypasses `fixture.commit()`'s auto-incrementing
      // clock, so without this the merge commits' hashes (and timestamps)
      // would be real wall-clock time.
      await fixture.git(
        ['merge', '--no-ff', 'feature/one', '-m', 'Merge feature/one into main'],
        undefined,
        { GIT_AUTHOR_DATE: '2026-01-05T09:10:00Z', GIT_COMMITTER_DATE: '2026-01-05T09:10:00Z' }
      )
      await fixture.commit('Post merge one', { 'c.txt': 'c\n' })
      await fixture.git(
        ['merge', '--no-ff', 'feature/two', '-m', 'Merge feature/two into main'],
        undefined,
        { GIT_AUTHOR_DATE: '2026-01-05T09:12:00Z', GIT_COMMITTER_DATE: '2026-01-05T09:12:00Z' }
      )
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByRole('tab', { name: 'Commit Graph' }).click()
      await window.getByTestId('commit-graph-rows').waitFor({ state: 'visible' })
      await shot('graph')
    }
  },
  {
    name: 'create-worktree',
    description:
      'The create dialog reading a pasted checkout command, and the worktree ' +
      'list either side of creating one.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByRole('button', { name: /main/ }).first().waitFor()
      await shot('before')

      await window.getByRole('button', { name: 'New worktree', exact: true }).click()
      await window.getByLabel('Branch', { exact: true }).fill('git checkout -b feature/ABC-123')
      await window.getByTestId('branch-existence').waitFor({ state: 'visible' })
      await shot('dialog')

      await window.getByRole('button', { name: 'Create' }).click()
      // Landing on main already (the auto-select fallback) means the detail
      // pane is visible before this click too, so waiting for its content
      // rather than its visibility is what actually waits for the new
      // worktree.
      await window
        .getByTestId('worktree-detail')
        .filter({ hasText: 'feature/ABC-123' })
        .waitFor({ state: 'visible' })
      await shot('after')
    }
  },
  {
    name: 'base-ref-picker',
    description:
      'The base-ref combobox on create-worktree: HEAD labelled with what it ' +
      'points at, the full list, filtering as you type, and the offer to ' +
      'track a remote base once the typed branch matches its short name.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      await fixture.commitFromElsewhere('feature-x', 'Pushed while nobody was fetching')
      await fixture.git(['fetch', 'origin'])
      await fixture.git(['branch', 'release/1.0'])
      await fixture.git(['branch', 'release/2.0'])
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()

      await window.getByRole('button', { name: 'New worktree', exact: true }).click()
      await window.getByLabel('Branch', { exact: true }).fill('some-topic')
      await window.getByTestId('branch-existence').waitFor({ state: 'visible' })
      await shot('closed')

      await window.getByRole('combobox').click()
      await window.getByRole('option').first().waitFor({ state: 'visible' })
      await shot('open')

      await window.getByPlaceholder('Search branches…').fill('release')
      await window.getByRole('option', { name: 'release/1.0' }).waitFor({ state: 'visible' })
      await shot('filtered')

      await window.getByRole('option', { name: 'release/1.0' }).click()
      await window.getByLabel('Branch', { exact: true }).fill('feature-x')
      await window.getByRole('combobox').click()
      await window.getByPlaceholder('Search branches…').fill('origin/feature-x')
      await window.getByRole('option', { name: 'origin/feature-x' }).click()
      await window.getByText(/matches origin\/feature-x/).waitFor({ state: 'visible' })
      await shot('track-offer')
    }
  },
  {
    name: 'delete-worktree',
    description:
      'Both confirmations for deleting a dirty worktree: the first says what ' +
      'goes, the second says what cannot be recovered.',
    setup: async ({ workDir }) => {
      const { fixture } = await makeBadgeMatrixIn(workDir, 'Arborist')
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByRole('button', { name: /feature\/dirty/ }).click()
      await window.getByTestId('worktree-detail').waitFor({ state: 'visible' })

      await window.getByRole('button', { name: 'Worktree actions' }).click()
      await window.getByRole('menuitem', { name: 'Delete worktree…' }).click()
      await window.getByTestId('delete-worktree-dialog').waitFor({ state: 'visible' })
      await shot('confirm')

      await window.getByRole('button', { name: 'Delete', exact: true }).click()
      await window.getByTestId('force-delete-worktree-dialog').waitFor({ state: 'visible' })
      await shot('force')
    }
  },
  {
    name: 'remote-branches',
    description:
      'The Remote Branches section: empty until a fetch reveals a branch ' +
      'pushed elsewhere, its detail pane, and creating a tracking worktree ' +
      'from it — which is what turns it back into an ordinary worktree.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      // Pushed to the bare remote before the app ever opens, so the local
      // repo has not fetched it yet: the section starts empty, and only the
      // in-app fetch action (not a refresh of anything already known)
      // reveals it.
      await fixture.commitFromElsewhere('feature-x', 'Pushed while nobody was fetching')
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByTestId('worktree-detail').waitFor({ state: 'visible' })
      await window.getByText('No remote branches without worktrees.').waitFor({ state: 'visible' })
      await shot('empty')

      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Fetch' }).click()
      await window.getByRole('button', { name: /origin\/feature-x/ }).waitFor({ state: 'visible' })
      await shot('fetched')

      await window.getByRole('button', { name: /origin\/feature-x/ }).click()
      await window.getByTestId('remote-branch-detail').waitFor({ state: 'visible' })
      await shot('detail')

      await window.getByRole('button', { name: 'Create worktree from this branch' }).click()
      await window.getByTestId('branch-existence').waitFor({ state: 'visible' })
      await shot('create-dialog')

      await window.getByRole('button', { name: 'Create', exact: true }).click()
      // As above: main is already selected by the time this dialog opens, so
      // the detail pane's content is what proves this is the new worktree,
      // not just its visibility.
      await window
        .getByTestId('worktree-detail')
        .filter({ hasText: 'feature-x' })
        .waitFor({ state: 'visible' })
      await window.getByText('No remote branches without worktrees.').waitFor({ state: 'visible' })
      await shot('after')
    }
  },
  {
    name: 'rb-tracking-demo',
    description:
      'A remote branch, before and after it is turned into a worktree whose ' +
      'local branch is deliberately named something else entirely (#47): ' +
      'the branch still disappears from Remote Branches, because the match ' +
      'follows the tracking relationship rather than the name.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      await fixture.commitFromElsewhere('feature-y', 'Pushed while nobody was fetching')
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Fetch' }).click()
      await window.getByRole('button', { name: /origin\/feature-y/ }).waitFor({ state: 'visible' })
      await shot('before')

      await window.getByRole('button', { name: /origin\/feature-y/ }).click()
      await window.getByRole('button', { name: 'Create worktree from this branch' }).click()
      // Overwrites the prefilled `feature-y` with a name that shares nothing
      // with the remote branch's own — the folder name already differed by
      // default (#47 is about the branch, not the folder), so this is the
      // part that used to slip through.
      await window.getByLabel('Branch', { exact: true }).fill('renamed-locally')
      await window.getByTestId('branch-existence').waitFor({ state: 'visible' })
      await shot('renaming')

      await window.getByRole('button', { name: 'Create', exact: true }).click()
      await window
        .getByTestId('worktree-detail')
        .filter({ hasText: 'renamed-locally' })
        .waitFor({ state: 'visible' })
      await window.getByText('No remote branches without worktrees.').waitFor({ state: 'visible' })
      await shot('after')
    }
  },
  {
    name: 'setup-automation',
    description:
      'The script editor with its parsed preview, and the console streaming ' +
      'a run: one command finished, one still going.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()

      await window.getByRole('button', { name: 'Project settings' }).click()
      await window
        .getByTestId('automation-script')
        .fill('echo "Installing into {{path}}"\n# comments are skipped\nsleep 30')
      await window.getByTestId('automation-preview').waitFor({ state: 'visible' })
      await shot('editor')

      await window.getByRole('button', { name: 'Save' }).click()
      await window.getByRole('button', { name: /main/ }).first().click()
      await window.getByRole('button', { name: 'Worktree actions' }).click()
      await window.getByRole('menuitem', { name: 'Run setup' }).click()
      await window.getByTestId('automation-status').filter({ hasText: 'Running 2 of 2' }).waitFor()
      await shot('console')
    }
  },
  {
    name: 'fetch',
    description:
      'Fetch, riding the project switcher as its one overflow action: the ' +
      'menu item, and the toast when the remote cannot be reached — the one ' +
      'friendly-message case, replacing raw stderr.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      // An address nothing listens on, so the fetch fails fast and the same
      // way on every run rather than depending on real network timing.
      await fixture.git(['remote', 'set-url', 'origin', 'https://127.0.0.1:1/nope.git'])
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByTestId('worktree-detail').waitFor({ state: 'visible' })

      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Fetch' }).waitFor({ state: 'visible' })
      await shot('menu')

      await window.getByRole('menuitem', { name: 'Fetch' }).click()
      await window.getByText('Fetch failed').waitFor({ state: 'visible' })
      await shot('error')
    }
  },
  {
    name: 'settings',
    description:
      'Settings: the General tab with the detected git binary and the theme, ' +
      'the Presets tab with the built-in switches, the preset editor over it, ' +
      'the Developer tab, and the About tab (#65) in its default, ' +
      'not-yet-checked state.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByTestId('worktree-detail').waitFor({ state: 'visible' })

      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'App settings…' }).click()
      await window.getByTestId('settings-dialog').waitFor({ state: 'visible' })
      await window.getByTestId('git-discovery').waitFor({ state: 'visible' })
      await shot('general')

      await window.getByRole('tab', { name: 'Presets' }).click()
      await window.getByTestId('preset-settings').waitFor({ state: 'visible' })
      await shot('presets')

      await window.getByRole('button', { name: 'New preset' }).click()
      await window.getByTestId('preset-editor').waitFor({ state: 'visible' })
      await shot('preset-editor')

      await window.getByLabel('Icon').click()
      await window.getByRole('listbox').waitFor({ state: 'visible' })
      await shot('preset-icons')

      await window.keyboard.press('Escape')
      await window.getByRole('listbox').waitFor({ state: 'detached' })
      await window.getByRole('button', { name: 'Cancel' }).click()
      await window.getByTestId('preset-editor').waitFor({ state: 'detached' })
      await window.getByRole('tab', { name: 'Developer' }).click()
      await window.getByLabel('Log every git command').waitFor({ state: 'visible' })
      await shot('developer')

      await window.getByRole('tab', { name: 'About' }).click()
      await window.getByTestId('update-status').filter({ hasText: 'Not checked yet' }).waitFor()
      await shot('about')
    }
  },
  {
    name: 'update-check-tab',
    description:
      'The About tab (#65) either side of the outcome a manual check can ' +
      'land on: up to date, and a failed check — a network outage, most ' +
      'likely — shown next to the button that triggers another one.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      // Fixed rather than a real check, which would either hit the network
      // or hang on an unpacked build — this is what "up to date" looks like
      // once one has actually run. Scoped to this scenario alone, rather than
      // the main "settings" one, so it doesn't also put an unrelated toast
      // over every other tab that scenario captures.
      return { ARBORIST_PICK_FOLDER: fixture.repoPath, ARBORIST_FAKE_UPDATE: 'up-to-date' }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()

      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'App settings…' }).click()
      await window.getByRole('tab', { name: 'About' }).click()
      await window.getByTestId('update-status').filter({ hasText: 'up to date' }).waitFor()
      await shot('up-to-date')
    }
  },
  {
    name: 'settings-about-error',
    description: 'The About tab (#65) when the last check failed.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      return { ARBORIST_PICK_FOLDER: fixture.repoPath, ARBORIST_FAKE_UPDATE: 'error' }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()

      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'App settings…' }).click()
      await window.getByRole('tab', { name: 'About' }).click()
      await window.getByTestId('update-status').filter({ hasText: 'Could not check' }).waitFor()
      await shot('error')
    }
  },
  {
    name: 'settings-worktree-location',
    description:
      'App-level worktree location: beside the repository, the default, ' +
      'then switched to a central directory before and after a folder is ' +
      'picked for it.',
    setup: async ({ workDir, userDataDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      const centralRoot = join(workDir, 'central-worktrees')
      await mkdir(centralRoot, { recursive: true })
      await seedProject(userDataDir, fixture.repoPath)
      return { ARBORIST_PICK_FOLDER: centralRoot }
    },
    drive: async (window, shot) => {
      await window.getByRole('button', { name: /main/ }).first().waitFor()
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'App settings…' }).click()
      await window.getByLabel('Worktree location').waitFor({ state: 'visible' })
      await shot('beside')

      await window.getByLabel('Worktree location').click()
      await window.getByRole('option', { name: 'In a central directory' }).click()
      await window.getByTestId('worktree-root-path').waitFor({ state: 'visible' })
      await shot('central-empty')

      await window.getByRole('button', { name: 'Choose…' }).click()
      await window
        .getByTestId('worktree-root-path')
        .filter({ hasText: 'central-worktrees' })
        .waitFor()
      await shot('central-chosen')
    }
  },
  {
    name: 'create-worktree-central',
    description:
      'The create dialog’s suggested path for a project in central mode — ' +
      'visibly different from the sibling-of-the-repository default.',
    setup: async ({ workDir, userDataDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      const centralRoot = join(workDir, 'central-worktrees')
      await mkdir(centralRoot, { recursive: true })
      await seedProject(userDataDir, fixture.repoPath, {
        projectSettings: { p1: { worktreeLocation: 'central', worktreeRoot: centralRoot } }
      })
    },
    drive: async (window, shot) => {
      await window.getByRole('button', { name: /main/ }).first().waitFor()
      await window.getByRole('button', { name: 'New worktree', exact: true }).click()
      await window.getByLabel('Branch', { exact: true }).fill('feature/central')
      await window.getByTestId('branch-existence').waitFor({ state: 'visible' })
      await window.waitForFunction(() => {
        const input = document.getElementById('worktree-path') as HTMLInputElement | null
        return input?.value.includes('central-worktrees') ?? false
      })
      await shot('dialog')
    }
  },
  {
    name: 'project-settings',
    description:
      'Project settings, opened from the button under the worktree list, now ' +
      'tabbed like app settings: the automation script with its parsed ' +
      'preview, the worktree-location override showing what inherit ' +
      'resolves to, the per-project preset overrides alongside a preset ' +
      "added just for this project, the project's own note, and the danger " +
      'zone.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByTestId('worktree-detail').waitFor({ state: 'visible' })
      await window.getByRole('button', { name: 'Project settings' }).click()
      await fillAndSettle(window, 'automation-script', 'npm install\nnpm run build')
      await window.getByTestId('automation-preview').waitFor({ state: 'visible' })
      await shot('automation')

      await window.getByRole('tab', { name: 'Worktrees' }).click()
      await window.getByTestId('project-worktree-location').waitFor({ state: 'visible' })
      await shot('worktree-location')

      await window.getByRole('tab', { name: 'Presets' }).click()
      await window.getByTestId('project-presets').waitFor({ state: 'visible' })
      await window.getByRole('button', { name: 'New preset' }).click()
      await window.getByLabel('Name').fill('Storybook')
      await window.getByLabel('Command').fill('npm run storybook')
      await window.getByRole('button', { name: 'Save' }).click()
      await window.getByTestId('preset-editor').waitFor({ state: 'detached' })
      await shot('presets')

      await window.getByRole('tab', { name: 'Notes' }).click()
      await fillAndSettle(
        window,
        'notes-editor',
        'Release branches: squash merges only.',
        '[data-testid="project-settings-dialog"]'
      )
      await shot('notes')

      await window.getByRole('tab', { name: 'Danger zone' }).click()
      await window.getByRole('button', { name: 'Remove…' }).waitFor({ state: 'visible' })
      await shot('danger')
    }
  },
  {
    name: 'preset-console',
    description:
      'A shell preset running in its own console: one command finished, the ' +
      'next failed with its output. Presets used to launch detached, so a ' +
      'command that failed did so out of sight.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()

      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'App settings…' }).click()
      await window.getByRole('tab', { name: 'Presets' }).click()
      await window.getByRole('button', { name: 'New preset' }).click()
      await window.getByLabel('Name').fill('Build')
      await window
        .getByLabel('Command')
        .fill('echo "Building {{branch}}"\necho "no such target" >&2; exit 2')
      await window.getByRole('button', { name: 'Save' }).click()
      await window.getByTestId('preset-editor').waitFor({ state: 'detached' })
      await window.keyboard.press('Escape')
      await window.getByTestId('settings-dialog').waitFor({ state: 'detached' })

      await window.getByRole('button', { name: /main/ }).first().click()
      await window.getByRole('button', { name: 'Build' }).click()
      await window.getByTestId('preset-console-status').filter({ hasText: 'Failed' }).waitFor()
    }
  },
  {
    name: 'git-not-found',
    description:
      'The blocking screen shown when no git binary can be found, with the ' +
      'manual path field. Every other screen assumes a working git, so this ' +
      'is the one state that replaces the whole shell.',
    setup: async () => ({ ARBORIST_FORCE_GIT_MISSING: '1' }),
    drive: async (window) => {
      await window.getByTestId('git-not-found').waitFor({ state: 'visible' })
    }
  },
  {
    name: 'store-corrupt',
    description:
      'The toast shown when the data file could not be read and was backed ' +
      'up. v1 printed this to a console nobody was reading, so the capture ' +
      'is the point: it has to be visible.',
    setup: async ({ userDataDir }) => {
      await writeFile(join(userDataDir, 'arborist-data.json'), 'not json{{{', 'utf8')
    },
    drive: async (window) => {
      await window.getByText('Your Arborist data could not be read').waitFor({ state: 'visible' })
    }
  },
  {
    name: 'update-downloading',
    description:
      'The toast shown while an update is downloading, with its progress. ' +
      'Before this, downloading happened silently and the app looked idle ' +
      'for however long the download took.',
    setup: async () => ({ ARBORIST_FAKE_UPDATE: 'downloading' }),
    drive: async (window) => {
      await window.getByText('Downloading Arborist 2.1.0').waitFor({ state: 'visible' })
    }
  },
  {
    name: 'update-ready',
    description:
      'The toast shown once an update has downloaded. It is the only place ' +
      'the app offers to restart itself, and it has to read as an offer ' +
      'rather than as a countdown: dismissing it is a supported answer, and ' +
      'the update lands on the next ordinary quit instead.',
    setup: async () => ({ ARBORIST_FAKE_UPDATE: 'ready' }),
    drive: async (window) => {
      await window.getByRole('button', { name: 'Restart now' }).waitFor({ state: 'visible' })
    }
  },
  {
    name: 'update-up-to-date',
    description:
      'The answer to a "Check for Updates…" that found nothing. It exists ' +
      'because a menu item that silently does nothing reads as broken.',
    setup: async () => ({ ARBORIST_FAKE_UPDATE: 'up-to-date' }),
    drive: async (window) => {
      await window.getByText("You're up to date").waitFor({ state: 'visible' })
    }
  },
  {
    name: 'diff-panel',
    description:
      'The third panel across the states its own file kinds force: a ' +
      'modest text diff, a binary file (now edited, not just new, so the ' +
      'hunk-less whole-file staging offer from #49 shows), a mode-only ' +
      'change with no hunks (offering the same), a file too large to show ' +
      'in full, and the panel closed again.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      // Written before the commit below, not after: an *edited* tracked
      // binary file is what exercises the hunk-less whole-file offer
      // (`isHunklessChange`) — a brand-new untracked one is a different,
      // already-covered case with no staging control in this panel at all.
      await writeFile(
        join(fixture.repoPath, 'image.png'),
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03])
      )
      // `commit()` stages everything dirty at call time, not just the paths
      // it's given — so the script and image are committed cleanly first,
      // and every uncommitted change below is made only after that commit
      // exists.
      await fixture.commit('Add a script and an image', { 'script.sh': '#!/bin/sh\necho hi\n' })
      await chmod(join(fixture.repoPath, 'script.sh'), 0o755)
      await writeFile(
        join(fixture.repoPath, 'README.md'),
        '# fixture\nedited for the diff panel\n',
        'utf8'
      )
      await writeFile(
        join(fixture.repoPath, 'image.png'),
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03, 0xff, 0xff])
      )
      const big = Array.from({ length: 2500 }, (_, i) => `line ${i}`).join('\n') + '\n'
      await writeFile(join(fixture.repoPath, 'big.txt'), big, 'utf8')
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByTestId('worktree-detail').waitFor({ state: 'visible' })
      await window.getByRole('tab', { name: 'Working Tree' }).click()
      await window.getByTestId('working-tree-files').waitFor({ state: 'visible' })

      await window.getByRole('button', { name: 'README.md', exact: true }).click()
      await window.getByTestId('diff-panel').waitFor({ state: 'visible' })
      await window.getByText('edited for the diff panel').waitFor({ state: 'visible' })
      await shot('modest-diff')

      await window.getByRole('button', { name: 'image.png', exact: true }).click()
      await window.getByText('Binary file, not shown.').waitFor({ state: 'visible' })
      await window.getByRole('button', { name: 'Stage file' }).waitFor({ state: 'visible' })
      await shot('binary')

      await window.getByRole('button', { name: 'script.sh', exact: true }).click()
      await window.getByText('File mode changed, no content changes.').waitFor({ state: 'visible' })
      await window.getByRole('button', { name: 'Stage file' }).waitFor({ state: 'visible' })
      await shot('mode-only')

      await window.getByRole('button', { name: 'big.txt', exact: true }).click()
      await window
        .getByText('This diff is too large to show in full and has been truncated.')
        .waitFor({ state: 'visible' })
      await shot('truncated')

      await window.getByRole('button', { name: 'Close' }).click()
      await window.getByTestId('diff-panel').waitFor({ state: 'detached' })
      await shot('closed')
    }
  },
  {
    name: 'diff-panel-hunks',
    description:
      'Hunk-level staging (#49) in the unified view (#73): a two-hunk diff ' +
      'with nothing staged, then the top hunk staged — it stays exactly ' +
      'where it was, marked with a rail and a Staged badge and its button ' +
      'flipped to "Unstage hunk", rather than disappearing into a separate ' +
      'Staged view the way it used to. The file row goes indeterminate ' +
      'alongside it. Unstaging it there returns the list to the state it ' +
      'started from.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`)
      await fixture.commit('Add f.txt', { 'f.txt': lines.join('\n') + '\n' })
      // Two edits far enough apart that they stay separate hunks under the
      // app's `-U3` context, the same shape #49 says needs no recomputed
      // header once only one of the two is staged.
      lines.splice(1, 0, 'inserted near the top')
      lines[31] = 'edited near line 30'
      await writeFile(join(fixture.repoPath, 'f.txt'), lines.join('\n') + '\n', 'utf8')
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByTestId('worktree-detail').waitFor({ state: 'visible' })
      await window.getByRole('tab', { name: 'Working Tree' }).click()
      await window.getByTestId('working-tree-files').waitFor({ state: 'visible' })

      await window.getByRole('button', { name: 'f.txt', exact: true }).click()
      await window.getByTestId('diff-panel').waitFor({ state: 'visible' })
      await window.getByRole('button', { name: 'Stage hunk' }).nth(1).waitFor({ state: 'visible' })
      await shot('unstaged')

      await window.getByRole('button', { name: 'Stage hunk' }).first().click()
      await window
        .locator('[aria-label="f.txt staging state"][data-state="indeterminate"]')
        .waitFor({ state: 'visible' })
      // The point of #73: the staged hunk's own text is still on screen, in
      // the same list, rather than having moved to a view the user has to go
      // and find. Waiting on the marked hunk is what says the refetch landed.
      await window.locator('[data-side="staged"]').waitFor({ state: 'visible' })
      await window.getByText('inserted near the top').waitFor({ state: 'visible' })
      await window.getByRole('button', { name: 'Unstage hunk' }).waitFor({ state: 'visible' })
      await shot('one-staged')

      await window.getByRole('button', { name: 'Unstage hunk' }).click()
      await window
        .locator('[aria-label="f.txt staging state"][data-state="unchecked"]')
        .waitFor({ state: 'visible' })
      await window.locator('[data-side="staged"]').waitFor({ state: 'detached' })
      await window.getByRole('button', { name: 'Stage hunk' }).nth(1).waitFor({ state: 'visible' })
      await shot('after')
    }
  },
  {
    name: 'shell-panels',
    description:
      'The shell at a narrower window width: two panels with the middle ' +
      'one scaling with the window, then a third opened — the middle panel ' +
      'switches to an absolute width, protected by its 360px minSize so a ' +
      '520px inspector cannot squeeze it away.',
    setup: async ({ workDir, userDataDir }) => {
      const { fixture } = await makeBadgeMatrixIn(workDir, 'Arborist')
      await writeFile(
        join(userDataDir, 'window-state.json'),
        JSON.stringify({ width: 900, height: 720, maximized: false }),
        'utf8'
      )
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByRole('button', { name: /feature\/dirty/ }).click()
      await window.getByRole('tab', { name: 'Working Tree' }).click()
      await window.getByTestId('working-tree-files').waitFor({ state: 'visible' })
      await shot('two-panels')

      await window.getByRole('button', { name: 'README.md', exact: true }).click()
      await window.getByTestId('diff-panel').waitFor({ state: 'visible' })
      await shot('three-panels')
    }
  },
  {
    name: 'working-tree-staging',
    description:
      'The staging model end to end: an indeterminate row (staged and ' +
      'unstaged at once) alongside untouched rows, checking one of those ' +
      'to stage it, a commit message typed in, and the list either side ' +
      'of committing.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      await fixture.commit('Add a.txt and b.txt', { 'a.txt': 'a\n', 'b.txt': 'b\n' })
      // a.txt: staged, then edited again — index and worktree both differ,
      // the one shape the checkbox alone can't produce (that's #49's hunk
      // staging), so it has to come from outside this session.
      await writeFile(join(fixture.repoPath, 'a.txt'), 'a\nstaged\n', 'utf8')
      await fixture.git(['add', 'a.txt'])
      await writeFile(join(fixture.repoPath, 'a.txt'), 'a\nstaged\nand edited again\n', 'utf8')
      // b.txt: an ordinary unstaged edit.
      await writeFile(join(fixture.repoPath, 'b.txt'), 'b\nedited\n', 'utf8')
      // c.txt: untracked.
      await writeFile(join(fixture.repoPath, 'c.txt'), 'new\n', 'utf8')
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByRole('tab', { name: 'Working Tree' }).click()
      await window
        .locator('[aria-label="a.txt staging state"][data-state="indeterminate"]')
        .waitFor({ state: 'visible' })
      await shot('nothing-checked')

      await window.getByLabel('b.txt staging state').click()
      await window
        .locator('[aria-label="b.txt staging state"][data-state="checked"]')
        .waitFor({ state: 'visible' })
      await shot('some-checked')

      await window.getByTestId('commit-message').fill('Update a.txt and b.txt')
      await shot('message-typed')

      await window.getByTestId('commit-button').click()
      await window.getByLabel('b.txt staging state').waitFor({ state: 'detached' })
      await shot('after-commit')
    }
  },
  {
    name: 'commit-footer-pin',
    description:
      'The commit box pinned to the bottom of the Working Tree panel (#66), ' +
      'full-width separator and all, regardless of how many changed files ' +
      'sit above it: enough untracked files to force the list to scroll, ' +
      'captured before and after scrolling it — the commit box stays put ' +
      'either way.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      // More rows than the panel can show at once, so the file list actually
      // has something to scroll — the point of this scenario.
      for (let i = 0; i < 30; i++) {
        await writeFile(
          join(fixture.repoPath, `file-${String(i).padStart(2, '0')}.txt`),
          `${i}\n`,
          'utf8'
        )
      }
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByRole('tab', { name: 'Working Tree' }).click()
      await window.getByTestId('working-tree-files').waitFor({ state: 'visible' })
      await window.getByTestId('commit-button').waitFor({ state: 'visible' })
      await shot('top')

      // Scrolls the file list, not the window — hovering it first is what
      // routes the wheel event to that inner scroll container rather than
      // the page.
      await window.getByTestId('working-tree-files').hover()
      await window.mouse.wheel(0, 4000)
      await window.getByRole('button', { name: 'file-29.txt', exact: true }).waitFor({
        state: 'visible'
      })
      // Still pinned exactly where it was: nothing about scrolling the list
      // above it should move the footer.
      await window.getByTestId('commit-button').waitFor({ state: 'visible' })
      await shot('scrolled')
    }
  },
  {
    name: 'working-tree-discard',
    description:
      'Discarding a file, behind a confirmation since it is irreversible — ' +
      'the same two-step shape as deleting a worktree.',
    setup: async ({ workDir }) => {
      const { fixture } = await makeBadgeMatrixIn(workDir, 'Arborist')
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByRole('button', { name: /feature\/dirty/ }).click()
      await window.getByRole('tab', { name: 'Working Tree' }).click()
      await window.getByTestId('working-tree-files').waitFor({ state: 'visible' })

      await window
        .getByRole('button', { name: 'README.md', exact: true })
        .click({ button: 'right' })
      await window.getByRole('menuitem', { name: 'Discard…' }).waitFor({ state: 'visible' })
      await shot('context-menu')

      await window.getByRole('menuitem', { name: 'Discard…' }).click()
      await window.getByTestId('discard-file-dialog').waitFor({ state: 'visible' })
      await shot('confirm')
    }
  },
  {
    name: 'commit-no-identity',
    description:
      'The hint under the commit box when git has no configured identity ' +
      'for this worktree — a warning rather than a block, since git still ' +
      'guesses one from the machine and commits successfully with it.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      await fixture.git(['config', '--unset', 'user.email'])
      await writeFile(join(fixture.repoPath, 'README.md'), '# fixture\nedited\n', 'utf8')
      // Isolates the identity check from this container's own global git
      // config, the same way a genuinely unconfigured machine would look.
      return { ARBORIST_PICK_FOLDER: fixture.repoPath, HOME: workDir }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByRole('tab', { name: 'Working Tree' }).click()
      await window.getByText(/No git identity configured/).waitFor({ state: 'visible' })
      await shot('hint')
    }
  },
  {
    name: 'pull-push',
    description:
      'Pull and push in the worktree detail header (#78): a branch behind ' +
      'its upstream showing Pull alone, since there is nothing to push, the ' +
      'pull menu holding rebase and merge, both buttons gone once the ' +
      'branch is level (#79 review — each exists only while it has work to ' +
      'do), and the offer a diverged branch gets when --ff-only refuses.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()

      // `main` one commit behind: their push is fetched but not integrated,
      // which is the state the Pull button exists for.
      await fixture.commitFromElsewhere('main', 'Pushed while nobody was looking')

      // A second worktree that has moved on both sides at once, so a
      // fast-forward is genuinely impossible rather than merely unlikely.
      const diverged = await fixture.addWorktree('diverged', { branch: 'feature/diverged' })
      await fixture.git(['push', '--set-upstream', 'origin', 'feature/diverged'], diverged)
      await fixture.commitFromElsewhere('feature/diverged', 'Their commit')
      await fixture.commit('Our commit', { 'ours.txt': 'ours\n' }, diverged)

      await fixture.git(['fetch', 'origin'])
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByRole('button', { name: 'Pull 1' }).waitFor({ state: 'visible' })
      await shot('behind')

      await window.getByRole('button', { name: 'Pull options' }).click()
      await window.getByRole('menu').waitFor({ state: 'visible' })
      await shot('pull-menu')

      await window.keyboard.press('Escape')
      await window.getByRole('menu').waitFor({ state: 'detached' })
      await window.getByRole('button', { name: 'Pull 1' }).click()
      // The whole pair going away is the branch having caught up, which is a
      // settled state to wait on rather than the toast, which fades.
      await window.getByTestId('sync-actions').waitFor({ state: 'detached' })
      await shot('pulled')

      await window.getByRole('button', { name: /feature\/diverged/ }).click()
      await window.getByRole('button', { name: 'Pull 1' }).click()
      await window.getByText('This branch and its upstream have both moved').waitFor({
        state: 'visible'
      })
      await shot('diverged')
    }
  },
  {
    name: 'push-button',
    description:
      'The push button in both states it appears: counting commits ahead ' +
      'once there is an upstream to compare against, and offering to ' +
      'publish the branch when there is not one yet.',
    setup: async ({ workDir }) => {
      const { fixture } = await makeBadgeMatrixIn(workDir, 'Arborist')
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()

      await window.getByRole('button', { name: /feature\/ahead-behind/ }).click()
      await window.getByRole('tab', { name: 'Working Tree' }).click()
      await window.getByRole('button', { name: 'Push 2 commits' }).waitFor({ state: 'visible' })
      await shot('ahead')

      await window.getByRole('button', { name: 'Commit options' }).click()
      await window.getByRole('menuitemcheckbox', { name: 'Amend previous commit' }).waitFor()
      await shot('commit-options')
      await window.keyboard.press('Escape')

      await window.getByRole('button', { name: /feature\/no-upstream/ }).click()
      await window.getByRole('tab', { name: 'Working Tree' }).click()
      await window.getByRole('button', { name: 'Publish branch' }).waitFor({ state: 'visible' })
      await shot('no-upstream')
    }
  },
  {
    name: 'working-tree-external-change',
    description:
      'The one capture with the watcher (#50) switched on: a file edited on ' +
      'disk by something other than Arborist — an editor, a build, a commit ' +
      'from the terminal — and the Working Tree tab picking it up on its ' +
      'own, with no manual refresh. Every other scenario keeps the watcher ' +
      'off, per the determinism note on ARBORIST_DISABLE_WATCHER.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      externalChangeRepoPath = fixture.repoPath
      // Overrides the runner's own default of '1', which every other
      // scenario relies on for a deterministic capture.
      return { ARBORIST_PICK_FOLDER: fixture.repoPath, ARBORIST_DISABLE_WATCHER: '0' }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByRole('tab', { name: 'Working Tree' }).click()
      await window.getByText('No changes.').waitFor({ state: 'visible' })
      await shot('before')

      // Written straight to disk, the way an editor or a build would —
      // never through `invoke('workingTree:…')`, which is the case already
      // covered without a watcher at all.
      await writeFile(
        join(externalChangeRepoPath, 'README.md'),
        '# fixture\nedited outside Arborist\n',
        'utf8'
      )
      await window
        .getByRole('button', { name: 'README.md', exact: true })
        .waitFor({ state: 'visible' })
      await shot('after')
    }
  },
  {
    name: 'switch-branch',
    description:
      "Switching a worktree's branch (#51): the picker open, the " +
      'conflicting-dirt AlertDialog offering to stash or commit first, the ' +
      'inline refusal when the target is already checked out in another ' +
      "worktree, and a clean switch whose uncommitted change — the branch's " +
      'own dirty edit didn’t conflict with — carries straight over, toast ' +
      'and all.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()

      // feature-elsewhere: checked out in a second worktree, so switching
      // onto it from main hits the branch-in-use refusal.
      await fixture.addWorktree('elsewhere', { branch: 'feature-elsewhere' })

      // feature-clean: nothing here overlaps the uncommitted edit below, so
      // a switch onto it carries that edit straight over.
      await fixture.git(['checkout', '-b', 'feature-clean'])
      await fixture.commit('Add clean.txt', { 'clean.txt': 'clean\n' })
      await fixture.git(['checkout', 'main'])

      // feature-conflict: edits README.md, the same file the uncommitted
      // change below touches — the one a switch can't carry over.
      await fixture.git(['checkout', '-b', 'feature-conflict'])
      await fixture.commit('Edit README on feature-conflict', {
        'README.md': '# fixture\nfeature-conflict edit\n'
      })
      await fixture.git(['checkout', 'main'])
      await writeFile(join(fixture.repoPath, 'README.md'), '# fixture\nuncommitted edit\n', 'utf8')

      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByTestId('worktree-detail').waitFor({ state: 'visible' })

      await window.getByRole('button', { name: 'Worktree actions' }).click()
      await window.getByRole('menuitem', { name: 'Switch branch…' }).click()
      await window.getByTestId('switch-branch-dialog').waitFor({ state: 'visible' })
      await window.getByRole('combobox').click()
      await window.getByRole('option', { name: 'feature-conflict' }).waitFor({ state: 'visible' })
      await shot('picker')

      await window.getByRole('option', { name: 'feature-conflict' }).click()
      await window.getByRole('button', { name: 'Switch', exact: true }).click()
      await window.getByTestId('switch-branch-conflict-dialog').waitFor({ state: 'visible' })
      await shot('conflict')

      await window.getByRole('button', { name: 'Cancel' }).click()
      await window.getByTestId('switch-branch-conflict-dialog').waitFor({ state: 'detached' })

      await window.getByRole('button', { name: 'Worktree actions' }).click()
      await window.getByRole('menuitem', { name: 'Switch branch…' }).click()
      await window.getByTestId('switch-branch-dialog').waitFor({ state: 'visible' })
      await window.getByRole('combobox').click()
      await window.getByRole('option', { name: 'feature-elsewhere' }).click()
      await window.getByRole('button', { name: 'Switch', exact: true }).click()
      await window.getByTestId('switch-branch-error').waitFor({ state: 'visible' })
      await shot('in-use')

      await window.getByRole('combobox').click()
      await window.getByRole('option', { name: 'feature-clean' }).click()
      await window.getByRole('button', { name: 'Switch', exact: true }).click()
      await window
        .getByText('Your uncommitted changes came with you.')
        .waitFor({ state: 'visible' })
      await shot('clean-switch')
    }
  },
  {
    name: 'switch-branch-create',
    description:
      'Creating a new branch from the switch-branch picker (#69 review): ' +
      "the empty state's hint text before anything is typed — this fixture " +
      'has no other local branches to pick, so that empty state is what ' +
      'greets the picker — the "Create branch" row that then appears once ' +
      'a typed name matches no existing branch, the Base picker it reveals ' +
      '(defaulting to HEAD), and the worktree afterwards, now checked out ' +
      'on the branch that was just created.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByTestId('worktree-detail').waitFor({ state: 'visible' })

      await window.getByRole('button', { name: 'Worktree actions' }).click()
      await window.getByRole('menuitem', { name: 'Switch branch…' }).click()
      await window.getByTestId('switch-branch-dialog').waitFor({ state: 'visible' })
      await window.getByRole('combobox').first().click()
      await window
        .getByText('No matching branch. Type a name to create one.')
        .waitFor({ state: 'visible' })
      await shot('empty')

      await window.getByPlaceholder('Search branches…').fill('feature/new-thing')
      await window.getByText('Create branch “feature/new-thing”').waitFor({
        state: 'visible'
      })
      await shot('create-option')

      await window.getByText('Create branch “feature/new-thing”').click()
      await window.getByText('New branch — created from HEAD (main).').waitFor({
        state: 'visible'
      })
      await shot('form')

      await window.getByRole('button', { name: 'Create and switch' }).click()
      await window
        .getByText('Created feature/new-thing and switched to it.')
        .waitFor({ state: 'visible' })
      await shot('after')
    }
  },
  {
    name: 'stash-list',
    description:
      "The Working Tree tab's Stash section (#51): absent entirely while " +
      'there are no stashes (#76), one entry after stashing an uncommitted ' +
      'edit through the UI, and the aftermath of a pop that left conflicts ' +
      '— the stash stays in the list rather than being silently dropped, ' +
      'and the conflicted file surfaces honestly.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      await writeFile(join(fixture.repoPath, 'README.md'), '# fixture\noriginal edit\n', 'utf8')
      stashListFixture = fixture
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByRole('tab', { name: 'Working Tree' }).click()
      // #76: no stashes means no section at all, so the wait is for the tab
      // itself to have loaded — waiting on the section would wait forever.
      await window.getByTestId('working-tree-files').waitFor({ state: 'visible' })
      await window.getByTestId('stash-section').waitFor({ state: 'detached' })
      await shot('empty')

      // Nothing is checked for staging, so the menu falls back to "Stash all
      // changes…" — the pre-existing one-click behaviour this replaces.
      await window.getByRole('button', { name: 'Changed files actions' }).click()
      await window.getByRole('menuitem', { name: 'Stash all changes…' }).click()
      await window.getByLabel('Message').fill('Keep this for later')
      await window.getByRole('button', { name: 'Stash', exact: true }).click()
      await window.getByTestId('stash-list').waitFor({ state: 'visible' })
      await window.getByText('No changes.').waitFor({ state: 'visible' })
      await shot('one-entry')

      // A conflicting *commit* made directly through git, after the stash —
      // there's no in-app editor, so this bypasses Arborist the same way the
      // watcher scenario's direct write does. It has to be a commit rather
      // than another dirty edit: verified against git 2.54, popping onto a
      // dirty file refuses outright ("local changes would be overwritten by
      // merge") rather than ever reaching a content merge, so a real UU
      // conflict only appears once HEAD has moved past the stash's base.
      await stashListFixture!.commit('Commit a conflicting edit while the stash is pending', {
        'README.md': '# fixture\ncommitted edit that conflicts with the stash\n'
      })

      await window.getByRole('button', { name: 'Keep this for later actions' }).click()
      await window.getByRole('menuitem', { name: 'Pop' }).click()
      await window.getByText('That left conflicts to resolve').waitFor({ state: 'visible' })
      await window.getByText('UU', { exact: true }).waitFor({ state: 'visible' })
      await shot('pop-conflict')
    }
  },
  {
    name: 'conflict-merge',
    description:
      'The Conflicts section (#53): the banner and both conflict rows mid-merge ' +
      '(a UU and an AA, from the same fixture #43 added), the list after ' +
      '"Mark resolved" clears one of them, and the section gone after Abort.',
    setup: async ({ workDir }) => {
      // The same steps `makeConflictFixture()` runs, but rooted at `workDir`
      // rather than a random tmpdir — a fixture path can end up on screen,
      // and `makeConflictFixture()`'s own tmpdir would change every run.
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      await fixture.commit('Add uu.txt', { 'uu.txt': 'base\n' })

      const worktreePath = await fixture.addWorktree('conflict', { branch: 'feature/conflict' })
      await fixture.commit('Feature edits uu.txt', { 'uu.txt': 'feature\n' }, worktreePath)
      await fixture.commit('Feature adds aa.txt', { 'aa.txt': 'feature\n' }, worktreePath)

      await fixture.commit('Main edits uu.txt', { 'uu.txt': 'main\n' })
      await fixture.commit('Main adds aa.txt', { 'aa.txt': 'main\n' })

      await fixture.git(['merge', 'main'], worktreePath).catch(() => {
        // A merge conflict exits non-zero; that is the point of this fixture.
      })

      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByRole('button', { name: /feature\/conflict/ }).click()
      await window.getByRole('tab', { name: 'Working Tree' }).click()
      await window.getByTestId('conflict-section').waitFor({ state: 'visible' })
      await window.getByTestId('conflict-files').getByText('AA', { exact: true }).waitFor()
      await shot('mid-merge')

      await window.getByRole('button', { name: 'aa.txt conflict actions' }).click()
      await window.getByRole('menuitem', { name: 'Mark resolved' }).click()
      await window.getByTestId('conflict-files').getByText('AA', { exact: true }).waitFor({
        state: 'detached'
      })
      await shot('one-resolved')

      await window.getByRole('button', { name: 'Abort' }).click()
      await window.getByTestId('conflict-section').waitFor({ state: 'detached' })
      await window.getByText('No changes.').waitFor({ state: 'visible' })
      await shot('aborted')
    }
  },
  {
    name: 'stash-selected-files',
    description:
      'The Changed Files header\'s "Stash…" menu (#69 review), scoped to ' +
      'whatever is checked: the menu offering to stash just the one staged ' +
      'file, and the working tree after — the staged file gone, the ' +
      'unstaged one untouched, exactly what `git stash push -- <pathspec>` ' +
      'promises.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      await writeFile(join(fixture.repoPath, 'staged.txt'), 'staged content\n', 'utf8')
      await writeFile(join(fixture.repoPath, 'README.md'), '# fixture\nunstaged edit\n', 'utf8')
      await fixture.git(['add', 'staged.txt'])
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByRole('tab', { name: 'Working Tree' }).click()
      await window.getByTestId('working-tree-files').waitFor({ state: 'visible' })
      await window
        .locator('[aria-label="staged.txt staging state"][data-state="checked"]')
        .waitFor({ state: 'visible' })
      await shot('before')

      await window.getByRole('button', { name: 'Changed files actions' }).click()
      await window.getByRole('menuitem', { name: 'Stash 1 selected file…' }).click()
      await shot('dialog')

      await window.getByRole('button', { name: 'Stash', exact: true }).click()
      await window.getByTestId('stash-list').waitFor({ state: 'visible' })
      await window.getByRole('button', { name: 'README.md', exact: true }).waitFor()
      await shot('after')
    }
  },
  {
    name: 'conflict-editor-default',
    description:
      'Project settings’ Presets tab: the per-project conflict-editor ' +
      'override (#53), showing what "Inherit" resolves to on a stock install, ' +
      'and the picker open over the other file-capable presets it offers.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByTestId('worktree-detail').waitFor({ state: 'visible' })
      await window.getByRole('button', { name: 'Project settings' }).click()
      await window.getByRole('tab', { name: 'Presets' }).click()
      await window.getByTestId('project-conflict-editor').waitFor({ state: 'visible' })
      await shot('current')

      await window.getByLabel('Conflict editor').click()
      await window.getByRole('listbox').waitFor({ state: 'visible' })
      await shot('picker')
    }
  }
]
