import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Titlebar } from '../../src/renderer/views/Titlebar.js'

const base = {
  drawerTab: null as 'files' | 'forwards' | null,
  onDrawerTab: vi.fn(),
  inspectorOpen: false,
  onInspector: vi.fn(),
}

describe('Titlebar', () => {
  it('offers two drawer buttons, not three panes', () => {
    render(<Titlebar {...base} />)
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.queryByRole('tab', { name: /terminal/i })).not.toBeInTheDocument()
  })

  it('opens the drawer on the pressed tab when it is closed', async () => {
    const onDrawerTab = vi.fn()
    render(<Titlebar {...base} onDrawerTab={onDrawerTab} />)
    await userEvent.click(screen.getByRole('tab', { name: /files/i }))
    expect(onDrawerTab).toHaveBeenCalledWith('files')
  })

  it('closes the drawer when the already-open tab is pressed again', async () => {
    const onDrawerTab = vi.fn()
    render(<Titlebar {...base} drawerTab="files" onDrawerTab={onDrawerTab} />)
    await userEvent.click(screen.getByRole('tab', { name: /files/i }))
    expect(onDrawerTab).toHaveBeenCalledWith(null)
  })

  it('switches tabs without closing when a different tab is pressed', async () => {
    const onDrawerTab = vi.fn()
    render(<Titlebar {...base} drawerTab="files" onDrawerTab={onDrawerTab} />)
    await userEvent.click(screen.getByRole('tab', { name: /forward/i }))
    expect(onDrawerTab).toHaveBeenCalledWith('forwards')
  })

  it('toggles the inspector', async () => {
    const onInspector = vi.fn()
    render(<Titlebar {...base} onInspector={onInspector} />)
    await userEvent.click(screen.getByRole('button', { name: /inspector/i }))
    expect(onInspector).toHaveBeenCalledWith(true)
  })
})
