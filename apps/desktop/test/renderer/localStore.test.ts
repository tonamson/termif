import { describe, expect, it, vi } from 'vitest'
import type { SshDirEntry } from '@termif/core'
import { createLocalStore, joinLocal, parentLocal } from '../../src/renderer/state/localStore.js'

const entry = (name: string, isDir = false): SshDirEntry => ({
  name,
  size: 10n,
  isDir,
  isSymlink: false,
  mode: 0o644,
  modifiedUnix: 0,
})

describe('local path helpers', () => {
  it('joins with the platform separator', () => {
    expect(joinLocal('/home/me', 'a.txt', '/')).toBe('/home/me/a.txt')
    expect(joinLocal('C:\\Users\\me', 'a.txt', '\\')).toBe('C:\\Users\\me\\a.txt')
  })

  it('walks up without falling off the root', () => {
    expect(parentLocal('/home/me', '/')).toBe('/home')
    expect(parentLocal('/home', '/')).toBe('/')
    expect(parentLocal('/', '/')).toBe('/')
    expect(parentLocal('C:\\Users\\me', '\\')).toBe('C:\\Users')
    expect(parentLocal('C:\\', '\\')).toBe('C:\\')
  })
})

describe('createLocalStore', () => {
  it('lists a directory with directories first', async () => {
    const list = vi.fn(async () => [entry('b.txt'), entry('zoo', true), entry('a.txt')])
    const store = createLocalStore({ list, sep: '/' })

    await store.open('/home/me')

    expect(list).toHaveBeenCalledWith('/home/me')
    expect(store.get().path).toBe('/home/me')
    expect(store.get().entries.map((e) => e.name)).toEqual(['zoo', 'a.txt', 'b.txt'])
    expect(store.get().error).toBeNull()
  })

  it('keeps the previous listing when a directory cannot be read', async () => {
    const list = vi
      .fn<(path: string) => Promise<SshDirEntry[]>>()
      .mockResolvedValueOnce([entry('a.txt')])
      .mockRejectedValueOnce(new Error('EACCES: permission denied'))
    const store = createLocalStore({ list, sep: '/' })

    await store.open('/home/me')
    await store.open('/root')

    expect(store.get().path).toBe('/home/me')
    expect(store.get().entries.map((e) => e.name)).toEqual(['a.txt'])
    expect(store.get().error).toContain('permission denied')
  })

  it('goes up one level', async () => {
    const list = vi.fn(async () => [] as SshDirEntry[])
    const store = createLocalStore({ list, sep: '/' })

    await store.open('/home/me')
    await store.up()

    expect(store.get().path).toBe('/home')
  })
})
