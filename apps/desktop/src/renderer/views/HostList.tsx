import { useEffect, useState, type KeyboardEvent } from 'react'
import { t } from '@termif/core'
import type { Host } from '@termif/core'

export interface HostListProps {
  hosts: readonly Host[]
  query: string
  onQueryChange(query: string): void
  onConnect(id: string): void
  onEdit(id: string): void
  onDelete(id: string): void
  onAdd(): void
}

export function HostList({
  hosts,
  query,
  onQueryChange,
  onConnect,
  onEdit,
  onDelete,
  onAdd,
}: HostListProps) {
  // Confirming inline rather than in a modal: a delete is reversible for 90
  // days via the tombstone, so a second click is proportionate friction.
  const [confirming, setConfirming] = useState<string | null>(null)

  // The search box owns its text and reports it upward: the parent re-renders
  // with the same value via `query`, so a controlled input would otherwise be
  // reset by React on every keystroke before `query` catches up.
  const [searchText, setSearchText] = useState(query)

  // Re-sync when the store's query changes from elsewhere, so the box and the
  // empty-state message (which reads the `query` prop) never diverge. Local
  // typing is unaffected: this effect fires only when `query` changes.
  useEffect(() => setSearchText(query), [query])

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>, id: string): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onConnect(id)
    }
  }

  return (
    <nav className="host-list">
      <div className="host-list__toolbar">
        <input
          type="search"
          role="searchbox"
          aria-label={t('host.search')}
          placeholder={t('host.search')}
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value)
            onQueryChange(e.target.value)
          }}
        />
        <button type="button" onClick={onAdd}>
          {t('host.add')}
        </button>
      </div>

      {hosts.length === 0 ? (
        <p className="host-list__empty">
          {query.trim().length === 0 ? t('host.empty') : t('host.noMatch')}
        </p>
      ) : (
        <ul>
          {hosts.map((host) => (
            <li
              key={host.id}
              tabIndex={0}
              onDoubleClick={() => onConnect(host.id)}
              onKeyDown={(e) => onKeyDown(e, host.id)}
            >
              <span className="host-list__label">{host.label}</span>
              <span className="host-list__target">
                {host.username}@{host.hostname}
                {host.port !== 22 && `:${host.port}`}
              </span>

              {host.tags.length > 0 && (
                <span className="host-list__tags">
                  {host.tags.map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                </span>
              )}

              <span className="host-list__actions">
                <button type="button" onClick={() => onConnect(host.id)}>
                  {t('host.connect')}
                </button>
                <button type="button" onClick={() => onEdit(host.id)}>
                  {t('host.edit', { label: host.label })}
                </button>

                {confirming === host.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirming(null)
                        onDelete(host.id)
                      }}
                    >
                      {t('host.confirmDelete')}
                    </button>
                    <button type="button" onClick={() => setConfirming(null)}>
                      {t('host.keep')}
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirming(host.id)}>
                    {t('host.delete', { label: host.label })}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}
