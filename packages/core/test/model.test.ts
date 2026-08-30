import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KDF_PARAMS,
  SCHEMA_VERSION,
  hostSchema,
  newId,
  snippetSchema,
  storedCredentialSchema,
  vaultMetaSchema,
} from '../src/model.js'

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
        cipher: 'AAAA',
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
        cipher: 'AAAA',
        updatedAt: '2026-08-28T10:00:00.000Z',
        deleted: false,
      }),
    ).toThrow()
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

describe('vaultMetaSchema', () => {
  it('accepts the default parameters', () => {
    const meta = vaultMetaSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      kdfSalt: 'c2FsdA',
      kdfParams: DEFAULT_KDF_PARAMS,
      vaultCheck: 'Y2hlY2s',
    })
    expect(meta.kdfParams.m).toBe(65536)
  })

  it('rejects an implausibly weak memory cost', () => {
    // A tiny m would make brute force cheap; reject it rather than trust the sheet.
    expect(() =>
      vaultMetaSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        kdfSalt: 'c2FsdA',
        kdfParams: { m: 8, t: 1, p: 1 },
        vaultCheck: 'Y2hlY2s',
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
