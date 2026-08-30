/**
 * Everything platform-shaped arrives through this interface. `packages/core`
 * imports nothing from Electron, Node, or any UI framework, which is what lets
 * it be tested against a fake and driven by a second shell later (spec §6).
 */
export interface Platform {
  readonly ssh: SshBridge
  readonly secureStore: SecureStore
  readonly db: LocalDb
  readonly net: HttpClient
  /** ISO-8601 UTC. Injected so tests can control time. */
  now(): string
  randomBytes(length: number): Uint8Array
}

export interface SecureStore {
  /** Reads a value, or null when absent. */
  get(key: string): Promise<Uint8Array | null>
  /**
   * Writes a value. `requireBiometrics` asks the OS to gate reads behind
   * Face ID / Touch ID / fingerprint where the platform supports it.
   */
  set(key: string, value: Uint8Array, requireBiometrics: boolean): Promise<void>
  delete(key: string): Promise<void>
}

export interface LocalDb {
  /** Runs a statement with no result rows. */
  exec(sql: string, params?: readonly SqlValue[]): Promise<void>
  /** Runs a query and returns rows as plain objects. */
  query<T = Record<string, SqlValue>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>
  /** Runs `fn` inside a transaction, rolling back if it throws. */
  transaction<T>(fn: () => Promise<T>): Promise<T>
}

export type SqlValue = string | number | null

export interface HttpResponse {
  readonly status: number
  readonly body: string
}

export interface HttpClient {
  request(init: {
    method: 'GET' | 'POST' | 'PUT'
    url: string
    headers?: Readonly<Record<string, string>>
    body?: string
  }): Promise<HttpResponse>
}

export interface SshConnectConfig {
  host: string
  port: number
  username: string
  /** Exactly one of `password` or `privateKeyPem`. */
  password?: string | undefined
  privateKeyPem?: string | undefined
  passphrase?: string | undefined
  connectTimeoutMs: number
  keepaliveSecs: number
}

export interface SshDirEntry {
  name: string
  size: bigint
  isDir: boolean
  isSymlink: boolean
  mode: number
  modifiedUnix: number
}

/**
 * Normalised event shape. The shell's bridge converts the flat napi object
 * into this before it reaches core, so core never sees an FFI-specific shape.
 */
export type SshEvent =
  | { kind: 'channelData'; channelId: bigint; bytes: Uint8Array }
  | { kind: 'channelClosed'; channelId: bigint; exitStatus: number | null }
  | { kind: 'sessionClosed'; sessionId: bigint; reason: string }
  | { kind: 'transferProgress'; transferId: bigint; done: bigint; total: bigint }
  | { kind: 'transferDone'; transferId: bigint; error: string | null }
  | { kind: 'forwardAccepted'; forwardId: bigint; peer: string }
  | { kind: 'log'; level: string; msg: string }

/** Mirrors the FFI surface from Plan 1 Tasks 11 and 12, one-to-one. */
export interface SshBridge {
  init(knownHostsPath: string): Promise<void>
  connect(cfg: SshConnectConfig): Promise<bigint>
  disconnect(sessionId: bigint): Promise<void>
  trustHostKey(host: string, port: number, algo: string, fingerprint: string): Promise<void>

  openShell(sessionId: bigint, cols: number, rows: number): Promise<bigint>
  write(channelId: bigint, data: Uint8Array): Promise<void>
  resize(channelId: bigint, cols: number, rows: number): Promise<void>
  closeChannel(channelId: bigint): Promise<void>

  sftpList(sessionId: bigint, path: string): Promise<SshDirEntry[]>
  sftpStat(sessionId: bigint, path: string): Promise<SshDirEntry>
  sftpMkdir(sessionId: bigint, path: string): Promise<void>
  sftpRename(sessionId: bigint, from: string, to: string): Promise<void>
  sftpRemove(sessionId: bigint, path: string, recursive: boolean): Promise<void>
  sftpReadRange(sessionId: bigint, path: string, offset: bigint, len: number): Promise<Uint8Array>
  sftpUpload(sessionId: bigint, local: string, remote: string): Promise<bigint>
  sftpDownload(sessionId: bigint, remote: string, local: string): Promise<bigint>
  cancelTransfer(transferId: bigint): Promise<void>

  forwardLocal(
    sessionId: bigint,
    localBind: string,
    remoteHost: string,
    remotePort: number,
  ): Promise<bigint>
  forwardRemote(
    sessionId: bigint,
    remoteBindHost: string,
    remoteBindPort: number,
    localHost: string,
    localPort: number,
  ): Promise<bigint>
  forwardSocks(sessionId: bigint, localBind: string): Promise<bigint>
  forwardBoundPort(forwardId: bigint): Promise<number>
  closeForward(forwardId: bigint): Promise<void>

  nextEvents(timeoutMs: number): Promise<SshEvent[]>
}
