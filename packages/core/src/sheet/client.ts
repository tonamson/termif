import { CoreError } from '../errors.js'
import type { HttpClient } from '../platform.js'
import {
  CREDENTIAL_COLUMNS,
  HOST_COLUMNS,
  META_COLUMNS,
  SNIPPET_COLUMNS,
  TABS,
  type TabName,
} from './rows.js'

const API = 'https://sheets.googleapis.com/v4/spreadsheets'

export interface SheetClientOptions {
  /** Injected so tests do not wait. Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>
  maxAttempts?: number
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Thin wrapper over the Sheets REST API. Retries the failures that are worth
 * retrying and gives up loudly on the ones that are not, so `sync` can decide
 * whether to stay offline (spec §7).
 */
export class SheetClient {
  readonly #net: HttpClient
  readonly #accessToken: () => Promise<string>
  readonly #sleep: (ms: number) => Promise<void>
  readonly #maxAttempts: number

  constructor(
    net: HttpClient,
    accessToken: () => Promise<string>,
    options: SheetClientOptions = {},
  ) {
    this.#net = net
    this.#accessToken = accessToken
    this.#sleep = options.sleep ?? defaultSleep
    this.#maxAttempts = options.maxAttempts ?? 5
  }

  async createSpreadsheet(title: string): Promise<string> {
    const created = await this.#send<{ spreadsheetId?: string }>({
      method: 'POST',
      url: API,
      body: {
        properties: { title },
        sheets: Object.values(TABS).map((name) => ({ properties: { title: name } })),
      },
    })

    const id = created.spreadsheetId
    if (id === undefined) {
      throw new CoreError('sheet_request', 'Sheets did not return a spreadsheet id')
    }

    // Header rows, written positionally, because readers index by column order.
    await this.#send({
      method: 'POST',
      url: `${API}/${id}/values:batchUpdate`,
      body: {
        valueInputOption: 'RAW',
        data: [
          { range: `${TABS.hosts}!A1`, values: [[...HOST_COLUMNS]] },
          { range: `${TABS.credentials}!A1`, values: [[...CREDENTIAL_COLUMNS]] },
          { range: `${TABS.snippets}!A1`, values: [[...SNIPPET_COLUMNS]] },
          { range: `${TABS.meta}!A1`, values: [[...META_COLUMNS]] },
        ],
      },
    })

    return id
  }

  /**
   * A second device must attach the sheet the first device created, not open a
   * new vault. `drive.file` lists only files this app created for this user.
   * Oldest match wins so two racing first-runs still converge.
   */
  async findSpreadsheetByTitle(title: string): Promise<string | null> {
    const escaped = title.replace(/'/g, "\\'")
    const q = encodeURIComponent(
      `name = '${escaped}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    )
    const response = await this.#send<{ files?: { id?: string }[] }>({
      method: 'GET',
      url: `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&orderBy=createdTime&pageSize=1`,
    })
    const id = response.files?.[0]?.id
    return id === undefined || id.length === 0 ? null : id
  }

  /** Returns data rows only; the header row is dropped. */
  async readTab(spreadsheetId: string, tab: TabName): Promise<string[][]> {
    const range = encodeURIComponent(`${tab}!A1:Z100000`)
    const response = await this.#send<{ values?: string[][] }>({
      method: 'GET',
      url: `${API}/${spreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`,
    })
    const values = response.values ?? []
    return values.slice(1).map((row) => row.map((cell) => (cell === null ? '' : String(cell))))
  }

  /** `rowIndexToCells` keys are 1-based sheet row numbers. */
  async writeRows(
    spreadsheetId: string,
    tab: TabName,
    rowIndexToCells: ReadonlyMap<number, readonly string[]>,
  ): Promise<void> {
    if (rowIndexToCells.size === 0) return

    const data = [...rowIndexToCells.entries()]
      .sort(([a], [b]) => a - b)
      .map(([rowIndex, cells]) => ({ range: `${tab}!A${rowIndex}`, values: [[...cells]] }))

    await this.#send({
      method: 'POST',
      url: `${API}/${spreadsheetId}/values:batchUpdate`,
      // RAW, never USER_ENTERED: a label or hostname beginning with "=" must
      // stay text rather than becoming a formula.
      body: { valueInputOption: 'RAW', data },
    })
  }

  async appendRows(
    spreadsheetId: string,
    tab: TabName,
    rows: readonly (readonly string[])[],
  ): Promise<void> {
    if (rows.length === 0) return

    const range = encodeURIComponent(`${tab}!A1`)
    await this.#send({
      method: 'POST',
      url: `${API}/${spreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      body: { values: rows.map((row) => [...row]) },
    })
  }

  /** id → 1-based row number, so an update can target the row that holds it. */
  async findRowIndexes(spreadsheetId: string, tab: TabName): Promise<Map<string, number>> {
    const range = encodeURIComponent(`${tab}!A1:A100000`)
    const response = await this.#send<{ values?: string[][] }>({
      method: 'GET',
      url: `${API}/${spreadsheetId}/values/${range}`,
    })
    const values = response.values ?? []

    const indexes = new Map<string, number>()
    // Skip the header at index 0; sheet rows are 1-based.
    for (let i = 1; i < values.length; i += 1) {
      const id = values[i]?.[0]
      if (id !== undefined && id.length > 0) indexes.set(String(id), i + 1)
    }
    return indexes
  }

  async #send<T>(init: {
    method: 'GET' | 'POST' | 'PUT'
    url: string
    body?: unknown
  }): Promise<T> {
    const token = await this.#accessToken()

    let lastStatus = 0
    let lastBody = ''

    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      const response = await this.#net.request({
        method: init.method,
        url: init.url,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      })

      lastStatus = response.status
      lastBody = response.body

      if (response.status >= 200 && response.status < 300) {
        return (response.body.length === 0 ? {} : JSON.parse(response.body)) as T
      }

      // 401/403 need a fresh token or a scope fix, not a retry.
      if (response.status === 401 || response.status === 403) {
        throw new CoreError('sheet_unauthorized', describe(response.status, response.body))
      }

      // Anything else in the 4xx range will fail identically next time.
      if (response.status < 500 && response.status !== 429) {
        throw new CoreError('sheet_request', describe(response.status, response.body))
      }

      if (attempt < this.#maxAttempts) {
        // Exponential with jitter: several devices retrying in lockstep would
        // otherwise re-collide on every attempt.
        const base = 500 * 2 ** (attempt - 1)
        await this.#sleep(base + Math.floor(Math.random() * 250))
      }
    }

    throw new CoreError('sheet_quota', describe(lastStatus, lastBody))
  }
}

function describe(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    const message = parsed.error?.message
    if (message !== undefined) return `Sheets returned ${status}: ${message}`
  } catch {
    // fall through to the raw body
  }
  return `Sheets returned ${status}: ${body.slice(0, 200)}`
}
