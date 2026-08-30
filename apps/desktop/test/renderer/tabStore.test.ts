import { describe, expect, it } from 'vitest'
import { createTabStore } from '../../src/renderer/state/tabStore.js'

describe('tabStore', () => {
  it('starts empty', () => {
    const store = createTabStore()
    expect(store.get().tabs).toEqual([])
    expect(store.get().activeId).toBeNull()
  })

  it('activates the first tab it adds', () => {
    const store = createTabStore()
    store.add({ id: 't1', sessionId: 1n, title: 'web-1' })
    expect(store.get().activeId).toBe('t1')
  })

  it('activates each newly added tab, since the user just asked for it', () => {
    const store = createTabStore()
    store.add({ id: 't1', sessionId: 1n, title: 'web-1' })
    store.add({ id: 't2', sessionId: 1n, title: 'web-1' })
    expect(store.get().activeId).toBe('t2')
  })

  it('numbers repeat tabs on the same host so they are distinguishable', () => {
    const store = createTabStore()
    store.add({ id: 't1', sessionId: 1n, title: 'web-1' })
    store.add({ id: 't2', sessionId: 1n, title: 'web-1' })
    expect(store.get().tabs.map((t) => t.title)).toEqual(['web-1', 'web-1 (2)'])
  })

  it('moves activation to the neighbour when the active tab closes', () => {
    const store = createTabStore()
    store.add({ id: 't1', sessionId: 1n, title: 'a' })
    store.add({ id: 't2', sessionId: 1n, title: 'b' })
    store.add({ id: 't3', sessionId: 1n, title: 'c' })

    store.activate('t2')
    store.close('t2')

    // Prefer the tab to the right, which is what a browser does.
    expect(store.get().activeId).toBe('t3')
  })

  it('falls back to the left neighbour when closing the last tab', () => {
    const store = createTabStore()
    store.add({ id: 't1', sessionId: 1n, title: 'a' })
    store.add({ id: 't2', sessionId: 1n, title: 'b' })

    store.activate('t2')
    store.close('t2')

    expect(store.get().activeId).toBe('t1')
  })

  it('clears activation when the last tab closes', () => {
    const store = createTabStore()
    store.add({ id: 't1', sessionId: 1n, title: 'a' })
    store.close('t1')
    expect(store.get().tabs).toEqual([])
    expect(store.get().activeId).toBeNull()
  })

  it('keeps activation when a non-active tab closes', () => {
    const store = createTabStore()
    store.add({ id: 't1', sessionId: 1n, title: 'a' })
    store.add({ id: 't2', sessionId: 1n, title: 'b' })
    store.activate('t1')
    store.close('t2')
    expect(store.get().activeId).toBe('t1')
  })

  it('marks a tab reconnecting without removing it, so scrollback survives', () => {
    const store = createTabStore()
    store.add({ id: 't1', sessionId: 1n, title: 'a' })
    store.setState('t1', 'reconnecting')

    expect(store.get().tabs[0]?.state).toBe('reconnecting')
    expect(store.get().tabs).toHaveLength(1)
  })

  it('marks every tab on a session at once', () => {
    const store = createTabStore()
    store.add({ id: 't1', sessionId: 1n, title: 'a' })
    store.add({ id: 't2', sessionId: 1n, title: 'b' })
    store.add({ id: 't3', sessionId: 2n, title: 'c' })

    store.setSessionState(1n, 'reconnecting')

    expect(store.get().tabs.map((t) => t.state)).toEqual(['reconnecting', 'reconnecting', 'live'])
  })

  it('ignores an unknown tab id rather than throwing at a UI callsite', () => {
    const store = createTabStore()
    expect(() => store.close('nope')).not.toThrow()
    expect(() => store.activate('nope')).not.toThrow()
    expect(() => store.setState('nope', 'closed')).not.toThrow()
  })
})
