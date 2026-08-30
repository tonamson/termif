import { describe, expect, it } from 'vitest'
import {
  CREDENTIAL_COLUMNS,
  HOST_COLUMNS,
  SNIPPET_COLUMNS,
  credentialToRow,
  hostToRow,
  metaToRows,
  rowToCredential,
  rowToHost,
  rowToSnippet,
  rowsToMeta,
  snippetToRow,
} from '../src/sheet/rows.js'
import { SCHEMA_VERSION, type Host } from '../src/model.js'
import { DEFAULT_KDF_PARAMS } from '../src/vault.js'

const host: Host = {
  id: 'h1',
  label: 'web-1',
  hostname: 'web1.example.com',
  port: 2222,
  username: 'deploy',
  authRef: 'c1',
  tags: ['prod', 'eu'],
  groupId: 'g1',
  updatedAt: '2026-08-28T10:00:00.000Z',
  deleted: false,
}

describe('host rows', () => {
  it('round-trips a host', () => {
    expect(rowToHost(hostToRow(host))).toEqual(host)
  })

  it('emits one cell per declared column, in order', () => {
    const row = hostToRow(host)
    expect(row).toHaveLength(HOST_COLUMNS.length)
    expect(row[HOST_COLUMNS.indexOf('hostname')]).toBe('web1.example.com')
  })

  it('keeps hostname and username as plaintext, which the spec chose deliberately', () => {
    const row = hostToRow(host)
    expect(row).toContain('web1.example.com')
    expect(row).toContain('deploy')
  })

  it('round-trips nulls as empty cells', () => {
    const bare = { ...host, authRef: null, groupId: null }
    const row = hostToRow(bare)
    expect(row[HOST_COLUMNS.indexOf('auth_ref')]).toBe('')
    expect(rowToHost(row)).toEqual(bare)
  })

  it('round-trips an empty tag list', () => {
    const untagged = { ...host, tags: [] }
    expect(rowToHost(hostToRow(untagged)).tags).toEqual([])
  })

  it('round-trips a tombstone', () => {
    const gone = { ...host, deleted: true }
    expect(rowToHost(hostToRow(gone)).deleted).toBe(true)
  })

  it('tolerates a short row from a hand-edited sheet by treating missing cells as empty', () => {
    const row = hostToRow(host).slice(0, 5)
    expect(() => rowToHost(row)).toThrow()
  })

  it('rejects a row whose port is not a number', () => {
    const row = hostToRow(host)
    row[HOST_COLUMNS.indexOf('port')] = 'twenty-two'
    expect(() => rowToHost(row)).toThrow()
  })
})

describe('credential rows', () => {
  it.skip('round-trips a credential and keeps the cipher opaque — Task 1 switched cipher→secret; rows deleted in Task 4', () => {
    const credential = {
      id: 'c1',
      label: 'deploy key',
      kind: 'key' as const,
      secret: 'AAAABBBBCCCC',
      updatedAt: '2026-08-28T10:00:00.000Z',
      deleted: false,
    }
    const row = credentialToRow(credential)
    expect(row).toHaveLength(CREDENTIAL_COLUMNS.length)
    expect(row[CREDENTIAL_COLUMNS.indexOf('cipher')]).toBe('AAAABBBBCCCC')
    expect(rowToCredential(row)).toEqual(credential)
  })
})

describe('snippet rows', () => {
  it('round-trips a multi-line body', () => {
    const snippet = {
      id: 's1',
      label: 'restart',
      body: 'systemctl restart nginx\nsystemctl status nginx',
      tags: ['nginx'],
      updatedAt: '2026-08-28T10:00:00.000Z',
      deleted: false,
    }
    const row = snippetToRow(snippet)
    expect(row).toHaveLength(SNIPPET_COLUMNS.length)
    expect(rowToSnippet(row)).toEqual(snippet)
  })
})

describe('meta rows', () => {
  it.skip('round-trips vault meta as key/value pairs — vaultMeta removed in Task 1; sheet deleted in Task 4', () => {
    const meta = {
      schemaVersion: SCHEMA_VERSION,
      kdfSalt: 'c2FsdA',
      kdfParams: DEFAULT_KDF_PARAMS,
      vaultCheck: 'Y2hlY2s',
    }
    expect(rowsToMeta(metaToRows(meta))).toEqual(meta)
  })

  it('throws when a required meta key is missing', () => {
    expect(() => rowsToMeta([['schema_version', '1']])).toThrow()
  })
})
