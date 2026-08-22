# Troubleshooting

Every problem below is one Arborist can put in front of you rather than one you
went looking for, so each entry starts with what you would actually see.

## "Git Was Not Found"

Arborist shells out to the git you already have rather than bundling its own, so
a machine with no git gets a guidance screen instead of a worktree list. This is
deliberate: a bundled git would be a second git on your machine, with its own
version, its own config, and its own credential helpers, and the worktrees it
made would be invisible to the one in your terminal.

**macOS.** `git --version` in Terminal will offer to install the Xcode Command
Line Tools, which is the shortest route. Homebrew's `brew install git` is the
other, and gives you a newer git than Apple ships.

**Windows.** Install [Git for Windows](https://git-scm.com/download/win). The
defaults are fine. Arborist also finds git installed through scoop, Chocolatey,
and a portable unzip in `%UserProfile%\PortableGit`.

**It is installed and Arborist still cannot see it.** This is usually PATH: an
app launched from the Dock or from Explorer inherits the environment the desktop
session started with, not the one your shell builds from `.zshrc` or from a
package manager's shim. Point Arborist at the binary directly in **Settings →
General → Git**, using the full path to the executable
(`/opt/homebrew/bin/git`, `C:\Program Files\Git\cmd\git.exe`). Arborist runs
`--version` against whatever you give it and tells you there and then if it is
not a working git, so a typo does not become a silent failure later.

## Windows: "Filename Too Long" When a Setup Script Runs

Git on Windows refuses paths over 260 characters unless it is told not to, and a
`node_modules` tree inside a worktree inside a projects folder reaches that
sooner than you would think. The fix is one setting, applied to your git rather
than to Arborist:

```
git config --global core.longpaths true
```

Worth knowing that this covers git itself, not every tool git calls. Some
Windows programs have the 260-character limit compiled into them and will still
fail. Keeping the folder your worktrees live in short (`C:\code` rather than
`C:\Users\you\Documents\Projects\Work\...`) is the blunter fix that always works.

## Windows: SmartScreen Blocks the Installer

**Arborist's Windows installer is not code-signed yet.** Windows will show a
blue "Windows protected your PC" dialog on first run, with only a "Don't run"
button visible. To get past it, click **More info**, then **Run anyway**.

That is a real warning, not a formality, and the honest version of what it means
is: Windows cannot tell you who built this file, so it is telling you it does
not know. Signing costs money and identity verification, and the certificate has
not been bought yet. Until it is, the two things worth doing are downloading the
installer only from
[this repository's releases page](https://github.com/zaccomode/arborist-2/releases)
and checking the file name matches the release you meant to get.

Signed builds will stop showing this dialog for new downloads, though even a
signed build attracts the warning for a while until enough people have installed
it for SmartScreen's reputation system to trust it.

## macOS: "Arborist Cannot Be Opened"

A release build is signed with a Developer ID certificate and notarised by
Apple, and the notarisation ticket is stapled to the dmg so the check works with
no network. If macOS still refuses to open it, the download was probably
corrupted in transit: delete it and fetch it again rather than reaching for
`xattr -d`, which disables the check that would have told you.

A build you made yourself with `npm run build:mac` and no certificate is
unsigned, and Gatekeeper is right to block it. Right-click the app and choose
**Open** to run it anyway.

## A Fetch Fails With an Authentication Error

Arborist uses your system git and therefore your system git credentials. It has
no separate login, stores no tokens, and never sees your password. If
`git fetch` works in your terminal for a repository but fails in Arborist, the
difference is almost always the credential helper: it is configured in a shell
profile that a desktop-launched app never reads, or it is an SSH agent that only
your terminal has the socket for.

The quickest test is to run the same fetch from a terminal in the same
repository. If that fails too, the fix is a git one and the error message is
git's own. If it succeeds, look at `git config --get credential.helper` and at
whether your SSH key is in the system keychain (macOS: `ssh-add --apple-use-keychain`)
rather than in an agent you start by hand.

## Where My Data Lives

Arborist keeps one JSON file with your projects list, notes, presets, and
settings, plus a small file remembering where the window was.

|         | Path                                                        |
| ------- | ----------------------------------------------------------- |
| macOS   | `~/Library/Application Support/Arborist/arborist-data.json` |
| Windows | `%APPDATA%\Arborist\arborist-data.json`                     |

Nothing in there is a secret, and nothing leaves your machine. Copying the file
to another machine carries your presets and notes across, though a preset
pointing at an application by path will point at nothing if that application
lives somewhere else on the new machine.

If the file cannot be read at startup, whether hand-edited into invalid JSON or
truncated by a crash mid-write, Arborist tells you so in a toast rather than
starting empty and looking like it lost everything. The unreadable file is kept
beside the new one as `arborist-data.json.corrupt-<timestamp>.json`, so whatever was
in it is recoverable by hand.

Uninstalling on Windows leaves this folder alone. Reinstalling picks your
projects back up.

## Something Else

Turn on **Settings → Developer → Log every git command**, reproduce the problem,
and open the developer tools (**View → Toggle Developer Tools**). Every git
invocation Arborist makes, with its arguments and its exit code, is in the
console. That output is the useful half of a bug report.
