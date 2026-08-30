import { useEffect, useState } from 'react'
import { t } from '@termif/core'
import type { App } from '../state/boot.js'
import { useStore } from '../state/useStore.js'
import { TerminalPane } from './TerminalPane.js'
import { SnippetPalette } from './SnippetPalette.js'

export function TerminalTabs({ app }: { app: App }) {
  const tabStore = app.tabs
  const { tabs, activeId } = useStore(tabStore)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Tabs are opened by the connect flow through the session manager, so this
  // component learns about them by listening rather than by being told.
  useEffect(() => {
    const offClosed = app.sessions.onTabClosed((tabId) => tabStore.close(tabId))

    const offState = app.sessions.onSessionState((sessionId, state) => {
      tabStore.setSessionState(
        sessionId,
        state === 'connected' ? 'live' : state === 'reconnecting' ? 'reconnecting' : 'closed',
      )
    })

    return () => {
      offClosed()
      offState()
    }
  }, [app.sessions, tabStore])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return

      if (event.key === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
      if (event.key === 'w' && activeId !== null) {
        event.preventDefault()
        void app.sessions.closeTab(activeId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeId, app.sessions])

  if (tabs.length === 0) {
    return <p className="terminal-tabs__empty">{t('terminal.empty')}</p>
  }

  return (
    <div className="terminal-tabs">
      <div role="tablist" className="terminal-tabs__bar">
        {tabs.map((tab) => (
          <div key={tab.id} className={`terminal-tabs__tab terminal-tabs__tab--${tab.state}`}>
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === activeId}
              onClick={() => tabStore.activate(tab.id)}
            >
              {tab.title}
              {tab.state === 'reconnecting' && ' …'}
            </button>
            <button
              type="button"
              aria-label={t('terminal.close', { title: tab.title })}
              onClick={() => void app.sessions.closeTab(tab.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {tabs.some((tab) => tab.state === 'reconnecting') && (
        <p role="status" className="terminal-tabs__notice">
          {t('session.reconnecting')}
        </p>
      )}

      <div className="terminal-tabs__panes">
        {tabs.map((tab) => (
          <TerminalPane
            key={tab.id}
            tabId={tab.id}
            sessions={app.sessions}
            active={tab.id === activeId}
          />
        ))}
      </div>

      {paletteOpen && activeId !== null && (
        <SnippetPalette
          app={app}
          onSend={async (body) => {
            await app.sessions.writeToTab(activeId, new TextEncoder().encode(body))
            setPaletteOpen(false)
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  )
}
