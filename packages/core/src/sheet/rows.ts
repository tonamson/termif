import { CoreError } from '../errors.js'
import {
  hostSchema,
  snippetSchema,
  storedCredentialSchema,
  vaultMetaSchema,
  type Host,
  type Snippet,
  type StoredCredential,
  type VaultMeta,
} from '../model.js'

/**
 * Column order is API: existing sheets are read by position. Append new
 * columns at the end; never reorder or remove.
 */
export const HOST_COLUMNS = [
  'id',
  'label',
  'hostname',
  'port',
  'username',
  'auth_ref',
  'tags',
  'group_id',
  'updated_at',
  'deleted',
] as const

export const CREDENTIAL_COLUMNS = [
  'id',
  'label',
  'kind',
  'cipher',
  'updated_at',
  'deleted',
] as const

export const SNIPPET_COLUMNS = ['id', 'label', 'body', 'tags', 'updated_at', 'deleted'] as const

export const META_COLUMNS = ['key', 'value'] as const

export const TABS = {
  hosts: 'hosts',
  credentials: 'credentials',
  snippets: 'snippets',
  meta: 'meta',
} as const

export type TabName = (typeof TABS)[keyof typeof TABS]

function cell(cells: readonly string[], columns: readonly string[], name: string): string {
  const index = columns.indexOf(name)
  const value = cells[index]
  if (value === undefined) {
    throw new CoreError(
      'sheet_bad_row',
      `row is missing the ${name} column (expected ${columns.length} cells, got ${cells.length})`,
    )
  }
  return value
}

const encodeTags = (tags: readonly string[]): string => tags.join(',')
const decodeTags = (raw: string): string[] =>
  raw.length === 0 ? [] : raw.split(',').map((t) => t.trim()).filter((t) => t.length > 0)

const encodeBool = (v: boolean): string => (v ? 'TRUE' : 'FALSE')
const decodeBool = (raw: string): boolean => raw.toUpperCase() === 'TRUE'

const encodeNullable = (v: string | null): string => v ?? ''
const decodeNullable = (raw: string): string | null => (raw.length === 0 ? null : raw)

export function hostToRow(host: Host): string[] {
  return [
    host.id,
    host.label,
    host.hostname,
    String(host.port),
    host.username,
    encodeNullable(host.authRef),
    encodeTags(host.tags),
    encodeNullable(host.groupId),
    host.updatedAt,
    encodeBool(host.deleted),
  ]
}

export function rowToHost(cells: readonly string[]): Host {
  const get = (name: string): string => cell(cells, HOST_COLUMNS, name)
  const port = Number(get('port'))
  if (!Number.isInteger(port)) {
    throw new CoreError('sheet_bad_row', `port is not an integer: ${get('port')}`)
  }
  return hostSchema.parse({
    id: get('id'),
    label: get('label'),
    hostname: get('hostname'),
    port,
    username: get('username'),
    authRef: decodeNullable(get('auth_ref')),
    tags: decodeTags(get('tags')),
    groupId: decodeNullable(get('group_id')),
    updatedAt: get('updated_at'),
    deleted: decodeBool(get('deleted')),
  })
}

export function credentialToRow(c: StoredCredential): string[] {
  return [c.id, c.label, c.kind, c.cipher, c.updatedAt, encodeBool(c.deleted)]
}

export function rowToCredential(cells: readonly string[]): StoredCredential {
  const get = (name: string): string => cell(cells, CREDENTIAL_COLUMNS, name)
  return storedCredentialSchema.parse({
    id: get('id'),
    label: get('label'),
    kind: get('kind'),
    cipher: get('cipher'),
    updatedAt: get('updated_at'),
    deleted: decodeBool(get('deleted')),
  })
}

export function snippetToRow(s: Snippet): string[] {
  return [s.id, s.label, s.body, encodeTags(s.tags), s.updatedAt, encodeBool(s.deleted)]
}

export function rowToSnippet(cells: readonly string[]): Snippet {
  const get = (name: string): string => cell(cells, SNIPPET_COLUMNS, name)
  return snippetSchema.parse({
    id: get('id'),
    label: get('label'),
    body: get('body'),
    tags: decodeTags(get('tags')),
    updatedAt: get('updated_at'),
    deleted: decodeBool(get('deleted')),
  })
}

/** `meta` is key/value rather than columnar, so new settings need no migration. */
export function metaToRows(meta: VaultMeta): string[][] {
  return [
    ['schema_version', String(meta.schemaVersion)],
    ['kdf_salt', meta.kdfSalt],
    ['kdf_m', String(meta.kdfParams.m)],
    ['kdf_t', String(meta.kdfParams.t)],
    ['kdf_p', String(meta.kdfParams.p)],
    ['vault_check', meta.vaultCheck],
  ]
}

export function rowsToMeta(rows: readonly (readonly string[])[]): VaultMeta {
  const map = new Map<string, string>()
  for (const row of rows) {
    const key = row[0]
    const value = row[1]
    if (key !== undefined && value !== undefined) map.set(key, value)
  }

  const need = (key: string): string => {
    const value = map.get(key)
    if (value === undefined) {
      throw new CoreError('sheet_bad_meta', `the meta tab is missing ${key}`)
    }
    return value
  }

  return vaultMetaSchema.parse({
    schemaVersion: Number(need('schema_version')),
    kdfSalt: need('kdf_salt'),
    kdfParams: { m: Number(need('kdf_m')), t: Number(need('kdf_t')), p: Number(need('kdf_p')) },
    vaultCheck: need('vault_check'),
  })
}
