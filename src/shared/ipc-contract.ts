/**
 * The typed IPC contract between renderer and main.
 *
 * Every invoke channel is declared here with its argument tuple and result
 * type. Main-process handlers implement this contract; the preload script
 * whitelists exactly these channels; the renderer's api layer derives its
 * types from it. Adding a channel means adding it here first.
 */

import type {
  BranchInfo,
  CommitLogEntry,
  GitDiscoveryResult,
  RemoteBranch,
  StoreStatus,
  WorkingTreeChanges,
  Worktree
} from './domain'
import type { DiffRequest, FileDiff } from './diff'
import type { Preset, ProjectSettings, Repository, SelectionState, Settings } from './persisted'
import type { AutomationEvent } from './automation'
import type { PresetCatalogue, PresetRunResult, ResolvedPreset } from './presets'
import type { SubstitutionValues } from './substitution'
import type { UpdateStatus, UpdateSupport } from './updates'

export interface IpcInvokeContract {
  /** Native folder picker. Resolves null when the user cancels. */
  'system:pickFolder': { args: []; result: string | null }
  /** Native application picker: a bundle on macOS, an executable on Windows. */
  'system:pickApplication': { args: []; result: string | null }
  'projects:list': { args: []; result: Repository[] }
  'projects:add': { args: [path: string]; result: Repository }
  'projects:remove': { args: [id: string]; result: void }
  /** Lists a repository's worktrees, each enriched with its current status. */
  'worktrees:list': { args: [repoPath: string]; result: Worktree[] }
  'branches:exists': { args: [repoPath: string, branch: string]; result: boolean }
  /** Local branches, for the base-ref picker on create-worktree. */
  'branches:list': { args: [repoPath: string]; result: BranchInfo[] }
  /** Remote branches with no local worktree of their own, tip commit included. */
  'branches:remote': { args: [repoPath: string]; result: RemoteBranch[] }
  /**
   * The default folder for a new worktree, already de-duplicated. Main
   * resolves the worktree location from the store and `projectId` — beside
   * the repository or under the configured central directory — so the
   * renderer never carries its own copy of settings.
   */
  'worktrees:suggestPath': {
    args: [repoPath: string, branch: string, projectId: string]
    result: string
  }
  'worktrees:create': {
    args: [
      repoPath: string,
      options: {
        branch: string
        path: string
        baseRef?: string | null
        /** Runs `worktree add --track`, so the new branch tracks `baseRef` from birth. */
        track?: boolean
      }
    ]
    result: string
  }
  'worktrees:isDirty': { args: [worktreePath: string]; result: boolean }
  /** `git status --porcelain=v2` for one worktree, for the Working Tree tab. */
  'workingTree:get': { args: [worktreePath: string]; result: WorkingTreeChanges }
  /** One file's diff, for the third-panel diff viewer. */
  'diff:get': { args: [request: DiffRequest]; result: FileDiff }
  /** `git add -- <paths>`. Both sides of a rename have to be passed together. */
  'workingTree:stage': { args: [worktreePath: string, paths: string[]]; result: void }
  'workingTree:unstage': { args: [worktreePath: string, paths: string[]]; result: void }
  /**
   * Stages or unstages exactly one hunk from the diff panel, by
   * `DiffHunk.id`. Stateless: main re-runs the same diff fresh and finds the
   * hunk by id rather than trusting anything cached on this side — a stale
   * id (the file changed since the diff was shown) throws `AppError` with
   * code `diff-stale`, for the renderer to refetch and toast over. `file`
   * carries both sides of a rename, the same as `diff:get`'s `DiffRequest`.
   */
  'worktree:applyHunk': {
    args: [
      worktreePath: string,
      file: { path: string; origPath?: string | null },
      hunkId: string,
      direction: 'stage' | 'unstage'
    ]
    result: void
  }
  /** Irreversible: `git restore` for tracked paths, `git clean -f` for untracked ones. */
  'workingTree:discard': {
    args: [worktreePath: string, paths: { tracked: string[]; untracked: string[] }]
    result: void
  }
  'workingTree:commit': {
    args: [worktreePath: string, message: string, amend: boolean]
    result: void
  }
  /** `setUpstream` runs `push --set-upstream origin <branch>` instead of a plain `push`. */
  'workingTree:push': {
    args: [worktreePath: string, branch: string, setUpstream: boolean]
    result: void
  }
  /** Whether `user.email` is configured — a warning under the commit box, never a block. */
  'workingTree:hasIdentity': { args: [worktreePath: string]; result: boolean }
  /** A worktree's draft commit message. */
  'commitDraft:get': { args: [repositoryId: string, worktreePath: string]; result: string }
  'commitDraft:set': {
    args: [repositoryId: string, worktreePath: string, text: string]
    result: void
  }
  'worktrees:remove': {
    args: [repoPath: string, worktreePath: string, force: boolean]
    result: void
  }
  'worktrees:prune': { args: [repoPath: string]; result: void }
  /** A worktree's note, or the project's own when `worktreePath` is null. */
  'notes:get': { args: [repositoryId: string, worktreePath: string | null]; result: string }
  'notes:set': {
    args: [repositoryId: string, worktreePath: string | null, text: string]
    result: void
  }
  'system:copyText': { args: [text: string]; result: void }
  /** The presets to offer, in order, for this project on this machine. */
  'presets:list': {
    args: [repoPath: string | null, projectId: string | null]
    result: ResolvedPreset[]
  }
  'automation:script': { args: [repositoryId: string]; result: string }
  'automation:setScript': { args: [repositoryId: string, script: string]; result: void }
  /** Starts a run and returns its id; progress arrives on `automation:event`. */
  'automation:start': {
    args: [
      options: {
        repositoryId: string
        worktreePath: string
        values: SubstitutionValues
        startIndex?: number
      }
    ]
    result: string
  }
  'automation:cancel': { args: [runId: string]; result: void }
  /** Everything the settings UI needs to show and edit presets. */
  'presets:catalogue': { args: []; result: PresetCatalogue }
  'presets:setEnabled': { args: [presetId: string, enabled: boolean]; result: void }
  'presets:setOverride': {
    args: [projectId: string, presetId: string, override: 'on' | 'off' | null]
    result: void
  }
  'presets:save': { args: [preset: Preset]; result: void }
  'presets:delete': { args: [presetId: string]; result: void }
  'presets:reorder': { args: [orderedIds: string[]]; result: void }
  /** Shell presets resolve to a run id to attach a console to; the rest launch. */
  'presets:run': {
    args: [presetId: string, context: SubstitutionValues & { projectId: string | null }]
    result: PresetRunResult
  }
  /**
   * `git fetch --all --prune`. Serialised per repository in the service
   * layer, so two rapid clicks share one running fetch.
   */
  'repos:fetch': { args: [repoPath: string]; result: void }
  /**
   * Recent commits on `ref`, newest first. `repoPath` need only be somewhere
   * inside the repository — for a remote branch with no local checkout it is
   * the project's own path, since remote-tracking refs are visible from any
   * worktree that shares the repository.
   */
  'commits:recent': {
    args: [repoPath: string, ref: string, limit: number, skip: number]
    result: CommitLogEntry[]
  }
  'git:discover': { args: []; result: GitDiscoveryResult }
  /** Sets (or clears, with null) the manual git path and re-runs discovery. */
  'git:setPath': { args: [path: string | null]; result: GitDiscoveryResult }
  'store:status': { args: []; result: StoreStatus }
  'settings:get': { args: []; result: Settings }
  'settings:update': { args: [changes: Partial<Settings>]; result: Settings }
  /** A project's settings overrides. Absent fields mean inherit the app-level value. */
  'projectSettings:get': { args: [projectId: string]; result: ProjectSettings }
  'projectSettings:set': {
    args: [projectId: string, changes: Partial<ProjectSettings>]
    result: ProjectSettings
  }
  /** The project/worktree/remote-branch last selected, remembered across sessions. */
  'selection:get': { args: []; result: SelectionState }
  'selection:update': { args: [changes: Partial<SelectionState>]; result: SelectionState }
  /** Whether this build can update itself, and what version it is. */
  'updates:support': { args: []; result: UpdateSupport }
  /** The state the updater is in right now, for a window that just opened. */
  'updates:status': { args: []; result: UpdateStatus }
  /** A check the user asked for: unlike the scheduled one, it always answers. */
  'updates:check': { args: []; result: UpdateStatus }
  /** Restarts into a staged update. The only thing in the app that quits it. */
  'updates:install': { args: []; result: void }
  /**
   * Tells main which worktree's filesystem and git metadata to watch — the
   * selected worktree only, never every worktree or every project. `null`
   * stops watching. Driven by a `useEffect` on the selected worktree; main
   * owns one watcher at a time and replaces it on each call. See
   * `worktree:changed` for what a watched change produces.
   */
  'watch:select': { args: [worktreePath: string | null]; result: void }
}

/**
 * Why `worktree:changed` fired, so the renderer can invalidate precisely
 * rather than refetching everything on every push: `worktree` (a file inside
 * the working tree changed) means status alone is stale; `index` (the
 * resolved-per-worktree index file, see `worktree-watcher.ts`) means status
 * and diffs; `head`/`refs` (HEAD, refs/heads, or packed-refs, all under the
 * resolved git-common-dir) mean status, commits and the worktree list, since
 * those move the branch pointer itself.
 */
export type WorktreeChangeReason = 'worktree' | 'index' | 'head' | 'refs'

export type IpcChannel = keyof IpcInvokeContract

export type IpcArgs<C extends IpcChannel> = IpcInvokeContract[C]['args']
export type IpcReturn<C extends IpcChannel> = IpcInvokeContract[C]['result']

/**
 * The preload whitelists exactly these channels, so a channel declared above
 * and missing here fails at run time with "IPC channel not in contract" — the
 * one thing the compiler cannot see, because a `readonly IpcChannel[]` only
 * says every entry is a channel, never that every channel is an entry.
 *
 * `Record<IpcChannel, true>` says both. Adding a channel to the contract and
 * forgetting it here is a type error now, at the point of the omission.
 */
const CHANNELS: Record<IpcChannel, true> = {
  'system:pickFolder': true,
  'system:pickApplication': true,
  'projects:list': true,
  'projects:add': true,
  'projects:remove': true,
  'worktrees:list': true,
  'branches:exists': true,
  'branches:list': true,
  'branches:remote': true,
  'worktrees:suggestPath': true,
  'worktrees:create': true,
  'worktrees:isDirty': true,
  'workingTree:get': true,
  'diff:get': true,
  'workingTree:stage': true,
  'workingTree:unstage': true,
  'worktree:applyHunk': true,
  'workingTree:discard': true,
  'workingTree:commit': true,
  'workingTree:push': true,
  'workingTree:hasIdentity': true,
  'commitDraft:get': true,
  'commitDraft:set': true,
  'worktrees:remove': true,
  'worktrees:prune': true,
  'notes:get': true,
  'notes:set': true,
  'system:copyText': true,
  'presets:list': true,
  'presets:catalogue': true,
  'presets:setEnabled': true,
  'presets:setOverride': true,
  'presets:save': true,
  'presets:delete': true,
  'presets:reorder': true,
  'presets:run': true,
  'repos:fetch': true,
  'commits:recent': true,
  'automation:script': true,
  'automation:setScript': true,
  'automation:start': true,
  'automation:cancel': true,
  'git:discover': true,
  'git:setPath': true,
  'store:status': true,
  'settings:get': true,
  'settings:update': true,
  'projectSettings:get': true,
  'projectSettings:set': true,
  'selection:get': true,
  'selection:update': true,
  'updates:support': true,
  'updates:status': true,
  'updates:check': true,
  'updates:install': true,
  'watch:select': true
}

export const IPC_CHANNELS: readonly IpcChannel[] = Object.keys(CHANNELS) as IpcChannel[]

/**
 * Pushes from main to renderer. Unlike invokes these carry no reply, so the
 * payload is the whole contract.
 */
export interface IpcEventContract {
  'automation:event': AutomationEvent
  /** Menu accelerators, which the renderer turns into the matching action. */
  'app:refresh': void
  'app:newWorktree': void
  'app:openSettings': void
  /** Every updater transition, so the toast follows a download it did not start. */
  'updates:changed': UpdateStatus
  /**
   * A change detected under the watched worktree — see `watch:select` and
   * `WorktreeChangeReason`. Only ever describes the one worktree main is
   * currently watching.
   */
  'worktree:changed': { worktreePath: string; reason: WorktreeChangeReason }
}

export type IpcEventChannel = keyof IpcEventContract

/** Exhaustive for the same reason, and for the same failure. */
const EVENT_CHANNELS: Record<IpcEventChannel, true> = {
  'automation:event': true,
  'app:refresh': true,
  'app:newWorktree': true,
  'app:openSettings': true,
  'updates:changed': true,
  'worktree:changed': true
}

export const IPC_EVENT_CHANNELS: readonly IpcEventChannel[] = Object.keys(
  EVENT_CHANNELS
) as IpcEventChannel[]
