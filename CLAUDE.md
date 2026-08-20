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

**One exception, for blocked containers.** Some cloud containers deny `ui.shadcn.com`, where the CLI fetches its registry, and the failure reads as `Request was cancelled`. Confirm it is the network rather than the plumbing (`curl -sS -o /dev/null -w '%{http_code}' https://ui.shadcn.com/r/styles/new-york-v4/input.json` returns `000`), then take the CLI's own payload from the upstream source tree, which is served from a host that is usually reachable:

```bash
curl -sS "https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/registry/new-york-v4/ui/<component>.tsx" \
  | sed 's#@/registry/new-york-v4/ui/#@/components/ui/#g' \
  > src/renderer/src/components/ui/<component>.tsx
npx prettier --write src/renderer/src/components/ui/<component>.tsx
```

The result is what `shadcn add` writes, so a later `--overwrite` from a machine with access is a no-op. Install the component's npm dependencies by hand, since nothing reads the registry's dependency list — check its imports.

## Before opening a pull request

Every PR that touches behaviour or UI needs all four of these. Do them in order, before opening the PR, not after review asks for them.

**1. Cover the change with scenarios.** Add or update scenarios in `scripts/screenshots/scenarios.ts` for the UI this change _affects_, which is wider than the UI it edits: a change to a shared component affects every screen that renders one. Capture the states the change actually alters, including the ones that are easy to skip — empty, error, and loading states, and the state partway through a flow. If a change alters a before-and-after, capture both in a single scenario using `shot`.

**2. Unit test the logic.** Run `npm test`, and extend it: a PR that changes behaviour without touching `tests/` is a PR whose behaviour nobody has pinned down. Logic that can live in `src/shared` as a pure function is far cheaper to test there than through the UI, so prefer moving it.

**3. Check for visual regressions.** Regenerate every scenario and see what moved:

```bash
xvfb-run -a npm run screenshot
git status --short docs/screenshots
```

Then **open each changed PNG and look at it**. Git reports a binary blob changed, not what changed, so an unreviewed diff here is worth nothing. Every changed image must be either an intended result of this PR or a bug you then fix. An image you can't explain is a regression until proven otherwise — the traps below all produce a plausible-looking wrong image rather than an error, and a `bg-primary` button once came out mid-grey in both themes and read as a real styling bug.

Captures are deterministic within one environment: re-running a scenario unchanged reproduces byte-identical PNGs, which is what makes this check meaningful. **Across** environments they are not, because font rasterisation differs between macOS and Linux. The committed baselines are generated in the Linux cloud container, so regenerate them there too. Regenerating on macOS will diff every image at once, which is the signature of this problem rather than of a real regression.

**4. Put the screenshots in the PR body.** Embed the captures the change affects, before and after where there's a meaningful pair, so the visual can be reviewed without launching the app. This repository is private, so the only URL form that renders is the committed blob:

```markdown
![Shell, dark](https://github.com/zaccomode/arborist-2/blob/<sha>/docs/screenshots/shell-dark.png?raw=true)
```

Pin `<sha>` to a commit rather than the branch, so the images survive the branch being deleted after merge. `raw.githubusercontent.com` URLs and relative paths both fail here: the former serves private content only against a token the browser doesn't send, and the latter has no directory to resolve against in a PR body.

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

### Capturing several points in one flow

`drive` receives a second argument, `shot`, which captures the window as it currently stands. A before and an after belong in **one** scenario rather than two, since they share the setup that got the app there:

```ts
{
  name: 'create-worktree',
  description: 'The worktree list either side of creating one.',
  drive: async (window, shot) => {
    await shot('before')
    await window.getByRole('button', { name: 'New worktree' }).click()
    await window.getByLabel('Branch').fill('feature/thing')
    await shot('dialog-filled')
    await window.getByRole('button', { name: 'Create' }).click()
    await window.getByRole('listitem').filter({ hasText: 'feature/thing' }).waitFor()
    await shot('after')
  }
}
```

Each call writes `<scenario>-<step>-<theme>.png`, so the example produces six images. A scenario that never calls `shot` is captured once at the end, as `<scenario>-<theme>.png`. Reusing a step name within a scenario is an error rather than a silent overwrite.

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
