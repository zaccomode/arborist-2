/**
 * Branch-name handling, shared by main and renderer so the create-worktree
 * dialog can preview what it is about to do without an IPC round-trip.
 *
 * Nothing here imports Node: it has to run in the renderer.
 */

/**
 * Prefixes users paste along with a branch name, because they copy whole
 * commands out of tickets and chat rather than the name alone. Longest match
 * per command first, so `git switch -c x` doesn't strip down to `-c x`.
 */
const COMMAND_PREFIXES = [
  'git checkout -b ',
  'git checkout ',
  'git switch -c ',
  'git switch --create ',
  'git switch ',
  'git branch ',
  'git co -b ',
  'git co '
]

/**
 * Reads a branch name out of whatever the user pasted: a bare name, a whole
 * checkout command, or a remote-qualified ref. Anything after the name is
 * dropped, since it is the rest of a command rather than part of the name.
 */
export function parseBranchInput(raw: string): string {
  let value = raw.trim()

  const lowered = value.toLowerCase()
  for (const prefix of COMMAND_PREFIXES) {
    if (lowered.startsWith(prefix)) {
      value = value.slice(prefix.length).trim()
      break
    }
  }

  if (value.toLowerCase().startsWith('origin/')) {
    value = value.slice('origin/'.length)
  }

  return value.split(/\s+/)[0] ?? ''
}

export interface BranchValidation {
  valid: boolean
  /** Why the name was rejected, phrased for display. */
  reason: string | null
}

const validName: BranchValidation = { valid: true, reason: null }

function invalid(reason: string): BranchValidation {
  return { valid: false, reason }
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/**
 * A local reading of `git check-ref-format --branch`, so the dialog can
 * answer each keystroke. Shelling out would be authoritative, but a process
 * spawn per keystroke is a lot to pay for rules that do not move.
 */
export function validateBranchName(name: string): BranchValidation {
  if (name.length === 0) return invalid('Enter a branch name.')
  if (name.includes('..')) return invalid('Branch names cannot contain "..".')
  if (name.includes('//')) return invalid('Branch names cannot contain "//".')
  if (name.includes('@{')) return invalid('Branch names cannot contain "@{".')
  if (name.includes('\\')) return invalid('Branch names cannot contain a backslash.')
  if (name.startsWith('/') || name.endsWith('/')) {
    return invalid('Branch names cannot start or end with "/".')
  }
  if (name.startsWith('.') || name.endsWith('.')) {
    return invalid('Branch names cannot start or end with ".".')
  }
  if (name.endsWith('.lock')) return invalid('Branch names cannot end with ".lock".')
  if (CONTROL_CHARACTERS.test(name)) {
    return invalid('Branch names cannot contain control characters.')
  }

  const forbidden = [
    [' ', 'a space'],
    ['~', '"~"'],
    ['^', '"^"'],
    [':', '":"'],
    ['?', '"?"'],
    ['*', '"*"'],
    ['[', '"["']
  ] as const
  for (const [character, label] of forbidden) {
    if (name.includes(character)) return invalid(`Branch names cannot contain ${label}.`)
  }

  return validName
}

/** Reserved on Windows whatever the extension, so a folder cannot take them. */
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

// eslint-disable-next-line no-control-regex
const INVALID_IN_FOLDER = /[\\:*?"<>|#\u0000-\u001f\u007f]/g

/**
 * Turns a branch name into the folder name its worktree gets by default.
 *
 * Characters invalid on Windows are stripped on both platforms, so a
 * repository laid out on a Mac still opens on a Windows machine.
 */
export function sanitizeForFolder(branch: string): string {
  const folder = branch
    .replace(/\//g, '-')
    .replace(INVALID_IN_FOLDER, '')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')

  if (folder.length === 0) return 'worktree'
  if (WINDOWS_RESERVED.test(folder)) return `${folder}-wt`
  return folder
}
