# Screenshots

Captures of the real Electron window, for attaching to pull requests so UI changes can be reviewed without launching the app.

Regenerate them with `npm run screenshot`, or `xvfb-run -a npm run screenshot` on Linux. Each image comes from a scenario in `scripts/screenshots/scenarios.ts`; add one there to capture a state other than the opening screen. `CLAUDE.md` covers the workflow, including the checks a pull request needs before it goes up.

Every capture below is deterministic: a scenario builds its own fixture repository at a fixed path, with commits at fixed dates, so re-running one reproduces the same pixels. Across environments they are not, because font rasterisation differs between macOS and Linux — the committed images are generated in the Linux cloud container, so regenerate them there.

## The shell

| Scenario                                                                                       | Dark                            | Light                            |
| ---------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------- |
| `shell` — the two-pane shell as the app opens, with no project. Compare against `concept.png`. | ![](./shell-dark.png)           | ![](./shell-light.png)           |
| `worktree-badges` — the sidebar over the full badge matrix.                                    | ![](./worktree-badges-dark.png) | ![](./worktree-badges-light.png) |

## Projects

| Scenario                                      | Dark                              | Light                              |
| --------------------------------------------- | --------------------------------- | ---------------------------------- |
| `add-project` — the empty state               | ![](./add-project-empty-dark.png) | ![](./add-project-empty-light.png) |
| `add-project` — the switcher menu             | ![](./add-project-menu-dark.png)  | ![](./add-project-menu-light.png)  |
| `add-project` — the project view that follows | ![](./add-project-added-dark.png) | ![](./add-project-added-light.png) |
| `remove-project` — the confirmation           | ![](./remove-project-dark.png)    | ![](./remove-project-light.png)    |

## Worktrees

| Scenario                                              | Dark                                     | Light                                     |
| ----------------------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `worktree-detail` — ahead and behind its upstream     | ![](./worktree-detail-tracking-dark.png) | ![](./worktree-detail-tracking-light.png) |
| `worktree-detail` — with a note                       | ![](./worktree-detail-notes-dark.png)    | ![](./worktree-detail-notes-light.png)    |
| `worktree-detail` — folder missing                    | ![](./worktree-detail-prunable-dark.png) | ![](./worktree-detail-prunable-light.png) |
| `create-worktree` — before                            | ![](./create-worktree-before-dark.png)   | ![](./create-worktree-before-light.png)   |
| `create-worktree` — reading a pasted checkout command | ![](./create-worktree-dialog-dark.png)   | ![](./create-worktree-dialog-light.png)   |
| `create-worktree` — after                             | ![](./create-worktree-after-dark.png)    | ![](./create-worktree-after-light.png)    |
| `delete-worktree` — the first confirmation            | ![](./delete-worktree-confirm-dark.png)  | ![](./delete-worktree-confirm-light.png)  |
| `delete-worktree` — the force confirmation            | ![](./delete-worktree-force-dark.png)    | ![](./delete-worktree-force-light.png)    |

## Automation and settings

| Scenario                                         | Dark                                     | Light                                     |
| ------------------------------------------------ | ---------------------------------------- | ----------------------------------------- |
| `setup-automation` — the script editor           | ![](./setup-automation-editor-dark.png)  | ![](./setup-automation-editor-light.png)  |
| `setup-automation` — the console mid-run         | ![](./setup-automation-console-dark.png) | ![](./setup-automation-console-light.png) |
| `project-settings` — script and preset overrides | ![](./project-settings-dark.png)         | ![](./project-settings-light.png)         |
| `settings` — General                             | ![](./settings-general-dark.png)         | ![](./settings-general-light.png)         |
| `settings` — Presets                             | ![](./settings-presets-dark.png)         | ![](./settings-presets-light.png)         |

## Failure states

| Scenario                                              | Dark                          | Light                          |
| ----------------------------------------------------- | ----------------------------- | ------------------------------ |
| `git-not-found` — the blocking screen and manual path | ![](./git-not-found-dark.png) | ![](./git-not-found-light.png) |
| `store-corrupt` — the data file could not be read     | ![](./store-corrupt-dark.png) | ![](./store-corrupt-light.png) |

---

Relative paths like the ones above only resolve inside repository files. A pull request body is rendered outside any file's directory, so embedding one there needs an absolute `github.com/.../blob/<sha>/...?raw=true` URL. On a private repository that blob URL is the only form that renders, since `raw.githubusercontent.com` serves private content only against a token the browser doesn't send.
