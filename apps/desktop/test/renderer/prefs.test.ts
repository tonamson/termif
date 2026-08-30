import { describe, expect, it } from 'vitest'
import { Store } from '@termif/core'
import { createPrefsStore, DEFAULT_PREFS, PREFS_KEY } from '../../src/renderer/state/prefs.js'
import { fakePlatform } from './fakes/platform.js'

async function setup() {
  const platform = await fakePlatform()
  const store = await Store.open(platform)
  const prefs = createPrefsStore({ store, writeDelayMs: 0 })
  return { store, prefs }
}

describe('prefsStore', () => {
  it('starts from the defaults when nothing is stored', async () => {
    const { prefs } = await setup()
    await prefs.load()
    expect(prefs.get()).toEqual(DEFAULT_PREFS)
  })

  it('persists a change and reads it back through a new store', async () => {
    const { store, prefs } = await setup()
    await prefs.load()
    prefs.set('sidebarWidth', 320)
    await prefs.flush()

    const second = createPrefsStore({ store, writeDelayMs: 0 })
    await second.load()
    expect(second.get().sidebarWidth).toBe(320)
  })

  it('updates observers before the write lands', async () => {
    const { prefs } = await setup()
    await prefs.load()
    prefs.set('drawerTab', 'files')
    expect(prefs.get().drawerTab).toBe('files')
  })

  it('falls back to the defaults when the stored blob is corrupt', async () => {
    const { store, prefs } = await setup()
    await store.setMetaValue(PREFS_KEY, '{not json')
    await prefs.load()
    expect(prefs.get()).toEqual(DEFAULT_PREFS)
  })

  it('ignores unknown keys and fills missing ones from the defaults', async () => {
    const { store, prefs } = await setup()
    await store.setMetaValue(PREFS_KEY, JSON.stringify({ sidebarWidth: 300, bogus: 1 }))
    await prefs.load()
    expect(prefs.get().sidebarWidth).toBe(300)
    expect(prefs.get().showHidden).toBe(DEFAULT_PREFS.showHidden)
    expect((prefs.get() as unknown as Record<string, unknown>).bogus).toBeUndefined()
  })

  it('clamps a sidebar width outside the allowed range', async () => {
    const { store, prefs } = await setup()
    await store.setMetaValue(PREFS_KEY, JSON.stringify({ sidebarWidth: 9000 }))
    await prefs.load()
    expect(prefs.get().sidebarWidth).toBe(400)
  })

  it('coalesces rapid writes into one', async () => {
    const { store, prefs } = await setup()
    const slow = createPrefsStore({ store, writeDelayMs: 20 })
    await slow.load()
    let writes = 0
    const original = store.setMetaValue.bind(store)
    store.setMetaValue = async (k, v) => {
      writes += 1
      return original(k, v)
    }
    for (let w = 200; w <= 260; w += 10) slow.set('sidebarWidth', w)
    await slow.flush()
    expect(writes).toBe(1)
  })
})
