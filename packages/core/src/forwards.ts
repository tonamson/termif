import { CoreError, parseFfiError } from './errors.js'
import { t } from './i18n/index.js'
import { newId } from './model.js'
import type { SshBridge, SshEvent } from './platform.js'

export type PlatformKind = 'desktop' | 'ios' | 'android'
export type ForwardKind = 'local' | 'remote' | 'socks'

export interface ForwardView {
  id: string
  kind: ForwardKind
  description: string
  boundPort: number | null
  acceptedCount: number
  lastPeer: string | null
  /** Platform caveat to show alongside the forward, or null. */
  note: string | null
}

/** Enough to re-establish the forward after a reconnect. */
type ForwardSpec =
  | { kind: 'local'; localBind: string; remoteHost: string; remotePort: number }
  | {
      kind: 'remote'
      remoteBindHost: string
      remoteBindPort: number
      localHost: string
      localPort: number
    }
  | { kind: 'socks'; localBind: string }

interface ForwardRecord extends ForwardView {
  sessionId: bigint
  bridgeId: bigint
  spec: ForwardSpec
}

export interface ForwardManagerDeps {
  ssh: SshBridge
  platformKind: PlatformKind
}

export class ForwardManager {
  readonly #ssh: SshBridge
  readonly #platformKind: PlatformKind
  readonly #records = new Map<string, ForwardRecord>()
  readonly #byBridgeId = new Map<bigint, string>()
  readonly #listeners = new Set<() => void>()

  constructor(deps: ForwardManagerDeps) {
    this.#ssh = deps.ssh
    this.#platformKind = deps.platformKind
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  list(): ForwardView[] {
    return [...this.#records.values()].map(
      ({ sessionId: _s, bridgeId: _b, spec: _spec, ...view }) => ({ ...view }),
    )
  }

  bridgeIdFor(id: string): bigint | undefined {
    return this.#records.get(id)?.bridgeId
  }

  async openLocal(
    sessionId: bigint,
    localBind: string,
    remoteHost: string,
    remotePort: number,
  ): Promise<string> {
    return this.#open(sessionId, { kind: 'local', localBind, remoteHost, remotePort })
  }

  async openRemote(
    sessionId: bigint,
    remoteBindHost: string,
    remoteBindPort: number,
    localHost: string,
    localPort: number,
  ): Promise<string> {
    return this.#open(sessionId, {
      kind: 'remote',
      remoteBindHost,
      remoteBindPort,
      localHost,
      localPort,
    })
  }

  async openSocks(sessionId: bigint, localBind: string): Promise<string> {
    return this.#open(sessionId, { kind: 'socks', localBind })
  }

  async close(id: string): Promise<void> {
    const record = this.#records.get(id)
    if (record === undefined) {
      throw new CoreError('no_such_forward', 'that forward is not open')
    }

    try {
      await this.#ssh.closeForward(record.bridgeId)
    } catch (e) {
      // Report but still forget it: a forward we cannot close is not one we
      // should keep showing as live.
      const parsed = parseFfiError(e)
      this.#forget(id)
      throw parsed
    }
    this.#forget(id)
  }

  handleEvent(event: SshEvent): void {
    if (event.kind !== 'forwardAccepted') return
    const id = this.#byBridgeId.get(event.forwardId)
    if (id === undefined) return
    const record = this.#records.get(id)
    if (record === undefined) return

    record.acceptedCount += 1
    record.lastPeer = event.peer
    this.#emit()
  }

  /**
   * After a reconnect the old bridge handles are dead, so each forward is
   * re-established on the new session under its original local id — the UI's
   * list stays stable across a network change.
   */
  async rebuildForSession(oldSessionId: bigint, newSessionId: bigint): Promise<void> {
    const affected = [...this.#records.values()].filter((r) => r.sessionId === oldSessionId)

    for (const record of affected) {
      this.#byBridgeId.delete(record.bridgeId)
      try {
        const bridgeId = await this.#start(newSessionId, record.spec)
        record.bridgeId = bridgeId
        record.sessionId = newSessionId
        record.boundPort = await this.#boundPortOrNull(record.spec, bridgeId)
        this.#byBridgeId.set(bridgeId, record.id)
      } catch {
        // A forward that will not come back must not linger as a dead row.
        this.#records.delete(record.id)
      }
    }
    this.#emit()
  }

  async #open(sessionId: bigint, spec: ForwardSpec): Promise<string> {
    let bridgeId: bigint
    try {
      bridgeId = await this.#start(sessionId, spec)
    } catch (e) {
      throw parseFfiError(e)
    }

    const id = newId()
    this.#records.set(id, {
      id,
      kind: spec.kind,
      description: describe(spec),
      boundPort: await this.#boundPortOrNull(spec, bridgeId),
      acceptedCount: 0,
      lastPeer: null,
      note: this.#noteFor(spec.kind),
      sessionId,
      bridgeId,
      spec,
    })
    this.#byBridgeId.set(bridgeId, id)
    this.#emit()
    return id
  }

  async #start(sessionId: bigint, spec: ForwardSpec): Promise<bigint> {
    if (spec.kind === 'local') {
      return this.#ssh.forwardLocal(sessionId, spec.localBind, spec.remoteHost, spec.remotePort)
    }
    if (spec.kind === 'socks') {
      return this.#ssh.forwardSocks(sessionId, spec.localBind)
    }
    return this.#ssh.forwardRemote(
      sessionId,
      spec.remoteBindHost,
      spec.remoteBindPort,
      spec.localHost,
      spec.localPort,
    )
  }

  /** A remote forward has no local listener, so it has no local bound port. */
  async #boundPortOrNull(spec: ForwardSpec, bridgeId: bigint): Promise<number | null> {
    if (spec.kind === 'remote') return null
    try {
      return await this.#ssh.forwardBoundPort(bridgeId)
    } catch {
      return null
    }
  }

  /**
   * States the OS constraint rather than working around it: iOS will not let a
   * background app hold a listening socket, and Android needs a foreground
   * service (spec §5).
   */
  #noteFor(kind: ForwardKind): string | null {
    if (kind === 'remote') return null // no local listener involved
    if (this.#platformKind === 'ios') return t('forward.iosForegroundOnly')
    if (this.#platformKind === 'android') return t('forward.androidBackground')
    return null
  }

  #forget(id: string): void {
    const record = this.#records.get(id)
    if (record !== undefined) this.#byBridgeId.delete(record.bridgeId)
    this.#records.delete(id)
    this.#emit()
  }

  #emit(): void {
    for (const listener of this.#listeners) listener()
  }
}

function describe(spec: ForwardSpec): string {
  if (spec.kind === 'local') {
    return t('forward.active', { from: spec.localBind, to: `${spec.remoteHost}:${spec.remotePort}` })
  }
  if (spec.kind === 'socks') {
    return t('forward.active', { from: spec.localBind, to: 'SOCKS5' })
  }
  return t('forward.active', {
    from: `${spec.remoteBindHost}:${spec.remoteBindPort}`,
    to: `${spec.localHost}:${spec.localPort}`,
  })
}
