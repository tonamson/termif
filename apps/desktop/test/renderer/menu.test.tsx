import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Menu } from '../../src/renderer/views/Menu.js'

const items = [
  { id: 'rename', label: 'Rename' },
  'separator' as const,
  { id: 'delete', label: 'Delete', danger: true },
  { id: 'nope', label: 'Unavailable', disabled: true },
]

describe('Menu', () => {
  it('renders one menuitem per entry, separators excluded', () => {
    render(<Menu items={items} x={0} y={0} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
  })

  it('reports the picked id', async () => {
    const onPick = vi.fn()
    render(<Menu items={items} x={0} y={0} onPick={onPick} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(onPick).toHaveBeenCalledWith('rename')
  })

  it('ignores a disabled item', async () => {
    const onPick = vi.fn()
    render(<Menu items={items} x={0} y={0} onPick={onPick} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Unavailable' }))
    expect(onPick).not.toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(<Menu items={items} x={0} y={0} onPick={vi.fn()} onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('moves the active item with the arrow keys and runs it on Enter', async () => {
    const onPick = vi.fn()
    render(<Menu items={items} x={0} y={0} onPick={onPick} onClose={vi.fn()} />)
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onPick).toHaveBeenCalledWith('delete')
  })

  it('skips disabled items while arrowing', async () => {
    const onPick = vi.fn()
    render(<Menu items={items} x={0} y={0} onPick={onPick} onClose={vi.fn()} />)
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onPick).toHaveBeenCalledWith('rename')
  })

  it('closes when the backdrop is clicked', async () => {
    const onClose = vi.fn()
    render(<Menu items={items} x={0} y={0} onPick={vi.fn()} onClose={onClose} />)
    await userEvent.click(screen.getByTestId('menu-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })
})
