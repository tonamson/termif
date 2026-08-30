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
  const match = CODE_PREFIX.exec(text)
  if (match?.[1] !== undefined && match[2] !== undefined) {
    return new CoreError(match[1], match[2])
  }
  return new CoreError('unknown', text)
}
