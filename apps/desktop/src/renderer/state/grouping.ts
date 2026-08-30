import type { Host } from '@termif/core'

export const OTHER_GROUP = 'Other'

export interface HostGroup {
  name: string
  hosts: Host[]
}

const byLabel = (a: Host, b: Host): number =>
  a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })

export function groupHosts(hosts: readonly Host[]): HostGroup[] {
  const buckets = new Map<string, Host[]>()

  for (const host of hosts) {
    const name = host.groupId === null || host.groupId === '' ? OTHER_GROUP : host.groupId
    const bucket = buckets.get(name)
    if (bucket === undefined) buckets.set(name, [host])
    else bucket.push(host)
  }

  const named = [...buckets.entries()]
    .filter(([name]) => name !== OTHER_GROUP)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(([name, list]) => ({ name, hosts: [...list].sort(byLabel) }))

  const other = buckets.get(OTHER_GROUP)
  return other === undefined ? named : [...named, { name: OTHER_GROUP, hosts: [...other].sort(byLabel) }]
}
