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

| #   | Check                                                             | macOS                                                                                                                                                                                                   | Windows                                                                                                      |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | Installer opens without a security dialog beyond the expected one | dmg opens, drag to Applications, first launch shows the standard "downloaded from the internet" prompt and no Gatekeeper block                                                                          | SmartScreen shows "Windows protected your PC"; **More info → Run anyway** proceeds (expected while unsigned) |
| 2   | Install needs no administrator password                           | n/a                                                                                                                                                                                                     | Installer completes with no UAC prompt                                                                       |
| 3   | `spctl -a -vv /Applications/Arborist.app` accepts the app         | Reports `accepted`, `source=Notarized Developer ID`                                                                                                                                                     | n/a                                                                                                          |
| 4   | The icon is the real one everywhere the OS shows it               | Dock, Finder, About panel                                                                                                                                                                               | Taskbar, Start menu, installer, uninstaller, Add/Remove Programs                                             |
| 5   | The layered icon renders on macOS 26, and the flat one below it   | On 26: the icon picks up Liquid Glass under **System Settings → Appearance → Icon & widget style** in Default, Dark, Clear and Tinted. On 15 or earlier: a normal flat icon, not a blank or generic one | n/a                                                                                                          |
| 6   | About panel shows the name, version, and copyright                |                                                                                                                                                                                                         |                                                                                                              |

## Git Discovery

Item 7 is the one that most often differs between a dev machine and a clean one,
because a dev machine has git on the PATH that a desktop-launched app inherits
and a clean one may not.

| #   | Check                                                                                         | macOS                           | Windows                                 |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------- |
| 7   | Git found on a stock install                                                                  | Xcode CLT git, and Homebrew git | Git for Windows default install         |
| 8   | Git found when installed through a package manager                                            | Homebrew, MacPorts              | scoop, Chocolatey                       |
| 9   | Git found from a portable install                                                             | n/a                             | Unzipped to `%UserProfile%\PortableGit` |
| 10  | No git at all shows the guidance screen, not a crash or an empty list                         |                                 |                                         |
| 11  | Setting **Settings → General → Git** to a valid path works, and to a nonsense path reports it |                                 |                                         |

## Window Behaviour

| #   | Check                                                                                                                       | macOS                                             | Windows                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------- |
| 12  | Window size and position survive a quit and relaunch                                                                        |                                                   |                                                    |
| 13  | Maximised state survives a quit and relaunch                                                                                |                                                   |                                                    |
| 14  | Window remembered on a second monitor reopens on the primary display after that monitor is disconnected                     |                                                   |                                                    |
| 15  | Layout is intact at 125% and 150% display scaling: no clipped text, no overlapping panes, no scrollbars on the shell itself | n/a (test at default and at a scaled Retina mode) | Both settings, after the sign-out Windows asks for |
| 16  | Menu accelerators use Ctrl where macOS uses Cmd, and every menu item is reachable                                           | Cmd+N, Cmd+R, Cmd+,                               | Ctrl+N, Ctrl+R, Ctrl+,                             |

## Paths

| #   | Check                                                                                                                              | macOS | Windows                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------- |
| 17  | No forward slashes in any displayed path: detail pane, project settings, create-worktree location field, automation console output | n/a   |                                         |
| 18  | Adding the same repository twice, once with a differently-cased path, is refused as already added                                  | n/a   | e.g. `C:\code\repo` then `c:\code\repo` |
| 19  | A worktree under a deep path works, with `core.longpaths` set                                                                      | n/a   |                                         |

## Features, Once Each

Every one of these was built in M1 or M2 and is covered by unit and integration
tests. What is being checked here is that they still work **from a packaged
build**, where the PATH, the working directory, and the app's own location all
differ from a dev run.

| #   | Check                                                                              | macOS                     | Windows                             |
| --- | ---------------------------------------------------------------------------------- | ------------------------- | ----------------------------------- |
| 20  | Add a project, and see its worktrees with their badges                             |                           |                                     |
| 21  | Create a worktree on a new branch                                                  |                           |                                     |
| 22  | Create a worktree tracking a remote branch, from the remote branches list          |                           |                                     |
| 23  | Fetch, and see the ahead/behind counts change                                      |                           |                                     |
| 24  | Recent commits panel loads, and pages on scroll                                    |                           |                                     |
| 25  | Write a note on a worktree, quit, relaunch, and find it there                      |                           |                                     |
| 26  | Every enabled **Open in…** preset launches the right application                   | Terminal, Finder, VS Code | Windows Terminal, Explorer, VS Code |
| 27  | A custom preset pointing at an application by path launches it                     |                           |                                     |
| 28  | A setup script runs on worktree creation, streams output, and can be cancelled     |                           |                                     |
| 29  | Delete a worktree, including the confirmation for a dirty one                      |                           |                                     |
| 30  | Prune, after deleting a worktree folder from outside the app                       |                           |                                     |
| 31  | Theme follows the OS, and the manual override in settings sticks across a relaunch |                           |                                     |

## Updates

Needs two builds: install version N, then publish N+1 and wait for the check.
The interval is six hours, so relaunching is the practical way to trigger it.

| #   | Check                                                                                  | macOS | Windows |
| --- | -------------------------------------------------------------------------------------- | ----- | ------- |
| 32  | Toast appears within a launch cycle of N+1 being published                             |       |         |
| 33  | **Restart now** applies the update and the app comes back on N+1                       |       |         |
| 34  | Dismissing the toast and quitting normally lands N+1 on the next launch                |       |         |
| 35  | An update never interrupts a running setup script                                      |       |         |
| 36  | **Check for Updates…** on the latest version says so rather than doing nothing visible |       |         |

## Uninstall

| #   | Check                                                                                  | macOS         | Windows             |
| --- | -------------------------------------------------------------------------------------- | ------------- | ------------------- |
| 37  | Uninstall removes the app                                                              | Drag to Trash | Add/Remove Programs |
| 38  | Uninstall leaves the data file alone, and reinstalling picks the projects list back up |               |                     |

## Recording Results

Paste the table into the release issue with each cell filled as pass, fail, or
n/a, and the OS version and hardware at the top. A cell left blank reads as
"nobody looked", which is different from a pass and much more useful to know.
