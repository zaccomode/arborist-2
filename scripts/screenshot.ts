/**
 * Captures PNGs of the real Electron window, for attaching to pull requests.
 *
 * Each scenario in `scripts/screenshots/scenarios.ts` drives the app to a
 * state and is captured in both themes. Add a scenario there rather than
 * editing this runner.
 *
 * Requires a prior `electron-vite build`; the `screenshot` npm script handles
 * it. On Linux, including cloud containers, this needs a virtual display:
 *
 *   xvfb-run -a npm run screenshot            # every scenario
 *   xvfb-run -a npm run screenshot -- shell   # just the named ones
 *   xvfb-run -a npm run screenshot -- --out /tmp/shots
 */
import { mkdir, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
// Node's native type stripping resolves ESM imports literally, so this needs
// the real file extension rather than a bare specifier.
import { scenarios, type Scenario } from './screenshots/scenarios.ts'

const THEMES = ['dark', 'light'] as const

function parseArgs(argv: string[]): { outDir: string; names: string[] } {
  const names: string[] = []
  let outDir = 'docs/screenshots'

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') {
      const value = argv[++i]
      if (value === undefined) throw new Error('--out needs a directory')
      outDir = value
    } else {
      names.push(argv[i])
    }
  }

  return { outDir: resolve(outDir), names }
}

async function launch(
  userDataDir: string,
  env: Record<string, string>
): Promise<ElectronApplication> {
  const args = [
    '.',
    // Keep each scenario off the real app's stored data, so captures can't
    // depend on whatever is already on the machine running them.
    `--user-data-dir=${userDataDir}`
  ]
  // Electron refuses to run as root, which is the default user in most
  // containers. Harmless elsewhere, since this only ever runs locally.
  if (process.getuid?.() === 0) args.push('--no-sandbox')

  return electron.launch({ args, env: { ...(process.env as Record<string, string>), ...env } })
}

/** Captures the window as it stands, once per theme, as `<stem>-<theme>.png`. */
async function captureThemes(
  window: Page,
  scenario: Scenario,
  outDir: string,
  stem: string
): Promise<void> {
  if (!scenario.keepPointer) {
    // Clicking leaves the pointer resting on whatever was clicked, so the
    // capture picks up its `hover:` styling. Park it out of the way unless
    // the scenario is deliberately showing a hover state.
    await window.mouse.move(0, 0)
  }

  for (const theme of THEMES) {
    await window.emulateMedia({ colorScheme: theme })

    // main.tsx mirrors the media query onto a `.dark` class, and it does so
    // from a change listener, so the class lands a tick after emulateMedia
    // resolves. Without this the capture shows the previous theme.
    await window.waitForFunction(
      (wantsDark) => document.documentElement.classList.contains('dark') === wantsDark,
      theme === 'dark'
    )

    const path = join(outDir, `${stem}-${theme}.png`)
    // Buttons carry `transition-all`, so swapping the theme animates their
    // colours. Without this the capture lands mid-transition and renders a
    // blend of the two themes rather than either one.
    await window.screenshot({ path, animations: 'disabled' })
    console.log(`wrote ${path}`)
  }
}

async function capture(scenario: Scenario, outDir: string): Promise<void> {
  const userDataDir = await mkdtemp(join(tmpdir(), 'arborist-shot-'))
  const workDir = await mkdtemp(join(tmpdir(), 'arborist-shot-work-'))
  const env = (await scenario.setup?.({ userDataDir, workDir })) ?? {}
  const app = await launch(userDataDir, env)

  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    // The window is created with show: false and revealed on ready-to-show,
    // so capturing before that lands catches a blank frame.
    await window.waitForSelector('#root > *')

    const steps = new Set<string>()
    const shot = async (step: string): Promise<void> => {
      if (steps.has(step)) {
        throw new Error(`Scenario "${scenario.name}" captured step "${step}" twice`)
      }
      steps.add(step)
      await captureThemes(window, scenario, outDir, `${scenario.name}-${step}`)
    }

    await scenario.drive?.(window, shot)

    // A scenario that captured its own steps has said where it wants images;
    // adding an unasked-for one at the end would just be a stray file.
    if (steps.size === 0) {
      await captureThemes(window, scenario, outDir, scenario.name)
    }
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workDir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    // Electron needs a display server. Without this the failure is an opaque
    // crash inside Electron rather than anything pointing at the cause.
    throw new Error(
      'No DISPLAY set. On Linux, run this under a virtual display:\n' +
        '  xvfb-run -a npm run screenshot'
    )
  }

  const { outDir, names } = parseArgs(process.argv.slice(2))

  const selected = names.length
    ? names.map((name) => {
        const match = scenarios.find((scenario) => scenario.name === name)
        if (!match) {
          throw new Error(
            `Unknown scenario "${name}". Available: ${scenarios.map((s) => s.name).join(', ')}`
          )
        }
        return match
      })
    : scenarios

  await mkdir(outDir, { recursive: true })

  // Electron apps get one instance at a time, so these can't overlap.
  for (const scenario of selected) {
    await capture(scenario, outDir)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
