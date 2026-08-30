import type { SshConnectConfig, SshDirEntry, SshEvent, SqlValue } from '@termif/core'

/**
 * The single definition of the main↔renderer contract. Both sides import this
 * file, so a rename cannot land on one side only.
 */
export const CHANNELS = Object.freeze({
  sshInit: 'termif:ssh:init',
  sshConnect: 'termif:ssh:connect',
  sshDisconnect: 'termif:ssh:disconnect',
  sshTrustHostKey: 'termif:ssh:trustHostKey',
  sshOpenShell: 'termif:ssh:openShell',
  sshWrite: 'termif:ssh:write',
  sshResize: 'termif:ssh:resize',
  sshCloseChannel: 'termif:ssh:closeChannel',
  sshSftpList: 'termif:ssh:sftpList',
  sshSftpStat: 'termif:ssh:sftpStat',
  sshSftpMkdir: 'termif:ssh:sftpMkdir',
  sshSftpRename: 'termif:ssh:sftpRename',
  sshSftpRemove: 'termif:ssh:sftpRemove',
  sshSftpReadRange: 'termif:ssh:sftpReadRange',
  sshSftpUpload: 'termif:ssh:sftpUpload',
  sshSftpDownload: 'termif:ssh:sftpDownload',
  sshCancelTransfer: 'termif:ssh:cancelTransfer',
  sshForwardLocal: 'termif:ssh:forwardLocal',
  sshForwardRemote: 'termif:ssh:forwardRemote',
  sshForwardSocks: 'termif:ssh:forwardSocks',
  sshForwardBoundPort: 'termif:ssh:forwardBoundPort',
  sshCloseForward: 'termif:ssh:closeForward',
  sshNextEvents: 'termif:ssh:nextEvents',

  dbExec: 'termif:db:exec',
  dbQuery: 'termif:db:query',
  dbTransaction: 'termif:db:transaction',

  secureGet: 'termif:secure:get',
  secureSet: 'termif:secure:set',
  secureDelete: 'termif:secure:delete',

  netRequest: 'termif:net:request',

  authStartDeviceFlow: 'termif:auth:startDeviceFlow',
  authPollDeviceFlow: 'termif:auth:pollDeviceFlow',
  authAccessToken: 'termif:auth:accessToken',
  authHasSession: 'termif:auth:hasSession',
  authSignOut: 'termif:auth:signOut',

  appPickFile: 'termif:app:pickFile',
  appPickSaveLocation: 'termif:app:pickSaveLocation',
  appOpenExternal: 'termif:app:openExternal',
  appPlatformKind: 'termif:app:platformKind',
} as const)

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]

/** One statement in a `dbTransaction` batch. */
export interface DbStatement {
  sql: string
  params: SqlValue[]
}

export interface HttpRequestPayload {
  method: 'GET' | 'POST' | 'PUT'
  url: string
  headers?: Record<string, string>
  body?: string
}

export interface HttpResponsePayload {
  status: number
  body: string
}

export interface DeviceFlowStart {
  userCode: string
  verificationUrl: string
  /** Opaque; hand it back to `authPollDeviceFlow`. */
  deviceCode: string
  intervalSecs: number
  expiresInSecs: number
}

export type DeviceFlowPoll =
  | { state: 'pending' }
  | { state: 'authorized' }
  | { state: 'denied'; reason: string }
  | { state: 'expired' }

/**
 * What the preload puts on `window.termif`. The renderer's `Platform` is built
 * from exactly this and nothing else.
 */
export interface TermifApi {
  ssh: {
    init(knownHostsPath: string): Promise<void>
    connect(cfg: SshConnectConfig): Promise<string>
    disconnect(sessionId: string): Promise<void>
    trustHostKey(host: string, port: number, algo: string, fingerprint: string): Promise<void>
    openShell(sessionId: string, cols: number, rows: number): Promise<string>
    write(channelId: string, data: Uint8Array): Promise<void>
    resize(channelId: string, cols: number, rows: number): Promise<void>
    closeChannel(channelId: string): Promise<void>
    sftpList(sessionId: string, path: string): Promise<SerialisedDirEntry[]>
    sftpStat(sessionId: string, path: string): Promise<SerialisedDirEntry>
    sftpMkdir(sessionId: string, path: string): Promise<void>
    sftpRename(sessionId: string, from: string, to: string): Promise<void>
    sftpRemove(sessionId: string, path: string, recursive: boolean): Promise<void>
    sftpReadRange(sessionId: string, path: string, offset: string, len: number): Promise<Uint8Array>
    sftpUpload(sessionId: string, local: string, remote: string): Promise<string>
    sftpDownload(sessionId: string, remote: string, local: string): Promise<string>
    cancelTransfer(transferId: string): Promise<void>
    forwardLocal(
      sessionId: string,
      localBind: string,
      remoteHost: string,
      remotePort: number,
    ): Promise<string>
    forwardRemote(
      sessionId: string,
      remoteBindHost: string,
      remoteBindPort: number,
      localHost: string,
      localPort: number,
    ): Promise<string>
    forwardSocks(sessionId: string, localBind: string): Promise<string>
    forwardBoundPort(forwardId: string): Promise<number>
    closeForward(forwardId: string): Promise<void>
    nextEvents(timeoutMs: number): Promise<SerialisedSshEvent[]>
  }
  db: {
    exec(sql: string, params: SqlValue[]): Promise<void>
    query(sql: string, params: SqlValue[]): Promise<Record<string, SqlValue>[]>
    transaction(statements: DbStatement[]): Promise<void>
  }
  secure: {
    get(key: string): Promise<Uint8Array | null>
    set(key: string, value: Uint8Array, requireBiometrics: boolean): Promise<void>
    delete(key: string): Promise<void>
  }
  net: {
    request(payload: HttpRequestPayload): Promise<HttpResponsePayload>
  }
  auth: {
    startDeviceFlow(): Promise<DeviceFlowStart>
    pollDeviceFlow(deviceCode: string): Promise<DeviceFlowPoll>
    accessToken(): Promise<string>
    hasSession(): Promise<boolean>
    signOut(): Promise<void>
  }
  app: {
    pickFile(): Promise<string | null>
    pickSaveLocation(suggestedName: string): Promise<string | null>
    openExternal(url: string): Promise<void>
    platformKind(): Promise<'desktop'>
  }
}

/**
 * `bigint` does not survive Electron's structured clone across every version,
 * and JSON cannot carry it at all — so handles cross IPC as decimal strings
 * and are converted at the renderer edge. Same for SFTP sizes.
 */
export type SerialisedDirEntry = Omit<SshDirEntry, 'size'> & { size: string }

export type SerialisedSshEvent =
  | { kind: 'channelData'; channelId: string; bytes: Uint8Array }
  | { kind: 'channelClosed'; channelId: string; exitStatus: number | null }
  | { kind: 'sessionClosed'; sessionId: string; reason: string }
  | { kind: 'transferProgress'; transferId: string; done: string; total: string }
  | { kind: 'transferDone'; transferId: string; error: string | null }
  | { kind: 'forwardAccepted'; forwardId: string; peer: string }
  | { kind: 'log'; level: string; msg: string }

/** Narrowing helper shared by the renderer's deserialiser. */
export type { SshEvent }
