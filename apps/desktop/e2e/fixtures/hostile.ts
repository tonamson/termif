export interface HostileHost {
  label: string
  group: string | null
  port: number
  username: string
}

const GROUPS = ['Production', 'Staging', 'g'.repeat(40), 'Databases', 'Edge', null]

export const HOSTILE_HOSTS: HostileHost[] = [
  { label: 'a'.repeat(60), group: 'Production', port: 22, username: 'root' },
  { label: 'Máy chủ sản xuất Hà Nội', group: 'Production', port: 22, username: 'root' },
  { label: '🚀 deploy', group: 'Production', port: 22, username: 'root' },
  { label: 'edge', group: 'g'.repeat(40), port: 22, username: 'root' },
  { label: 'high-port', group: null, port: 65535, username: 'u'.repeat(30) },
  ...Array.from({ length: 35 }, (_, index) => ({
    label: `host-${String(index).padStart(2, '0')}`,
    group: GROUPS[index % GROUPS.length]!,
    port: 22,
    username: 'deploy',
  })),
]

export const HOSTILE_PATH = `/root/${'d'.repeat(190)}`
export const HOSTILE_FILENAME = `${'f'.repeat(120)}.log`
