/**
 * Picking the right result out of `where`'s output (#63).
 *
 * A pure function so the resolution logic is testable without a real PATH or
 * a Windows machine to run `where` on.
 */

/**
 * The extensions Windows treats as directly executable, in the order `where`
 * tends to report them: the literal (unextended) name first if one exists,
 * then each `PATHEXT` variant. Only the ones a spawned child process can
 * actually be is listed here — `.com`/`.exe` need no shell at all, `.bat`/
 * `.cmd` need one, which Node arranges automatically.
 */
const WINDOWS_EXECUTABLE_EXTENSIONS = ['.com', '.exe', '.bat', '.cmd']

/**
 * Chooses which line of `where`/`which` output to actually spawn.
 *
 * On every platform but Windows this is just "the first non-blank line" —
 * `which` only ever reports things that are executable. `where` is looser:
 * asked for `code`, it lists every file named `code*` on PATH, and VS Code's
 * installer puts two of them side by side in its `bin` directory — `code`,
 * a POSIX shell script for WSL/git-bash with no extension at all, alongside
 * `code.cmd`, the actual Windows entry point. `where` lists the extension-less
 * one first, and `spawn` can't run it: Windows has no association for a file
 * with no recognised extension, so trying fails with ENOENT even though a
 * working entry point sits right next to it. Preferring whichever candidate
 * carries a recognised executable extension is what routes around that,
 * without needing to know VS Code specifically — any command with the same
 * shim-plus-`.cmd` shape on Windows hits the same fix.
 */
export function pickExecutable(
  candidates: readonly string[],
  platform: NodeJS.Platform
): string | null {
  const lines = candidates
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0)
  if (lines.length === 0) return null
  if (platform !== 'win32') return lines[0]

  const withKnownExtension = lines.find((candidate) =>
    WINDOWS_EXECUTABLE_EXTENSIONS.some((extension) => candidate.toLowerCase().endsWith(extension))
  )
  return withKnownExtension ?? lines[0]
}
