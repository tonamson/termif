export interface Syncable {
  id: string
  updatedAt: string
}

export interface MergeResult<T> {
  /** Remote rows that win and should be written into the local store. */
  toApplyLocally: T[]
  /** Local rows that win and should be written to the sheet. */
  toPushRemotely: T[]
}

/**
 * Per-row last-write-wins on `updatedAt` (spec §4). A single-user app almost
 * never sees a real conflict, and an event log would cost far more than it
 * saves here.
 *
 * `updatedAt` is ISO-8601 UTC with fixed width, so string comparison is also
 * chronological comparison. When two sides carry the same timestamp, the
 * larger `id` wins: an arbitrary but *identical* choice on every device, which
 * is what makes the devices converge instead of ping-ponging.
 */
export function mergeRows<T extends Syncable>(
  local: readonly T[],
  remote: readonly T[],
): MergeResult<T> {
  const localById = new Map(local.map((r) => [r.id, r]))
  const remoteById = new Map(remote.map((r) => [r.id, r]))

  const toApplyLocally: T[] = []
  const toPushRemotely: T[] = []

  for (const [id, remoteRow] of remoteById) {
    const localRow = localById.get(id)
    if (localRow === undefined) {
      toApplyLocally.push(remoteRow)
      continue
    }
    const winner = pickWinner(localRow, remoteRow)
    if (winner === 'remote') toApplyLocally.push(remoteRow)
    else if (winner === 'local') toPushRemotely.push(localRow)
    // 'equal' means both sides already agree; nothing to do.
  }

  for (const [id, localRow] of localById) {
    if (!remoteById.has(id)) toPushRemotely.push(localRow)
  }

  return { toApplyLocally, toPushRemotely }
}

function pickWinner<T extends Syncable>(local: T, remote: T): 'local' | 'remote' | 'equal' {
  if (local.updatedAt > remote.updatedAt) return 'local'
  if (local.updatedAt < remote.updatedAt) return 'remote'

  // Same instant. Compare content to avoid a pointless write, then fall back
  // to a deterministic content comparison so every device makes the same
  // choice. We must compare content rather than the id, because the id is the
  // merge key and is identical on both sides, so an id tie-break can never
  // converge two devices.
  if (sameContent(local, remote)) return 'equal'
  return canonical(local) >= canonical(remote) ? 'local' : 'remote'
}

function canonical<T extends object>(o: T): string {
  return JSON.stringify(o, Object.keys(o).sort())
}

/**
 * Key-order-independent comparison. Row values are scalars or arrays of
 * scalars, so a shallow walk is enough — and unlike `JSON.stringify`, this does
 * not report a difference merely because two objects list their keys in a
 * different order.
 */
function sameContent(a: object, b: object): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const av = (a as Record<string, unknown>)[key]
    const bv = (b as Record<string, unknown>)[key]
    if (Array.isArray(av) && Array.isArray(bv)) {
      if (av.length !== bv.length || av.some((v, i) => v !== bv[i])) return false
    } else if (av !== bv) {
      return false
    }
  }
  return true
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Tombstones older than this can go: every device has had ample time to see
 * the delete (spec §4).
 */
export function tombstoneCutoff(nowIso: string, days = 90): string {
  return new Date(Date.parse(nowIso) - days * MS_PER_DAY).toISOString()
}
