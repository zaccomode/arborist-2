# Screenshots

Captures of the real Electron window, for attaching to pull requests so UI changes can be reviewed without launching the app.

Regenerate them with `npm run screenshot`, or `xvfb-run -a npm run screenshot` on Linux. See the "Previewing UI changes visually" section of `CLAUDE.md`.

## Dark

![Arborist shell, dark](./shell-dark.png)

## Light

![Arborist shell, light](./shell-light.png)

Relative paths like the ones above only resolve inside repository files. A pull request body is rendered outside any file's directory, so embedding one there needs an absolute `github.com/.../blob/<sha>/...?raw=true` URL. On a private repository that blob URL is the only form that renders, since `raw.githubusercontent.com` serves private content only against a token the browser doesn't send.
