# Arborist v2

Cross-platform (macOS + Windows) git worktree manager. Electron + React + TypeScript + Tailwind v4 + shadcn/ui. See README.md for layout and commands.

## Design reference

`concept.png` at the repo root is the authoritative UI concept (dark theme, two-pane layout: project switcher above the sidebar panel, worktree detail pane at right). Read it whenever making layout or styling decisions — the v2 plan's "UI reference" section describes the same screenshot in prose.

## Previewing UI changes visually

You can't screenshot the Electron window, but `npm run dev` (electron-vite) also serves the renderer over plain HTTP at http://localhost:5173, which an in-app/headless browser can load.

1. Start the dev server via the `dev` configuration in `.claude/launch.json` (e.g. Claude Code's `preview_start` with name `"dev"`). Don't run the server with raw shell commands if a preview tool is available.
2. Open http://localhost:5173 in the browser pane and screenshot it.
3. The reference design (`concept.png`) is dark — set the browser's color scheme to dark before screenshotting, since the app follows `prefers-color-scheme`. Compare your screenshot against `concept.png`.

Caveats:

- In a browser there is no preload, so `window.arborist` is undefined — any IPC-backed interaction (e.g. the ping button) will error. That's expected; only visuals can be verified this way. Anything needing real IPC has to go through the Playwright e2e tests (`npm run test:e2e`), which drive the actual Electron app.
- If port 5173 is busy, check for an orphaned `electron-vite dev` / Electron process from a previous run (`lsof -nP -iTCP:5173 -sTCP:LISTEN`) and kill it. Note that killing the electron-vite CLI does not always kill the Electron app it spawned — `pkill -f "arborist-2/node_modules/electron/dist"` cleans up the leftover app.
- If you start `npm run dev` in the background yourself, kill both the CLI and the Electron app when done, or the port stays held.
