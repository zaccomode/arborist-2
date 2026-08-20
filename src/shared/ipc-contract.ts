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
  'git:discover',
  'git:setPath',
  'store:status'
]
