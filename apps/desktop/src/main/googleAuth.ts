import type { DeviceFlowPoll, DeviceFlowStart, HttpResponsePayload } from '../shared/ipc.js'

/**
 * `drive.file` instead of full `drive`: the app can create and use its own
 * spreadsheet but cannot read anything else in the user's Drive (spec §4).
 */
export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
] as const

const DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const TOKEN_KEY = 'termif.googleToken'
/** Refresh this far before expiry so a slow request does not fail mid-flight. */
const REFRESH_MARGIN_MS = 60_000

interface StoredToken {
  refreshToken: string
  accessToken: string
  expiresAtMs: number
}

export interface GoogleAuthDeps {
  clientId: string
  clientSecret: string
  store: {
    get(key: string): Promise<Uint8Array | null>
    set(key: string, value: Uint8Array, requireBiometrics: boolean): Promise<void>
    delete(key: string): Promise<void>
  }
  request(payload: {
    method: 'GET' | 'POST' | 'PUT'
    url: string
    headers?: Record<string, string>
    body?: string
  }): Promise<HttpResponsePayload>
  now(): number
}

export class GoogleAuth {
  readonly #deps: GoogleAuthDeps

  constructor(deps: GoogleAuthDeps) {
    this.#deps = deps
  }

  async startDeviceFlow(): Promise<DeviceFlowStart> {
    const response = await this.#form(DEVICE_CODE_URL, {
      client_id: this.#deps.clientId,
      scope: SCOPES.join(' '),
    })

    const body = parse<{
      device_code?: string
      user_code?: string
      verification_url?: string
      verification_uri?: string
      interval?: number
      expires_in?: number
    }>(response)

    if (body.device_code === undefined || body.user_code === undefined) {
      throw new Error(`Google did not start a device flow: ${response.body.slice(0, 200)}`)
    }

    return {
      deviceCode: body.device_code,
      userCode: body.user_code,
      // Google has used both spellings over time.
      verificationUrl: body.verification_url ?? body.verification_uri ?? 'https://google.com/device',
      intervalSecs: body.interval ?? 5,
      expiresInSecs: body.expires_in ?? 1800,
    }
  }

  async pollDeviceFlow(deviceCode: string): Promise<DeviceFlowPoll> {
    const response = await this.#form(TOKEN_URL, {
      client_id: this.#deps.clientId,
      client_secret: this.#deps.clientSecret,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    })

    const body = parse<{
      access_token?: string
      refresh_token?: string
      expires_in?: number
      error?: string
    }>(response)

    if (body.access_token !== undefined && body.refresh_token !== undefined) {
      await this.#save({
        refreshToken: body.refresh_token,
        accessToken: body.access_token,
        expiresAtMs: this.#deps.now() + (body.expires_in ?? 3600) * 1000,
      })
      return { state: 'authorized' }
    }

    switch (body.error) {
      case 'authorization_pending':
      case 'slow_down':
        return { state: 'pending' }
      case 'expired_token':
        return { state: 'expired' }
      default:
        return { state: 'denied', reason: body.error ?? `HTTP ${response.status}` }
    }
  }

  async accessToken(): Promise<string> {
    const stored = await this.#load()
    if (stored === null) {
      throw new Error('not signed in to Google')
    }

    if (stored.expiresAtMs - REFRESH_MARGIN_MS > this.#deps.now()) {
      return stored.accessToken
    }

    const response = await this.#form(TOKEN_URL, {
      client_id: this.#deps.clientId,
      client_secret: this.#deps.clientSecret,
      refresh_token: stored.refreshToken,
      grant_type: 'refresh_token',
    })

    const body = parse<{ access_token?: string; expires_in?: number; error?: string }>(response)
    if (body.access_token === undefined) {
      throw new Error(`could not refresh the Google token: ${body.error ?? response.status}`)
    }

    const refreshed: StoredToken = {
      // A refresh response usually omits the refresh token; keep the one we have.
      refreshToken: stored.refreshToken,
      accessToken: body.access_token,
      expiresAtMs: this.#deps.now() + (body.expires_in ?? 3600) * 1000,
    }
    await this.#save(refreshed)
    return refreshed.accessToken
  }

  async hasSession(): Promise<boolean> {
    return (await this.#load()) !== null
  }

  async signOut(): Promise<void> {
    await this.#deps.store.delete(TOKEN_KEY)
  }

  async #form(url: string, fields: Record<string, string>): Promise<HttpResponsePayload> {
    // Encode with `encodeURIComponent` rather than `URLSearchParams`: the test
    // (and RFC 3986) expect the scope separator to be `%20`, not form-urlencoded
    // `+`. Google's token endpoint accepts either.
    const body = Object.entries(fields)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&')
    return this.#deps.request({
      method: 'POST',
      url,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
  }

  async #save(token: StoredToken): Promise<void> {
    await this.#deps.store.set(
      TOKEN_KEY,
      new TextEncoder().encode(JSON.stringify(token)),
      false,
    )
  }

  async #load(): Promise<StoredToken | null> {
    const raw = await this.#deps.store.get(TOKEN_KEY)
    if (raw === null) return null
    try {
      return JSON.parse(new TextDecoder().decode(raw)) as StoredToken
    } catch {
      return null
    }
  }
}

function parse<T>(response: HttpResponsePayload): T {
  try {
    return JSON.parse(response.body) as T
  } catch {
    return {} as T
  }
}
