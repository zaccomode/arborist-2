import type { Page } from 'playwright'

export interface Scenario {
  /** File name stem: produces `<name>-dark.png` and `<name>-light.png`. */
  name: string
  /** What the capture is meant to show, for whoever reviews it. */
  description: string
  /**
   * Drives the app to the state worth capturing. Receives the Electron
   * window as a Playwright page, so the full locator API is available.
   * Omit it to capture the app as it opens.
   *
   * Anything awaited here must settle before the screenshot, so assert on
   * the end state rather than sleeping — `expect`-style waits like
   * `waitFor()` are what keep a capture from racing the UI it is showing.
   */
  drive?: (window: Page) => Promise<void>
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
    description: 'The two-pane shell as the app opens, with no project selected.'
  },
  {
    name: 'ping-result',
    description:
      'The M0 ping button after a round-trip to the main process. Proves a ' +
      'capture exercises real IPC, which is the whole reason for driving the ' +
      'Electron window rather than the renderer in a browser.',
    drive: async (window) => {
      await window.getByRole('button', { name: 'Ping main process' }).click()
      await window.getByTestId('ping-result').waitFor({ state: 'visible' })
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
