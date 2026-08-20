import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type IpcArgs, type IpcChannel, type IpcReturn } from '../shared/ipc-contract'
import type { IpcResult } from '../shared/result'

const allowedChannels = new Set<string>(IPC_CHANNELS)

export interface ArboristApi {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<IpcReturn<C>>>
}

const api: ArboristApi = {
  invoke: (channel, ...args) => {
    if (!allowedChannels.has(channel)) {
      throw new Error(`IPC channel not in contract: ${channel}`)
    }
    return ipcRenderer.invoke(channel, ...args)
  }
}

contextBridge.exposeInMainWorld('arborist', api)
