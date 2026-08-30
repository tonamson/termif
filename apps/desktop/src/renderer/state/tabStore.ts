import { createStore, type Observable } from './useStore.js'

export type TabState = 'live' | 'reconnecting' | 'closed'

export interface TabView {
  id: string
  sessionId: bigint
  title: string
  state: TabState
}

export interface TabsState {
  tabs: TabView[]
  activeId: string | null
}

export interface TabStore extends Observable<TabsState> {
  add(tab: { id: string; sessionId: bigint; title: string }): void
  close(id: string): void
  activate(id: string): void
  setState(id: string, state: TabState): void
  setSessionState(sessionId: bigint, state: TabState): void
}

export function createTabStore(): TabStore {
  const base = createStore<TabsState>({ tabs: [], activeId: null })

  /** Second tab on the same host becomes "web-1 (2)". */
  const uniqueTitle = (tabs: readonly TabView[], title: string): string => {
    const sameBase = tabs.filter((t) => t.title === title || t.title.startsWith(`${title} (`))
    return sameBase.length === 0 ? title : `${title} (${sameBase.length + 1})`
  }

  return {
    ...base,

    add({ id, sessionId, title }): void {
      base.set((current) => ({
        tabs: [
          ...current.tabs,
          { id, sessionId, title: uniqueTitle(current.tabs, title), state: 'live' },
        ],
        // The user just asked for this tab, so focus follows it.
        activeId: id,
      }))
    },

    close(id): void {
      base.set((current) => {
        const index = current.tabs.findIndex((t) => t.id === id)
        if (index === -1) return current

        const tabs = current.tabs.filter((t) => t.id !== id)
        if (current.activeId !== id) return { tabs, activeId: current.activeId }

        // Prefer the tab to the right, then the left — the behaviour every
        // tabbed interface has trained people to expect.
        const next = tabs[index] ?? tabs[index - 1] ?? null
        return { tabs, activeId: next?.id ?? null }
      })
    },

    activate(id): void {
      base.set((current) =>
        current.tabs.some((t) => t.id === id) ? { ...current, activeId: id } : current,
      )
    },

    setState(id, state): void {
      base.set((current) => ({
        ...current,
        tabs: current.tabs.map((t) => (t.id === id ? { ...t, state } : t)),
      }))
    },

    setSessionState(sessionId, state): void {
      base.set((current) => ({
        ...current,
        tabs: current.tabs.map((t) => (t.sessionId === sessionId ? { ...t, state } : t)),
      }))
    },
  }
}
