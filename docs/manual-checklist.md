# Manual Verification Checklist

A chunk of Arborist cannot be meaningfully automated. It opens real Terminals
and real editors, it renders at whatever scaling the display is set to, and it
is installed by an installer the CI runner never runs. The e2e suite covers none
of that, and pretending otherwise would be kidding ourselves.

So this is the pass a human runs before a release, one column per OS. Copy it
into the release issue and fill it in there rather than editing this file with
results.

Two things worth knowing before starting. The list is written to be run on a
**clean machine**, meaning a fresh VM or an account that has never run Arborist,
because half of what it is checking is what happens with no data file and no
prior state. And each item names what a pass looks like, so "works" is not left
to judgement.

## Install

| #   | Check                                                             | macOS                                                                                                                          | Windows                                                                                                      |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 1   | Installer opens without a security dialog beyond the expected one | dmg opens, drag to Applications, first launch shows the standard "downloaded from the internet" prompt and no Gatekeeper block | SmartScreen shows "Windows protected your PC"; **More info → Run anyway** proceeds (expected while unsigned) |
| 2   | Install needs no administrator password                           | n/a                                                                                                                            | Installer completes with no UAC prompt                                                                       |
| 3   | `spctl -a -vv /Applications/Arborist.app` accepts the app         | Reports `accepted`, `source=Notarized Developer ID`                                                                            | n/a                                                                                                          |
| 4   | The icon is the real one everywhere the OS shows it               | Dock, Finder, About panel                                                                                                      | Taskbar, Start menu, installer, uninstaller, Add/Remove Programs                                             |
| 5   | About panel shows the name, version, and copyright                |                                                                                                                                |                                                                                                              |

## Git Discovery

Item 6 is the one that most often differs between a dev machine and a clean one,
because a dev machine has git on the PATH that a desktop-launched app inherits
and a clean one may not.

| #   | Check                                                                                         | macOS                           | Windows                                 |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------- |
| 6   | Git found on a stock install                                                                  | Xcode CLT git, and Homebrew git | Git for Windows default install         |
| 7   | Git found when installed through a package manager                                            | Homebrew, MacPorts              | scoop, Chocolatey                       |
| 8   | Git found from a portable install                                                             | n/a                             | Unzipped to `%UserProfile%\PortableGit` |
| 9   | No git at all shows the guidance screen, not a crash or an empty list                         |                                 |                                         |
| 10  | Setting **Settings → General → Git** to a valid path works, and to a nonsense path reports it |                                 |                                         |

## Window Behaviour

| #   | Check                                                                                                                       | macOS                                             | Windows                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------- |
| 11  | Window size and position survive a quit and relaunch                                                                        |                                                   |                                                    |
| 12  | Maximised state survives a quit and relaunch                                                                                |                                                   |                                                    |
| 13  | Window remembered on a second monitor reopens on the primary display after that monitor is disconnected                     |                                                   |                                                    |
| 14  | Layout is intact at 125% and 150% display scaling: no clipped text, no overlapping panes, no scrollbars on the shell itself | n/a (test at default and at a scaled Retina mode) | Both settings, after the sign-out Windows asks for |
| 15  | Menu accelerators use Ctrl where macOS uses Cmd, and every menu item is reachable                                           | Cmd+N, Cmd+R, Cmd+,                               | Ctrl+N, Ctrl+R, Ctrl+,                             |

## Paths

| #   | Check                                                                                                                              | macOS | Windows                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------- |
| 16  | No forward slashes in any displayed path: detail pane, project settings, create-worktree location field, automation console output | n/a   |                                         |
| 17  | Adding the same repository twice, once with a differently-cased path, is refused as already added                                  | n/a   | e.g. `C:\code\repo` then `c:\code\repo` |
| 18  | A worktree under a deep path works, with `core.longpaths` set                                                                      | n/a   |                                         |

## Features, Once Each

Every one of these was built in M1 or M2 and is covered by unit and integration
tests. What is being checked here is that they still work **from a packaged
build**, where the PATH, the working directory, and the app's own location all
differ from a dev run.

| #   | Check                                                                              | macOS                     | Windows                             |
| --- | ---------------------------------------------------------------------------------- | ------------------------- | ----------------------------------- |
| 19  | Add a project, and see its worktrees with their badges                             |                           |                                     |
| 20  | Create a worktree on a new branch                                                  |                           |                                     |
| 21  | Create a worktree tracking a remote branch, from the remote branches list          |                           |                                     |
| 22  | Fetch, and see the ahead/behind counts change                                      |                           |                                     |
| 23  | Recent commits panel loads, and pages on scroll                                    |                           |                                     |
| 24  | Write a note on a worktree, quit, relaunch, and find it there                      |                           |                                     |
| 25  | Every enabled **Open in…** preset launches the right application                   | Terminal, Finder, VS Code | Windows Terminal, Explorer, VS Code |
| 26  | A custom preset pointing at an application by path launches it                     |                           |                                     |
| 27  | A setup script runs on worktree creation, streams output, and can be cancelled     |                           |                                     |
| 28  | Delete a worktree, including the confirmation for a dirty one                      |                           |                                     |
| 29  | Prune, after deleting a worktree folder from outside the app                       |                           |                                     |
| 30  | Theme follows the OS, and the manual override in settings sticks across a relaunch |                           |                                     |

## Updates

Needs two builds: install version N, then publish N+1 and wait for the check.
The interval is six hours, so relaunching is the practical way to trigger it.

| #   | Check                                                                                  | macOS | Windows |
| --- | -------------------------------------------------------------------------------------- | ----- | ------- |
| 31  | Toast appears within a launch cycle of N+1 being published                             |       |         |
| 32  | **Restart now** applies the update and the app comes back on N+1                       |       |         |
| 33  | Dismissing the toast and quitting normally lands N+1 on the next launch                |       |         |
| 34  | An update never interrupts a running setup script                                      |       |         |
| 35  | **Check for Updates…** on the latest version says so rather than doing nothing visible |       |         |

## Uninstall

| #   | Check                                                                                  | macOS         | Windows             |
| --- | -------------------------------------------------------------------------------------- | ------------- | ------------------- |
| 36  | Uninstall removes the app                                                              | Drag to Trash | Add/Remove Programs |
| 37  | Uninstall leaves the data file alone, and reinstalling picks the projects list back up |               |                     |

## Recording Results

Paste the table into the release issue with each cell filled as pass, fail, or
n/a, and the OS version and hardware at the top. A cell left blank reads as
"nobody looked", which is different from a pass and much more useful to know.
