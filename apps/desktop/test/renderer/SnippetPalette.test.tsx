import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Snippet } from '@termif/core'
import { SnippetPaletteView } from '../../src/renderer/views/SnippetPalette.js'

const snippet = (over: Partial<Snippet> = {}): Snippet => ({
  id: 's1',
  label: 'disk usage',
  body: 'df -h',
  tags: ['ops'],
  updatedAt: '2026-08-28T10:00:00.000Z',
  deleted: false,
  ...over,
})

const props = {
  snippets: [snippet(), snippet({ id: 's2', label: 'tail log', body: 'tail -f app.log' })],
  query: '',
  onQueryChange: vi.fn(),
  onSend: vi.fn(async () => {}),
  onSave: vi.fn(async () => {}),
  onRemove: vi.fn(async () => {}),
  onClose: vi.fn(),
}

describe('SnippetPaletteView', () => {
  it('lists snippets with their bodies', () => {
    render(<SnippetPaletteView {...props} />)
    expect(screen.getByText('disk usage')).toBeInTheDocument()
    expect(screen.getByText('df -h')).toBeInTheDocument()
  })

  it('sends the body with a trailing newline on click', async () => {
    const onSend = vi.fn(async () => {})
    render(<SnippetPaletteView {...props} onSend={onSend} />)

    await userEvent.click(screen.getByRole('button', { name: /send disk usage/i }))

    expect(onSend).toHaveBeenCalledWith('df -h\n')
  })

  it('sends the highlighted snippet on Enter', async () => {
    const onSend = vi.fn(async () => {})
    render(<SnippetPaletteView {...props} onSend={onSend} />)

    const search = screen.getByRole('searchbox')
    search.focus()
    await userEvent.keyboard('{Enter}')

    expect(onSend).toHaveBeenCalledWith('df -h\n')
  })

  it('moves the highlight with the arrow keys', async () => {
    const onSend = vi.fn(async () => {})
    render(<SnippetPaletteView {...props} onSend={onSend} />)

    screen.getByRole('searchbox').focus()
    await userEvent.keyboard('{ArrowDown}{Enter}')

    expect(onSend).toHaveBeenCalledWith('tail -f app.log\n')
  })

  it('does not move the highlight past the last item', async () => {
    const onSend = vi.fn(async () => {})
    render(<SnippetPaletteView {...props} onSend={onSend} />)

    screen.getByRole('searchbox').focus()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')

    expect(onSend).toHaveBeenCalledWith('tail -f app.log\n')
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(<SnippetPaletteView {...props} onClose={onClose} />)

    screen.getByRole('searchbox').focus()
    await userEvent.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
  })

  it('reports typing upward instead of filtering itself', async () => {
    const onQueryChange = vi.fn()
    render(<SnippetPaletteView {...props} onQueryChange={onQueryChange} />)
    await userEvent.type(screen.getByRole('searchbox'), 'tail')
    expect(onQueryChange).toHaveBeenLastCalledWith('tail')
  })

  it('adds a new snippet from the inline form', async () => {
    const onSave = vi.fn(async () => {})
    render(<SnippetPaletteView {...props} onSave={onSave} />)

    await userEvent.click(screen.getByRole('button', { name: /new snippet/i }))
    await userEvent.type(screen.getByLabelText(/label/i), 'restart nginx')
    await userEvent.type(screen.getByLabelText(/command/i), 'systemctl restart nginx')
    await userEvent.click(screen.getByRole('button', { name: /^save/i }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'restart nginx', body: 'systemctl restart nginx' }),
    )
  })

  it('will not save a snippet with an empty body', async () => {
    const onSave = vi.fn(async () => {})
    render(<SnippetPaletteView {...props} onSave={onSave} />)

    await userEvent.click(screen.getByRole('button', { name: /new snippet/i }))
    await userEvent.type(screen.getByLabelText(/label/i), 'empty')
    await userEvent.click(screen.getByRole('button', { name: /^save/i }))

    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows an empty state when nothing matches', () => {
    render(<SnippetPaletteView {...props} snippets={[]} query="zzz" />)
    expect(screen.getByText(/no snippets match/i)).toBeInTheDocument()
  })
})
