import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SshDirEntry } from '@termif/core'
import { SftpBrowserView } from '../../src/renderer/views/SftpBrowser.js'
import { TransferList } from '../../src/renderer/views/TransferList.js'

const entry = (name: string, isDir = false, size = 1024n): SshDirEntry => ({
  name,
  size,
  isDir,
  isSymlink: false,
  mode: 0o644,
  modifiedUnix: 1_700_000_000,
})

const props = {
  path: '/home/me',
  entries: [entry('docs', true), entry('notes.txt', false, 2048n)],
  loading: false,
  error: null,
  onOpen: vi.fn(),
  onUp: vi.fn(),
  onRefresh: vi.fn(),
  onMkdir: vi.fn(async () => {}),
  onRemove: vi.fn(async () => {}),
  onUpload: vi.fn(async () => {}),
  onDownload: vi.fn(async () => {}),
}

describe('SftpBrowserView', () => {
  it('shows the current path', () => {
    render(<SftpBrowserView {...props} />)
    expect(screen.getByText('/home/me')).toBeInTheDocument()
  })

  it('lists directories and files', () => {
    render(<SftpBrowserView {...props} />)
    expect(screen.getByText('docs')).toBeInTheDocument()
    expect(screen.getByText('notes.txt')).toBeInTheDocument()
  })

  it('shows a human-readable size for files and none for directories', () => {
    render(<SftpBrowserView {...props} />)
    expect(screen.getByText('2.0 KB')).toBeInTheDocument()
    // A directory's byte size is meaningless to a user; do not show one.
    const dirRow = screen.getByText('docs').closest('li')
    expect(dirRow?.textContent).not.toMatch(/KB|MB/)
  })

  it('opens a directory on double click', async () => {
    const onOpen = vi.fn()
    render(<SftpBrowserView {...props} onOpen={onOpen} />)

    await userEvent.dblClick(screen.getByText('docs'))

    expect(onOpen).toHaveBeenCalledWith('/home/me/docs')
  })

  it('does not try to open a file as a directory', async () => {
    const onOpen = vi.fn()
    render(<SftpBrowserView {...props} onOpen={onOpen} />)

    await userEvent.dblClick(screen.getByText('notes.txt'))

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('downloads a file', async () => {
    const onDownload = vi.fn(async () => {})
    render(<SftpBrowserView {...props} onDownload={onDownload} />)

    await userEvent.click(screen.getByRole('button', { name: /download notes.txt/i }))

    expect(onDownload).toHaveBeenCalledWith('notes.txt')
  })

  it('navigates up', async () => {
    const onUp = vi.fn()
    render(<SftpBrowserView {...props} onUp={onUp} />)
    await userEvent.click(screen.getByRole('button', { name: /up/i }))
    expect(onUp).toHaveBeenCalled()
  })

  it('shows an error banner when one is present', () => {
    render(<SftpBrowserView {...props} error="sftp: Permission denied" />)
    expect(screen.getByRole('alert')).toHaveTextContent(/permission denied/i)
  })

  it('confirms before removing a directory recursively', async () => {
    const onRemove = vi.fn(async () => {})
    render(<SftpBrowserView {...props} onRemove={onRemove} />)

    await userEvent.click(screen.getByRole('button', { name: /delete docs/i }))
    expect(onRemove).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /^confirm/i }))
    expect(onRemove).toHaveBeenCalledWith('docs', true)
  })
})

describe('TransferList', () => {
  const transfers = [
    {
      id: 'x1',
      kind: 'upload' as const,
      local: '/local/a.bin',
      remote: 'a.bin',
      state: 'running' as const,
      done: 512n,
      total: 1024n,
      error: null,
    },
  ]

  it('shows progress as a percentage', () => {
    render(<TransferList transfers={transfers} onCancel={vi.fn()} />)
    expect(screen.getByText(/50%/)).toBeInTheDocument()
  })

  it('offers cancel while running', async () => {
    const onCancel = vi.fn()
    render(<TransferList transfers={transfers} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledWith('x1')
  })

  it('does not offer cancel once finished', () => {
    render(
      <TransferList
        transfers={[{ ...transfers[0]!, state: 'done', done: 1024n }]}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull()
  })

  it('shows the failure reason', () => {
    render(
      <TransferList
        transfers={[{ ...transfers[0]!, state: 'failed', error: 'sftp: disk full' }]}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText(/disk full/i)).toBeInTheDocument()
  })

  it('handles a zero total without dividing by zero', () => {
    render(
      <TransferList
        transfers={[{ ...transfers[0]!, done: 0n, total: 0n }]}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText(/0%/)).toBeInTheDocument()
  })
})
