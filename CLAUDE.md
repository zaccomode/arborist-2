# Arborist v2

Cross-platform (macOS + Windows) git worktree manager. Electron + React + TypeScript + Tailwind v4 + shadcn/ui. See README.md for layout and commands.

## UI components: always use the shadcn CLI

Never hand-write components that shadcn provides. `src/renderer/src/components/ui/` is owned by the CLI:

```bash
npx shadcn@latest add <component> --overwrite --yes
```

Then run `npx prettier --write` on the generated files (the CLI emits its own style). ESLint rules the generated code doesn't satisfy are already relaxed for that directory in `eslint.config.mjs` — relax rules there rather than editing generated files, or `--overwrite` will reintroduce the problem.

Plumbing that makes the CLI work here (don't break it):

- `components.json` at the root is hand-authored because `shadcn init` can't detect electron-vite's split config.
- The root `tsconfig.json` carries `baseUrl`/`paths` purely so the CLI can resolve the `@/` alias — it compiles nothing (`files: []`). Keep its paths in sync with `tsconfig.web.json`. **Symptom of breakage:** the CLI reports success but writes into a literal `./@/` directory at the repo root.

If the CLI misbehaves, diagnose and fix the plumbing — don't fall back to hand-copying component source.

## Design reference

`concept.png` at the repo root is the authoritative UI concept (dark theme, two-pane layout: project switcher above the sidebar panel, worktree detail pane at right). Read it whenever making layout or styling decisions — the v2 plan's "UI reference" section describes the same screenshot in prose.

## Previewing UI changes visually

Screenshot the real Electron window. `npm run screenshot` builds, launches the app under Playwright's `_electron`, and writes a dark and a light PNG per scenario into `docs/screenshots/`. Compare the dark captures against `concept.png`.

On Linux, including cloud containers, prefix it with a virtual display:

```bash
xvfb-run -a npm run screenshot                  # every scenario
xvfb-run -a npm run screenshot -- shell         # just the named ones
xvfb-run -a npm run screenshot -- --out /tmp/x  # somewhere other than docs/
```

This is the full app with preload and IPC, so it's the accurate reference. Prefer it over loading the renderer in a browser.

### Capturing a state other than the opening screen

Add a scenario to `scripts/screenshots/scenarios.ts` rather than editing the runner. A scenario names the output and optionally supplies `drive`, which receives the Electron window as a Playwright page, so anything the e2e tests can do — click, type, hover, drag — is available:

```ts
{
  name: 'project-switcher-open',
  description: 'The project switcher menu, expanded.',
  drive: async (window) => {
    await window.getByRole('button', { name: 'No project' }).click()
    await window.getByRole('menu').waitFor({ state: 'visible' })
  }
}
```

Wait on the end state, as above, rather than sleeping: a capture that races the UI it is showing fails intermittently and is easy to mistake for a styling bug. Each scenario gets its own Electron launch and a throwaway `--user-data-dir`, so captures can't leak state into each other or depend on whatever is already stored on the machine.

Four things the runner handles that are easy to get wrong in a hand-rolled capture. All four produce a plausible-looking wrong image rather than an error, which is the dangerous kind:

- **Wait for the theme class, not just `emulateMedia`.** `main.tsx` mirrors `prefers-color-scheme` onto a `.dark` class from a change listener, so the class lands a tick after `emulateMedia` resolves.
- **Screenshot with `animations: 'disabled'`.** Buttons carry `transition-all`, so a theme swap animates their colours. Capturing mid-transition renders a blend of both themes — a `bg-primary` button came out mid-grey in both schemes, which reads as a styling bug that isn't there.
- **Park the pointer after clicking.** It otherwise rests on whatever was clicked and the capture picks up its `hover:` styling: the ping button measured RGB 209 hovered against 229 at rest. Set `keepPointer` on the scenario to capture a hover state deliberately.
- **Wait for `#root > *`.** The window is created with `show: false` and revealed on `ready-to-show`, so capturing earlier catches a blank frame.

### Running the app in a container

`npm run dev` works, but needs both a virtual display and the sandbox disabled, because Electron refuses to run as root:

```bash
ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a npm run dev
```

Without `ELECTRON_DISABLE_SANDBOX` Electron aborts with `Running as root without --no-sandbox is not supported`, and because electron-vite supervises the Electron process, that takes the renderer server down with it. Expect GPU and IPv6 socket errors in the log; they're noise from the headless environment, not failures. `npm run test:e2e` needs the same `xvfb-run` prefix, but not the env var, since Playwright passes `--no-sandbox` itself.

Falling back to the renderer in a browser (electron-vite also serves it at http://localhost:5173) only verifies layout: there's no preload, so `window.arborist` is undefined and any IPC-backed interaction errors.

If port 5173 is busy, check for an orphaned process from a previous run (`lsof -nP -iTCP:5173 -sTCP:LISTEN`). Killing the electron-vite CLI does not always kill the Electron app it spawned — `pkill -f "arborist-2/node_modules/electron/dist"` cleans up the leftover app.
