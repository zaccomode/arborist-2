# Arborist

A cross-platform (macOS + Windows) git worktree manager. Electron + React + TypeScript + Tailwind v4 + shadcn/ui.

This is v2, a ground-up rewrite of the Swift/SwiftUI original. Git operations run through the system git CLI, spawned from the main process.

## Project layout

```
src/
  shared/     types + pure functions only — imported by main AND renderer
  main/       Electron main process: IPC handlers, services (git, persistence, presets)
  preload/    typed, whitelisted bridge between renderer and main
  renderer/   React UI
tests/
  unit/       Vitest unit tests
  integration/  Vitest tests against real temp git repos (from M1)
  e2e/        Playwright _electron smoke tests
```

Import direction is enforced by ESLint: renderer never imports main/preload, main never imports renderer, and `src/shared` stays free of Electron and Node built-ins.

## Development

```bash
npm install
npm run dev
```

## Checks

```bash
npm run lint        # ESLint
npm run typecheck   # tsc for node + web configs
npm test            # Vitest unit tests
npm run test:e2e    # builds, then runs the Playwright smoke test
```

CI runs all four on macOS and Windows for every push and pull request.

## Building for distribution

```bash
npm run build:mac
npm run build:win
```

Packaging and signing are finalised in M3.
