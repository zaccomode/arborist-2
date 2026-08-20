/**
 * The typed IPC contract between renderer and main.
 *
 * Every invoke channel is declared here with its argument tuple and result
 * type. Main-process handlers implement this contract; the preload script
 * whitelists exactly these channels; the renderer's api layer derives its
 * types from it. Adding a channel means adding it here first.
 */

import type { GitDiscoveryResult } from './domain'

export interface IpcInvokeContract {
  'system:ping': { args: []; result: string }
  'git:discover': { args: []; result: GitDiscoveryResult }
  /** Sets (or clears, with null) the manual git path and re-runs discovery. */
  'git:setPath': { args: [path: string | null]; result: GitDiscoveryResult }
}

export type IpcChannel = keyof IpcInvokeContract

export type IpcArgs<C extends IpcChannel> = IpcInvokeContract[C]['args']
export type IpcReturn<C extends IpcChannel> = IpcInvokeContract[C]['result']

export const IPC_CHANNELS: readonly IpcChannel[] = ['system:ping', 'git:discover', 'git:setPath']
