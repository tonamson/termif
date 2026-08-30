import type { App } from './boot.js'
import type { HostStore } from './hostStore.js'

export function useConnectFlow(app: App, hostStore: HostStore): {
  start(id: string): Promise<void>
  prompt: null
} {
  void app
  void hostStore
  return { start: async () => {}, prompt: null }
}
