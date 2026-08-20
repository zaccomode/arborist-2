import type { ArboristApi } from './index'

declare global {
  interface Window {
    arborist: ArboristApi
  }
}

export {}
