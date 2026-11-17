/**
 * Where a branch stands against the repository's default branch (#151):
 * "3 ahead, 2 behind origin/main". Its upstream's ahead/behind says whether
 * it is pushed; this says how far it has drifted from where it will merge.
 *
 * Kept pure so the choice of base and the wording are tested directly; the
 * git service only supplies the refs and the counts.
 */
import type { BranchPosition } from './domain'

export type { BranchPosition }

/**
 * The ref to compare against, given the default branch's name (from
 * `resolveDefaultBranch`). The remote's copy when there is one, since that is
 * what a branch is merged into and what a fetch keeps current — a local
 * `main` nobody has pulled in a month would make every branch look ahead.
 * `origin` first, then any other remote, then the local branch. Null when
 * there is no default branch, or it exists nowhere.
 */
export function chooseBaseRef(
  defaultBranch: string | null,
  localNames: readonly string[],
  remoteRefs: readonly string[]
): string | null {
  if (!defaultBranch) return null
  const onOrigin = `origin/${defaultBranch}`
  if (remoteRefs.includes(onOrigin)) return onOrigin
  const onOther = remoteRefs.find((ref) => ref.endsWith(`/${defaultBranch}`))
  if (onOther) return onOther
  return localNames.includes(defaultBranch) ? defaultBranch : null
}

/**
 * Whether `ref` is the default branch itself, locally or on a remote, which
 * has no position against itself worth a pill.
 */
export function isDefaultBranchRef(
  ref: string,
  defaultBranch: string | null,
  base: string | null
): boolean {
  return defaultBranch !== null && (ref === defaultBranch || ref === base)
}

/**
 * The pill's text, or null when there is nothing worth showing: no position,
 * or the base is also the branch's upstream, whose own chip already says the
 * same thing in the same counts.
 */
export function branchPositionLabel(
  position: BranchPosition | null,
  upstream: string | null = null
): string | null {
  if (!position || position.base === upstream) return null
  const { ahead, behind, base } = position
  if (ahead && behind) return `${ahead} ahead, ${behind} behind ${base}`
  if (ahead) return `${ahead} ahead of ${base}`
  if (behind) return `${behind} behind ${base}`
  return `Even with ${base}`
}
