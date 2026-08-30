import { describe, expect, it } from 'vitest'
import { hostSchema, newId, snippetSchema, storedCredentialSchema } from '../src/model.js'

const validHost = {
  id: 'h1',
  label: 'web-1',
  hostname: 'web1.example.com',
  port: 22,
  username: 'deploy',
  authRef: 'c1',
  tags: ['prod'],
  groupId: null,
  updatedAt: '2026-08-28T10:00:00.000Z',
  deleted: false,
}

describe('hostSchema', () => {
  it('accepts a valid host', () => {
    expect(hostSchema.parse(validHost).label).toBe('web-1')
  })

  it('rejects a port outside 1-65535', () => {
    expect(() => hostSchema.parse({ ...validHost, port: 0 })).toThrow()
    expect(() => hostSchema.parse({ ...validHost, port: 70000 })).toThrow()
  })

  it('rejects an empty hostname', () => {
    expect(() => hostSchema.parse({ ...validHost, hostname: '' })).toThrow()
  })

  it('rejects a non-ISO updatedAt', () => {
    expect(() => hostSchema.parse({ ...validHost, updatedAt: 'yesterday' })).toThrow()
  })

  it('allows a null authRef for a host with no stored credential', () => {
    expect(hostSchema.parse({ ...validHost, authRef: null }).authRef).toBeNull()
  })
})

describe('storedCredentialSchema', () => {
  it('accepts password and key kinds', () => {
    for (const kind of ['password', 'key'] as const) {
      const parsed = storedCredentialSchema.parse({
        id: 'c1',
        label: 'root pw',
        kind,
        secret: 'hunter2',
        updatedAt: '2026-08-28T10:00:00.000Z',
        deleted: false,
      })
      expect(parsed.kind).toBe(kind)
    }
  })

  it('rejects an unknown kind', () => {
    expect(() =>
      storedCredentialSchema.parse({
        id: 'c1',
        label: 'x',
        kind: 'certificate',
        secret: 'hunter2',
        updatedAt: '2026-08-28T10:00:00.000Z',
        deleted: false,
      }),
    ).toThrow()
  })

  it('parses a credential with secret in the clear', () => {
    const parsed = storedCredentialSchema.parse({
      id: 'c1',
      label: 'root pw',
      kind: 'password',
      secret: 'hunter2',
      updatedAt: '2026-08-28T10:00:00.000Z',
      deleted: false,
    })
    expect(parsed.secret).toBe('hunter2')
  })

  it('rejects a cipher-only payload with no secret', () => {
    expect(() =>
      storedCredentialSchema.parse({
        id: 'c1',
        label: 'root pw',
        kind: 'password',
        cipher: 'AAAA',
        updatedAt: '2026-08-28T10:00:00.000Z',
        deleted: false,
      }),
    ).toThrow()
  })

  it('accepts a multi-line PEM private key as secret unchanged', () => {
    const pem = [
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW',
      'QyNTUxOQAAACBfakeKeyMaterialForTestOnly1234567890',
      '-----END OPENSSH PRIVATE KEY-----',
    ].join('\n')
    const parsed = storedCredentialSchema.parse({
      id: 'c1',
      label: 'deploy key',
      kind: 'key',
      secret: pem,
      updatedAt: '2026-08-28T10:00:00.000Z',
      deleted: false,
    })
    expect(parsed.secret).toBe(pem)
  })
})

describe('snippetSchema', () => {
  it('requires a non-empty body', () => {
    expect(() =>
      snippetSchema.parse({
        id: 's1',
        label: 'tail log',
        body: '',
        tags: [],
        updatedAt: '2026-08-28T10:00:00.000Z',
        deleted: false,
      }),
    ).toThrow()
  })
})

describe('newId', () => {
  it('produces distinct, URL-safe ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()))
    expect(ids.size).toBe(500)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{16,}$/)
  })
})
