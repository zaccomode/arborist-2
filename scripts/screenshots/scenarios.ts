import { writeFile } from 'fs/promises'
import { join } from 'path'
import type { Page } from 'playwright'

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
    name: 'ping',
    description:
      'The M0 ping button before and after a round-trip to the main process. ' +
      'Proves a capture exercises real IPC, which is the whole reason for ' +
      'driving the Electron window rather than the renderer in a browser.',
    drive: async (window, shot) => {
      await shot('before')
      await window.getByRole('button', { name: 'Ping main process' }).click()
      await window.getByTestId('ping-result').waitFor({ state: 'visible' })
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

  // Capturing a transient state, once M1 gives the switcher a real menu:
  //
  // {
  //   name: 'project-switcher-open',
  //   description: 'The project switcher menu, expanded.',
  //   drive: async (window) => {
  //     await window.getByRole('button', { name: 'No project' }).click()
  //     await window.getByRole('menu').waitFor({ state: 'visible' })
  //   }
  // }
]
