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
 *
 * PNGs go to the gitignored .screenshots/ (or `--out`), never into git. What
 * is committed is docs/screenshots/manifest.json, every capture's SHA-256, so
 * `git diff docs/screenshots/manifest.json` is the regression check, and the
 * images themselves are served from the image host by that hash. The
 * key-screens table in docs/screenshots/README.md is regenerated from it.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as prettier from 'prettier'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
// Node's native type stripping resolves ESM imports literally, so this needs
// the real file extension rather than a bare specifier.
import { scenarios, type Scenario } from './screenshots/scenarios.ts'
import { MANIFEST_PATH, README_PATH, resolveOutDir } from './screenshots/output.ts'
import {
  captureFileName,
  mergeManifest,
  parseManifest,
  recordCapture,
  serializeManifest,
  renderKeyScreens,
  replaceKeyScreens,
  sha256Hex,
  type Manifest
} from './screenshots/manifest.ts'

const THEMES = ['dark', 'light'] as const

function parseArgs(argv: string[]): { outDir: string | undefined; names: string[] } {
  const names: string[] = []
  let outDir: string | undefined

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') {
      const value = argv[++i]
      if (value === undefined) throw new Error('--out needs a directory')
      outDir = value
    } else {
      names.push(argv[i])
    }
  }

  return { outDir, names }
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

/**
 * Two animation frames: enough for a DOM mutation just made — a class swap,
 * or the DOM update React queues from a click's `onCheckedChange` — to reach
 * layout and for any CSS transition it starts to actually be registered by
 * `getAnimations()`.
 *
 * Skipping this is what made the "wait for every CSSTransition to finish"
 * check below non-deterministic (#57): `Array.prototype.every` on an empty
 * array is vacuously true, so if `getAnimations()` is queried before a
 * just-triggered transition has started, the check reads "nothing running"
 * and resolves immediately — a frame or two before the transition (most
 * often a shadcn `Switch` thumb's `transition-transform`, which nothing
 * else here waits on specifically) actually begins, letting the screenshot
 * land mid-transition on an unpredictable run.
 */
async function settle(window: Page): Promise<void> {
  await window.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
  )
}

/**
 * Captures the window as it stands, once per theme, and records each PNG's
 * hash in `manifest`. `step` is `''` for a scenario that never calls `shot`.
 */
async function captureThemes(
  window: Page,
  scenario: Scenario,
  outDir: string,
  step: string,
  manifest: Manifest
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

    // Give any transition just triggered — by the theme swap above, or by
    // whatever the scenario's `drive` step did right before calling `shot`
    // — a couple of frames to actually start and be registered by
    // `getAnimations()` before checking whether one is running. See
    // `settle`'s own comment for why this is what #57 was missing.
    await settle(window)

    // Swapping the theme starts a colour transition on everything carrying
    // `transition-[color]` — a textarea's own text among them, which lands
    // near-invisible against the new background if it is caught halfway.
    // Animations are excluded: a spinner never finishes.
    await window.waitForFunction(() =>
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .every((animation) => animation.playState !== 'running')
    )

    const path = join(outDir, captureFileName(scenario.name, step, theme))
    // Buttons carry `transition-all`, so swapping the theme animates their
    // colours. Without this the capture lands mid-transition and renders a
    // blend of the two themes rather than either one.
    const png = await window.screenshot({ path, animations: 'disabled' })
    recordCapture(manifest, { scenario: scenario.name, step, theme, sha256: sha256Hex(png) })
    console.log(`wrote ${path}`)
  }
}

async function capture(scenario: Scenario, outDir: string, manifest: Manifest): Promise<void> {
  const userDataDir = await mkdtemp(join(tmpdir(), 'arborist-shot-'))
  // Deterministic, unlike the user-data dir, because whatever a scenario
  // builds here can end up on screen: a random temp path would change the
  // pixels on every run and make the whole comparison worthless.
  const workDir = join(tmpdir(), 'arborist-shot-work', scenario.name)
  await rm(workDir, { recursive: true, force: true })
  await mkdir(workDir, { recursive: true })
  // Off by default: a watcher makes a capture race a filesystem event, which
  // reads as a flaky styling bug rather than the timing issue it is. The one
  // scenario that means to show the watcher working opts back in by
  // returning `ARBORIST_DISABLE_WATCHER: '0'` from its own `setup`, which
  // overrides this default below.
  //
  // The dates pin any commit the app itself makes during a capture (a commit
  // from the staging panel, a stash), which inherits this environment. A
  // commit's hash covers its timestamp, so with the clock's date the short
  // sha on screen changed on every run. The fixtures pin their own commits'
  // dates the same way; this sits after those, so app commits stay newest.
  const env = {
    ARBORIST_DISABLE_WATCHER: '1',
    GIT_AUTHOR_DATE: '2026-01-05T12:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-05T12:00:00Z',
    ...(await scenario.setup?.({ userDataDir, workDir }))
  }
  const app = await launch(userDataDir, env)

  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    // Captures show end states, so CSS motion only adds risk, and it made a
    // handful of captures flip between two renderings a few anti-aliased
    // pixels apart. Chromium rasterises a layer that is being scaled (a
    // dialog or palette zooming in, say) at that intermediate scale, and
    // re-rasterises it at the final one lazily, after the animation ends.
    // Whether that has happened by the capture is a race, and nothing in
    // the DOM shows it: `getAnimations()` is already empty. With no CSS
    // animations or transitions, every layer is only ever rasterised at its
    // final scale and colour. The waits below stay as a backstop for
    // anything this can't reach, such as script-driven Web Animations.
    await window.addStyleTag({
      content: '*, *::before, *::after { animation: none !important; transition: none !important; }'
    })
    // The window is created with show: false and revealed on ready-to-show,
    // so capturing before that lands catches a blank frame.
    // `:not(script)` because the theme provider's no-flash script is the
    // first child of #root, and waiting on an invisible element never settles.
    await window.waitForSelector('#root > :not(script)')

    const steps = new Set<string>()
    const shot = async (step: string): Promise<void> => {
      // The manifest files a scenario's single, step-less capture under ''.
      if (!step) throw new Error(`Scenario "${scenario.name}" captured an empty step name`)
      if (steps.has(step)) {
        throw new Error(`Scenario "${scenario.name}" captured step "${step}" twice`)
      }
      steps.add(step)
      await captureThemes(window, scenario, outDir, step, manifest)
    }

    await scenario.drive?.(window, shot)

    // A scenario that captured its own steps has said where it wants images;
    // adding an unasked-for one at the end would just be a stray file.
    if (steps.size === 0) {
      await captureThemes(window, scenario, outDir, '', manifest)
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

  const dir = resolveOutDir(outDir)
  await mkdir(dir, { recursive: true })

  let manifest = await readManifest()
  // Electron apps get one instance at a time, so these can't overlap.
  for (const scenario of selected) {
    const fresh: Manifest = {}
    await capture(scenario, dir, fresh)
    // Written after every scenario, so a run that fails partway still records
    // the captures it did make.
    manifest = mergeManifest(
      manifest,
      fresh,
      scenarios.map((s) => s.name)
    )
    await writeManifest(manifest)
  }
}

async function readManifest(): Promise<Manifest> {
  try {
    return parseManifest(await readFile(MANIFEST_PATH, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

async function writeManifest(manifest: Manifest): Promise<void> {
  await writeFile(MANIFEST_PATH, serializeManifest(manifest))

  const keyScenarios = scenarios.flatMap((s) => (s.key ? [{ name: s.name, key: s.key }] : []))
  const readme = replaceKeyScreens(
    await readFile(README_PATH, 'utf8'),
    renderKeyScreens(manifest, keyScenarios, THEMES)
  )
  // Formatted the way `npm run format` would, so the two never fight over the
  // table's column padding.
  const options = await prettier.resolveConfig(README_PATH)
  await writeFile(README_PATH, await prettier.format(readme, { ...options, filepath: README_PATH }))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
