import { useEffect, useRef, type KeyboardEvent } from 'react'
import { DEFAULT_PREFS, SIDEBAR_MAX, SIDEBAR_MIN } from '../state/prefs.js'

const clamp = (n: number): number => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n))

export function SidebarResizer({ width, onWidth }: { width: number; onWidth(width: number): void }) {
  const dragging = useRef(false)

  useEffect(() => {
    const move = (event: MouseEvent): void => {
      if (!dragging.current) return
      onWidth(clamp(event.clientX))
    }
    const up = (): void => {
      dragging.current = false
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [onWidth])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft') onWidth(clamp(width - 10))
    if (event.key === 'ArrowRight') onWidth(clamp(width + 10))
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      tabIndex={0}
      className="sidebar-resizer"
      onMouseDown={() => {
        dragging.current = true
      }}
      onDoubleClick={() => onWidth(DEFAULT_PREFS.sidebarWidth)}
      onKeyDown={onKeyDown}
    />
  )
}
