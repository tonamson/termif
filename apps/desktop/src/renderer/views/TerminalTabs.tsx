import { useEffect, useRef, useState } from 'react'
import { t } from '@termif/core'
import type { App } from '../state/boot.js'
import { useStore } from '../state/useStore.js'
import { TerminalPane } from './TerminalPane.js'
import { SnippetPalette } from './SnippetPalette.js'
import { Menu } from './Menu.js'

export function TerminalTabs({ app }: { app: App }) {
  const tabStore = app.tabs
  const { tabs, activeId } = useStore(tabStore)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const bar = useRef<HTMLDivElement>(null)
  // At least one tab is always shown: measuring happens after layout, and a
  // zero here would hide the only tab behind the overflow menu.
  const [visibleCount, setVisibleCount] = useState(1)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

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

      if (event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
      if (event.key.toLowerCase() === 'w' && activeId !== null) {
        event.preventDefault()
        void app.sessions.closeTab(activeId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeId, app.sessions])

  useEffect(() => {
    const element = bar.current
    if (element === null) return
    const measure = (): void => {
      const room = Math.max(1, Math.floor((element.clientWidth - 44) / 120))
      setVisibleCount(room)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
    // The bar does not exist until the first tab does, so re-attach when the
    // count changes rather than only on mount.
  }, [tabs.length])

  const shown = tabs.slice(0, visibleCount)
  const hidden = tabs.slice(visibleCount)

  if (tabs.length === 0) {
    return <p className="terminal-tabs__empty">{t('terminal.empty')}</p>
  }

  return (
    <div className="terminal-tabs-view" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div ref={bar} role="tablist" className="terminal-tabs__bar terminal-bar">
        <div className="terminal-tabs">
          {shown.map((tab) => (
            <div
              key={tab.id}
              className={`terminal-tabs__tab terminal-tab terminal-tabs__tab--${tab.state}`}
              data-active={tab.id === activeId}
            >
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
                className="terminal-tab__close"
                aria-label={t('terminal.close', { title: tab.title })}
                onClick={() => void app.sessions.closeTab(tab.id)}
              >
                ×
              </button>
            </div>
          ))}
          {hidden.length > 0 && (
            <button
              type="button"
              className="terminal-bar__btn"
              onClick={(e) => {
                const rect = (e.target as HTMLElement).getBoundingClientRect()
                setMenu({ x: rect.left, y: rect.bottom })
              }}
            >
              +{hidden.length}
            </button>
          )}
        </div>
        <div className="terminal-bar__actions" style={{ display: 'flex', gap: '4px' }}>
          <button
            type="button"
            className="terminal-bar__btn"
            title="Snippet Palette (⌘K)"
            onClick={() => setPaletteOpen((prev) => !prev)}
          >
            ⌘K
          </button>
        </div>
      </div>
      {menu !== null && (
        <Menu
          items={hidden.map((tab) => ({ id: tab.id, label: tab.title }))}
          x={menu.x}
          y={menu.y}
          onPick={(id) => {
            tabStore.activate(id)
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
        />
      )}

      {tabs.some((tab) => tab.state === 'reconnecting') && (
        <p role="status" className="terminal-tabs__notice">
          {t('session.reconnecting')}
        </p>
      )}

      <div className="terminal-tabs__panes terminal-canvas-container" style={{ flex: 1, position: 'relative' }}>
        {tabs.map((tab) => (
          <TerminalPane
            key={tab.id}
            tabId={tab.id}
            sessions={app.sessions}
            active={tab.id === activeId}
          />
        ))}
      </div>

      {paletteOpen && (
        <SnippetPalette
          snippets={app.snippets}
          onInsert={(body) => {
            if (activeId !== null) {
              const session = app.sessions.getSession(activeId)
              session?.send(body)
            }
            setPaletteOpen(false)
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  )
}
