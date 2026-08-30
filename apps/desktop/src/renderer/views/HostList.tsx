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
  const [confirming, setConfirming] = useState<string | null>(null)
  const [searchText, setSearchText] = useState(query)

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
    <nav className="host-list sidebar">
      <div className="host-list__toolbar sidebar__header">
        <input
          type="search"
          role="searchbox"
          className="sidebar__search-input"
          aria-label={t('host.search')}
          placeholder={t('host.search')}
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value)
            onQueryChange(e.target.value)
          }}
        />
        <button type="button" className="titlebar__btn" onClick={onAdd} title={t('host.add')}>
          {t('host.add')}
        </button>
      </div>

      {hosts.length === 0 ? (
        <p className="host-list__empty" style={{ padding: 'var(--space-3)', color: 'var(--fg-subtle)', textAlign: 'center' }}>
          {query.trim().length === 0 ? t('host.empty') : t('host.noMatch')}
        </p>
      ) : (
        <div className="host-list__scroll host-tree u-scroll">
          {groups.map((group) => {
            const collapsed = !searching && collapsedGroups.includes(group.name)
            return (
              <section key={group.name} className="host-list__group">
                {group.name !== '' && (
                  <button
                    type="button"
                    className="host-list__grouphead host-tree__group-title"
                    aria-expanded={!collapsed}
                    onClick={() => onToggleGroup(group.name)}
                  >
                    <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
                    <span className="u-clip">{group.name}</span>
                    <span className="host-list__count host-item__badge">{group.hosts.length}</span>
                  </button>
                )}
                {!collapsed && (
                  <ul>
                    {group.hosts.map((host) => (
                      <li
                        key={host.id}
                        className="host-item"
                        tabIndex={0}
                        data-state={hostStates.get(host.id) ?? 'closed'}
                        onKeyDown={(e) => onKeyDown(e, host.id)}
                        onDoubleClick={() => onConnect(host.id)}
                      >
                        <span
                          className="host-list__dot host-item__status"
                          data-status={hostStates.get(host.id) === 'open' ? 'online' : 'offline'}
                          aria-hidden="true"
                        />
                        <span className="host-list__label host-item__name u-clip">{host.label}</span>
                        <span className="host-list__target host-item__badge u-clip">{target(host)}</span>
                        <span className="host-list__actions" style={{ display: 'inline-flex', gap: '4px' }}>
                          <button
                            type="button"
                            className="titlebar__btn"
                            aria-label={t('host.connect')}
                            title={t('host.connect')}
                            onClick={(e) => {
                              e.stopPropagation()
                              onConnect(host.id)
                            }}
                          >
                            <span aria-hidden="true">▸</span>
                          </button>
                          <button
                            type="button"
                            className="titlebar__btn"
                            aria-label={t('host.edit', { label: host.label })}
                            title={t('host.editShort')}
                            onClick={(e) => {
                              e.stopPropagation()
                              onEdit(host.id)
                            }}
                          >
                            <span aria-hidden="true">✎</span>
                          </button>
                          {confirming === host.id ? (
                            <>
                              <button
                                type="button"
                                data-variant="danger"
                                style={{ color: 'var(--danger)', fontWeight: 600, fontSize: '11px' }}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setConfirming(null)
                                  onDelete(host.id)
                                }}
                              >
                                {t('host.confirmDelete')}
                              </button>
                              <button
                                type="button"
                                style={{ color: 'var(--fg-muted)', fontSize: '11px' }}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setConfirming(null)
                                }}
                              >
                                {t('host.keep')}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="titlebar__btn"
                              aria-label={t('host.delete', { label: host.label })}
                              title={t('host.deleteShort')}
                              onClick={(e) => {
                                e.stopPropagation()
                                setConfirming(host.id)
                              }}
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
