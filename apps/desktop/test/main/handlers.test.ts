import { describe, expect, it, vi } from 'vitest'
import { CHANNELS } from '../../src/shared/ipc.js'
import { handlerNames } from '../../src/main/handlers.js'

describe('registerHandlers', () => {
  it('registers a handler for every declared channel', () => {
    // A channel with no handler fails only when a user reaches that feature;
    // this catches it at build time instead.
    const declared = new Set(Object.values(CHANNELS))
    const registered = new Set(handlerNames())

    const missing = [...declared].filter((c) => !registered.has(c))
    expect(missing, `channels with no handler: ${missing.join(', ')}`).toEqual([])
  })

  it('registers no handler for a channel that does not exist', () => {
    const declared = new Set<string>(Object.values(CHANNELS))
    const extra = handlerNames().filter((c) => !declared.has(c))
    expect(extra, `handlers with no channel: ${extra.join(', ')}`).toEqual([])
  })
})
