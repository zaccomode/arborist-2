# Arborist 3 — implementation plan

The programme overview for v3. Each of the ten phases below is also a `v3`-labelled
issue; see [Phasing](#phasing) for the table. Branch from `v3`, and open pull requests
back into `v3`.

## Context

Arborist v2 manages git worktrees: it lists them, shows what state each is in, creates and
removes them, and opens them elsewhere. Everything past that point — seeing what changed,
staging it, committing it — still means switching to a terminal or a second app.

v3 closes that gap. It keeps v2's architecture and extends it into a tool that handles the
whole ordinary git workload in one place: a working tree you can read and stage and commit,
diffs in a third panel, a commit graph worth opening, branch switching, and a worktree
location you can configure rather than accept. Merge conflicts are the deliberate exception
and hand off to the user's editor.

This is an extension, not a rewrite. Every layer v2 established — the `GitRunner` seam, the
two-entry IPC contract, the pure-parsers-in-`porcelain.ts` rule, the tri-state inheritance
pattern, the ban on stderr matching as control flow — stays, and the plan is largely an
account of how each new feature fits inside them.

### Decisions already taken

- **Staging is file-level and hunk-level.** A checkbox per file, plus per-hunk staging in the
  diff panel. Line-level selection is out of scope.
- **Diffs are hand-rolled with no syntax highlighting.** A pure parser in `src/shared`,
  rendered as styled rows. No new rendering dependency.
- **Freshness comes from a file watcher in main**, debounced, pushing an IPC event.
- **Worktree location is two modes plus a directory picker** — beside the repository (today's
  behaviour) or under a central directory — set app-wide and overridden per project.

### Three findings that shape the plan

Each was verified by running git 2.54 in a scratch repo rather than recalled.

**A diff round-tripped through a JavaScript string is not a valid patch.** For a file that
isn't valid UTF-8, decoding and re-encoding changed 139 bytes into 141, and `git apply
--cached --check` rejected the result with exit 1 while accepting the raw bytes with exit 0.
`execGitAt` hard-codes `encoding: 'utf8'` and offers no stdin, so hunk staging cannot be built
on it as it stands. This is why Phase 1 exists and why it comes first.

The saving grace is that UTF-8 decoding never invents or removes a newline — `0x0A` cannot
occur inside a multi-byte sequence, and invalid bytes each become one U+FFFD. The raw buffer
and the decoded string had 9 newlines apiece. So one parser can run over the decoded text and
record line _indices_, and main can slice the original buffer by those indices to get bytes.
No second implementation.

**In a linked worktree the index is not under the worktree at all.** `.git` is a file reading
`gitdir: …/proj/.git/worktrees/feat`, and `git rev-parse --git-path index` resolves to
`…/proj/.git/worktrees/feat/index`. A watcher on `<worktree>/.git/index` works for the main
worktree and silently never fires for any other — exactly the case Arborist exists to serve.

**`git worktree add` creates missing intermediate directories.** `git worktree add -b feat
/tmp/x/deep/a/b/feat` created all of `deep/a/b`. So the central-directory mode needs no
`mkdir` and the app's property of never creating directories survives intact.

---

## Phasing

Ten phases, one reviewable PR each, in dependency order. Every PR carries the four things
`CLAUDE.md` requires — scenarios, unit tests, regenerated screenshots reviewed by eye in the
Linux container, and those screenshots embedded in the PR body pinned to a commit sha.

Each phase is tracked as its own issue, labelled `v3`. The issue is the executable
version of the phase below — self-contained, so an agent can work from it without this
document — and this document is the programme they hang off.

| #   | Ships                                                           | Issue                                                    | Depends on    |
| --- | --------------------------------------------------------------- | -------------------------------------------------------- | ------------- |
| 1   | Git plumbing: buffer/stdin exec, status v2 parser, domain types | [#43](https://github.com/zaccomode/arborist-2/issues/43) | —             |
| 2   | Worktree location settings + the per-project settings record    | [#44](https://github.com/zaccomode/arborist-2/issues/44) | —             |
| 3   | Three tabs; Overview rebuilt; Changed Files read-only           | [#45](https://github.com/zaccomode/arborist-2/issues/45) | #43           |
| 4   | Third panel + diff parser, read-only                            | [#46](https://github.com/zaccomode/arborist-2/issues/46) | #43, #45      |
| 5   | Staging, discard, commit, push                                  | [#48](https://github.com/zaccomode/arborist-2/issues/48) | #45, #46      |
| 6   | Hunk staging                                                    | [#49](https://github.com/zaccomode/arborist-2/issues/49) | #46, #48      |
| 7   | File watcher                                                    | [#50](https://github.com/zaccomode/arborist-2/issues/50) | #48           |
| 8   | Branch switching + stash                                        | [#51](https://github.com/zaccomode/arborist-2/issues/51) | #43, #45      |
| 9   | Commit graph                                                    | [#52](https://github.com/zaccomode/arborist-2/issues/52) | #45, #46      |
| 10  | Conflict handoff                                                | [#53](https://github.com/zaccomode/arborist-2/issues/53) | #43, #45, #48 |

Work branches from `v3` and pull requests go back into `v3`, not `main`.

Phases 1 and 2 are independent of each other and of everything else, so they can go in
parallel. Phase 2 early matters because it establishes the per-project settings storage that
Phase 10 also needs, which keeps the schema at one migration rather than two.

---

## Phase 1 — Git plumbing

No UI, no screenshot diffs. Say so in the PR body so the reviewer isn't hunting for images.

### `execGitAt` gains stdin and a buffer mode

`src/main/services/git/git-executor.ts`. Keep the string path as the default so nothing in
`git-service.ts` needs touching:

```ts
export interface ExecGitOptions {
  repoPath?: string
  timeoutMs?: number
  signal?: AbortSignal
  /** Written to the child's stdin, then closed. */
  input?: string | Buffer
  /** 'utf8' (default) fills stdout/stderr; 'buffer' additionally fills stdoutBuffer. */
  encoding?: 'utf8' | 'buffer'
}
```

`GitRunner` (`git-runner.ts` — the seam every git call passes through) forwards both and gains
`runRaw()` whose result has a non-optional `stdoutBuffer`.

**Close stdin immediately when `input` is undefined.** Otherwise a command that reads stdin —
`git apply` with no file argument does — hangs until `DEFAULT_TIMEOUT_MS` with no signal that
anything is wrong.

### `parseStatusV2` beside `parseStatus`

New function in `src/main/services/git/porcelain.ts`. **`parseStatus` stays exactly as it is**,
and so do its tests — every sidebar badge is downstream of it.

Invocation: `git status --porcelain=v2 -z --branch --untracked-files=all`. `-z` is mandatory,
not an optimisation: without it git C-quotes paths containing spaces. `-uall` is for the
selected worktree's Working Tree tab only; the refresh pipeline keeps v1 at `-unormal`, since
it only needs counts and `-uall` on a large untracked tree is expensive.

**The field-count subtlety.** A `2` (rename/copy) record is NUL-terminated after the _new_
path, and the original path is a **separate NUL-terminated field that follows it**. Verified:

```
2 RM N... 100644 100644 100644 814f4a42… 814f4a42… R100 renamed file.txt<NUL>a file.txt<NUL>
```

Split the whole stdout on `\0` and walk it with an index cursor — a record beginning `2 `
consumes the next element too, everything else consumes one. A naive
`.split('\0').filter(Boolean).map(parse)` emits `a file.txt` as its own bogus record, and the
bug is silent because the string looks exactly like a path.

An `AA` record's stage-1 mode is `000000` with an all-zero hash, so the parser must not assume
all three stages exist.

Record layouts: `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>`; `2` as above with
`<R|C><score>` before the path; `u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>`;
`? <path>` and `! <path>`.

### Domain types

In `src/shared/domain.ts`, beside the existing `WorkingTreeStatus`:

```ts
export type ChangeCode = '.' | 'M' | 'T' | 'A' | 'D' | 'R' | 'C'
export type UnmergedCode = 'DD' | 'AU' | 'UD' | 'UA' | 'DU' | 'AA' | 'UU'
export type ChangedFileKind = 'tracked' | 'untracked' | 'ignored' | 'unmerged'

export interface ChangedFile {
  /** Repo-relative, POSIX separators, exactly as git printed it. The identity, everywhere. */
  path: string
  kind: ChangedFileKind
  index: ChangeCode
  worktree: ChangeCode
  origPath: string | null
  score: number | null
  conflict: UnmergedCode | null
  submodule: { commitChanged: boolean; modifiedTracked: boolean; untracked: boolean } | null
}

export interface StatusBranch {
  oid: string | null // null at '(initial)'
  head: string | null // null when '(detached)'
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
}

export interface WorkingTreeChanges {
  branch: StatusBranch
  files: ChangedFile[]
}
```

**State the path-keying rule in the file header.** The repo-relative POSIX path is the identity
used in the DTO, the query key, the IPC argument, and the Zustand selection.
`normaliseGitPath` from `src/shared/paths.ts` applies only when a path is joined onto the
worktree path to build an absolute one for display or the shell. Mixing the two is the problem
`samePath` already exists to clean up one level higher; don't recreate it.

Also add `countsFromV2(changes): WorkingTreeStatus`, a pure roll-up producing the shape
`parseStatus` returns, and test it for **parity** against `parseStatus` over the
`makeBadgeMatrix` fixture. That parity test is what will one day let the refresh pipeline
collapse to a single status call. Don't make that switch in this PR.

### Files and tests

Modified: `git-executor.ts`, `git-runner.ts`, `porcelain.ts`, `src/shared/domain.ts`.
New: `tests/unit/porcelain-v2.test.ts` — fixtures for the rename two-field case, `AA` with a
missing stage 1, a submodule `S.M.`, and `(initial)` / `(detached)` heads.
`tests/integration/status-v2.test.ts` — a new `makeConflictFixture()` in
`tests/integration/fixtures/git-fixture.ts` producing `UU` and `AA`, plus a rename-with-space
fixture and **a CRLF fixture** (see the Windows note in Phase 4).

Check `tests/unit/git-executor.test.ts` — its five cases don't currently assert the options
object, so they should survive, but confirm rather than assume.

---

## Phase 2 — Worktree location, and the per-project settings record

### Schema, `SCHEMA_VERSION` 3 → 4

In `src/shared/persisted.ts`:

```ts
// settingsSchema gains:
worktreeLocation: z.enum(['beside', 'central']).default('beside'),
worktreeRoot: z.string().nullable().default(null),
conflictEditorPresetId: z.string().nullable().default(null),   // Phase 10 uses it

// New top-level record — this does not exist today:
export const projectSettingsSchema = z.object({
  /** Absent means inherit. Never a boolean. */
  worktreeLocation: z.enum(['beside', 'central']).optional(),
  worktreeRoot: z.string().nullable().optional(),
  conflictEditorPresetId: z.string().nullable().optional()
})

// persistedDataSchema gains:
projectSettings: z.record(z.string(), projectSettingsSchema).default({}),
/** `<repository id>::<worktree path>` → draft. Phase 5 uses it. */
commitDrafts: z.record(z.string(), z.string()).default({})
```

Keyed by project id, a sibling of `notes` / `worktreeNotes` / `automationScripts` — the shape
every other per-project thing in the file already has. Don't hang it off `repositorySchema`;
`repositories` is an array, and a record keyed by id is the established idiom.

**The tri-state applies with full force.** `worktreeLocation` is `'beside' | 'central' |
absent`. A boolean `useCentralDirectory` would reproduce precisely the `disabledIds` mistake
that migration 2→3 exists to fix — a boolean cannot express "inherit".

Migration `3: (data) => data` in `src/main/services/persistence/migrations.ts`. It does
nothing, because zod's defaults fill the new fields, but `migrate()` throws on a missing step
so it must exist. Its comment should say exactly that.

Declaring `commitDrafts` and `conflictEditorPresetId` now, ahead of the phases that use them,
keeps this to one migration.

### The resolver

New pure module `src/shared/worktree-location.ts`, modelled on `enabledFor` in
`src/shared/presets.ts`:

```ts
export function resolveWorktreeLocation(
  app,
  project
): { mode: 'beside' | 'central'; root: string | null }

export function worktreeBasePath(input: {
  location: ResolvedLocation
  repoPath: string
  repoName: string
  branch: string
  platform: NodeJS.Platform // a parameter, so win32 is testable from a Mac
}): string
```

`central` → `<root>/<repoName>/<sanitizeForFolder(branch)>`. `beside` → `<parent of
repoPath>/<sanitizeForFolder(branch)>`, byte-identical to today. `sanitizeForFolder` already
exists in `src/shared/branch-name.ts` and already strips Windows-invalid characters on both
platforms.

`src/shared` may not import `path`, so add `joinPath(platform, ...parts)` and
`parentPath(platform, p)` to `src/shared/paths.ts` — that file exists precisely to hold pure
platform-aware string work, beside `normaliseGitPath`.

### `suggestWorktreePath`

`src/main/services/git/git-service.ts:137` hard-codes `dirname(repoPath)` and owns the dedup
loop. Split it: `worktreeBasePath` computes the candidate, the service keeps only the
`stat`-based `-2`, `-3` suffix loop. Signature becomes `suggestWorktreePath(repoPath, branch,
location, repoName)`.

The IPC channel becomes `'worktrees:suggestPath': { args: [repoPath, branch, projectId] }` —
main resolves the location from the store using the existing `() => store!.data.settings`
idiom, so the renderer never carries a copy. Add `'projectSettings:get'` and
`'projectSettings:set'`, each needing **both** the `IpcInvokeContract` entry and the `CHANNELS`
record entry in `src/shared/ipc-contract.ts`.

### Directory handling

`git worktree add` creates intermediate directories (verified), so nothing needs `mkdir`. Two
pre-checks, both `stat`-based rather than stderr-based:

- **Root missing at creation time** — removed volume, deleted folder. One `fs.stat` before
  `worktree add`, erroring `'worktree-root-missing'` with the path.
- **Root inside a registered project** would be a disaster. Compare with the existing
  `normaliseForCompare` against every project path and refuse in the settings UI at pick time,
  not at create time.

`system:pickFolder` already passes `createDirectory: true`, so a user making the root does it
in the picker.

### UI

`src/renderer/src/components/settings/general-settings.tsx` — a `Select` for the mode, a
"Choose…" button wired to `system:pickFolder`, and the resolved path shown read-only beneath.

`src/renderer/src/components/project-settings-dialog.tsx` — the same control with an extra
option, following the convention in `settings/project-preset-overrides.tsx` where **the inherit
option shows what it resolves to**: `<SelectItem value="inherit">Inherit (Beside the
repository)</SelectItem>`.

### Breakage

`tests/integration/create-worktree.test.ts` (4 calls) and
`tests/integration/remote-branches.test.ts` (1) call `suggestWorktreePath` directly and need
the new argument. `tests/unit/store.test.ts:68` uses the real migration registry and its
expectation changes; line 209 injects its own and survives.

### Scenarios

`settings-worktree-location` (both modes, with a picked directory); extend `project-settings`
with the inherit row showing both resolutions; extend `create-worktree` with a project in
`central` mode so the suggested path visibly differs.

---

## Phase 3 — Three tabs

`src/renderer/src/components/worktree-detail.tsx` (144 lines, currently one scrolling column)
becomes a fixed header plus `Tabs`. The header keeps the icon, title, click-to-copy path,
refresh, actions dropdown, and chip row — the concept shows all of them above the tab strip.

- **Overview** — `<OpenInGrid>`, an Information block (Branch / Commit / Path), then
  `<NotesEditor>`. `<RecentCommits>` leaves this tab. The Information block is a `<dl>` with
  grid classes, **not** shadcn `table`: three label/value rows don't justify the primitive, and
  it isn't installed.
- **Working Tree** — new `working-tree-tab.tsx` rendering rows from a new
  `useWorkingTree(worktreePath)` query. Read-only this phase: filename, dim directory, status
  letter badge.
- **Commit Graph** — `<RecentCommits>` moved verbatim. Phase 9 rebuilds it.

### The decision this phase forces

The concept's Working Tree has **one list and one checkbox column**, with no staged/unstaged
split. That's a real design choice and a good one, but it leaves "what does checked mean?"
undefined, and it's the most underspecified thing in the spec. Settle it here, before any
staging code exists:

> **Checked means "will be in the next commit."** Checking stages (`git add`), unchecking
> unstages (`git restore --staged`). The state is read from the `1`/`2` record's `X` code. A
> file with both staged and unstaged changes (`MM`) is one row with an **indeterminate**
> checkbox, and checking it stages the rest.

That indeterminate state is why this needs shadcn `checkbox` rather than the installed
`switch`, and it's why Phase 5's commit button must count **files with staged content read from
the index**, not checked rows — a hunk-staged file contributes one file, not the whole thing.

### Also

Extend `src/renderer/src/state/selection.ts` with `tabByWorktree: Record<string, 'overview' |
'working-tree' | 'commit-graph'>` keyed `${projectId}::${worktreePath}`, mirroring
`worktreeNoteKey`. Remembering the tab per worktree is what makes flipping between two
worktrees feel right.

Add `checkbox` via the CLI now, even though it renders disabled this phase — landing the
component with the layout keeps Phase 5's diff about behaviour.

### Risks

`tests/e2e/smoke.spec.ts` reaches `getByTestId('notes-editor')` after selecting a worktree.
Overview is the default tab so it should still be visible, but a `Tabs` content panel is
unmounted rather than hidden when inactive — verify rather than assume.

### Scenarios

Rewrite `worktree-detail` as a multi-`shot` scenario: `overview`, `working-tree` (against the
badge matrix's dirty worktree so rows exist), `working-tree-clean`, `commit-graph`. Update
`recent-commits` and `setup-automation`, which now need a tab click to reach their content.
`remote-branches` is unaffected — `RemoteBranchDetail` uses `RecentCommits` directly.

---

## Phase 4 — Third panel and the diff parser

### Extract the shell first

`src/renderer/src/App.tsx` owns the panel group, both panes, and all five dialogs. Extract
`src/renderer/src/components/shell.tsx` holding the panel group and the three panes, leaving
App with dialogs and data wiring. Do it now, or Phases 5–10 all pile into one file. Keep the
extraction behaviourally inert so `shell-*.png` and `worktree-detail-*.png` come out identical
apart from the intended panel.

### The panel

`react-resizable-panels@4`, sizes in pixels:

```tsx
<ResizablePanelGroup orientation="horizontal">
  <ResizablePanel id="sidebar" defaultSize={260} minSize={200} maxSize={420}>
    …
  </ResizablePanel>
  <ResizableHandle className="mx-1 bg-transparent" />
  <ResizablePanel id="detail" minSize={360}>
    …
  </ResizablePanel>
  {inspector && (
    <>
      <ResizableHandle className="mx-1 bg-transparent" withHandle />
      <ResizablePanel id="inspector" defaultSize={520} minSize={320}>
        …
      </ResizablePanel>
    </>
  )}
</ResizablePanelGroup>
```

Explicit `id` on all three: v4 identifies panels by id, and one that mounts and unmounts must
be identifiable. **`minSize={360}` on the middle panel is not optional** — without it, opening
a 520px inspector in the default 1100px window squeezes the detail pane to nothing. `withHandle`
is the grip variant already present and unused in `ui/resizable.tsx`; this is the boundary
users actually drag.

Panel sizes still aren't persisted — v4 has no `autoSaveId`, only `defaultLayout` plus
`onLayoutChanged`. Persisting them into `projectSettings` is a deliberate follow-up.

### Inspector state

In `selection.ts`, not a new Context — that store already owns "these are mutually exclusive,
remembered per selection":

```ts
type Inspector =
  { kind: 'file'; path: string; side: 'unstaged' | 'staged' } | { kind: 'commit'; hash: string }
inspectorByWorktree: Record<string, Inspector> // `${projectId}::${worktreePath}`
```

Dismissed by the X in the header, by `Escape` while focus is inside, when the worktree changes
to one with no remembered inspector, and automatically when the inspected file leaves the
changes list. Opening an inspector **sets** the tab; switching the tab **leaves the inspector
alone** — closing it on a tab switch destroys reading-in-progress for a momentary consistency
that isn't worth it.

### Which git call produces which diff

One flag preamble everywhere, to neutralise the user's own config:

```
-c diff.noprefix=false -c diff.mnemonicPrefix=false
diff --no-ext-diff --no-color --no-textconv -U3 --src-prefix=a/ --dst-prefix=b/ -M
```

`--no-textconv` isn't paranoia: a textconv filter produces a diff that cannot be applied back.
`diff.noprefix` and `mnemonicPrefix` are common in dotfiles and both break `-p1`.

| Case                  | Invocation                                                                              |
| --------------------- | --------------------------------------------------------------------------------------- |
| unstaged, tracked     | `diff <preamble> -- <origPath?> <path>`                                                 |
| staged                | `diff --cached <preamble> -- <origPath?> <path>`                                        |
| untracked             | no git call — see below                                                                 |
| a commit's file list  | `show --format= --numstat -z --diff-merges=first-parent -M <sha>`                       |
| a commit's file patch | `show --format= --diff-merges=first-parent -M <preamble> <sha> -- <origPath?> <path>`   |
| unmerged (`u`)        | none — `git diff` gives a combined `--cc` diff. Phase 10 shows a conflict card instead. |

**Renames need both paths passed.** Filtering a rename by one path reports it as a new file
with the whole content added, silently destroying rename detection. Pass `-- <oldPath>
<newPath>`.

**Merge commits need `--diff-merges=first-parent` explicitly**, since `git show` of a merge
defaults to a combined diff whose behaviour varies by version. Root commits need no special
casing.

**Untracked files: don't call git.** `diff --no-index -- /dev/null <f>` exits 1 for "differences
found", which fights `runOrThrow`, and `/dev/null` is platform-dependent on Windows. Instead
read the file as a Buffer in main, NUL-sniff the first 8000 bytes for binary, and synthesize a
`new file` diff with a pure `syntheticNewFileDiff()` in shared.

### The parser

`src/shared/diff.ts`, pure, exporting `parseUnifiedDiff(text): FileDiff[]` over types
`DiffLine` / `DiffHunk` / `FileDiff`. Cases it must cover:

- `diff --git a/x b/x` followed by any of `old mode`/`new mode` (a mode-only change produces
  **no** `---`/`+++` and no hunks), `new file mode`, `deleted file mode`, `similarity index N%`
  with `rename from`/`rename to`, and `index <a>..<b> <mode>`.
- `--- /dev/null` and `+++ /dev/null` for add and delete.
- `@@ -a,b +c,d @@ heading` where **`b` and `d` default to 1 when omitted** — `@@ -1 +1,2 @@`
  occurs in real output.
- `\ No newline at end of file`, which attaches to the `-` or `+` line above it and can appear
  on **both** sides of one hunk. Its own line kind, preserved byte-exactly when a patch is
  rebuilt.
- `Binary files a/x and b/x differ` → `binary: true`, no hunks. `--numstat` reports `-\t-`.

Track `oldLine`/`newLine` counters through each hunk for the gutter, and record each hunk's
`lineRange` — the line indices into the original output.

**Windows.** `core.autocrlf` puts `\r` at line ends. Strip a trailing `\r` **for display only**,
never from the bytes used to rebuild a patch. This is invisible on macOS, so the CRLF fixture
added in Phase 1 is what stops it reaching a user.

### Byte-accurate slicing

Run every diff-producing command in buffer mode. In main, split the Buffer on `0x0A` to get a
byte range per line index, run `parseUnifiedDiff` over `buf.toString('utf8')`, and map indices
to byte ranges. This is correct because UTF-8 decoding never invents or removes a newline —
verified above, 9 newlines either way on a file that does not round-trip. One parser, byte-exact
slices, no second implementation.

Add `lossy: boolean` to `FileDiff` when re-encoding the decoded view doesn't reproduce the
bytes, so the panel can say "this file isn't UTF-8; the diff shown is approximate" rather than
rendering mojibake with no explanation.

### Rendering

Hand-rolled rows, no highlighting, no new dependency. `scroll-area` (installed) for the diff
body. Header per the concept: checkbox and filename, then `+171 • -17 • <full path>`, then the
diff, with an X to close. Add `collapsible` via the CLI for per-hunk collapse.

Cap at roughly 2000 lines per file in the DTO with `truncated: true` and an escape to the
configured editor. The 64 MiB `maxBuffer` protects main, not React.

---

## Phase 5 — Staging, discard, commit, push

New methods on `GitService`, all exit-code driven, no stderr matching:

- `stageFiles` → `git add -- <paths…>`. `git add` on a deleted path stages the deletion
  (verified). For a rename, pass both paths.
- `unstageFiles` → `git restore --staged -- <paths…>`.
- `discardFiles` → `git restore --` for tracked, `git clean -f --` for untracked. Behind an
  `AlertDialog`; irreversible.
- `commit` → `git commit -m <message> [--amend]`. A multi-line message is a single argv entry
  and works. Nothing staged exits 1, but the button should be disabled from status instead.
- `push` → `git push` or `git push --set-upstream origin <branch>`, at `FETCH_TIMEOUT_MS`,
  reusing the sanctioned `isAuthFailure` stderr match in `git-service.ts:32` for the message
  only.

### Push is a scope gap worth naming

"95% of a regular git workload" without push isn't 95%. The concept has no push button, but a
user who commits in Arborist and then can't push goes straight to the terminal, and at that
point the ahead/behind badge is all the app contributed. It's about twenty lines. Ship it here
as a secondary button beside Commit, reading "Push 2 commits" when `ahead > 0`.

Amend likewise: a checkbox on the commit box, enabled only when `ahead > 0` or there's no
upstream, so nobody amends something already pushed with one click.

### Commit message draft

Copy `src/renderer/src/components/notes-editor.tsx` exactly — 400 ms debounced write-behind
**with the unmount flush**, so switching worktrees mid-sentence doesn't drop the last
keystrokes. Keyed `${repositoryId}::${worktreePath}` into `commitDrafts`. Cleared on a
successful commit.

### Identity

`git config --get user.email` exits 1 when unset, but git then _guesses_ an identity from gecos
and hostname and commits successfully — so this is a **warning, not a block**. A hint under the
commit box offering to set it, because that guessed address gets pushed.

Each mutation invalidates `worktrees(repoPath)`, `workingTree(worktreePath)`, and for commit
`commits(...)`. This phase must work fully without the watcher; Phase 7 only covers _external_
changes.

Add `context-menu` for right-click on a row (Stage / Unstage / Discard / Open in editor).
Optional — `dropdown-menu` is installed — but right-click is the platform-native gesture for a
file list.

### Scenarios

`working-tree-staging` with shots at nothing checked, some checked with an indeterminate row
visible, message typed, and after commit. `working-tree-discard` for the confirmation.
`commit-no-identity` for the hint.

---

## Phase 6 — Hunk staging

### The protocol — stateless, no server cache

1. Each `DiffHunk` in the DTO carries an `id`: 12 hex of a sha1 over the hunk's **raw bytes**,
   `@@` header included, computed in main (`crypto` is fine there, forbidden in shared).
2. New channel `'worktree:applyHunk': { args: [worktreePath, file, hunkId, direction]; result: void }`.
3. Main re-runs the same diff in buffer mode, re-parses, and finds the hunk by id. Not found →
   `AppError('This file changed since the diff was shown.', 'diff-stale')`, and the renderer
   refetches. No cache to invalidate, no staleness window to reason about, and correct for
   non-UTF-8 files.
4. Build the patch as `Buffer.concat([headerBytes, hunkBytes])`, both sliced from the **same
   buffer** by the recorded line ranges. Header is the `diff --git` line, any mode / new file /
   deleted file / similarity / rename lines, and the `---` / `+++` pair. Drop the `index` line —
   apply succeeds without it, and it's misleading when only one hunk is included.
5. `git apply --cached --whitespace=nowarn` with the patch on **stdin**, plus `--reverse` for
   unstaging from `diff --cached`.

### No line-count arithmetic is needed

Worth stating loudly, because this is the part people over-engineer. Staging only the _second_
of two hunks — whose header's new-side start is wrong relative to the index base, because the
first hunk inserted three lines — applied at exit 0 and produced the correct index. `git apply`
matches the old-side context with an offset search. Do not recompute headers. `--recount` would
only be needed if something edited hunk _bodies_, which line-level staging would, and it is out
of scope.

The reverse round-trip and a rename-plus-edit round-trip were both verified to come back clean.

### Error classification without stderr matching

| exit | meaning                   | code                  |
| ---- | ------------------------- | --------------------- |
| 0    | applied                   | —                     |
| 1    | context moved             | `patch-did-not-apply` |
| 128  | malformed patch — our bug | `patch-invalid`       |

Both verified. This is why the house rule survives here: the two failure modes that would
otherwise tempt stderr matching are already distinguishable by exit code.

**Hunk-less files** — mode-only changes, pure renames, binaries — offer whole-file staging only.
Say so in the UI rather than showing a disabled button with no explanation.

### Scenarios

`diff-panel-hunks`: diff shown, one hunk staged (the row goes indeterminate, the panel
updates), then unstaged. `diff-panel-binary` and `diff-panel-mode-only` for the no-hunk states.

---

## Phase 7 — The file watcher

**chokidar 5.** Verified: one pure-JS dependency (`readdirp`), no native modules — v4 dropped
fsevents. So there is nothing for `electron-builder install-app-deps` to rebuild, which is the
reason to pick it over `@parcel/watcher` or `nsfw`.

### What to watch

The **selected worktree only**. Never all worktrees, never all projects.

**The worktree tree**, recursively, `ignoreInitial: true`, `awaitWriteFinish: {
stabilityThreshold: 150, pollInterval: 50 }`, ignoring `**/.git/**`, a hardcoded floor
(`node_modules`, `.next`, `dist`, `build`, `out`, `target`, `.venv`, `__pycache__`,
`.DS_Store`), and — the part that stops a large repo melting — **gitignored directories
obtained from git itself**: on watch start, `git ls-files --others --directory
--no-empty-directory -i --exclude-standard -z` gives the top-level ignored directories. One git
call, git's own matcher, exact. Re-run when `.gitignore` changes. No gitignore parser.

**Git metadata, by resolved path.** This is where a naive implementation silently never fires.
In a linked worktree the index is not under the worktree — `git rev-parse --git-path index`
resolves into `.git/worktrees/<name>/` (verified above). Watch as explicit file paths, not by
watching `.git` recursively, which fires hundreds of times during a fetch or a gc:
`--git-path index`, `--git-path HEAD`, `<common-dir>/refs/heads`, `<common-dir>/packed-refs`.

### Event

Coalesce into one trailing-edge debounce of 250 ms with a 1 s max wait, so a long `npm install`
updates once a second rather than never. One new event channel `'worktree:changed': {
worktreePath, reason: 'worktree' | 'index' | 'head' | 'refs' }`, added to `IpcEventContract`
**and** `EVENT_CHANNELS`. The reason lets the renderer invalidate precisely: `worktree` →
status; `index` → status and diffs; `head`/`refs` → status, commits, and the worktree list.

### The feedback loop, and why `GIT_OPTIONAL_LOCKS=0` is the fix rather than the problem

Every Arborist write touches the index and fires the watcher. That alone is a doubled refetch,
not a loop — _unless the refetch itself writes_. And `git status` normally does write the
refreshed index. With `GIT_OPTIONAL_LOCKS=0`, already set app-wide in `gitEnv`, it does not. So
the env var that looks like a hazard is precisely what prevents status → watcher → status from
spinning forever. **Keep it, and say why in a comment**, because someone will try to remove it
in this phase's review.

Verified that it does not block the commands that need the index: `add`, `commit`, `stash push`,
`stash pop`, and `apply --cached` all returned 0 with it set. It skips optional locks only.

Belt and braces: a suppression window in the watcher service, `suppress(worktreePath, 400)`,
called by every mutating operation before it runs.

**The genuine hazard**, listed as a known risk rather than pre-solved: because the refreshed
index is never written back, a repo where a build touched many files re-hashes them on every
status. With a watcher driving statuses, that's a treadmill on a large repo. If it bites, add an
`optionalLocks: true` escape to `execGitAt` for the selected worktree's foreground status only.
Measure first.

### Lifecycle and determinism

`src/main/services/watch/worktree-watcher.ts`, owned by the composition root in
`app.whenReady()`, one watcher at a time, `watch(path | null)` replacing it. Driven by a
`useEffect` on the selected worktree calling a new `'watch:select'` channel. Guard a prunable
worktree and a path that vanishes mid-watch — chokidar `error` should stop and report, never
crash main. Stop on `window-all-closed` and `before-quit`.

A watcher makes screenshots and e2e nondeterministic. Add `ARBORIST_DISABLE_WATCHER=1` to the
existing env escape-hatch family and set it in the screenshot runner by default; scenarios opt
in. Without this every capture becomes flaky in a way that reads as a styling bug.

---

## Phase 8 — Branch switching and stash

`git switch <branch>` with `-C worktreePath`. Every failure mode is pre-checkable, so the house
rule holds:

| Situation                          | Raw git                    | Pre-check                                                                                                     |
| ---------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| branch doesn't exist               | exit 128                   | existing `branchExists()`                                                                                     |
| checked out in another worktree    | exit 128                   | `parseWorktreeList` — find an entry with `branch === target` and a different `path`, compared with `samePath` |
| dirty tree that would be clobbered | exit 1                     | `git diff --name-only -z HEAD <target> --` intersected with the changed paths from `parseStatusV2`            |
| dirty tree that wouldn't be        | exit 0, changes carry over | none                                                                                                          |
| unmerged paths present             | —                          | refuse: `u` records in status                                                                                 |

All verified. The two 128s are indistinguishable from each other by exit code, which is exactly
why the pre-checks matter rather than being nice-to-have.

**Do not offer `--ignore-other-worktrees`.** It succeeds and leaves two worktrees on one
branch — the precise failure mode Arborist exists to prevent.

### When the tree is dirty

- **Non-conflicting** (the intersection is empty): switch straight through, toast "Your
  uncommitted changes came with you." That's git's own behaviour and the right one.
- **Conflicting**: an `AlertDialog` naming the files, offering **Stash and switch** (`git stash
push --include-untracked -m "Arborist: switching to <b>"`, then switch — **do not auto-pop**,
  since a pop into a conflicting tree exits 1 and leaves `UU`, and a silent auto-pop conflict is
  the worst possible outcome), **Commit first** (switches to the Working Tree tab and focuses
  the commit box), or **Cancel**.
- Explicitly **not** offered: force or discard. Deleting work behind one confirmation isn't
  something this app should do.

### Stash

In the same PR because switching needs it. `git stash push [-u] -m <msg>` — note it **exits 0
with nothing stashed when the tree is clean**, so "did it stash?" needs a dirty pre-check rather
than an exit code. `git stash list --format='%gd%x00%s%x00%aI'`, then `pop` / `apply` / `drop`.
A pop conflict exits 1 with `UU` in status, which flows straight into Phase 10's UI.

"Switch branch…" goes in the worktree actions dropdown, opening a dialog built on the existing
`src/renderer/src/components/branch-combobox.tsx` (cmdk, already grouped head/local/remote). A
stash section goes in the Working Tree tab below Changed Files. Post-switch, invalidate
`worktrees`, `workingTree`, `commits`, and clear the inspector; the worktree's identity is its
path, which doesn't change, so the selection survives.

### Scenarios

`switch-branch`: picker open, clean switch, the conflicting-dirt dialog, the branch-in-use
refusal. `stash-list`: empty, one entry, pop-conflict aftermath.

---

## Phase 9 — The commit graph

```
git log --topo-order --date=iso-strict --shortstat
        --format=<RS><H><US><h><US><an><US><ad><US><s><US><P>
        -n <limit> --skip=<n> <tip…> --
```

`<tip…>` is the worktree's branch (or HEAD when detached) **plus its upstream ref** when one
exists and isn't gone — `WorktreeStatus.upstream` already carries it. The trailing `--` stops a
branch named like a path being ambiguous.

Extend `LOG_FORMAT` in `porcelain.ts` with `%P` and add `parents: string[]` to
`CommitLogEntry`, rather than adding a parallel format that would drift. Cost: the three
`parseCommitLog` assertions in `tests/unit/porcelain.test.ts` need the field.
`RemoteBranchDetail` gets `parents` it ignores, which is harmless.

**Do not use `git log --graph`.** Its ASCII art can't be parsed stably and can't be styled.

### Lane assignment — pure, `src/shared/commit-graph.ts`

`assignLanes(commits, { maxLanes })` returning rows carrying `lane`, `laneCount`, `edges`,
`danglingParents`, and `overflow`. A classic active-lanes fold: keep `lanes: (string | null)[]`
holding the hash each lane waits for; for each commit in topo order take the lane already
waiting for it, else the first free slot, else push. The first parent inherits the commit's
lane; further parents take free lanes and emit `parent` edges. Any _other_ lane also waiting for
this hash is a join — clear it and emit a `merge` edge. Compact trailing nulls so `laneCount`
stays small. `maxLanes` (8) collapses beyond into the last lane with `overflow: true`, so a
pathological repo doesn't render sixty columns.

### Reconciling with `useInfiniteQuery`

`useCommitLog` already pages 20 via `--skip`. Three consequences:

1. **Lanes are a fold, so they must be computed over `pages.flat()`, never per page.** A
   `useMemo` keyed by `pages.length` — O(n) over a few hundred rows, and recomputing is far
   simpler than making the fold resumable.
2. **Edges dangling off the bottom.** Commits in the last page have parents that aren't loaded;
   `danglingParents` tells the renderer to draw a short stub that fades rather than a line to a
   row that doesn't exist. The converse — a merge whose second parent is fifty rows down —
   needs nothing: the lane simply stays occupied, which is what the fold already does.
3. **`--skip` is unstable if commits land between pages.** Phase 5's mutations and Phase 7's
   watcher both invalidate the commits query wholesale, resetting to page 0, so cursor paging
   isn't needed — but say so, because "why is `--skip` acceptable" is a fair review question.

### Rendering and the commit inspector

An inline SVG rail of width `laneCount * 12`: a dot at `lane`, lines for the edges. No
dependency. Row content per the concept: author, `formatCommitTimestamp` (which already
produces "4d (13 July 2026 at 21:19)"), subject, then `<hash> • 4 files changed • +171 • −17`.

Clicking a row sets `{ kind: 'commit', hash }`. The panel shows the commit's metadata and its
file list from `show --format= --numstat -z --diff-merges=first-parent -M <sha>`; clicking a
file shows its patch. Those rows have **no checkboxes**. The concept says the panel "looks
similar" to the Working Tree one, which invites sharing the component wholesale — resist it.
Share a row _primitive_, keep the two lists separate.

Note `--numstat -z` has the same rename field-count shape as status: `0\t0\t\0oldpath\0newpath\0`,
an empty third field then two more NUL fields.

**One honest caveat for the UI.** "Local and remote on this branch" means two tips, so the graph
is usually a straight line with the occasional fork. Users will expect other branches. Head the
tab "main and origin/main" so the scope is visible rather than looking broken.

---

## Phase 10 — Conflict handoff

### Detection

`u` records from `parseStatusV2` → `kind: 'unmerged'` with the two-letter code. Show what the
code means rather than a generic "conflict": `UU` both modified, `AA` both added, `DD` both
deleted, `AU` added by us, `UA` added by them, `DU` deleted by us, `UD` deleted by them.

Which operation is in progress, so the banner uses the right verb: `git rev-parse --git-path
MERGE_HEAD` (and `REBASE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `rebase-merge/`) plus
`fs.stat`. A path lookup and a stat, no stderr matching.

### UI

A **Conflicts** section above Changed Files: "Merging origin/main into feature-x — 2 files
conflict." Conflicted rows get no checkbox — staging half a conflict is meaningless — a
destructive-toned code badge, and two actions: **Open in editor** (primary) and **Mark
resolved** (`git add -- <path>`, which resolves the entry to whatever is on disk; let git
decide rather than scanning for conflict markers). Footer: **Abort**
(`merge`/`rebase`/`cherry-pick --abort` per the detected state) and, once no `u` records
remain, **Continue**.

**`--continue` opens an editor.** `GIT_TERMINAL_PROMPT=0` does not cover that, and the child
hangs until `DEFAULT_TIMEOUT_MS`. Pass `-c core.editor=true` on those calls. Easy to miss, and
it presents as a mysterious thirty-second freeze.

`git checkout --ours -- <path>` is tempting and one call. Offer it **only on `UU`**, labelled
"Keep ours (discard theirs)". It's a footgun on `AA` and `DU`.

### The preset problem

The existing system is "open this **worktree** in X": every path in `PresetService` passes
`context.path`, and `SubstitutionValues` in `src/shared/substitution.ts` has `path`, `branch`,
`commitHash`, `repoName`, `repoPath` — no notion of a file. Three changes:

1. **`SubstitutionValues` gains `filePath` and `fileLine`**, added to `KNOWN_TOKENS`. Existing
   presets are unaffected: `substitute` already leaves unknown tokens verbatim and already
   escapes per destination.
2. **`PresetService.run` gains `target: 'worktree' | 'file'`.** For `'file'`: `vscode` → `code
--goto <file>:<line>`; `reveal` → `shell.showItemInFolder(file)`; `terminal`, `github`,
   `xcode`, `warp` are **filtered out** of the file-target list, because there's no sensible
   file form and faking one is worse than omitting it; custom `app` presets pass the file as
   argv; custom `url` and `shell` presets get `{{filePath}}`.
3. **A per-project default**, `conflictEditorPresetId`, already declared in Phase 2's schema as
   the same tri-state with an app-level value beneath it. Unset resolves to the first
   file-capable enabled preset, which on a stock install is VS Code. A dropdown beside the
   button offers the rest.

**Not in scope:** an in-app three-way merge editor, conflict-marker parsing, `git mergetool`.

### Scenarios

`conflict-merge`: the banner and conflict rows mid-merge, after "Mark resolved" on one file,
and after abort. `conflict-editor-setting` in project settings showing the inherit row.

---

## Cross-cutting

### shadcn components to add

Via `npx shadcn@latest add <c> --overwrite --yes` then prettier — never hand-written, per
`CLAUDE.md`, which also documents the curl-from-GitHub fallback for containers that can't reach
`ui.shadcn.com`.

- **`checkbox`** (Phase 3) — required; the indeterminate state is why it can't be `switch`.
- **`collapsible`** (Phase 4) — hunk collapse and the Conflicts section.
- **`context-menu`** (Phase 5) — optional, but right-click is the native gesture for a file list.
- **Not `toggle-group`** — the unstaged/staged switch in the diff header can be `Tabs`, already
  installed and themed.
- **Not `table`** — the Overview Information block is three label/value rows; a `<dl>` beats it.
- `scroll-area` is installed and should carry both the changed-files list and the diff body,
  which scroll independently.

### Tests that will break

| File                                                                           | Why                                                                                                                                                             |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/porcelain.test.ts`                                                 | Phase 9 only: `LOG_FORMAT` gains `%P`, so three `parseCommitLog` assertions need `parents`. The `parseStatus` cases must **not** change — that's the guarantee. |
| `tests/integration/create-worktree.test.ts` (4), `remote-branches.test.ts` (1) | Phase 2: `suggestWorktreePath` grows an argument.                                                                                                               |
| `tests/unit/store.test.ts:68`                                                  | Phase 2: uses the real migration registry; expectation changes. Line 209 injects its own and survives.                                                          |
| `tests/unit/git-executor.test.ts`                                              | Phase 1, only if a case asserts the `execFile` options object. None currently do — confirm.                                                                     |
| `tests/unit/ipc-contract.test.ts`                                              | No break: it asserts non-empty and unique, not a count.                                                                                                         |
| `tests/e2e/smoke.spec.ts`                                                      | Phase 3: `notes-editor` moves inside the Overview tab panel. Overview is the default, but `Tabs` unmounts inactive content — verify.                            |

### Things in the spec worth pushing back on

1. **Push is missing**, and "95% of a regular git workload" without it isn't. Ship it in Phase 5.
2. **The single-list staging model is undefined.** Settle it in Phase 3 or every later phase
   inherits the ambiguity.
3. **"Commit 5 files to main"** must count files with staged content, not checked rows, or hunk
   staging makes the label lie.
4. **The Commit Graph's scope will disappoint.** Two tips means a near-straight line. Label it
   rather than widening to `--branches`, which is expensive and noisy.
5. **Amend needs a guard** — enabled only when `ahead > 0` or there's no upstream.
6. **Submodules** appear in status v2 with their own state field. Show the row, allow whole-file
   staging, don't offer a diff.

---

## Verification

Per phase, in this order, before the PR:

1. **Unit tests.** `npm test`. The pure work — `parseStatusV2`, `parseUnifiedDiff`,
   `assignLanes`, `resolveWorktreeLocation`, `worktreeBasePath` — all lives in `src/shared` or
   `porcelain.ts` and is testable without a repository. That's where the coverage should
   concentrate; `porcelain.ts`'s own header says why.
2. **Integration tests** against real temp repos, extending
   `tests/integration/fixtures/git-fixture.ts`. New fixtures needed: `makeConflictFixture()`
   (`UU` + `AA`), a rename-with-a-space, a CRLF file, a latin-1 file (the byte-accuracy
   invariant), and a staged/unstaged/untracked matrix. Keep the pinned timestamps —
   `BASE_COMMIT_TIME`, 60 s apart — which is what makes the captures byte-stable.
3. **Round-trip assertions for the risky mechanics**, as integration tests rather than by eye:
   stage a hunk then unstage it and assert the status returns to its prior code; apply a
   rename-plus-edit patch and assert `R  old -> new`; assert a latin-1 patch applies from bytes
   and fails from a round-tripped string, so the executor's buffer mode can never be quietly
   reverted.
4. **Run the app.** `ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a npm run dev` in the container, or
   `npm run dev` locally. The e2e suite needs `xvfb-run` but not the env var.
5. **Screenshots.** `xvfb-run -a npm run screenshot` **in the Linux cloud container**, then
   `git status --short docs/screenshots`, then open every changed PNG and look at it. An image
   you can't explain is a regression until proven otherwise. Regenerating on macOS diffs every
   image at once, which is the signature of that problem and not of a real one.
6. **E2E.** `npm run test:e2e`. New native-dialog flows need an env escape hatch in the
   `ARBORIST_PICK_FOLDER` family; Phase 7 needs `ARBORIST_DISABLE_WATCHER=1` set by default in
   the screenshot runner or every capture goes flaky.
7. **Lint and typecheck.** `npm run lint && npm run typecheck`. ESLint enforces that
   `src/shared` imports no Node built-ins, which is what will catch a `path` or `crypto` import
   creeping into `diff.ts` or `commit-graph.ts`.

### Critical files

- `src/main/services/git/git-executor.ts` — buffer mode and stdin (Phase 1)
- `src/main/services/git/porcelain.ts` — `parseStatusV2`, `%P` in `LOG_FORMAT`
- `src/main/services/git/git-service.ts` — every new git operation
- `src/shared/ipc-contract.ts` — **two** entries per channel, contract and whitelist
- `src/shared/persisted.ts` + `src/main/services/persistence/migrations.ts` — schema 3 → 4
- `src/shared/diff.ts`, `src/shared/commit-graph.ts`, `src/shared/worktree-location.ts` — new pure modules
- `src/renderer/src/App.tsx` → `components/shell.tsx` — the third panel
- `src/renderer/src/components/worktree-detail.tsx` — the three tabs
- `src/renderer/src/state/selection.ts` — tab and inspector state
- `scripts/screenshots/scenarios.ts` — a scenario per phase, minimum
