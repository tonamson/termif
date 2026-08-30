import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Titlebar } from '../../src/renderer/views/Titlebar.js'

describe('Titlebar', () => {
  it('exposes the three panes as a single tablist', () => {
    render(<Titlebar pane="terminals" onPaneChange={() => {}} />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
  })

  it('marks the active pane selected', () => {
    render(<Titlebar pane="files" onPaneChange={() => {}} />)

    const selected = screen.getAllByRole('tab').filter(
      (tab) => tab.getAttribute('aria-selected') === 'true',
    )
    expect(selected).toHaveLength(1)
  })

  it('reports a pane change when another tab is clicked', async () => {
    const onPaneChange = vi.fn()
    render(<Titlebar pane="terminals" onPaneChange={onPaneChange} />)

    const [, second] = screen.getAllByRole('tab')
    await userEvent.click(second!)

    expect(onPaneChange).toHaveBeenCalledWith('files')
  })

  it('renders the class hooks the stylesheet targets', () => {
    const { container } = render(<Titlebar pane="terminals" onPaneChange={() => {}} />)

    // `.titlebar` carries the drag region and `.titlebar__panes` opts back out
    // of it. Whether the opt-out works can only be checked in a real window
    // (Task 4, step 8) — this only guards the hooks the CSS needs.
    expect(container.querySelector('.titlebar')).not.toBeNull()
    expect(container.querySelector('.titlebar__panes')).not.toBeNull()
  })
})
