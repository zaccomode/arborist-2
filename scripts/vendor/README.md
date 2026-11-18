# Vendored tools

Third-party scripts that the project's own workflow runs, committed so they
are reviewed and pinned like any other code rather than fetched and run as
whatever a URL serves that day (#154).

| File      | What it is                                                                                     | Source                                       | SHA-256                                                            |
| --------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| `cdn.mjs` | The image host's CLI, run by `scripts/upload-screenshots.ts` to upload screenshot captures for PR bodies (see `CLAUDE.md`, step 4) | `https://media.isaacshea.com/cli/cdn.mjs` | `dc92f469ffddb37266ea2955859f90f6d3467035ff148f677eeb532872258476` |

Each file is byte-for-byte what the source served, so its hash can be checked
against the table, and it is excluded from Prettier and ESLint, which would
otherwise reformat it.

## Updating one

Bumping a vendored file is a reviewed pull request, never a step in another
change:

```bash
f=$(mktemp)
curl -fsSL https://media.isaacshea.com/cli/cdn.mjs -o "$f"
sha256sum "$f"
diff scripts/vendor/cdn.mjs "$f"   # read every line of this
```

Then copy it over `scripts/vendor/cdn.mjs`, update the hash above, and say in
the PR what changed and why it was taken.
