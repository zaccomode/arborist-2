/**
 * The typed IPC contract between renderer and main.
 *
 * Every invoke channel is declared here with its argument tuple and result
 * type. Main-process handlers implement this contract; the preload script
 * whitelists exactly these channels; the renderer's api layer derives its
 * types from it. Adding a channel means adding it here first.
 */

import type { GitDiscoveryResult, StoreStatus, Worktree } from './domain'
import type { Repository } from './persisted'

export interface IpcInvokeContract {
  /** Native folder picker. Resolves null when the user cancels. */
  'system:pickFolder': { args: []; result: string | null }
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
  'git:discover': { args: []; result: GitDiscoveryResult }
  /** Sets (or clears, with null) the manual git path and re-runs discovery. */
  'git:setPath': { args: [path: string | null]; result: GitDiscoveryResult }
  'store:status': { args: []; result: StoreStatus }
}

export type IpcChannel = keyof IpcInvokeContract

export type IpcArgs<C extends IpcChannel> = IpcInvokeContract[C]['args']
export type IpcReturn<C extends IpcChannel> = IpcInvokeContract[C]['result']

export const IPC_CHANNELS: readonly IpcChannel[] = [
  'system:pickFolder',
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
  'git:discover',
  'git:setPath',
  'store:status'
]
