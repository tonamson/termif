import { describe, expect, it } from 'vitest'
import { SheetClient } from '../src/sheet/client.js'
import { FakeHttp, json } from './fakes/http.js'

const token = async () => 'test-access-token'
/** No real waiting in tests: the backoff schedule is injected. */
const noSleep = async () => {}

function client(http: FakeHttp) {
  return new SheetClient(http, token, { sleep: noSleep, maxAttempts: 4 })
}

describe('SheetClient', () => {
  it('sends the bearer token on every request', async () => {
    const http = new FakeHttp()
    http.enqueue(json(200, { values: [] }))
    await client(http).readTab('sheet-1', 'hosts')
    expect(http.requests[0]?.headers.Authorization).toBe('Bearer test-access-token')
  })

  it('reads a tab and drops the header row', async () => {
    const http = new FakeHttp()
    http.enqueue(
      json(200, {
        values: [
          ['id', 'label'],
          ['h1', 'web-1'],
          ['h2', 'web-2'],
        ],
      }),
    )
    const rows = await client(http).readTab('sheet-1', 'hosts')
    expect(rows).toEqual([
      ['h1', 'web-1'],
      ['h2', 'web-2'],
    ])
  })

  it('returns an empty array for a tab with only a header', async () => {
    const http = new FakeHttp()
    http.enqueue(json(200, { values: [['id', 'label']] }))
    expect(await client(http).readTab('sheet-1', 'hosts')).toEqual([])
  })

  it('returns an empty array when the response has no values at all', async () => {
    const http = new FakeHttp()
    http.enqueue(json(200, {}))
    expect(await client(http).readTab('sheet-1', 'hosts')).toEqual([])
  })

  it('writes rows by index in a single batchUpdate', async () => {
    const http = new FakeHttp()
    http.enqueue(json(200, { totalUpdatedCells: 4 }))

    await client(http).writeRows(
      'sheet-1',
      'hosts',
      new Map([
        [2, ['h1', 'web-1']],
        [5, ['h2', 'web-2']],
      ]),
    )

    expect(http.requests).toHaveLength(1)
    const request = http.requests[0]!
    expect(request.url).toContain('/values:batchUpdate')
    const body = JSON.parse(request.body ?? '{}') as {
      valueInputOption: string
      data: { range: string; values: string[][] }[]
    }
    // RAW so a hostname like "=cmd" is never interpreted as a formula.
    expect(body.valueInputOption).toBe('RAW')
    expect(body.data).toHaveLength(2)
    expect(body.data[0]?.range).toBe('hosts!A2')
    expect(body.data[1]?.range).toBe('hosts!A5')
  })

  it('makes no request when there is nothing to write', async () => {
    const http = new FakeHttp()
    await client(http).writeRows('sheet-1', 'hosts', new Map())
    expect(http.requests).toEqual([])
  })

  it('appends rows with INSERT_ROWS', async () => {
    const http = new FakeHttp()
    http.enqueue(json(200, { updates: { updatedRows: 1 } }))

    await client(http).appendRows('sheet-1', 'hosts', [['h3', 'web-3']])

    const request = http.requests[0]!
    expect(request.url).toContain(':append')
    expect(request.url).toContain('insertDataOption=INSERT_ROWS')
  })

  it('maps ids to 1-based row numbers, accounting for the header', async () => {
    const http = new FakeHttp()
    http.enqueue(json(200, { values: [['id'], ['h1'], ['h2'], ['h3']] }))

    const indexes = await client(http).findRowIndexes('sheet-1', 'hosts')

    // Header is row 1, so the first data row is row 2.
    expect(indexes.get('h1')).toBe(2)
    expect(indexes.get('h3')).toBe(4)
    expect(indexes.size).toBe(3)
  })

  it('retries a 429 and succeeds', async () => {
    const http = new FakeHttp()
    http.enqueue(json(429, { error: { message: 'quota' } }), json(200, { values: [] }))

    const rows = await client(http).readTab('sheet-1', 'hosts')

    expect(rows).toEqual([])
    expect(http.requests).toHaveLength(2)
  })

  it('retries a 503 and succeeds', async () => {
    const http = new FakeHttp()
    http.enqueue(json(503, {}), json(200, { values: [] }))
    await client(http).readTab('sheet-1', 'hosts')
    expect(http.requests).toHaveLength(2)
  })

  it('gives up after maxAttempts and reports a quota error', async () => {
    const http = new FakeHttp()
    http.setFallback(json(429, { error: { message: 'quota exceeded' } }))

    await expect(client(http).readTab('sheet-1', 'hosts')).rejects.toMatchObject({
      code: 'sheet_quota',
    })
    expect(http.requests).toHaveLength(4)
  })

  it('does not retry a 400, which will never succeed', async () => {
    const http = new FakeHttp()
    http.setFallback(json(400, { error: { message: 'bad range' } }))

    await expect(client(http).readTab('sheet-1', 'hosts')).rejects.toMatchObject({
      code: 'sheet_request',
    })
    expect(http.requests).toHaveLength(1)
  })

  it('reports an auth failure distinctly, since it needs a new token not a retry', async () => {
    const http = new FakeHttp()
    http.setFallback(json(401, { error: { message: 'invalid credentials' } }))

    await expect(client(http).readTab('sheet-1', 'hosts')).rejects.toMatchObject({
      code: 'sheet_unauthorized',
    })
    expect(http.requests).toHaveLength(1)
  })

  it('creates a spreadsheet with all four tabs and their headers', async () => {
    const http = new FakeHttp()
    http.enqueue(
      json(200, { spreadsheetId: 'new-sheet-id' }),
      json(200, { totalUpdatedCells: 24 }),
    )

    const id = await client(http).createSpreadsheet('Termif')

    expect(id).toBe('new-sheet-id')
    const create = JSON.parse(http.requests[0]?.body ?? '{}') as {
      sheets: { properties: { title: string } }[]
    }
    expect(create.sheets.map((s) => s.properties.title)).toEqual([
      'hosts',
      'credentials',
      'snippets',
      'meta',
    ])

    // The second call writes the header row into each tab.
    const headers = JSON.parse(http.requests[1]?.body ?? '{}') as {
      data: { range: string; values: string[][] }[]
    }
    expect(headers.data).toHaveLength(4)
    expect(headers.data[0]?.values[0]?.[0]).toBe('id')
  })

  it('finds an existing Termif spreadsheet by title', async () => {
    const http = new FakeHttp()
    http.enqueue(json(200, { files: [{ id: 'existing-sheet' }] }))

    expect(await client(http).findSpreadsheetByTitle('Termif')).toBe('existing-sheet')

    const url = http.requests[0]?.url ?? ''
    expect(url).toContain('https://www.googleapis.com/drive/v3/files')
    expect(url).toContain(encodeURIComponent("name = 'Termif'"))
    expect(url).toContain('orderBy=createdTime')
  })

  it('returns null when no Termif spreadsheet exists yet', async () => {
    const http = new FakeHttp()
    http.enqueue(json(200, { files: [] }))

    expect(await client(http).findSpreadsheetByTitle('Termif')).toBeNull()
  })
})
