/**
 * The typed IPC contract between renderer and main.
 *
 * Every invoke channel is declared here with its argument tuple and result
 * type. Main-process handlers implement this contract; the preload script
 * whitelists exactly these channels; the renderer's api layer derives its
 * types from it. Adding a channel means adding it here first.
 */

export interface IpcInvokeContract {
  'system:ping': { args: []; result: string }
}

export type IpcChannel = keyof IpcInvokeContract

export type IpcArgs<C extends IpcChannel> = IpcInvokeContract[C]['args']
export type IpcReturn<C extends IpcChannel> = IpcInvokeContract[C]['result']

export const IPC_CHANNELS: readonly IpcChannel[] = ['system:ping']
