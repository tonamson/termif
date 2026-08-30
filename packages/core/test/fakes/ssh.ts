import type { SshBridge, SshConnectConfig, SshDirEntry, SshEvent } from '../../src/platform.js'

/**
 * Scriptable stand-in for the FFI. `pushEvent` is how a test simulates the
 * Rust side, and `nextEvents` drains the same way the real bridge does.
 */
export class FakeSsh implements SshBridge {
  #events: SshEvent[] = []
  #waiters: (() => void)[] = []
  #nextId = 1n

  readonly connects: SshConnectConfig[] = []
  readonly writes: { channelId: bigint; data: Uint8Array }[] = []
  readonly resizes: { channelId: bigint; cols: number; rows: number }[] = []
  readonly closedChannels: bigint[] = []
  readonly disconnected: bigint[] = []
  readonly openedShells: { sessionId: bigint; cols: number; rows: number }[] = []

  /** Set to make the next `connect` reject. */
  connectError: Error | null = null
  /** Fails the first N connects, then succeeds — for reconnect tests. */
  failConnectsRemaining = 0

  pushEvent(event: SshEvent): void {
    this.#events.push(event)
    const waiter = this.#waiters.shift()
    waiter?.()
  }

  async init(): Promise<void> {}

  async connect(cfg: SshConnectConfig): Promise<bigint> {
    this.connects.push(cfg)
    if (this.failConnectsRemaining > 0) {
      this.failConnectsRemaining -= 1
      throw new Error('connect: refused')
    }
    if (this.connectError !== null) {
      const error = this.connectError
      this.connectError = null
      throw error
    }
    return this.#nextId++
  }

  async disconnect(sessionId: bigint): Promise<void> {
    this.disconnected.push(sessionId)
  }

  async trustHostKey(): Promise<void> {}

  async openShell(sessionId: bigint, cols: number, rows: number): Promise<bigint> {
    this.openedShells.push({ sessionId, cols, rows })
    return this.#nextId++
  }

  async write(channelId: bigint, data: Uint8Array): Promise<void> {
    this.writes.push({ channelId, data })
  }

  async resize(channelId: bigint, cols: number, rows: number): Promise<void> {
    this.resizes.push({ channelId, cols, rows })
  }

  async closeChannel(channelId: bigint): Promise<void> {
    this.closedChannels.push(channelId)
  }

  async sftpList(): Promise<SshDirEntry[]> {
    return []
  }
  async sftpStat(): Promise<SshDirEntry> {
    return { name: 'x', size: 0n, isDir: false, isSymlink: false, mode: 0o644, modifiedUnix: 0 }
  }
  async sftpMkdir(): Promise<void> {}
  async sftpRename(): Promise<void> {}
  async sftpRemove(): Promise<void> {}
  async sftpReadRange(): Promise<Uint8Array> {
    return new Uint8Array()
  }

  readonly uploads: { local: string; remote: string }[] = []
  readonly downloads: { remote: string; local: string }[] = []
  readonly cancelledTransfers: bigint[] = []

  async sftpUpload(_sessionId: bigint, local: string, remote: string): Promise<bigint> {
    this.uploads.push({ local, remote })
    return this.#nextId++
  }

  async sftpDownload(_sessionId: bigint, remote: string, local: string): Promise<bigint> {
    this.downloads.push({ remote, local })
    return this.#nextId++
  }

  async cancelTransfer(transferId: bigint): Promise<void> {
    this.cancelledTransfers.push(transferId)
  }

  readonly localForwards: { localBind: string; remoteHost: string; remotePort: number }[] = []
  readonly remoteForwards: unknown[] = []
  readonly socksForwards: string[] = []
  readonly closedForwards: bigint[] = []
  boundPort = 54321

  async forwardLocal(
    _sessionId: bigint,
    localBind: string,
    remoteHost: string,
    remotePort: number,
  ): Promise<bigint> {
    this.localForwards.push({ localBind, remoteHost, remotePort })
    return this.#nextId++
  }

  async forwardRemote(...args: unknown[]): Promise<bigint> {
    this.remoteForwards.push(args)
    return this.#nextId++
  }

  async forwardSocks(_sessionId: bigint, localBind: string): Promise<bigint> {
    this.socksForwards.push(localBind)
    return this.#nextId++
  }

  async forwardBoundPort(): Promise<number> {
    return this.boundPort
  }

  async closeForward(forwardId: bigint): Promise<void> {
    this.closedForwards.push(forwardId)
  }

  async nextEvents(timeoutMs: number): Promise<SshEvent[]> {
    if (this.#events.length > 0) {
      const batch = this.#events
      this.#events = []
      return batch
    }
    // Mirror the real long poll: resolve early if an event arrives.
    await new Promise<void>((resolve) => {
      this.#waiters.push(resolve)
      setTimeout(resolve, Math.min(timeoutMs, 20))
    })
    const batch = this.#events
    this.#events = []
    return batch
  }
}
