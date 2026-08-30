import type { SerialisedSshEvent } from '../shared/ipc.js'

/**
 * The flat object napi produces (Plan 1 Task 11's `JsEvent`): one `kind` plus
 * optional fields. We narrow it into the tagged union the renderer expects.
 */
export interface RawNapiEvent {
  kind: string
  channelId?: bigint | null
  sessionId?: bigint | null
  transferId?: bigint | null
  forwardId?: bigint | null
  bytes?: Uint8Array | null
  exitStatus?: number | null
  reason?: string | null
  done?: bigint | null
  total?: bigint | null
  error?: string | null
  peer?: string | null
  level?: string | null
  msg?: string | null
}

/** The subset of `@termif/ssh-native` this app calls. */
interface NativeModule {
  init(knownHostsPath: string): void
  connect(cfg: unknown): Promise<bigint>
  disconnect(sessionId: bigint): Promise<void>
  trustHostKey(host: string, port: number, algo: string, fingerprint: string): Promise<void>
  openShell(sessionId: bigint, cols: number, rows: number): Promise<bigint>
  write(channelId: bigint, data: Uint8Array): Promise<void>
  resize(channelId: bigint, cols: number, rows: number): Promise<void>
  closeChannel(channelId: bigint): Promise<void>
  sftpList(sessionId: bigint, path: string): Promise<RawDirEntry[]>
  sftpStat(sessionId: bigint, path: string): Promise<RawDirEntry>
  sftpMkdir(sessionId: bigint, path: string): Promise<void>
  sftpRename(sessionId: bigint, from: string, to: string): Promise<void>
  sftpRemove(sessionId: bigint, path: string, recursive: boolean): Promise<void>
  sftpReadRange(sessionId: bigint, path: string, offset: bigint, len: number): Promise<Buffer>
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
  nextEvents(timeoutMs: number): Promise<RawNapiEvent[]>
}

export interface RawDirEntry {
  name: string
  size: bigint
  isDir: boolean
  isSymlink: boolean
  mode: number
  modifiedUnix: number
}

let cached: NativeModule | null = null

/**
 * Loaded lazily and only here, in the main process. A renderer import of this
 * module would defeat the sandbox and would not work in a packaged build
 * (spec §3).
 */
export function native(): NativeModule {
  if (cached === null) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cached = require('@termif/ssh-native') as NativeModule
  }
  return cached
}

export function initNative(knownHostsPath: string): void {
  native().init(knownHostsPath)
}

const str = (value: bigint | null | undefined): string => (value ?? 0n).toString()

/**
 * Handles and byte counters cross IPC as decimal strings: `bigint` is not
 * reliably structured-cloneable across Electron versions, and a 64-bit id does
 * not fit in a JS number.
 */
export function serialiseEvents(raw: readonly RawNapiEvent[]): SerialisedSshEvent[] {
  const out: SerialisedSshEvent[] = []

  for (const event of raw) {
    switch (event.kind) {
      case 'channelData':
        out.push({
          kind: 'channelData',
          channelId: str(event.channelId),
          bytes: event.bytes ?? new Uint8Array(),
        })
        break
      case 'channelClosed':
        out.push({
          kind: 'channelClosed',
          channelId: str(event.channelId),
          exitStatus: event.exitStatus ?? null,
        })
        break
      case 'sessionClosed':
        out.push({
          kind: 'sessionClosed',
          sessionId: str(event.sessionId),
          reason: event.reason ?? '',
        })
        break
      case 'transferProgress':
        out.push({
          kind: 'transferProgress',
          transferId: str(event.transferId),
          done: str(event.done),
          total: str(event.total),
        })
        break
      case 'transferDone':
        out.push({
          kind: 'transferDone',
          transferId: str(event.transferId),
          error: event.error ?? null,
        })
        break
      case 'forwardAccepted':
        out.push({
          kind: 'forwardAccepted',
          forwardId: str(event.forwardId),
          peer: event.peer ?? '',
        })
        break
      case 'log':
        out.push({ kind: 'log', level: event.level ?? 'info', msg: event.msg ?? '' })
        break
      default:
        // Unknown kind from a newer core: skip it rather than break the loop.
        break
    }
  }

  return out
}

export function serialiseDirEntry(entry: RawDirEntry): {
  name: string
  size: string
  isDir: boolean
  isSymlink: boolean
  mode: number
  modifiedUnix: number
} {
  return { ...entry, size: entry.size.toString() }
}
