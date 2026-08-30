import { useEffect, useState } from 'react'
import { t } from '@termif/core'
import type { SyncStatus } from '@termif/core'
import { useStore } from '../state/useStore.js'
import { createHostStore } from '../state/hostStore.js'
import type { App } from '../state/boot.js'
import { HostList } from '../views/HostList.js'
import { HostForm } from '../views/HostForm.js'
import { SyncBadge } from '../views/SyncBadge.js'
import { TerminalTabs } from '../views/TerminalTabs.js'
import { SftpBrowser } from '../views/SftpBrowser.js'
import { ForwardPanel } from '../views/ForwardPanel.js'
import { useConnectFlow } from '../state/connectFlow.js'

type Pane = 'terminals' | 'files' | 'forwards'

export function MainLayout({ app }: { app: App }) {
  // Created once per mount and kept: recreating it would drop the loaded list.
  const [hostStore] = useState(() =>
    createHostStore({
      store: app.store,
      vault: () => app.vaultStore.vault(),
      requestSync: () => app.sync?.requestSync(),
    }),
  )
  const hosts = useStore(hostStore)

  const [pane, setPane] = useState<Pane>('terminals')
  const [editing, setEditing] = useState<{ id: string | null } | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    app.sync?.status ?? { state: 'idle', lastSuccessAt: null, lastError: null },
  )

  const connect = useConnectFlow(app, hostStore)

  useEffect(() => {
    void hostStore.refresh()
    // The store emits on every local write, so the list stays live without polling.
    return app.store.onChange(() => void hostStore.refresh())
  }, [app.store, hostStore])

  useEffect(() => app.sync?.onStatus(setSyncStatus), [app.sync])

  const editingHost =
    editing?.id == null ? null : (hosts.hosts.find((h) => h.id === editing.id) ?? null)

  return (
    <div className="layout">
      <aside className="layout__sidebar">
        <SyncBadge status={syncStatus} onSyncNow={() => void app.sync?.syncNow()} />

        <HostList
          hosts={hostStore.visibleHosts()}
          query={hosts.query}
          onQueryChange={(q) => hostStore.setQuery(q)}
          onConnect={(id) => void connect.start(id)}
          onEdit={(id) => setEditing({ id })}
          onDelete={(id) => void hostStore.remove(id)}
          onAdd={() => setEditing({ id: null })}
        />
      </aside>

      <main className="layout__main">
        <nav className="layout__tabs" role="tablist">
          {(['terminals', 'files', 'forwards'] as const).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={pane === name}
              onClick={() => setPane(name)}
            >
              {t(`layout.tab.${name}`)}
            </button>
          ))}
        </nav>

        {editing !== null ? (
          <HostForm
            host={editingHost}
            onSave={async (input, secret) => {
              await hostStore.save(input, secret)
              setEditing(null)
            }}
            onCancel={() => setEditing(null)}
          />
        ) : pane === 'terminals' ? (
          <TerminalTabs app={app} />
        ) : pane === 'files' ? (
          <SftpBrowser app={app} />
        ) : (
          <ForwardPanel app={app} />
        )}
      </main>

      {connect.prompt}
    </div>
  )
}
