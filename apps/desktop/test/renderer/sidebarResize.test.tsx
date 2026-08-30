import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SidebarResizer } from '../../src/renderer/views/SidebarResizer.js'

describe('SidebarResizer', () => {
  it('reports the dragged width', () => {
    const onWidth = vi.fn()
    render(<SidebarResizer width={260} onWidth={onWidth} />)
    const handle = screen.getByRole('separator')
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 260, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, bubbles: true }))
    expect(onWidth).toHaveBeenCalledWith(300)
  })

  it('clamps below the minimum', () => {
    const onWidth = vi.fn()
    render(<SidebarResizer width={260} onWidth={onWidth} />)
    const handle = screen.getByRole('separator')
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 260, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, bubbles: true }))
    expect(onWidth).toHaveBeenCalledWith(200)
  })

  it('clamps above the maximum', () => {
    const onWidth = vi.fn()
    render(<SidebarResizer width={260} onWidth={onWidth} />)
    const handle = screen.getByRole('separator')
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 260, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 900, bubbles: true }))
    expect(onWidth).toHaveBeenCalledWith(400)
  })

  it('stops reporting after mouseup', () => {
    const onWidth = vi.fn()
    render(<SidebarResizer width={260} onWidth={onWidth} />)
    const handle = screen.getByRole('separator')
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 260, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    onWidth.mockClear()
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 320, bubbles: true }))
    expect(onWidth).not.toHaveBeenCalled()
  })

  it('restores the default width on double click', () => {
    const onWidth = vi.fn()
    render(<SidebarResizer width={330} onWidth={onWidth} />)
    screen.getByRole('separator').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(onWidth).toHaveBeenCalledWith(260)
  })

  it('moves by keyboard for people who cannot drag', () => {
    const onWidth = vi.fn()
    render(<SidebarResizer width={260} onWidth={onWidth} />)
    const handle = screen.getByRole('separator')
    handle.focus()
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(onWidth).toHaveBeenCalledWith(270)
  })
})
