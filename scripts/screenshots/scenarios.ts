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
      await window.getByTestId('project-detail').waitFor({ state: 'visible' })
      await shot('added')
    }
  },
  {
    name: 'remove-project',
    description:
      'The confirmation for removing a project, which says what it does and ' + 'does not touch.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByTestId('project-detail').waitFor({ state: 'visible' })
      await window.getByRole('button', { name: 'Project actions' }).click()
      await window.getByRole('menuitem', { name: 'Remove project…' }).click()
      await window.getByRole('alertdialog').waitFor({ state: 'visible' })
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

      await window.getByTestId('notes-editor').fill('Waiting on review before merging.')
      await shot('notes')

      await window.getByRole('button', { name: /feature\/prunable/ }).click()
      await window.getByTestId('prunable-banner').waitFor({ state: 'visible' })
      await shot('prunable')
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

      await window.getByRole('button', { name: 'New worktree' }).click()
      await window.getByLabel('Branch').fill('git checkout -b feature/ABC-123')
      await window.getByTestId('branch-existence').waitFor({ state: 'visible' })
      await shot('dialog')

      await window.getByRole('button', { name: 'Create' }).click()
      await window.getByTestId('worktree-detail').waitFor({ state: 'visible' })
      await shot('after')
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

      await window.getByRole('button', { name: 'Project actions' }).click()
      await window.getByRole('menuitem', { name: 'Project settings…' }).click()
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
      await window.getByTestId('project-detail').waitFor({ state: 'visible' })

      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Settings…' }).click()
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
      'automation script with its parsed preview, and the per-project preset ' +
      'overrides underneath.',
    setup: async ({ workDir }) => {
      const fixture = new GitFixture(workDir, 'Arborist')
      await fixture.init()
      return { ARBORIST_PICK_FOLDER: fixture.repoPath }
    },
    drive: async (window) => {
      await window.getByTestId('project-switcher').click()
      await window.getByRole('menuitem', { name: 'Add project…' }).click()
      await window.getByTestId('project-detail').waitFor({ state: 'visible' })
      await window.getByRole('button', { name: 'Project settings' }).click()
      await window.getByTestId('automation-script').fill('npm install\nnpm run build')
      await window.getByTestId('project-preset-overrides').waitFor({ state: 'visible' })
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
  }
]
