import { CoreError, parseFfiError } from './errors.js'
import { newId } from './model.js'
import type { SshBridge, SshEvent } from './platform.js'

export type TransferKind = 'upload' | 'download'
export type TransferState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface TransferView {
  id: string
  kind: TransferKind
  local: string
  remote: string
  state: TransferState
  done: bigint
  total: bigint
  error: string | null
}

interface TransferRecord extends TransferView {
  sessionId: bigint
  /** The id the Rust side gave us; absent while queued. */
  bridgeId: bigint | null
}

export interface TransferManagerDeps {
  ssh: SshBridge
  /**
   * Parallel transfers on one session mostly compete for the same bandwidth
   * while multiplying memory, so the default is deliberately low.
   */
  maxConcurrent?: number
}

export class TransferManager {
  readonly #ssh: SshBridge
  readonly #maxConcurrent: number
  readonly #records = new Map<string, TransferRecord>()
  readonly #byBridgeId = new Map<bigint, string>()
  readonly #listeners = new Set<() => void>()

  constructor(deps: TransferManagerDeps) {
    this.#ssh = deps.ssh
    this.#maxConcurrent = deps.maxConcurrent ?? 2
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  list(): TransferView[] {
    return [...this.#records.values()].map(
      ({ sessionId: _s, bridgeId: _b, ...view }) => ({ ...view }),
    )
  }

  bridgeIdFor(id: string): bigint | undefined {
    return this.#records.get(id)?.bridgeId ?? undefined
  }

  async enqueueUpload(sessionId: bigint, local: string, remote: string): Promise<string> {
    return this.#enqueue('upload', sessionId, local, remote)
  }

  async enqueueDownload(sessionId: bigint, remote: string, local: string): Promise<string> {
    return this.#enqueue('download', sessionId, local, remote)
  }

  async cancel(id: string): Promise<void> {
    const record = this.#records.get(id)
    if (record === undefined) {
      throw new CoreError('no_such_transfer', 'that transfer is not in the queue')
    }

    if (record.bridgeId === null) {
      // Never started, so there is nothing for Rust to cancel.
      record.state = 'cancelled'
      this.#emit()
      void this.#pump()
      return
    }

    try {
      await this.#ssh.cancelTransfer(record.bridgeId)
    } catch (e) {
      throw parseFfiError(e)
    }
  }

  /** Fed from the session manager's drain loop. */
  handleEvent(event: SshEvent): void {
    if (event.kind === 'transferProgress') {
      const record = this.#lookup(event.transferId)
      if (record === undefined) return
      record.done = event.done
      record.total = event.total
      this.#emit()
      return
    }

    if (event.kind === 'transferDone') {
      const record = this.#lookup(event.transferId)
      if (record === undefined) return
      record.error = event.error
      record.state =
        event.error === null
          ? 'done'
          : event.error.toLowerCase().includes('cancel')
            ? 'cancelled'
            : 'failed'
      this.#emit()
      void this.#pump()
    }
  }

  async #enqueue(
    kind: TransferKind,
    sessionId: bigint,
    local: string,
    remote: string,
  ): Promise<string> {
    const id = newId()
    this.#records.set(id, {
      id,
      kind,
      local,
      remote,
      state: 'queued',
      done: 0n,
      total: 0n,
      error: null,
      sessionId,
      bridgeId: null,
    })
    this.#emit()
    await this.#pump()
    return id
  }

  /** Starts queued transfers up to the concurrency limit. */
  async #pump(): Promise<void> {
    const running = [...this.#records.values()].filter((r) => r.state === 'running').length
    let slots = this.#maxConcurrent - running
    if (slots <= 0) return

    for (const record of this.#records.values()) {
      if (slots <= 0) break
      if (record.state !== 'queued') continue

      try {
        const bridgeId =
          record.kind === 'upload'
            ? await this.#ssh.sftpUpload(record.sessionId, record.local, record.remote)
            : await this.#ssh.sftpDownload(record.sessionId, record.remote, record.local)

        record.bridgeId = bridgeId
        record.state = 'running'
        this.#byBridgeId.set(bridgeId, record.id)
        slots -= 1
      } catch (e) {
        record.state = 'failed'
        record.error = parseFfiError(e).message
      }
      this.#emit()
    }
  }

  #lookup(bridgeId: bigint): TransferRecord | undefined {
    const id = this.#byBridgeId.get(bridgeId)
    return id === undefined ? undefined : this.#records.get(id)
  }

  #emit(): void {
    for (const listener of this.#listeners) listener()
  }
}
