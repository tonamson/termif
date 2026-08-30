import { useEffect, useState, type KeyboardEvent } from 'react'
import { t, type Snippet, type SnippetInput } from '@termif/core'
import type { App } from '../state/boot.js'
import { createSnippetStore, withTrailingNewline } from '../state/snippetStore.js'
import { useStore } from '../state/useStore.js'

export interface SnippetPaletteViewProps {
  snippets: readonly Snippet[]
  query: string
  onQueryChange(query: string): void
  onSend(body: string): Promise<void>
  onSave(input: SnippetInput): Promise<void>
  onRemove(id: string): Promise<void>
  onClose(): void
}

/** Presentational half, so the keyboard behaviour is testable without a store. */
export function SnippetPaletteView({
  snippets,
  query,
  onQueryChange,
  onSend,
  onSave,
  onRemove,
  onClose,
}: SnippetPaletteViewProps) {
  const [highlight, setHighlight] = useState(0)
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [body, setBody] = useState('')
  // Mirror the `query` prop locally so typing is not reset by React on every
  // keystroke before the store's query catches up (same pattern as HostList).
  const [searchText, setSearchText] = useState(query)
  useEffect(() => setSearchText(query), [query])

  // A shrinking list must not leave the highlight past the end.
  useEffect(() => {
    setHighlight((current) => Math.min(current, Math.max(snippets.length - 1, 0)))
  }, [snippets.length])

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((current) => Math.min(current + 1, snippets.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const chosen = snippets[highlight]
      if (chosen !== undefined) void onSend(withTrailingNewline(chosen.body))
    }
  }

  const saveNew = async (): Promise<void> => {
    if (label.trim().length === 0 || body.trim().length === 0) return
    await onSave({ label: label.trim(), body, tags: [] })
    setLabel('')
    setBody('')
    setAdding(false)
  }

  return (
    <div className="snippet-palette" role="dialog" aria-label={t('snippet.search')}>
      <input
        type="search"
        role="searchbox"
        aria-label={t('snippet.search')}
        placeholder={t('snippet.search')}
        autoFocus
        value={searchText}
        onChange={(e) => {
          setSearchText(e.target.value)
          onQueryChange(e.target.value)
        }}
        onKeyDown={onKeyDown}
      />

      {snippets.length === 0 ? (
        <p>{t('snippet.noMatch')}</p>
      ) : (
        <ul>
          {snippets.map((snippet, index) => (
            <li
              key={snippet.id}
              className={index === highlight ? 'snippet--highlight' : undefined}
              aria-current={index === highlight}
            >
              <button
                type="button"
                aria-label={t('snippet.send', { label: snippet.label })}
                onClick={() => void onSend(withTrailingNewline(snippet.body))}
              >
                <span className="snippet__label">{snippet.label}</span>
                <code className="snippet__body">{snippet.body}</code>
              </button>
              <button
                type="button"
                aria-label={t('snippet.delete', { label: snippet.label })}
                onClick={() => void onRemove(snippet.id)}
              >
                {t('snippet.removeGlyph')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="snippet-palette__form">
          <label htmlFor="snippet-label">{t('snippet.label')}</label>
          <input id="snippet-label" value={label} onChange={(e) => setLabel(e.target.value)} />

          <label htmlFor="snippet-body">{t('snippet.command')}</label>
          <textarea
            id="snippet-body"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />

          <button type="button" onClick={() => void saveNew()}>
            {t('snippet.save')}
          </button>
          <button type="button" onClick={() => setAdding(false)}>
            {t('snippet.cancel')}
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)}>
          {t('snippet.new')}
        </button>
      )}
    </div>
  )
}

/** Wired half: owns the store and hands the view its data. */
export function SnippetPalette({
  app,
  onSend,
  onClose,
}: {
  app: App
  onSend(body: string): Promise<void>
  onClose(): void
}) {
  const [snippetStore] = useState(() =>
    createSnippetStore({ store: app.store, requestSync: () => app.sync?.requestSync() }),
  )
  const state = useStore(snippetStore)

  useEffect(() => {
    void snippetStore.refresh()
  }, [snippetStore])

  return (
    <SnippetPaletteView
      snippets={snippetStore.visible()}
      query={state.query}
      onQueryChange={(q) => snippetStore.setQuery(q)}
      onSend={onSend}
      onSave={(input) => snippetStore.save(input)}
      onRemove={(id) => snippetStore.remove(id)}
      onClose={onClose}
    />
  )
}
