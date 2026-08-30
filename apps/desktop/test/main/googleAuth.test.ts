import { describe, expect, it, vi } from 'vitest'
import { GoogleAuth, SCOPES } from '../../src/main/googleAuth.js'

interface StoredToken {
  refreshToken: string
  accessToken: string
  expiresAtMs: number
}

/** In-memory stand-in for the keychain-backed store. */
function fakeStore() {
  const items = new Map<string, Uint8Array>()
  return {
    async get(key: string) {
      return items.get(key) ?? null
    },
    async set(key: string, value: Uint8Array) {
      items.set(key, value)
    },
    async delete(key: string) {
      items.delete(key)
    },
    items,
  }
}

function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; body: string | undefined }[] = []
  const fn = vi.fn(async (payload: { url: string; body?: string }) => {
    calls.push({ url: payload.url, body: payload.body })
    const next = responses.shift() ?? { status: 500, body: {} }
    return { status: next.status, body: JSON.stringify(next.body) }
  })
  return { fn, calls }
}

describe('GoogleAuth', () => {
  it('requests only the spreadsheets and drive.file scopes', () => {
    expect(SCOPES).toEqual([
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ])
    // Full Drive access would let the app read unrelated files; it must not ask.
    expect(SCOPES).not.toContain('https://www.googleapis.com/auth/drive')
  })

  it('has no session before the user authorises', async () => {
    const auth = new GoogleAuth({
      clientId: 'c',
      clientSecret: 's',
      store: fakeStore(),
      request: vi.fn(),
      now: () => 0,
    })
    expect(await auth.hasSession()).toBe(false)
  })

  it('starts a device flow and returns the user code and URL', async () => {
    const { fn, calls } = fakeFetch([
      {
        status: 200,
        body: {
          device_code: 'dev-1',
          user_code: 'ABCD-EFGH',
          verification_url: 'https://google.com/device',
          interval: 5,
          expires_in: 1800,
        },
      },
    ])
    const auth = new GoogleAuth({
      clientId: 'client-1',
      clientSecret: 'secret-1',
      store: fakeStore(),
      request: fn,
      now: () => 1_000_000,
    })

    const start = await auth.startDeviceFlow()

    expect(start.userCode).toBe('ABCD-EFGH')
    expect(start.verificationUrl).toBe('https://google.com/device')
    expect(start.deviceCode).toBe('dev-1')
    expect(start.intervalSecs).toBe(5)
    expect(calls[0]?.body).toContain('client_id=client-1')
    expect(calls[0]?.body).toContain(encodeURIComponent(SCOPES.join(' ')))
  })

  it('reports pending while the user has not finished', async () => {
    const { fn } = fakeFetch([{ status: 428, body: { error: 'authorization_pending' } }])
    const auth = new GoogleAuth({
      clientId: 'c',
      clientSecret: 's',
      store: fakeStore(),
      request: fn,
      now: () => 0,
    })

    expect(await auth.pollDeviceFlow('dev-1')).toEqual({ state: 'pending' })
  })

  it('stores the refresh token on authorization', async () => {
    const store = fakeStore()
    const { fn } = fakeFetch([
      {
        status: 200,
        body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 },
      },
    ])
    const auth = new GoogleAuth({
      clientId: 'c',
      clientSecret: 's',
      store,
      request: fn,
      now: () => 1_000_000,
    })

    expect(await auth.pollDeviceFlow('dev-1')).toEqual({ state: 'authorized' })
    expect(await auth.hasSession()).toBe(true)

    const raw = store.items.get('termif.googleToken')
    expect(raw).toBeDefined()
    const stored = JSON.parse(new TextDecoder().decode(raw)) as StoredToken
    expect(stored.refreshToken).toBe('rt-1')
    expect(stored.accessToken).toBe('at-1')
  })

  it('reports denial with the reason', async () => {
    const { fn } = fakeFetch([{ status: 400, body: { error: 'access_denied' } }])
    const auth = new GoogleAuth({
      clientId: 'c',
      clientSecret: 's',
      store: fakeStore(),
      request: fn,
      now: () => 0,
    })

    expect(await auth.pollDeviceFlow('dev-1')).toEqual({
      state: 'denied',
      reason: 'access_denied',
    })
  })

  it('reports expiry distinctly, since the user must restart the flow', async () => {
    const { fn } = fakeFetch([{ status: 400, body: { error: 'expired_token' } }])
    const auth = new GoogleAuth({
      clientId: 'c',
      clientSecret: 's',
      store: fakeStore(),
      request: fn,
      now: () => 0,
    })

    expect(await auth.pollDeviceFlow('dev-1')).toEqual({ state: 'expired' })
  })

  it('returns a cached access token while it is still valid', async () => {
    const store = fakeStore()
    store.items.set(
      'termif.googleToken',
      new TextEncoder().encode(
        JSON.stringify({ refreshToken: 'rt', accessToken: 'at-cached', expiresAtMs: 5_000_000 }),
      ),
    )
    const { fn } = fakeFetch([])
    const auth = new GoogleAuth({
      clientId: 'c',
      clientSecret: 's',
      store,
      request: fn,
      now: () => 4_000_000,
    })

    expect(await auth.accessToken()).toBe('at-cached')
    expect(fn).not.toHaveBeenCalled()
  })

  it('refreshes an expired access token using the refresh token', async () => {
    const store = fakeStore()
    store.items.set(
      'termif.googleToken',
      new TextEncoder().encode(
        JSON.stringify({ refreshToken: 'rt-1', accessToken: 'at-old', expiresAtMs: 1_000 }),
      ),
    )
    const { fn, calls } = fakeFetch([
      { status: 200, body: { access_token: 'at-new', expires_in: 3600 } },
    ])
    const auth = new GoogleAuth({
      clientId: 'c',
      clientSecret: 's',
      store,
      request: fn,
      now: () => 2_000_000,
    })

    expect(await auth.accessToken()).toBe('at-new')
    expect(calls[0]?.body).toContain('refresh_token=rt-1')
    expect(calls[0]?.body).toContain('grant_type=refresh_token')
  })

  it('refreshes slightly before expiry, so a long request does not fail mid-flight', async () => {
    const store = fakeStore()
    // Expires in 30s: inside the safety margin, so it refreshes now.
    store.items.set(
      'termif.googleToken',
      new TextEncoder().encode(
        JSON.stringify({ refreshToken: 'rt', accessToken: 'at-old', expiresAtMs: 1_030_000 }),
      ),
    )
    const { fn } = fakeFetch([{ status: 200, body: { access_token: 'at-new', expires_in: 3600 } }])
    const auth = new GoogleAuth({
      clientId: 'c',
      clientSecret: 's',
      store,
      request: fn,
      now: () => 1_000_000,
    })

    expect(await auth.accessToken()).toBe('at-new')
  })

  it('throws a clear error when no token is stored at all', async () => {
    const { fn } = fakeFetch([])
    const auth = new GoogleAuth({
      clientId: 'c',
      clientSecret: 's',
      store: fakeStore(),
      request: fn,
      now: () => 0,
    })

    await expect(auth.accessToken()).rejects.toThrow(/not signed in/i)
  })

  it('forgets the token on sign out', async () => {
    const store = fakeStore()
    store.items.set('termif.googleToken', new TextEncoder().encode('{}'))
    const { fn } = fakeFetch([])
    const auth = new GoogleAuth({
      clientId: 'c',
      clientSecret: 's',
      store,
      request: fn,
      now: () => 0,
    })

    await auth.signOut()

    expect(store.items.has('termif.googleToken')).toBe(false)
  })
})
