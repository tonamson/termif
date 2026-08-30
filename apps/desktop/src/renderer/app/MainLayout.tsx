import { useEffect, useState } from 'react'
import { useStore } from '../state/useStore.js'
import { createHostStore } from '../state/hostStore.js'
import type { App } from '../state/boot.js'
import { HostList } from '../views/HostList.js'
import { HostForm } from '../views/HostForm.js'
import { TerminalTabs } from '../views/TerminalTabs.js'
import { SftpBrowser } from '../views/SftpBrowser.js'
import { ForwardPanel } from '../views/ForwardPanel.js'
import { Titlebar, type Pane } from '../views/Titlebar.js'
import { useConnectFlow } from '../state/connectFlow.js'

export function MainLayout({ app }: { app: App }) {
  // Created once per mount and kept: recreating it would drop the loaded list.
  const [hostStore] = useState(() => createHostStore({ store: app.store }))
  const hosts = useStore(hostStore)

  const [pane, setPane] = useState<Pane>('terminals')
  const [editing, setEditing] = useState<{ id: string | null } | null>(null)

  const connect = useConnectFlow(app, hostStore)

  useEffect(() => {
    void hostStore.refresh()
    return app.store.onChange(() => void hostStore.refresh())
  }, [app.store, hostStore])

  const editingHost =
    editing?.id == null ? null : (hosts.hosts.find((h) => h.id === editing.id) ?? null)

  return (
    <div className="shell">
      <Titlebar pane={pane} onPaneChange={setPane} />
      <div className="layout">
        <aside className="layout__sidebar">
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
      </div>
      {connect.prompt}
    </div>
  )
}
