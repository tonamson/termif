import {
  ForwardManager,
  SessionManager,
  Store,
  TransferManager,
  type Platform,
} from '@termif/core'
import { createTabStore, type TabStore } from './tabStore.js'
import { createPrefsStore, type PrefsStore } from './prefs.js'

export interface App {
  platform: Platform
  store: Store
  prefs: PrefsStore
  sessions: SessionManager
  tabs: TabStore
  transfers: TransferManager
  forwards: ForwardManager
}

import { logToFile } from './log.js'

export async function bootApp(platform: Platform): Promise<App> {
  logToFile('info', 'boot', 'Store.open start')
  const store = await Store.open(platform)
  logToFile('info', 'boot', 'Store.open ok')
  const prefs = createPrefsStore({ store })
  await prefs.load()

  const sessions = new SessionManager({ ssh: platform.ssh, now: platform.now })
  const tabs = createTabStore()
  const transfers = new TransferManager({ ssh: platform.ssh })
  const forwards = new ForwardManager({ ssh: platform.ssh, platformKind: 'desktop' })

  sessions.onBridgeEvent((event) => {
    transfers.handleEvent(event)
    forwards.handleEvent(event)
  })

  await sessions.start()

  return { platform, store, prefs, sessions, tabs, transfers, forwards }
}
