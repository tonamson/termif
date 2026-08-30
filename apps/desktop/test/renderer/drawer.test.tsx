import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Drawer } from '../../src/renderer/views/Drawer.js'

const base = { tab: 'files' as const, height: 220, onHeight: vi.fn(), onClose: vi.fn() }

describe('Drawer', () => {
  it('applies its height as a custom property', () => {
    render(<Drawer {...base}>body</Drawer>)
    expect(screen.getByRole('region')).toHaveStyle({ '--drawer-h': '220px' })
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<Drawer {...base} onClose={onClose}>body</Drawer>)
    screen.getByRole('region').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onClose).toHaveBeenCalled()
  })

  it('reports a dragged height measured upward from the bottom', () => {
    const onHeight = vi.fn()
    render(<Drawer {...base} onHeight={onHeight}>body</Drawer>)
    const handle = screen.getByRole('separator')
    handle.dispatchEvent(new MouseEvent('mousedown', { clientY: 500, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientY: 400, bubbles: true }))
    expect(onHeight).toHaveBeenCalledWith(320)
  })

  it('clamps to the 120px minimum', () => {
    const onHeight = vi.fn()
    render(<Drawer {...base} onHeight={onHeight}>body</Drawer>)
    const handle = screen.getByRole('separator')
    handle.dispatchEvent(new MouseEvent('mousedown', { clientY: 500, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientY: 900, bubbles: true }))
    expect(onHeight).toHaveBeenCalledWith(120)
  })
})
