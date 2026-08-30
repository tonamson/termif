import {
  ForwardManager,
  SessionManager,
  Store,
  TransferManager,
  type Platform,
} from '@termif/core'
import { createTabStore, type TabStore } from './tabStore.js'

export interface App {
  platform: Platform
  store: Store
  sessions: SessionManager
  tabs: TabStore
  transfers: TransferManager
  forwards: ForwardManager
}

export async function bootApp(platform: Platform): Promise<App> {
  const store = await Store.open(platform)

  const sessions = new SessionManager({ ssh: platform.ssh, now: platform.now })
  const tabs = createTabStore()
  const transfers = new TransferManager({ ssh: platform.ssh })
  const forwards = new ForwardManager({ ssh: platform.ssh, platformKind: 'desktop' })

  sessions.onBridgeEvent((event) => {
    transfers.handleEvent(event)
    forwards.handleEvent(event)
  })

  await sessions.start()

  return { platform, store, sessions, tabs, transfers, forwards }
}
