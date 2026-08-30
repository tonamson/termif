import type { Snippet, SnippetInput, Store } from '@termif/core'
import { createStore, type Observable } from './useStore.js'

export interface SnippetState {
  snippets: Snippet[]
  query: string
}

export interface SnippetStore extends Observable<SnippetState> {
  refresh(): Promise<void>
  setQuery(query: string): void
  visible(): Snippet[]
  save(input: SnippetInput): Promise<void>
  remove(id: string): Promise<void>
}

/**
 * A snippet is a command, and a command without a newline just sits at the
 * prompt. `\r` is left as-is: a body written for a device expecting CR is
 * deliberate, not a mistake to correct.
 */
export function withTrailingNewline(body: string): string {
  return body.endsWith('\n') || body.endsWith('\r') ? body : `${body}\n`
}

export function createSnippetStore(deps: {
  store: Store
  requestSync: () => void
}): SnippetStore {
  const base = createStore<SnippetState>({ snippets: [], query: '' })

  const reload = async (): Promise<void> => {
    const snippets = await deps.store.listSnippets()
    base.set((current) => ({ ...current, snippets }))
  }

  return {
    ...base,
    refresh: reload,

    setQuery(query): void {
      base.set((current) => ({ ...current, query }))
    },

    visible(): Snippet[] {
      const { snippets, query } = base.get()
      const needle = query.trim().toLowerCase()
      if (needle.length === 0) return snippets

      return snippets.filter((snippet) =>
        [snippet.label, snippet.body, ...snippet.tags].join(' ').toLowerCase().includes(needle),
      )
    },

    async save(input): Promise<void> {
      await deps.store.upsertSnippet(input)
      await reload()
      deps.requestSync()
    },

    async remove(id): Promise<void> {
      await deps.store.deleteSnippet(id)
      await reload()
      deps.requestSync()
    },
  }
}
