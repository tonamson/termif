import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'

const MIN_H = 120

export function Drawer({
  tab,
  height,
  onHeight,
  onClose,
  children,
}: {
  tab: 'files' | 'forwards'
  height: number
  onHeight(px: number): void
  onClose(): void
  children: ReactNode
}) {
  const drag = useRef<{ y: number; h: number } | null>(null)

  useEffect(() => {
    const move = (event: MouseEvent): void => {
      const start = drag.current
      if (start === null) return
      const next = start.h + (start.y - event.clientY)
      onHeight(Math.max(MIN_H, next))
    }
    const up = (): void => {
      drag.current = null
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [onHeight])

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') onClose()
  }

  return (
    <section
      role="region"
      aria-label={tab}
      className="drawer"
      style={{ ['--drawer-h' as string]: `${height}px` }}
      onKeyDown={onKeyDown}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize panel"
        className="drawer__handle"
        onMouseDown={(event) => {
          drag.current = { y: event.clientY, h: height }
        }}
      />
      <div className="drawer__body u-scroll">{children}</div>
    </section>
  )
}
