import { CoreError, parseFfiError } from './errors.js'
import type { Host } from './model.js'
import { newId } from './model.js'
import type { Platform, SshBridge, SshEvent } from './platform.js'

export type TabId = string
export type SessionState = 'connected' | 'reconnecting' | 'closed'
export type HostConnectionState = 'connected' | 'reconnecting'

export interface ConnectCredential {
  password?: string | undefined
  privateKeyPem?: string | undefined
  passphrase?: string | undefined
}

export interface SessionManagerDeps {
  ssh: SshBridge
  now: () => string
  /** Backoff schedule for an unexpected disconnect. */
  reconnectDelaysMs?: number[]
  /** How long each `nextEvents` poll waits. */
  pollTimeoutMs?: number
}

interface TabRecord {
  id: TabId
  sessionId: bigint
  channelId: bigint | null
  cols: number
  rows: number
  subscribers: Set<(bytes: Uint8Array) => void>
}

interface SessionRecord {
  /**
   * STABLE caller-facing id. Assigned once at first connect and never changes
   * across reconnect — `disconnect`/`openTab`/`tabsForSession`/`onSessionState`
   * all key on it, and the caller keeps that handle for the life of the session.
   */
  id: bigint
  /**
   * The LIVE ssh handle the `SshBridge` cares about. Changes on each reconnect;
   * `openShell` and `disconnect` use this so the bridge sees the current handle.
   */
  handleId: bigint
  host: Host
  credential: ConnectCredential
  /** True once the caller asked for a disconnect, which suppresses reconnect. */
  closingDeliberately: boolean
}

const DEFAULT_RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000]

/**
 * Owns the single `nextEvents` drain loop and fans bytes out to tabs. Core
 * never parses ANSI — bytes go straight to the emulator, which does it better
 * and on the render thread (spec §6).
 */
export class SessionManager {
  readonly #ssh: SshBridge
  readonly #now: () => string
  readonly #reconnectDelays: number[]
  readonly #pollTimeoutMs: number

  readonly #sessions = new Map<bigint, SessionRecord>()
  readonly #tabs = new Map<TabId, TabRecord>()
  readonly #tabByChannel = new Map<bigint, TabId>()
  /** live ssh handle → stable session id, so `sessionClosed` finds the record. */
  readonly #handleToSession = new Map<bigint, bigint>()

  readonly #tabClosedListeners = new Set<(tab: TabId, exitStatus: number | null) => void>()
  readonly #sessionStateListeners = new Set<(sessionId: bigint, state: SessionState) => void>()
  readonly #logListeners = new Set<(level: string, msg: string) => void>()
  readonly #bridgeEventListeners = new Set<(event: SshEvent) => void>()
  readonly #sessionStates = new Map<bigint, SessionState>()

  #draining = false
  #drainPromise: Promise<void> | null = null

  constructor(deps: SessionManagerDeps) {
    this.#ssh = deps.ssh
    this.#now = deps.now
    this.#reconnectDelays = deps.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS
    this.#pollTimeoutMs = deps.pollTimeoutMs ?? 1000
  }

  /** 1 while the loop runs, 0 otherwise — asserted by tests. */
  get drainLoopCount(): number {
    return this.#draining ? 1 : 0
  }

  async start(): Promise<void> {
    if (this.#draining) return
    this.#draining = true
    this.#drainPromise = this.#drain()
  }

  async stop(): Promise<void> {
    this.#draining = false
    await this.#drainPromise
    this.#drainPromise = null
  }

  onTabClosed(listener: (tab: TabId, exitStatus: number | null) => void): () => void {
    this.#tabClosedListeners.add(listener)
    return () => this.#tabClosedListeners.delete(listener)
  }

  onSessionState(listener: (sessionId: bigint, state: SessionState) => void): () => void {
    this.#sessionStateListeners.add(listener)
    return () => this.#sessionStateListeners.delete(listener)
  }

  onLog(listener: (level: string, msg: string) => void): () => void {
    this.#logListeners.add(listener)
    return () => this.#logListeners.delete(listener)
  }

  onBridgeEvent(listener: (event: SshEvent) => void): () => void {
    this.#bridgeEventListeners.add(listener)
    return () => this.#bridgeEventListeners.delete(listener)
  }

  async connect(host: Host, credential: ConnectCredential): Promise<bigint> {
    const handleId = await this.#openConnection(host, credential)
    // The stable id the caller sees is the first ssh handle. It never changes.
    const sessionId = handleId
    this.#sessions.set(sessionId, {
      id: sessionId,
      handleId,
      host,
      credential,
      closingDeliberately: false,
    })
    this.#handleToSession.set(handleId, sessionId)
    this.#emitSessionState(sessionId, 'connected')
    return sessionId
  }

  async disconnect(sessionId: bigint): Promise<void> {
    const session = this.#sessions.get(sessionId)
    if (session !== undefined) session.closingDeliberately = true

    for (const tab of [...this.#tabs.values()]) {
      if (tab.sessionId === sessionId) this.#forgetTab(tab.id)
    }

    const handleId = session?.handleId
    this.#sessions.delete(sessionId)
    this.#sessionStates.delete(sessionId)
    if (handleId !== undefined) this.#handleToSession.delete(handleId)

    try {
      await this.#ssh.disconnect(handleId ?? sessionId)
    } catch (e) {
      // Already gone is not a failure worth surfacing.
      this.#emitLog('debug', `disconnect: ${parseFfiError(e).message}`)
    }
  }

  async openTab(sessionId: bigint, cols: number, rows: number): Promise<TabId> {
    const session = this.#sessions.get(sessionId)
    if (session === undefined) {
      throw new CoreError('no_such_session', 'that session is not open')
    }
    const channelId = await this.#call(() => this.#ssh.openShell(session.handleId, cols, rows))
    const id = newId()

    this.#tabs.set(id, { id, sessionId, channelId, cols, rows, subscribers: new Set() })
    this.#tabByChannel.set(channelId, id)
    return id
  }

  subscribeTab(tab: TabId, onData: (bytes: Uint8Array) => void): () => void {
    const record = this.#requireTab(tab)
    record.subscribers.add(onData)
    return () => record.subscribers.delete(onData)
  }

  async writeToTab(tab: TabId, data: Uint8Array): Promise<void> {
    const channelId = this.#requireChannel(tab)
    await this.#call(() => this.#ssh.write(channelId, data))
  }

  async resizeTab(tab: TabId, cols: number, rows: number): Promise<void> {
    const record = this.#requireTab(tab)
    record.cols = cols
    record.rows = rows

    // Bound locally so `strict` keeps the narrowing across the closure.
    const channelId = record.channelId
    if (channelId === null) return // mid-reconnect; the new channel gets this size
    await this.#call(() => this.#ssh.resize(channelId, cols, rows))
  }

  async closeTab(tab: TabId): Promise<void> {
    const record = this.#requireTab(tab)
    const channelId = record.channelId
    this.#forgetTab(tab)
    for (const listener of this.#tabClosedListeners) listener(tab, null)
    if (channelId !== null) {
      try {
        await this.#ssh.closeChannel(channelId)
      } catch (e) {
        this.#emitLog('debug', `closeChannel: ${parseFfiError(e).message}`)
      }
    }
  }

  channelIdForTab(tab: TabId): bigint | undefined {
    return this.#tabs.get(tab)?.channelId ?? undefined
  }

  tabsForSession(sessionId: bigint): TabId[] {
    return [...this.#tabs.values()].filter((t) => t.sessionId === sessionId).map((t) => t.id)
  }

  /**
   * The CURRENT live bridge handle for a caller-facing (stable) session id, or
   * undefined if that session is not open. The stable id survives reconnect and
   * is NOT the bridge handle; to reach the `SshBridge` (forwards/transfers, and
   * `ForwardManager.rebuildForSession`), resolve the live handle through this.
   */
  liveHandleFor(sessionId: bigint): bigint | undefined {
    return this.#sessions.get(sessionId)?.handleId ?? undefined
  }

  /**
   * Stable ids of the sessions open right now. A panel that mounts after the
   * connection (the file browser lives in a drawer) has no state event to
   * catch up on, so it reads the current set instead.
   */
  openSessionIds(): bigint[] {
    return [...this.#sessions.keys()]
  }

  connectedHostIds(): string[] {
    return [...this.#sessions.values()].map((s) => s.host.id)
  }

  /** Per-host connection state, strongest session wins. */
  hostStates(): Map<string, HostConnectionState> {
    const out = new Map<string, HostConnectionState>()
    for (const session of this.#sessions.values()) {
      const state = this.#sessionStates.get(session.id)
      if (state === 'closed' || state === undefined) continue
      const hostId = session.host.id
      const current = out.get(hostId)
      if (current === 'connected') continue
      if (state === 'connected') out.set(hostId, 'connected')
      else if (current === undefined) out.set(hostId, 'reconnecting')
    }
    return out
  }

  // ---- internals ----

  async #openConnection(host: Host, credential: ConnectCredential): Promise<bigint> {
    const hasPassword = credential.password !== undefined && credential.password.length > 0
    const hasKey = credential.privateKeyPem !== undefined && credential.privateKeyPem.length > 0
    if (hasPassword === hasKey) {
      throw new CoreError('auth', 'supply exactly one of a password or a private key')
    }

    return this.#call(() =>
      this.#ssh.connect({
        host: host.hostname,
        port: host.port,
        username: host.username,
        ...(hasPassword ? { password: credential.password } : {}),
        ...(hasKey ? { privateKeyPem: credential.privateKeyPem } : {}),
        ...(credential.passphrase === undefined ? {} : { passphrase: credential.passphrase }),
        connectTimeoutMs: 15000,
        keepaliveSecs: 30,
      }),
    )
  }

  /** Every bridge call funnels through here so errors arrive as `CoreError`. */
  async #call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      throw parseFfiError(e)
    }
  }

  async #drain(): Promise<void> {
    while (this.#draining) {
      let events: SshEvent[] = []
      try {
        events = await this.#ssh.nextEvents(this.#pollTimeoutMs)
      } catch (e) {
        this.#emitLog('warn', `nextEvents: ${parseFfiError(e).message}`)
        // Do not spin on a persistent bridge failure.
        await sleep(500)
        continue
      }
      for (const event of events) {
        for (const listener of this.#bridgeEventListeners) listener(event)
        this.#handle(event)
      }
    }
  }

  #handle(event: SshEvent): void {
    switch (event.kind) {
      case 'channelData': {
        const tabId = this.#tabByChannel.get(event.channelId)
        if (tabId === undefined) return
        const record = this.#tabs.get(tabId)
        if (record === undefined) return
        for (const subscriber of record.subscribers) subscriber(event.bytes)
        return
      }
      case 'channelClosed': {
        const tabId = this.#tabByChannel.get(event.channelId)
        if (tabId === undefined) return
        this.#forgetTab(tabId)
        for (const listener of this.#tabClosedListeners) listener(tabId, event.exitStatus)
        return
      }
      case 'sessionClosed': {
        const stableId = this.#handleToSession.get(event.sessionId)
        const session = stableId === undefined ? undefined : this.#sessions.get(stableId)
        if (session === undefined || session.closingDeliberately) return
        void this.#reconnect(session)
        return
      }
      case 'log': {
        this.#emitLog(event.level, event.msg)
        return
      }
      // transferProgress, transferDone, and forwardAccepted belong to the
      // transfer and forward managers. They tap this loop via onBridgeEvent
      // (Plan 3 bootApp) rather than opening a second nextEvents poll.
      default:
        return
    }
  }

  /**
   * Rebuilds the connection and one channel per tab. Terminal contents cannot
   * be restored — plain SSH has no resume, and pretending otherwise would be a
   * lie to the user (spec §6).
   */
  async #reconnect(session: SessionRecord): Promise<void> {
    const tabs = [...this.#tabs.values()].filter((t) => t.sessionId === session.id)
    for (const tab of tabs) {
      if (tab.channelId !== null) this.#tabByChannel.delete(tab.channelId)
      tab.channelId = null
    }
    // The bridge's old handle is dead; only the live handle may map back.
    this.#handleToSession.delete(session.handleId)
    this.#emitSessionState(session.id, 'reconnecting')

    for (const delay of this.#reconnectDelays) {
      if (!this.#draining) return
      await sleep(delay)

      // A caller may disconnect mid-reconnect (race): if so, abort before
      // re-establishing a handle. The deliberate disconnect already tore down
      // the live handle and removed the session; bail cleanly.
      if (session.closingDeliberately) return

      try {
        const handleId = await this.#openConnection(session.host, session.credential)
        session.handleId = handleId
        this.#handleToSession.set(handleId, session.id)

        for (const tab of tabs) {
          const channelId = await this.#ssh.openShell(handleId, tab.cols, tab.rows)
          tab.sessionId = session.id
          tab.channelId = channelId
          this.#tabByChannel.set(channelId, tab.id)
        }

        this.#emitSessionState(session.id, 'connected')
        return
      } catch (e) {
        this.#emitLog('warn', `reconnect failed: ${parseFfiError(e).message}`)
      }
    }

    this.#emitSessionState(session.id, 'closed')
    this.#handleToSession.delete(session.handleId)
    this.#sessions.delete(session.id)
    for (const tab of tabs) {
      this.#forgetTab(tab.id)
      for (const listener of this.#tabClosedListeners) listener(tab.id, null)
    }
  }

  #forgetTab(tab: TabId): void {
    const record = this.#tabs.get(tab)
    if (record === undefined) return
    if (record.channelId !== null) this.#tabByChannel.delete(record.channelId)
    record.subscribers.clear()
    this.#tabs.delete(tab)
  }

  #requireTab(tab: TabId): TabRecord {
    const record = this.#tabs.get(tab)
    if (record === undefined) throw new CoreError('no_such_tab', 'that tab is not open')
    return record
  }

  #requireChannel(tab: TabId): bigint {
    const record = this.#requireTab(tab)
    if (record.channelId === null) {
      throw new CoreError('tab_reconnecting', 'the tab is reconnecting')
    }
    return record.channelId
  }

  #emitSessionState(sessionId: bigint, state: SessionState): void {
    if (state === 'closed') this.#sessionStates.delete(sessionId)
    else this.#sessionStates.set(sessionId, state)
    for (const listener of this.#sessionStateListeners) listener(sessionId, state)
  }

  #emitLog(level: string, msg: string): void {
    for (const listener of this.#logListeners) listener(level, msg)
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
