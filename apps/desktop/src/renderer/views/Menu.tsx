import { useEffect, useState } from 'react'

export interface MenuItem {
  id: string
  label: string
  danger?: boolean
  disabled?: boolean
  shortcut?: string
}

export function Menu({
  items,
  x,
  y,
  onPick,
  onClose,
}: {
  items: readonly (MenuItem | 'separator')[]
  x: number
  y: number
  onPick(id: string): void
  onClose(): void
}) {
  const enabled = items.filter(
    (item): item is MenuItem => item !== 'separator' && item.disabled !== true,
  )
  const [active, setActive] = useState(0)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') return onClose()
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        return setActive((i) => (i + 1) % enabled.length)
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        return setActive((i) => (i - 1 + enabled.length) % enabled.length)
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const item = enabled[active]
        if (item !== undefined) onPick(item.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, enabled, onClose, onPick])

  return (
    <>
      <div className="menu__backdrop" data-testid="menu-backdrop" onClick={onClose} />
      <div className="menu" role="menu" style={{ left: x, top: y }}>
        {items.map((item, index) =>
          item === 'separator' ? (
            <hr key={`sep-${index}`} className="menu__sep" />
          ) : (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled === true}
              data-active={enabled[active]?.id === item.id ? 'true' : undefined}
              data-danger={item.danger === true ? 'true' : undefined}
              onClick={() => {
                if (item.disabled === true) return
                onPick(item.id)
              }}
            >
              <span className="u-clip">{item.label}</span>
              {item.shortcut !== undefined && <span className="menu__shortcut">{item.shortcut}</span>}
            </button>
          ),
        )}
      </div>
    </>
  )
}
