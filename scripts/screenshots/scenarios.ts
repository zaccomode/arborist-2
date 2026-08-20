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
