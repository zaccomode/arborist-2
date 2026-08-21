import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  IPC_EVENT_CHANNELS,
  type IpcArgs,
  type IpcChannel,
  type IpcEventChannel,
  type IpcEventContract,
  type IpcReturn
} from '../shared/ipc-contract'
import type { IpcResult } from '../shared/result'

const allowedChannels = new Set<string>(IPC_CHANNELS)
const allowedEventChannels = new Set<string>(IPC_EVENT_CHANNELS)

export interface ArboristApi {
  /** The renderer has no process object; a few screens are platform-specific. */
  platform: NodeJS.Platform
  invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<IpcReturn<C>>>
  /** Subscribes to a main-process push. Returns the unsubscribe function. */
  subscribe<C extends IpcEventChannel>(
    channel: C,
    listener: (payload: IpcEventContract[C]) => void
  ): () => void
}

const api: ArboristApi = {
  platform: process.platform,
  invoke: (channel, ...args) => {
    if (!allowedChannels.has(channel)) {
      throw new Error(`IPC channel not in contract: ${channel}`)
    }
    return ipcRenderer.invoke(channel, ...args)
  },
  subscribe: (channel, listener) => {
    if (!allowedEventChannels.has(channel)) {
      throw new Error(`IPC event channel not in contract: ${channel}`)
    }
    const handler = (_event: unknown, payload: unknown): void =>
      listener(payload as IpcEventContract[typeof channel])
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

contextBridge.exposeInMainWorld('arborist', api)
