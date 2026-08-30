import { net } from 'electron'
import type { HttpRequestPayload, HttpResponsePayload } from '../shared/ipc.js'

/**
 * Uses Electron's `net` rather than Node's fetch so requests follow the app's
 * proxy configuration, which corporate networks rely on.
 */
export async function request(payload: HttpRequestPayload): Promise<HttpResponsePayload> {
  const response = await net.fetch(payload.url, {
    method: payload.method,
    // `exactOptionalPropertyTypes` is on: an `undefined` header value is not
    // assignable to `HeadersInit`, so spread it only when present.
    ...(payload.headers === undefined ? {} : { headers: payload.headers }),
    ...(payload.body === undefined ? {} : { body: payload.body }),
  })

  return { status: response.status, body: await response.text() }
}
