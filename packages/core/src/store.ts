import {
  hostSchema,
  newId,
  SCHEMA_VERSION,
  snippetSchema,
  storedCredentialSchema,
  type Host,
  type Snippet,
  type StoredCredential,
} from './model.js'
import type { LocalDb, Platform, SqlValue } from './platform.js'

const STALE_META_KEYS = ['kdfSalt', 'kdfParams', 'vaultCheck', 'spreadsheetId']

export async function columnsOf(db: LocalDb, table: string): Promise<Set<string>> {
  const rows = await db.query<{ name: string }>(`PRAGMA table_info(${table})`)
  return new Set(rows.map((r) => r.name))
}

export type RowKind = 'hosts' | 'credentials' | 'snippets'
type ChangeListener = (kind: RowKind) => void

type StorePlatform = Pick<Platform, 'db' | 'now'>

/** Fields the caller supplies; the store owns id, updatedAt, and deleted. */
export type HostInput = Omit<Host, 'id' | 'updatedAt' | 'deleted'> & { id?: string }
export type CredentialInput = Omit<StoredCredential, 'id' | 'updatedAt' | 'deleted' | 'passphrase'> & {
  id?: string
  passphrase?: string | null
}
export type SnippetInput = Omit<Snippet, 'id' | 'updatedAt' | 'deleted'> & { id?: string }

export type KnownHost = {
  host: string
  port: number
  algo: string
  key: string
  addedAt: string
}
export type KnownHostInput = Omit<KnownHost, 'addedAt'> & { addedAt?: string }

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS hosts (
     id TEXT PRIMARY KEY,
     label TEXT NOT NULL,
     hostname TEXT NOT NULL,
     port INTEGER NOT NULL,
     username TEXT NOT NULL,
     auth_ref TEXT,
     tags TEXT NOT NULL,
     group_id TEXT,
     updated_at TEXT NOT NULL,
     deleted INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      kind TEXT NOT NULL,
      secret TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0
    )`,
  `CREATE TABLE IF NOT EXISTS snippets (
     id TEXT PRIMARY KEY,
     label TEXT NOT NULL,
     body TEXT NOT NULL,
     tags TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     deleted INTEGER NOT NULL DEFAULT 0
   )`,
   `CREATE TABLE IF NOT EXISTS known_hosts (
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      algo TEXT NOT NULL,
      key TEXT NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (host, port, algo)
    )`,
   `CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  `CREATE INDEX IF NOT EXISTS hosts_updated_at ON hosts (updated_at)`,
  `CREATE INDEX IF NOT EXISTS credentials_updated_at ON credentials (updated_at)`,
  `CREATE INDEX IF NOT EXISTS snippets_updated_at ON snippets (updated_at)`,
]

/**
 * The local database is the read source for the whole app; the Sheet is only
 * a sync medium (spec §4). Everything here works offline.
 */
export class Store {
  readonly #db: LocalDb
  readonly #now: () => string
  readonly #listeners = new Set<ChangeListener>()

  private constructor(db: LocalDb, now: () => string) {
    this.#db = db
    this.#now = now
  }

  static async open(platform: StorePlatform): Promise<Store> {
    for (const sql of MIGRATIONS) {
      await platform.db.exec(sql)
    }
    const current = await platform.db.query<{ value: string }>(
      'SELECT value FROM meta WHERE key = ?',
      ['schemaVersion'],
    )
    const version = current[0]?.value ?? null
    if (version === null) {
      await platform.db.exec(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ['schemaVersion', String(SCHEMA_VERSION)],
      )
      // New DB at version 3 needs passphrase column even though MIGRATIONS creates old shape
      await platform.db.exec('ALTER TABLE credentials ADD COLUMN passphrase TEXT').catch(() => {})
    } else if (version === '1') {
      await platform.db.exec('DROP TABLE IF EXISTS credentials')
      await platform.db.exec(MIGRATIONS[1]!)
      await platform.db.exec(MIGRATIONS[6]!)
      await platform.db.exec('ALTER TABLE credentials ADD COLUMN passphrase TEXT').catch(() => {})
      for (const k of STALE_META_KEYS) {
        await platform.db.exec('DELETE FROM meta WHERE key = ?', [k])
      }
      await platform.db.exec(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ['schemaVersion', String(SCHEMA_VERSION)],
      )
    } else if (version === '2') {
      await platform.db.exec('ALTER TABLE credentials ADD COLUMN passphrase TEXT').catch(() => {})
      await platform.db.exec(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ['schemaVersion', String(SCHEMA_VERSION)],
      )
    }
    // Ensure column exists even if version already 3 but column missing (e.g. buggy earlier build)
    await platform.db.exec('ALTER TABLE credentials ADD COLUMN passphrase TEXT').catch(() => {})
    return new Store(platform.db, platform.now)
  }

  async migrate(): Promise<void> {
    const current = await this.#db.query<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['schemaVersion'])
    const version = current[0]?.value ?? null
    if (version === '2') {
      await this.#db.exec('ALTER TABLE credentials ADD COLUMN passphrase TEXT').catch(() => {})
      await this.#db.exec(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ['schemaVersion', String(SCHEMA_VERSION)],
      )
    }
  }

  onChange(listener: ChangeListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #emit(kind: RowKind): void {
    for (const listener of this.#listeners) listener(kind)
  }

  // ---- hosts ----

  async listHosts(): Promise<Host[]> {
    const rows = await this.#db.query<HostRow>(
      'SELECT * FROM hosts WHERE deleted = 0 ORDER BY label COLLATE NOCASE',
    )
    return rows.map(toHost)
  }

  async getHost(id: string): Promise<Host | null> {
    const rows = await this.#db.query<HostRow>(
      'SELECT * FROM hosts WHERE id = ? AND deleted = 0',
      [id],
    )
    const row = rows[0]
    return row === undefined ? null : toHost(row)
  }

  async upsertHost(input: HostInput): Promise<Host> {
    const host = hostSchema.parse({
      ...input,
      id: input.id ?? newId(),
      updatedAt: this.#now(),
      deleted: false,
    })
    await this.#writeHost(host)
    this.#emit('hosts')
    return host
  }

  async deleteHost(id: string): Promise<void> {
    // Tombstone, never DELETE: a vanished row is indistinguishable from one
    // that has not synced yet (spec §4).
    await this.#db.exec('UPDATE hosts SET deleted = 1, updated_at = ? WHERE id = ?', [
      this.#now(),
      id,
    ])
    this.#emit('hosts')
  }

  async #writeHost(host: Host): Promise<void> {
    await this.#db.exec(
      `INSERT INTO hosts (id, label, hostname, port, username, auth_ref, tags, group_id, updated_at, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         label = excluded.label, hostname = excluded.hostname, port = excluded.port,
         username = excluded.username, auth_ref = excluded.auth_ref, tags = excluded.tags,
         group_id = excluded.group_id, updated_at = excluded.updated_at,
         deleted = excluded.deleted`,
      [
        host.id,
        host.label,
        host.hostname,
        host.port,
        host.username,
        host.authRef,
        JSON.stringify(host.tags),
        host.groupId,
        host.updatedAt,
        host.deleted ? 1 : 0,
      ],
    )
  }

  // ---- credentials ----

  async listCredentials(): Promise<StoredCredential[]> {
    const rows = await this.#db.query<CredentialRow>(
      'SELECT * FROM credentials WHERE deleted = 0 ORDER BY label COLLATE NOCASE',
    )
    return rows.map(toCredential)
  }

  async getCredential(id: string): Promise<StoredCredential | null> {
    const rows = await this.#db.query<CredentialRow>(
      'SELECT * FROM credentials WHERE id = ? AND deleted = 0',
      [id],
    )
    const row = rows[0]
    return row === undefined ? null : toCredential(row)
  }

  async upsertCredential(input: CredentialInput): Promise<StoredCredential> {
    const credential = storedCredentialSchema.parse({
      passphrase: null,
      ...input,
      id: input.id ?? newId(),
      updatedAt: this.#now(),
      deleted: false,
    })
    await this.#writeCredential(credential)
    this.#emit('credentials')
    return credential
  }

  async deleteCredential(id: string): Promise<void> {
    await this.#db.exec('UPDATE credentials SET deleted = 1, updated_at = ? WHERE id = ?', [
      this.#now(),
      id,
    ])
    this.#emit('credentials')
  }

  async #writeCredential(c: StoredCredential): Promise<void> {
    await this.#db.exec(
      `INSERT INTO credentials (id, label, kind, secret, passphrase, updated_at, deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          label = excluded.label, kind = excluded.kind, secret = excluded.secret,
          passphrase = excluded.passphrase, updated_at = excluded.updated_at, deleted = excluded.deleted`,
      [c.id, c.label, c.kind, c.secret, c.passphrase, c.updatedAt, c.deleted ? 1 : 0],
    )
  }

  // ---- snippets ----

  async listSnippets(): Promise<Snippet[]> {
    const rows = await this.#db.query<SnippetRow>(
      'SELECT * FROM snippets WHERE deleted = 0 ORDER BY label COLLATE NOCASE',
    )
    return rows.map(toSnippet)
  }

  async getSnippet(id: string): Promise<Snippet | null> {
    const rows = await this.#db.query<SnippetRow>(
      'SELECT * FROM snippets WHERE id = ? AND deleted = 0',
      [id],
    )
    const row = rows[0]
    return row === undefined ? null : toSnippet(row)
  }

  async upsertSnippet(input: SnippetInput): Promise<Snippet> {
    const snippet = snippetSchema.parse({
      ...input,
      id: input.id ?? newId(),
      updatedAt: this.#now(),
      deleted: false,
    })
    await this.#writeSnippet(snippet)
    this.#emit('snippets')
    return snippet
  }

  async deleteSnippet(id: string): Promise<void> {
    await this.#db.exec('UPDATE snippets SET deleted = 1, updated_at = ? WHERE id = ?', [
      this.#now(),
      id,
    ])
    this.#emit('snippets')
  }

  async #writeSnippet(s: Snippet): Promise<void> {
    await this.#db.exec(
      `INSERT INTO snippets (id, label, body, tags, updated_at, deleted)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         label = excluded.label, body = excluded.body, tags = excluded.tags,
         updated_at = excluded.updated_at, deleted = excluded.deleted`,
      [s.id, s.label, s.body, JSON.stringify(s.tags), s.updatedAt, s.deleted ? 1 : 0],
    )
  }

  // ---- sync support ----

  async rowsChangedSince(iso: string): Promise<{
    hosts: Host[]
    credentials: StoredCredential[]
    snippets: Snippet[]
  }> {
    const [hosts, credentials, snippets] = await Promise.all([
      this.#db.query<HostRow>('SELECT * FROM hosts WHERE updated_at > ?', [iso]),
      this.#db.query<CredentialRow>('SELECT * FROM credentials WHERE updated_at > ?', [iso]),
      this.#db.query<SnippetRow>('SELECT * FROM snippets WHERE updated_at > ?', [iso]),
    ])
    return {
      hosts: hosts.map(toHost),
      credentials: credentials.map(toCredential),
      snippets: snippets.map(toSnippet),
    }
  }

  /**
   * Writes rows that came from the sheet. Unlike `upsert*`, this keeps each
   * row's own `updatedAt` — re-stamping it would push remote rows forward on
   * every pull and break last-write-wins.
   */
  async applyRemote(
    kind: RowKind,
    rows: readonly (Host | StoredCredential | Snippet)[],
  ): Promise<void> {
    if (rows.length === 0) return

    await this.#db.transaction(async () => {
      for (const row of rows) {
        if (kind === 'hosts') await this.#writeHost(hostSchema.parse(row))
        else if (kind === 'credentials') await this.#writeCredential(storedCredentialSchema.parse(row))
        else await this.#writeSnippet(snippetSchema.parse(row))
      }
    })
    this.#emit(kind)
  }

  /** Returns how many tombstones were removed. */
  async pruneTombstones(olderThanIso: string): Promise<number> {
    let removed = 0
    for (const table of ['hosts', 'credentials', 'snippets'] as const) {
      const before = await this.#db.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${table} WHERE deleted = 1 AND updated_at < ?`,
        [olderThanIso],
      )
      removed += before[0]?.n ?? 0
      await this.#db.exec(
        `DELETE FROM ${table} WHERE deleted = 1 AND updated_at < ?`,
        [olderThanIso],
      )
    }
    return removed
  }

  // ---- known_hosts ----

  async saveKnownHost(input: KnownHostInput): Promise<KnownHost> {
    const addedAt = input.addedAt ?? this.#now()
    const host: KnownHost = {
      host: input.host,
      port: input.port,
      algo: input.algo,
      key: input.key,
      addedAt,
    }
    await this.#db.exec(
      `INSERT INTO known_hosts (host, port, algo, key, added_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(host, port, algo) DO UPDATE SET key = excluded.key, added_at = excluded.added_at`,
      [host.host, host.port, host.algo, host.key, host.addedAt],
    )
    return host
  }

  async listKnownHosts(): Promise<KnownHost[]> {
    const rows = await this.#db.query<KnownHostRow>(
      'SELECT host, port, algo, key, added_at FROM known_hosts ORDER BY host, port, algo',
    )
    return rows.map(toKnownHost)
  }

  async getMetaValue(key: string): Promise<string | null> {
    const rows = await this.#db.query<{ value: string }>(
      'SELECT value FROM meta WHERE key = ?',
      [key],
    )
    return rows[0]?.value ?? null
  }

  async setMetaValue(key: string, value: string): Promise<void> {
    await this.#db.exec(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    )
  }
}

// ---- row mapping ----

interface HostRow {
  id: string
  label: string
  hostname: string
  port: number
  username: string
  auth_ref: string | null
  tags: string
  group_id: string | null
  updated_at: string
  deleted: number
}

interface CredentialRow {
  id: string
  label: string
  kind: string
  secret: string
  passphrase: string | null
  updated_at: string
  deleted: number
}

interface SnippetRow {
  id: string
  label: string
  body: string
  tags: string
  updated_at: string
  deleted: number
}

interface KnownHostRow {
  host: string
  port: number
  algo: string
  key: string
  added_at: string
}

function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

function toHost(row: HostRow): Host {
  return {
    id: row.id,
    label: row.label,
    hostname: row.hostname,
    port: row.port,
    username: row.username,
    authRef: row.auth_ref,
    tags: parseTags(row.tags),
    groupId: row.group_id,
    updatedAt: row.updated_at,
    deleted: row.deleted === 1,
  }
}

function toCredential(row: CredentialRow): StoredCredential {
  return storedCredentialSchema.parse({
    id: row.id,
    label: row.label,
    kind: row.kind,
    secret: row.secret,
    passphrase: row.passphrase ?? null,
    updatedAt: row.updated_at,
    deleted: row.deleted === 1,
  })
}

function toSnippet(row: SnippetRow): Snippet {
  return {
    id: row.id,
    label: row.label,
    body: row.body,
    tags: parseTags(row.tags),
    updatedAt: row.updated_at,
    deleted: row.deleted === 1,
  }
}

function toKnownHost(row: KnownHostRow): KnownHost {
  return {
    host: row.host,
    port: row.port,
    algo: row.algo,
    key: row.key,
    addedAt: row.added_at,
  }
}
