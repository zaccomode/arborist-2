/**
 * Captures PNGs of the real Electron window, for attaching to pull requests.
 *
 * Requires a prior `electron-vite build`; the `screenshot` npm script handles
 * it. On Linux CI and cloud containers this needs a virtual display, which the
 * npm script supplies via `xvfb-run`.
 *
 * Usage: npm run screenshot -- [outDir]
 */
import { mkdir } from 'fs/promises'
import { resolve } from 'path'
import { _electron as electron } from 'playwright'

const outDir = resolve(process.argv[2] ?? 'docs/screenshots')

// Electron refuses to run as root without this, which is the default user in
// most containers. Harmless elsewhere, since this only ever runs locally.
const args = process.getuid?.() === 0 ? ['.', '--no-sandbox'] : ['.']

async function main(): Promise<void> {
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    // Electron needs a display server. Without this the failure is an opaque
    // crash inside Electron rather than anything pointing at the cause.
    throw new Error(
      'No DISPLAY set. On Linux, run this under a virtual display:\n' +
        '  xvfb-run -a npm run screenshot'
    )
  }

  await mkdir(outDir, { recursive: true })

  const app = await electron.launch({ args })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  // The window is created with show: false and revealed on ready-to-show, so
  // screenshotting before that lands captures a blank frame.
  await window.waitForSelector('#root > *')

  for (const scheme of ['dark', 'light'] as const) {
    await window.emulateMedia({ colorScheme: scheme })

    // main.tsx mirrors the media query onto a `.dark` class, and it does so from
    // a change listener, so the class lands a tick after emulateMedia resolves.
    // Screenshotting without waiting for it captures a half-themed frame.
    await window.waitForFunction(
      (wantsDark) => document.documentElement.classList.contains('dark') === wantsDark,
      scheme === 'dark'
    )

    const path = resolve(outDir, `shell-${scheme}.png`)
    // Buttons carry `transition-all`, so swapping the theme animates their
    // colours. Without this the capture lands mid-transition and the button
    // renders a blend of the two themes rather than either one.
    await window.screenshot({ path, animations: 'disabled' })
    console.log(`wrote ${path}`)
  }

  await app.close()
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
