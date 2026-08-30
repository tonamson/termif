import { describe, expect, it, vi } from 'vitest'
import { createSftpStore, joinPath, parentPath } from '../../src/renderer/state/sftpStore.js'
import type { SshDirEntry } from '@termif/core'

const entry = (name: string, isDir = false): SshDirEntry => ({
  name,
  size: 1024n,
  isDir,
  isSymlink: false,
  mode: 0o644,
  modifiedUnix: 1_700_000_000,
})

function fakeSsh(entries: Record<string, SshDirEntry[]> = {}) {
  const calls: { name: string; args: unknown[] }[] = []
  return {
    calls,
    ssh: {
      sftpList: vi.fn(async (_id: bigint, path: string) => {
        calls.push({ name: 'sftpList', args: [path] })
        const found = entries[path]
        if (found === undefined) throw new Error('sftp: No such file')
        return found
      }),
      sftpMkdir: vi.fn(async (_id: bigint, path: string) => {
        calls.push({ name: 'sftpMkdir', args: [path] })
      }),
      sftpRename: vi.fn(async (_id: bigint, from: string, to: string) => {
        calls.push({ name: 'sftpRename', args: [from, to] })
      }),
      sftpRemove: vi.fn(async (_id: bigint, path: string, recursive: boolean) => {
        calls.push({ name: 'sftpRemove', args: [path, recursive] })
      }),
    },
  }
}

describe('joinPath', () => {
  it('joins without doubling the separator', () => {
    expect(joinPath('/home/me', 'file.txt')).toBe('/home/me/file.txt')
    expect(joinPath('/home/me/', 'file.txt')).toBe('/home/me/file.txt')
  })

  it('handles the root', () => {
    expect(joinPath('/', 'etc')).toBe('/etc')
  })
})

describe('parentPath', () => {
  it('walks up one level', () => {
    expect(parentPath('/home/me/docs')).toBe('/home/me')
  })

  it('stops at the root', () => {
    expect(parentPath('/')).toBe('/')
    expect(parentPath('/etc')).toBe('/')
  })

  it('ignores a trailing separator', () => {
    expect(parentPath('/home/me/')).toBe('/home')
  })
})

describe('sftpStore', () => {
  it('lists a directory and sorts directories first', async () => {
    const { ssh } = fakeSsh({
      '/home/me': [entry('b.txt'), entry('alpha', true), entry('a.txt'), entry('beta', true)],
    })
    const store = createSftpStore({ ssh: ssh as never, sessionId: 1n })

    await store.open('/home/me')

    // Core already sorts, but the view depends on it, so assert the contract.
    expect(store.get().entries.map((e) => e.name)).toEqual(['alpha', 'beta', 'a.txt', 'b.txt'])
    expect(store.get().path).toBe('/home/me')
    expect(store.get().loading).toBe(false)
  })

  it('records an error and keeps the previous listing on a failed open', async () => {
    const { ssh } = fakeSsh({ '/home/me': [entry('a.txt')] })
    const store = createSftpStore({ ssh: ssh as never, sessionId: 1n })

    await store.open('/home/me')
    await store.open('/nope')

    expect(store.get().error).toMatch(/no such file/i)
    // Staying put beats emptying the pane the user was working in.
    expect(store.get().path).toBe('/home/me')
    expect(store.get().entries.map((e) => e.name)).toEqual(['a.txt'])
  })

  it('clears a previous error on a successful open', async () => {
    const { ssh } = fakeSsh({ '/a': [entry('x')], '/b': [entry('y')] })
    const store = createSftpStore({ ssh: ssh as never, sessionId: 1n })

    await store.open('/a')
    await store.open('/nope')
    await store.open('/b')

    expect(store.get().error).toBeNull()
  })

  it('navigates up', async () => {
    const { ssh } = fakeSsh({ '/home/me': [entry('x')], '/home': [entry('me', true)] })
    const store = createSftpStore({ ssh: ssh as never, sessionId: 1n })

    await store.open('/home/me')
    await store.up()

    expect(store.get().path).toBe('/home')
  })

  it('creates a directory relative to the current path and refreshes', async () => {
    const { ssh, calls } = fakeSsh({ '/home/me': [] })
    const store = createSftpStore({ ssh: ssh as never, sessionId: 1n })

    await store.open('/home/me')
    await store.mkdir('newdir')

    expect(calls.filter((c) => c.name === 'sftpMkdir')[0]?.args).toEqual(['/home/me/newdir'])
    // Two listings: the open plus the post-mkdir refresh.
    expect(calls.filter((c) => c.name === 'sftpList')).toHaveLength(2)
  })

  it('renames within the current directory', async () => {
    const { ssh, calls } = fakeSsh({ '/home/me': [entry('old.txt')] })
    const store = createSftpStore({ ssh: ssh as never, sessionId: 1n })

    await store.open('/home/me')
    await store.rename('old.txt', 'new.txt')

    expect(calls.filter((c) => c.name === 'sftpRename')[0]?.args).toEqual([
      '/home/me/old.txt',
      '/home/me/new.txt',
    ])
  })

  it('passes the recursive flag through on remove', async () => {
    const { ssh, calls } = fakeSsh({ '/home/me': [entry('dir', true)] })
    const store = createSftpStore({ ssh: ssh as never, sessionId: 1n })

    await store.open('/home/me')
    await store.remove('dir', true)

    expect(calls.filter((c) => c.name === 'sftpRemove')[0]?.args).toEqual(['/home/me/dir', true])
  })

  it('reports a mkdir failure without losing the listing', async () => {
    const { ssh } = fakeSsh({ '/home/me': [entry('a.txt')] })
    ssh.sftpMkdir = vi.fn(async () => {
      throw new Error('sftp: Permission denied')
    })
    const store = createSftpStore({ ssh: ssh as never, sessionId: 1n })

    await store.open('/home/me')
    await store.mkdir('nope')

    expect(store.get().error).toMatch(/permission denied/i)
    expect(store.get().entries).toHaveLength(1)
  })
})
