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

Screenshot the real Electron window. `npm run screenshot` builds, launches the app under Playwright's `_electron`, and writes `shell-dark.png` and `shell-light.png` to `docs/screenshots/` (pass a different directory as an argument). Compare the dark capture against `concept.png`.

On Linux, including cloud containers, prefix it with a virtual display:

```bash
xvfb-run -a npm run screenshot
```

This is the full app with preload and IPC, so it's the accurate reference. Prefer it over loading the renderer in a browser.

Two things the script handles that are easy to get wrong if you write your own capture:

- **Wait for the theme class, not just `emulateMedia`.** `main.tsx` mirrors `prefers-color-scheme` onto a `.dark` class from a change listener, so the class lands a tick after `emulateMedia` resolves.
- **Screenshot with `animations: 'disabled'`.** Buttons carry `transition-all`, so a theme swap animates their colours. Capturing mid-transition renders a blend of both themes — a `bg-primary` button came out mid-grey in both schemes, which reads as a styling bug that isn't there.

### Running the app in a container

`npm run dev` works, but needs both a virtual display and the sandbox disabled, because Electron refuses to run as root:

```bash
ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a npm run dev
```

Without `ELECTRON_DISABLE_SANDBOX` Electron aborts with `Running as root without --no-sandbox is not supported`, and because electron-vite supervises the Electron process, that takes the renderer server down with it. Expect GPU and IPv6 socket errors in the log; they're noise from the headless environment, not failures. `npm run test:e2e` needs the same `xvfb-run` prefix, but not the env var, since Playwright passes `--no-sandbox` itself.

Falling back to the renderer in a browser (electron-vite also serves it at http://localhost:5173) only verifies layout: there's no preload, so `window.arborist` is undefined and any IPC-backed interaction errors.

If port 5173 is busy, check for an orphaned process from a previous run (`lsof -nP -iTCP:5173 -sTCP:LISTEN`). Killing the electron-vite CLI does not always kill the Electron app it spawned — `pkill -f "arborist-2/node_modules/electron/dist"` cleans up the leftover app.
