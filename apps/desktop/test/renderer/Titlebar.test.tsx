import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Titlebar } from '../../src/renderer/views/Titlebar.js'

const base = {
  panel: 'terminal' as const,
  onPanel: vi.fn(),
  inspectorOpen: false,
  onInspector: vi.fn(),
}

describe('Titlebar', () => {
  it('offers three panes including terminal', () => {
    render(<Titlebar {...base} />)
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByRole('tab', { name: /terminal/i })).toBeInTheDocument()
  })

  it('selects the active panel', async () => {
    render(<Titlebar {...base} panel="files" />)
    expect(screen.getByRole('tab', { name: /files/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /terminal/i })).toHaveAttribute('aria-selected', 'false')
  })

  it('notifies when a tab is pressed', async () => {
    const onPanel = vi.fn()
    render(<Titlebar {...base} onPanel={onPanel} />)
    await userEvent.click(screen.getByRole('tab', { name: /files/i }))
    expect(onPanel).toHaveBeenCalledWith('files')
  })

  it('switches tabs', async () => {
    const onPanel = vi.fn()
    render(<Titlebar {...base} panel="files" onPanel={onPanel} />)
    await userEvent.click(screen.getByRole('tab', { name: /forward/i }))
    expect(onPanel).toHaveBeenCalledWith('forwards')
  })

  it('toggles the inspector', async () => {
    const onInspector = vi.fn()
    render(<Titlebar {...base} onInspector={onInspector} />)
    await userEvent.click(screen.getByRole('button', { name: /inspector/i }))
    expect(onInspector).toHaveBeenCalledWith(true)
  })
})
