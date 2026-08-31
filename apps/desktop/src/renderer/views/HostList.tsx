import { Icon } from "../components/Icon"
import { useEffect, useState, type KeyboardEvent } from 'react'
import { t } from '@termif/core'
import type { Host, HostConnectionState } from '@termif/core'
import { groupHosts, type HostGroup } from '../state/grouping.js'

export interface HostListProps {
  hosts: readonly Host[]
  query: string
  collapsedGroups?: readonly string[]
  hostStates?: ReadonlyMap<string, HostConnectionState>
  onQueryChange(query: string): void
  onToggleGroup?: (name: string) => void
  onConnect(id: string): void
  onEdit(id: string): void
  onDelete(id: string): void
  onAdd(): void
}

export function HostList({
  hosts,
  query,
  collapsedGroups = [],
  hostStates = new Map(),
  onQueryChange,
  onToggleGroup = () => {},
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

  const searching = query.trim().length > 0
  const groups: HostGroup[] = searching ? [{ name: '', hosts: [...hosts] }] : groupHosts(hosts)
  const target = (host: Host): string =>
    `${host.username}@${host.hostname}${host.port === 22 ? '' : `:${host.port}`}`

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
        <div className="host-list__scroll u-scroll">
          {groups.map((group) => {
            const collapsed = !searching && collapsedGroups.includes(group.name)
            return (
              <section key={group.name} className="host-list__group">
                {group.name !== '' && (
                  <button
                    type="button"
                    className="host-list__grouphead"
                    aria-expanded={!collapsed}
                    onClick={() => onToggleGroup(group.name)}
                  >
                    <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
                    <span className="u-clip">{group.name}</span>
                    <span className="host-list__count">{group.hosts.length}</span>
                  </button>
                )}
                {!collapsed && (
                  <ul>
                    {group.hosts.map((host) => (
                      <li
                        key={host.id}
                        tabIndex={0}
                        data-state={hostStates.get(host.id) ?? 'closed'}
                        onKeyDown={(e) => onKeyDown(e, host.id)}
                        onDoubleClick={() => onConnect(host.id)}
                      >
                        <span className="host-list__dot" aria-hidden="true" />
                        <span className="host-list__label u-clip">{host.label}</span>
                        <span className="host-list__target u-clip">{target(host)}</span>
                        <span className="host-list__actions">
                          <button
                            type="button"
                            aria-label={t('host.connect')}
                            title={t('host.connect')}
                            onClick={() => onConnect(host.id)}
                          >
                            <span aria-hidden="true">▸</span>
                          </button>
                          <button
                            type="button"
                            aria-label={t('host.edit', { label: host.label })}
                            title={t('host.editShort')}
                            onClick={() => onEdit(host.id)}
                          >
                            <span aria-hidden="true"><Icon name="edit" size={18} /></span>
                          </button>
                          {confirming === host.id ? (
                            <>
                              <button
                                type="button"
                                data-variant="danger"
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
                            <button
                              type="button"
                              aria-label={t('host.delete', { label: host.label })}
                              title={t('host.deleteShort')}
                              onClick={() => setConfirming(host.id)}
                            >
                              <span aria-hidden="true">✕</span>
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
    </nav>
  )
}
