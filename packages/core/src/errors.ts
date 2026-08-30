export type CoreErrorDetails = Readonly<Record<string, string>>

export class CoreError extends Error {
  readonly code: string
  readonly details: CoreErrorDetails

  constructor(code: string, message: string, details: CoreErrorDetails = {}) {
    super(message)
    this.name = 'CoreError'
    this.code = code
    this.details = details
  }

  /**
   * True only for failures that must stop the operation with no override.
   * A changed host key is the signature of an MITM in progress, so there is
   * deliberately no "continue once" path (spec §7).
   */
  isSecurityBlock(): boolean {
    return this.code === 'host_key_mismatch'
  }
}

/** Codes are snake_case with no whitespace; that is how we recognise one. */
const CODE_PREFIX = /^([a-z][a-z0-9_]*):\s(.*)$/s

/**
 * Normalises whatever the bridge threw into a `CoreError`. Plan 1's napi
 * binding produces "code: message"; a raw `{ code, message }` object is also
 * accepted, because an Error does not survive the IPC boundary intact and the
 * bridge should not have to re-stringify just to be re-parsed.
 */
export function parseFfiError(e: unknown): CoreError {
  if (e instanceof CoreError) return e

  if (typeof e === 'object' && e !== null && 'code' in e && 'message' in e) {
    const { code, message } = e as { code: unknown; message: unknown }
    if (typeof code === 'string' && typeof message === 'string') {
      return new CoreError(code, message)
    }
  }

  const text = e instanceof Error ? e.message : String(e)
  // Electron's ipcRenderer wraps the native error as
  // "Error invoking remote method 'termif:ssh:connect': Error: host_key_unknown: ..."
  // so we look for the *last* code: message pair, not the first.
  const wrapped = text.includes('Error invoking remote method')
    ? (text.split('Error:').pop()?.trim() ?? text)
    : text
  const candidate = wrapped.includes('host_key_unknown') || wrapped.includes('host_key_mismatch')
    ? wrapped
    : text
  // Try direct prefix first, then search for any embedded code pattern
  let match = CODE_PREFIX.exec(candidate)
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const code = match[1]
    const msg = match[2]
    const details: Record<string, string> = {}
    // Extract structured details that Rust now embeds in the message
    // e.g. "unknown host key for 1.2.3.4 fingerprint=SHA256:abc algo=ssh-ed25519"
    const fp = msg.match(/fingerprint=([^\s]+)/)
    if (fp?.[1]) details.fingerprint = fp[1]
    const algo = msg.match(/algo=([^\s]+)/)
    if (algo?.[1]) details.algo = algo[1]
    const host = msg.match(/for\s+([^\s]+)(?:\s|$)/)
    if (host?.[1]) details.host = host[1]
    const expected = msg.match(/expected=([^\s]+)/)
    if (expected?.[1]) details.expected = expected[1]
    const got = msg.match(/got=([^\s]+)/)
    if (got?.[1]) details.got = got[1]
    return new CoreError(code, msg, details)
  }
  // Fallback: find last occurrence of "code: message" inside wrapped text
  const all = [...text.matchAll(/([a-z][a-z0-9_]*):\s([^\n]+)/g)]
  if (all.length > 0) {
    const last = all[all.length - 1]!
    const code = last[1]!
    // Only accept known codes to avoid treating "host: 1.2.3.4" as code
    const known = new Set([
      'host_key_unknown',
      'host_key_mismatch',
      'auth',
      'connect',
      'timeout',
      'sftp',
      'forward',
      'io',
      'internal',
      'no_such_session',
      'no_such_channel',
      'no_such_transfer',
      'no_such_forward',
    ])
    if (known.has(code)) {
      const msg = text.slice((last.index ?? 0) + code.length + 2).trim()
      const details: Record<string, string> = {}
      const fp = msg.match(/fingerprint=([^\s]+)/)
      if (fp?.[1]) details.fingerprint = fp[1]
      const algo = msg.match(/algo=([^\s]+)/)
      if (algo?.[1]) details.algo = algo[1]
      const host = msg.match(/for\s+([^\s]+)(?:\s|$)/)
      if (host?.[1]) details.host = host[1]
      return new CoreError(code, msg, details)
    }
  }
  return new CoreError('unknown', text)
}
