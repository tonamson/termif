import {
  ForwardManager,
  SessionManager,
  SheetClient,
  Store,
  SyncEngine,
  TransferManager,
  type Platform,
} from '@termif/core'
import type { TermifApi } from '../../shared/ipc.js'
import { createTabStore, type TabStore } from './tabStore.js'
import { createVaultStore, type VaultStore } from './vaultStore.js'

export interface App {
  platform: Platform
  store: Store
  vaultStore: VaultStore
  sessions: SessionManager
  tabs: TabStore
  transfers: TransferManager
  forwards: ForwardManager
  sync: SyncEngine | null
  setSpreadsheet(spreadsheetId: string): void
}

const SPREADSHEET_KEY = 'spreadsheetId'

/**
 * Assembles core once. The managers are long-lived and share one drain loop, so
 * they are created here rather than inside a component that could remount.
 */
export async function bootApp(platform: Platform, api: TermifApi): Promise<App> {
  const store = await Store.open(platform)
  const vaultStore = createVaultStore({ platform, store })

  const sessions = new SessionManager({ ssh: platform.ssh, now: platform.now })
  const tabs = createTabStore()
  const transfers = new TransferManager({ ssh: platform.ssh })
  const forwards = new ForwardManager({ ssh: platform.ssh, platformKind: 'desktop' })

  // Transfer and forward events arrive on the same queue the sessions manager
  // drains, so they are forwarded here rather than opened as a second loop.
  sessions.onBridgeEvent((event) => {
    transfers.handleEvent(event)
    forwards.handleEvent(event)
  })

  await sessions.start()
  await vaultStore.boot()

  const client = new SheetClient(platform.net, () => api.auth.accessToken())
  const stored = await store.getMetaValue(SPREADSHEET_KEY)

  const app: App = {
    platform,
    store,
    vaultStore,
    sessions,
    tabs,
    transfers,
    forwards,
    sync:
      stored === null
        ? null
        : new SyncEngine({ store, client, spreadsheetId: stored, now: platform.now }),
    setSpreadsheet(spreadsheetId: string): void {
      void store.setMetaValue(SPREADSHEET_KEY, spreadsheetId)
      app.sync = new SyncEngine({ store, client, spreadsheetId, now: platform.now })
    },
  }

  return app
}
