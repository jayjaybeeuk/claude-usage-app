/// <reference types="vite/client" />

import type { ElectronAPI } from '../shared/ipc-types'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
