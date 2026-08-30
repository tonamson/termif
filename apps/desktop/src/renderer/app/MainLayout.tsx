import { useEffect, useState } from 'react'
import { useStore } from '../state/useStore.js'
import { createHostStore } from '../state/hostStore.js'
import type { App } from '../state/boot.js'
import { HostList } from '../views/HostList.js'
import { HostForm } from '../views/HostForm.js'
import { TerminalTabs } from '../views/TerminalTabs.js'
import { SidebarResizer } from '../views/SidebarResizer.js'
import { SftpBrowser } from '../views/SftpBrowser.js'
import { ForwardPanel } from '../views/ForwardPanel.js'
import { Titlebar } from '../views/Titlebar.js'
import { Drawer } from '../views/Drawer.js'
import { Inspector } from '../views/Inspector.js'
import { useConnectFlow } from '../state/connectFlow.js'
import { t } from '@termif/core'

export function MainLayout({ app }: { app: App }) {
  const [hostStore] = useState(() => createHostStore({ store: app.store }))
  const hosts = useStore(hostStore)
  const prefs = useStore(app.prefs)

  const [editing, setEditing] = useState<{ id: string | null } | null>(null)

  const connect = useConnectFlow(app, hostStore)

  useEffect(() => {
    void hostStore.refresh()
    return app.store.onChange(() => void hostStore.refresh())
  }, [app.store, hostStore])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'j') {
        event.preventDefault()
        app.prefs.set('drawerTab', app.prefs.get().drawerTab === null ? 'files' : null)
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void hostStore
          .save({ label: 'New host', hostname: '', port: 22, username: '', tags: [], groupId: null }, null)
          .then((saved) => {
            if (saved) {
              setEditing({ id: saved.id })
              app.prefs.set('inspectorOpen', true)
            }
          })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [app.prefs, hostStore])

  const editingHost =
    editing?.id == null ? null : (hosts.hosts.find((h) => h.id === editing.id) ?? null)

  const selectedHost = hosts.hosts.find((h) => h.id === hosts.hosts[0]?.id) ?? hosts.hosts[0] ?? null
  const allGroups = [...new Set(hosts.hosts.map((h) => h.groupId).filter((g): g is string => g !== null && g !== ''))]

  return (
    <div className="shell">
      <Titlebar
        drawerTab={prefs.drawerTab}
        onDrawerTab={(tab) => app.prefs.set('drawerTab', tab)}
        inspectorOpen={prefs.inspectorOpen}
        onInspector={(open) => app.prefs.set('inspectorOpen', open)}
      />
      <div
        className="layout"
        data-inspector={prefs.inspectorOpen ? 'open' : 'closed'}
        style={{ ['--sidebar-w' as string]: `${prefs.sidebarWidth}px` }}
      >
        <aside className="layout__sidebar">
          <HostList
            hosts={hostStore.visibleHosts()}
            query={hosts.query}
            collapsedGroups={prefs.collapsedGroups}
            connectedIds={app.sessions.connectedHostIds()}
            onQueryChange={(q) => hostStore.setQuery(q)}
            onToggleGroup={(name) =>
              app.prefs.set(
                'collapsedGroups',
                prefs.collapsedGroups.includes(name)
                  ? prefs.collapsedGroups.filter((g) => g !== name)
                  : [...prefs.collapsedGroups, name],
              )
            }
            onConnect={(id) => void connect.start(id)}
            onEdit={(id) => setEditing({ id })}
            onDelete={(id) => void hostStore.remove(id)}
            onAdd={() => setEditing({ id: null })}
          />
          <SidebarResizer width={prefs.sidebarWidth} onWidth={(w) => app.prefs.set('sidebarWidth', w)} />
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
          ) : (
            <>
              <TerminalTabs app={app} />
              {prefs.drawerTab !== null && (
                <Drawer
                  tab={prefs.drawerTab}
                  height={prefs.drawerHeight}
                  onHeight={(px) => app.prefs.set('drawerHeight', px)}
                  onClose={() => app.prefs.set('drawerTab', null)}
                >
                  {prefs.drawerTab === 'files' ? <SftpBrowser app={app} /> : <ForwardPanel app={app} />}
                </Drawer>
              )}
            </>
          )}
        </main>
        {prefs.inspectorOpen && (
          <aside className="inspector">
            <Inspector
              host={selectedHost}
              credential={null}
              groups={allGroups}
              onSave={(input, secret) => hostStore.save(input, secret)}
              onPickKeyFile={async () => {
                const p = await (window as any).termif?.app?.pickFile?.()
                return p ?? null
              }}
            />
          </aside>
        )}
      </div>
      {connect.prompt}
    </div>
  )
}
