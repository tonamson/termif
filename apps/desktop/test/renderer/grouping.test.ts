import { describe, expect, it } from 'vitest'
import type { Host } from '@termif/core'
import { groupHosts, OTHER_GROUP } from '../../src/renderer/state/grouping.js'

const host = (label: string, groupId: string | null): Host => ({
  id: label,
  label,
  hostname: `${label}.example.com`,
  port: 22,
  username: 'deploy',
  authRef: null,
  tags: [],
  groupId,
  updatedAt: '2026-08-30T00:00:00.000Z',
  deleted: false,
})

describe('groupHosts', () => {
  it('returns an empty array for no hosts', () => {
    expect(groupHosts([])).toEqual([])
  })

  it('sorts groups by name', () => {
    const groups = groupHosts([host('a', 'Staging'), host('b', 'Production')])
    expect(groups.map((g) => g.name)).toEqual(['Production', 'Staging'])
  })

  it('pins the ungrouped bucket last even though O sorts before S', () => {
    const groups = groupHosts([host('a', null), host('b', 'Staging')])
    expect(groups.map((g) => g.name)).toEqual(['Staging', OTHER_GROUP])
  })

  it('omits the ungrouped bucket when every host has a group', () => {
    const groups = groupHosts([host('a', 'Production')])
    expect(groups.map((g) => g.name)).toEqual(['Production'])
  })

  it('sorts hosts inside a group case-insensitively', () => {
    const groups = groupHosts([host('beta', 'P'), host('Alpha', 'P')])
    expect(groups[0]?.hosts.map((h) => h.label)).toEqual(['Alpha', 'beta'])
  })

  it('treats an empty-string group as ungrouped', () => {
    expect(groupHosts([host('a', '')])[0]?.name).toBe(OTHER_GROUP)
  })
})
