/**
 * The typed IPC contract between renderer and main.
 *
 * Every invoke channel is declared here with its argument tuple and result
 * type. Main-process handlers implement this contract; the preload script
 * whitelists exactly these channels; the renderer's api layer derives its
 * types from it. Adding a channel means adding it here first.
 */

import type { GitDiscoveryResult, StoreStatus, Worktree } from './domain'
import type { Preset, Repository, Settings } from './persisted'
import type { AutomationEvent } from './automation'
import type { PresetCatalogue, PresetRunResult, ResolvedPreset } from './presets'
import type { SubstitutionValues } from './substitution'

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
  /** The default sibling folder for a new worktree, already de-duplicated. */
  'worktrees:suggestPath': { args: [repoPath: string, branch: string]; result: string }
  'worktrees:create': {
    args: [repoPath: string, options: { branch: string; path: string; baseRef?: string | null }]
    result: string
  }
  'worktrees:isDirty': { args: [worktreePath: string]; result: boolean }
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
  'git:discover': { args: []; result: GitDiscoveryResult }
  /** Sets (or clears, with null) the manual git path and re-runs discovery. */
  'git:setPath': { args: [path: string | null]; result: GitDiscoveryResult }
  'store:status': { args: []; result: StoreStatus }
  'settings:get': { args: []; result: Settings }
  'settings:update': { args: [changes: Partial<Settings>]; result: Settings }
}

export type IpcChannel = keyof IpcInvokeContract

export type IpcArgs<C extends IpcChannel> = IpcInvokeContract[C]['args']
export type IpcReturn<C extends IpcChannel> = IpcInvokeContract[C]['result']

export const IPC_CHANNELS: readonly IpcChannel[] = [
  'system:pickFolder',
  'system:pickApplication',
  'projects:list',
  'projects:add',
  'projects:remove',
  'worktrees:list',
  'branches:exists',
  'worktrees:suggestPath',
  'worktrees:create',
  'worktrees:isDirty',
  'worktrees:remove',
  'worktrees:prune',
  'notes:get',
  'notes:set',
  'system:copyText',
  'presets:list',
  'presets:catalogue',
  'presets:setEnabled',
  'presets:setOverride',
  'presets:save',
  'presets:delete',
  'presets:reorder',
  'presets:run',
  'automation:script',
  'automation:setScript',
  'automation:start',
  'automation:cancel',
  'git:discover',
  'git:setPath',
  'store:status',
  'settings:get',
  'settings:update'
]

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
}

export type IpcEventChannel = keyof IpcEventContract

export const IPC_EVENT_CHANNELS: readonly IpcEventChannel[] = [
  'automation:event',
  'app:refresh',
  'app:newWorktree',
  'app:openSettings'
]
