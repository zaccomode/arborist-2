import { writeFile } from 'fs/promises'
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
 */
async function fillAndSettle(window: Page, testId: string, value: string): Promise<void> {
  await window.getByTestId(testId).fill(value)
  await window.waitForFunction(
    ({ testId, value }) =>
      (document.querySelector(`[data-testid="${testId}"]`) as HTMLTextAreaElement | null)?.value ===
      value,
    { testId, value }
  )
}

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
    name: 'worktree-detail',
    description:
      'The detail pane for a worktree that is ahead and behind, and for one ' +
      'whose folder has gone missing — the two ends of what the chips and ' +
      'the banner have to say.',
    setup: async ({ workDir }) => {
      const { fixture } = await makeBadgeMatrixIn(workDir, 'Arborist')
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()

      await window.getByRole('button', { name: /feature\/ahead-behind/ }).click()
      await window.getByTestId('worktree-detail').waitFor({ state: 'visible' })
      await shot('tracking')

      await fillAndSettle(window, 'notes-editor', 'Waiting on review before merging.')
      await shot('notes')

      await window.getByRole('button', { name: /feature\/prunable/ }).click()
      await window.getByTestId('prunable-banner').waitFor({ state: 'visible' })
      await shot('prunable')
    }
  },
  {
    name: 'recent-commits',
    description:
      'The Recent Commits panel: cards with the shortstat line, and load ' +
      'more revealing the page behind it.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      for (let i = 0; i < 25; i++) {
        await fixture.commit(`Change ${i}`, { [`file-${i}.txt`]: `${i}\n` })
      }
      // Long enough to wrap onto a second line rather than fit on one, so
      // the capture shows the subject wrapping rather than truncating.
      await fixture.commit(
        'Rework the badge matrix fixture so every worktree state the sidebar can show — ahead/behind, dirty, locked, missing, deleted upstream, detached — has its own row and its own fixture helper',
        { 'badge-matrix.txt': 'rework' }
      )
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window, shot) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByRole('button', { name: /main/ }).first().click()
      await window.getByTestId('recent-commits').waitFor({ state: 'visible' })
      await shot('list')

      await window.getByRole('button', { name: 'Load more' }).click()
      await window.getByRole('button', { name: 'Load more' }).waitFor({ state: 'detached' })
      await shot('loaded-more')
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
      await window.getByLabel('Branch').fill('git checkout -b feature/ABC-123')
      await window.getByTestId('branch-existence').waitFor({ state: 'visible' })
      await shot('dialog')

      await window.getByRole('button', { name: 'Create' }).click()
      await window.getByTestId('worktree-detail').waitFor({ state: 'visible' })
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
      await window.getByLabel('Branch').fill('some-topic')
      await window.getByTestId('branch-existence').waitFor({ state: 'visible' })
      await shot('closed')

      await window.getByRole('combobox').click()
      await window.getByRole('option').first().waitFor({ state: 'visible' })
      await shot('open')

      await window.getByPlaceholder('Search branches…').fill('release')
      await window.getByRole('option', { name: 'release/1.0' }).waitFor({ state: 'visible' })
      await shot('filtered')

      await window.getByRole('option', { name: 'release/1.0' }).click()
      await window.getByLabel('Branch').fill('feature-x')
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
      await window.getByTestId('worktree-detail').waitFor({ state: 'visible' })
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
      'and the Developer tab.',
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
    }
  },
  {
    name: 'project-settings',
    description:
      'Project settings, opened from the button under the worktree list: the ' +
      'automation script with its parsed preview, the per-project preset ' +
      'overrides, and the project note that used to live in the pane behind it.',
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
      await window.getByTestId('project-preset-overrides').waitFor({ state: 'visible' })
      await shot('automation')

      await fillAndSettle(window, 'notes-editor', 'Release branches: squash merges only.')
      await shot('notes')
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
  }
]
