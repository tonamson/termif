import { beforeAll, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { TerminalTabs } from '../../src/renderer/views/TerminalTabs.js'
import { createTabStore } from '../../src/renderer/state/tabStore.js'
import type { App } from '../../src/renderer/state/boot.js'

/** Only the pieces `TerminalTabs` touches; the rest of `App` is not exercised. */
function makeApp(tabs: ReturnType<typeof createTabStore>): App {
  const noop = (): (() => void) => () => {}
  return {
    tabs,
    sessions: {
      onTabClosed: noop,
      onSessionState: noop,
      closeTab: async () => {},
      subscribeTab: noop,
      channelIdForTab: () => undefined,
      write: async () => {},
      resize: async () => {},
    },
  } as unknown as App
}

// xterm asks the window about reduced motion; jsdom has no matchMedia.
beforeAll(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    media: '',
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as typeof window.matchMedia
})

describe('TerminalTabs', () => {
  it('shows a tab opened after mount instead of hiding it in the overflow menu', async () => {
    const tabs = createTabStore()
    render(<TerminalTabs app={makeApp(tabs)} />)

    expect(screen.getByText(/double-click a host/i)).toBeInTheDocument()

    await act(async () => {
      tabs.add({ id: 't1', title: 'web-1', sessionId: 1n })
    })

    expect(screen.getByRole('tab', { name: /web-1/ })).toBeInTheDocument()
    expect(screen.queryByText('+1')).not.toBeInTheDocument()
  })

  it('Cmd/Ctrl+W closes the active tab (case-insensitive)', async () => {
    const tabs = createTabStore()
    const closeTab = vi.fn(async () => {})
    const app = {
      tabs,
      sessions: {
        onTabClosed: () => () => {},
        onSessionState: () => () => {},
        closeTab,
        subscribeTab: () => () => {},
        channelIdForTab: () => undefined,
      },
    } as unknown as App
    render(<TerminalTabs app={app} />)
    await act(async () => {
      tabs.add({ id: 't1', title: 'web-1', sessionId: 1n })
      tabs.activate('t1')
    })
    // let effect re-register with activeId
    await act(async () => {})

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', metaKey: true, bubbles: true }))
    await act(async () => {})
    expect(closeTab).toHaveBeenCalledWith('t1')
    closeTab.mockClear()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'W', ctrlKey: true, bubbles: true }))
    await act(async () => {})
    expect(closeTab).toHaveBeenCalledWith('t1')
  })
})
