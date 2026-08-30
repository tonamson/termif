import { describe, expect, it } from 'vitest'
import { CHANNELS } from '../src/shared/ipc.js'

describe('CHANNELS', () => {
  it('namespaces every channel under termif:', () => {
    for (const [key, value] of Object.entries(CHANNELS)) {
      expect(value, `channel ${key}`).toMatch(/^termif:[a-z]+:[a-zA-Z]+$/)
    }
  })

  it('has no duplicate channel names, which would cross-wire two handlers', () => {
    const values = Object.values(CHANNELS)
    expect(new Set(values).size).toBe(values.length)
  })

  it('covers every area the app needs', () => {
    const areas = new Set(Object.values(CHANNELS).map((c) => c.split(':')[1]))
    expect(areas).toEqual(new Set(['ssh', 'db', 'secure', 'net', 'auth', 'app']))
  })

  it('is frozen, so a typo cannot add a channel at runtime', () => {
    expect(Object.isFrozen(CHANNELS)).toBe(true)
  })
})
