import { describe, expect, it } from 'vitest'
import { Store } from '@termif/core'
import { createSnippetStore, withTrailingNewline } from '../../src/renderer/state/snippetStore.js'
import { fakePlatform } from './fakes/platform.js'

async function setup() {
  const platform = await fakePlatform()
  const store = await Store.open(platform)
  const snippetStore = createSnippetStore({ store })
  return { store, snippetStore }
}

describe('snippetStore', () => {
  it('saves and lists a snippet', async () => {
    const { snippetStore } = await setup()
    await snippetStore.save({ label: 'tail nginx', body: 'tail -f /var/log/nginx/error.log', tags: ['nginx'] })

    expect(snippetStore.get().snippets).toHaveLength(1)
    expect(snippetStore.get().snippets[0]?.label).toBe('tail nginx')
  })

  it('filters by label, body, and tag', async () => {
    const { snippetStore } = await setup()
    await snippetStore.save({ label: 'tail nginx', body: 'tail -f /var/log/nginx/error.log', tags: ['web'] })
    await snippetStore.save({ label: 'disk usage', body: 'df -h', tags: ['ops'] })

    const matches = (query: string): string[] => {
      snippetStore.setQuery(query)
      return snippetStore.visible().map((s) => s.label)
    }

    expect(matches('nginx')).toEqual(['tail nginx'])
    expect(matches('df')).toEqual(['disk usage'])
    expect(matches('ops')).toEqual(['disk usage'])
    expect(matches('')).toEqual(['disk usage', 'tail nginx'])
  })

  it('updates an existing snippet in place', async () => {
    const { snippetStore } = await setup()
    await snippetStore.save({ label: 'a', body: 'ls', tags: [] })
    const id = snippetStore.get().snippets[0]!.id

    await snippetStore.save({ id, label: 'a renamed', body: 'ls -la', tags: [] })

    expect(snippetStore.get().snippets).toHaveLength(1)
    expect(snippetStore.get().snippets[0]?.body).toBe('ls -la')
  })

  it('removes a snippet', async () => {
    const { snippetStore } = await setup()
    await snippetStore.save({ label: 'a', body: 'ls', tags: [] })
    await snippetStore.remove(snippetStore.get().snippets[0]!.id)
    expect(snippetStore.get().snippets).toEqual([])
  })

  it('removes without extra sync plumbing', async () => {
    const { snippetStore } = await setup()
    await snippetStore.save({ label: 'a', body: 'ls', tags: [] })
    await snippetStore.remove(snippetStore.get().snippets[0]!.id)
    expect(snippetStore.get().snippets).toHaveLength(0)
  })
})

describe('withTrailingNewline', () => {
  it('adds a newline so a one-line command runs', () => {
    expect(withTrailingNewline('df -h')).toBe('df -h\n')
  })

  it('does not double an existing newline', () => {
    expect(withTrailingNewline('df -h\n')).toBe('df -h\n')
  })

  it('leaves a body ending in a carriage return alone', () => {
    // Some snippets are written for a device expecting CR; do not "fix" them.
    expect(withTrailingNewline('df -h\r')).toBe('df -h\r')
  })

  it('handles a multi-line body', () => {
    expect(withTrailingNewline('cd /tmp\nls')).toBe('cd /tmp\nls\n')
  })
})
