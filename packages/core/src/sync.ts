import { CoreError, parseFfiError } from './errors.js'
import type { Host, Snippet, StoredCredential } from './model.js'
import type { SheetClient } from './sheet/client.js'
import { mergeRows, tombstoneCutoff, type Syncable } from './sheet/merge.js'
import {
  credentialToRow,
  hostToRow,
  rowToCredential,
  rowToHost,
  rowToSnippet,
  snippetToRow,
  TABS,
  type TabName,
} from './sheet/rows.js'
import type { RowKind, Store } from './store.js'

export interface SyncStatus {
  state: 'idle' | 'running' | 'failed'
  lastSuccessAt: string | null
  lastError: CoreError | null
}

export interface SyncOutcome {
  pulled: number
  pushed: number
  pruned: number
}

export interface SyncEngineDeps {
  store: Store
  client: SheetClient
  spreadsheetId: string
  now: () => string
  /** Burst coalescing window for `requestSync`. */
  debounceMs?: number
  /** Tombstones older than this are pruned. */
  tombstoneDays?: number
}

const LAST_PULL_KEY = 'lastPull'

/** Per-kind wiring so the three row types share one code path. */
const KINDS = [
  {
    kind: 'hosts' as RowKind,
    tab: TABS.hosts as TabName,
    toRow: (r: Syncable) => hostToRow(r as Host),
    fromRow: (cells: string[]) => rowToHost(cells) as Syncable,
  },
  {
    kind: 'credentials' as RowKind,
    tab: TABS.credentials as TabName,
    toRow: (r: Syncable) => credentialToRow(r as StoredCredential),
    fromRow: (cells: string[]) => rowToCredential(cells) as Syncable,
  },
  {
    kind: 'snippets' as RowKind,
    tab: TABS.snippets as TabName,
    toRow: (r: Syncable) => snippetToRow(r as Snippet),
    fromRow: (cells: string[]) => rowToSnippet(cells) as Syncable,
  },
]

/**
 * Pull, merge per row, push. Not realtime: the Sheets API is not built for it
 * and quota would not survive (spec §4). A failure leaves the app fully usable
 * against the local store.
 */
export class SyncEngine {
  readonly #deps: Required<Pick<SyncEngineDeps, 'debounceMs' | 'tombstoneDays'>> & SyncEngineDeps
  readonly #listeners = new Set<(status: SyncStatus) => void>()
  #status: SyncStatus = { state: 'idle', lastSuccessAt: null, lastError: null }
  #running: Promise<SyncOutcome> | null = null
  #timer: ReturnType<typeof setTimeout> | null = null

  constructor(deps: SyncEngineDeps) {
    this.#deps = { debounceMs: 2000, tombstoneDays: 90, ...deps }
  }

  get status(): SyncStatus {
    return { ...this.#status }
  }

  onStatus(listener: (status: SyncStatus) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #setStatus(next: Partial<SyncStatus>): void {
    this.#status = { ...this.#status, ...next }
    const snapshot = this.status
    for (const listener of this.#listeners) listener(snapshot)
  }

  /**
   * Debounced: an edit burst (renaming three hosts in a row) produces one
   * sync, not three. Never rejects — check `status` for failures.
   */
  requestSync(): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = null
      void this.syncNow()
    }, this.#deps.debounceMs)
  }

  async syncNow(): Promise<SyncOutcome> {
    // A concurrent caller joins the in-flight run rather than duplicating it.
    if (this.#running !== null) return this.#running

    this.#running = this.#run()
    try {
      return await this.#running
    } finally {
      this.#running = null
    }
  }

  async #run(): Promise<SyncOutcome> {
    this.#setStatus({ state: 'running' })
    const startedAt = this.#deps.now()

    try {
      // Snapshot the sheet before touching it: every tab is read while the
      // sheet is still the value it just was. Reading and writing per tab
      // interleaved would let an earlier write invalidate a later read of the
      // same tab, and would mix the findRowIndexes read up with the pulls.
      const remoteByKind = new Map<RowKind, Syncable[]>()
      for (const spec of KINDS) {
        const remoteCells = await this.#deps.client.readTab(this.#deps.spreadsheetId, spec.tab)
        const remote: Syncable[] = []
        for (const cells of remoteCells) {
          // One malformed row must not abort the whole sync; skip it and keep going.
          try {
            remote.push(spec.fromRow(cells))
          } catch {
            continue
          }
        }
        remoteByKind.set(spec.kind, remote)
      }

      let pulled = 0
      let pushed = 0

      for (const spec of KINDS) {
        const remote = remoteByKind.get(spec.kind) ?? []
        const local = await this.#localRows(spec.kind)
        const { toApplyLocally, toPushRemotely } = mergeRows(local, remote)

        if (toApplyLocally.length > 0) {
          await this.#deps.store.applyRemote(
            spec.kind,
            toApplyLocally as unknown as (Host | StoredCredential | Snippet)[],
          )
          pulled += toApplyLocally.length
        }

        if (toPushRemotely.length > 0) {
          await this.#push(spec, toPushRemotely)
          pushed += toPushRemotely.length
        }
      }

      const pruned = await this.#deps.store.pruneTombstones(
        tombstoneCutoff(startedAt, this.#deps.tombstoneDays),
      )

      // Record the instant the pull started, not finished: a row written to the
      // sheet mid-sync must not fall into the gap.
      await this.#deps.store.setMetaValue(LAST_PULL_KEY, startedAt)
      this.#setStatus({ state: 'idle', lastSuccessAt: startedAt, lastError: null })
      return { pulled, pushed, pruned }
    } catch (e) {
      this.#setStatus({ state: 'failed', lastError: parseFfiError(e) })
      return { pulled: 0, pushed: 0, pruned: 0 }
    }
  }

  async #localRows(kind: RowKind): Promise<Syncable[]> {
    // Everything, tombstones included: the sheet needs the deletes too.
    const all = await this.#deps.store.rowsChangedSince('1970-01-01T00:00:00.000Z')
    if (kind === 'hosts') return all.hosts
    if (kind === 'credentials') return all.credentials
    return all.snippets
  }

  async #push(
    spec: (typeof KINDS)[number],
    rows: readonly Syncable[],
  ): Promise<void> {
    const indexes = await this.#deps.client.findRowIndexes(this.#deps.spreadsheetId, spec.tab)

    const updates = new Map<number, string[]>()
    const appends: string[][] = []
    for (const row of rows) {
      const rowIndex = indexes.get(row.id)
      if (rowIndex === undefined) appends.push(spec.toRow(row))
      else updates.set(rowIndex, spec.toRow(row))
    }

    await this.#deps.client.writeRows(this.#deps.spreadsheetId, spec.tab, updates)
    await this.#deps.client.appendRows(this.#deps.spreadsheetId, spec.tab, appends)
  }
}
