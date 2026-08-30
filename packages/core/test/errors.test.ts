import { describe, expect, it } from 'vitest'
import { CoreError, parseFfiError } from '../src/errors.js'

describe('parseFfiError', () => {
  it('extracts the code from a napi-style prefixed message', () => {
    const err = parseFfiError(new Error('host_key_unknown: unknown host key for example.com'))
    expect(err.code).toBe('host_key_unknown')
    expect(err.message).toContain('example.com')
  })

  it('extracts the code from a raw { code, message } object', () => {
    const err = parseFfiError({ code: 'auth', message: 'authentication failed' })
    expect(err.code).toBe('auth')
    expect(err.message).toBe('authentication failed')
  })

  it('falls back to "unknown" for an unrecognised error', () => {
    const err = parseFfiError('something went sideways')
    expect(err.code).toBe('unknown')
    expect(err.message).toBe('something went sideways')
  })

  it('does not treat a colon inside a message as a code delimiter', () => {
    const err = parseFfiError(new Error('connect failed: 127.0.0.1:22 refused'))
    expect(err.code).toBe('unknown')
  })

  it('keeps host key details when present', () => {
    const err = new CoreError('host_key_mismatch', 'key changed', {
      host: 'example.com',
      expected: 'SHA256:aaa',
      got: 'SHA256:bbb',
    })
    expect(err.details.host).toBe('example.com')
    expect(err.isSecurityBlock()).toBe(true)
  })

  it('marks only host_key_mismatch as a security block', () => {
    expect(new CoreError('host_key_unknown', 'x').isSecurityBlock()).toBe(false)
    expect(new CoreError('auth', 'x').isSecurityBlock()).toBe(false)
    expect(new CoreError('host_key_mismatch', 'x').isSecurityBlock()).toBe(true)
  })
})
