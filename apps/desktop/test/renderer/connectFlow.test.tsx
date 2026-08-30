import { describe, expect, it, vi } from 'vitest'
import { CoreError, Store } from '@termif/core'
import { resolveCredential, classifyConnectError } from '../../src/renderer/state/connectFlow.js'
import { fakePlatform } from './fakes/platform.js'

describe('resolveCredential', () => {
  it('returns nothing for a host with no stored credential', async () => {
    const platform = await fakePlatform()
    const store = await Store.open(platform)

    const host = await store.upsertHost({
      label: 'h',
      hostname: 'h',
      port: 22,
      username: 'u',
      authRef: null,
      tags: [],
      groupId: null,
    })

    expect(await resolveCredential(store, host)).toBeNull()
  })

  it('passes credential.secret to the caller unchanged (no decrypt)', async () => {
    const platform = await fakePlatform()
    const store = await Store.open(platform)

    const credential = await store.upsertCredential({
      label: 'pw',
      kind: 'password',
      secret: 'hunter2',
    })
    const host = await store.upsertHost({
      label: 'h',
      hostname: 'h',
      port: 22,
      username: 'u',
      authRef: credential.id,
      tags: [],
      groupId: null,
    })

    expect(await resolveCredential(store, host)).toEqual({ password: 'hunter2' })
    // Verify the stored form is literally the secret — no cipher field.
    const stored = await store.getCredential(credential.id)
    expect(stored!.secret).toBe('hunter2')
    expect((stored as unknown as Record<string, unknown>).cipher).toBeUndefined()
  })

  it('resolves a key credential into privateKeyPem', async () => {
    const platform = await fakePlatform()
    const store = await Store.open(platform)

    const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END OPENSSH PRIVATE KEY-----'
    const credential = await store.upsertCredential({
      label: 'key',
      kind: 'key',
      secret: pem,
    })
    const host = await store.upsertHost({
      label: 'h',
      hostname: 'h',
      port: 22,
      username: 'u',
      authRef: credential.id,
      tags: [],
      groupId: null,
    })

    expect(await resolveCredential(store, host)).toEqual({ privateKeyPem: pem })
  })

  it('resolveCredential has no vault param', async () => {
    expect(resolveCredential.length).toBe(2)
  })

  it('throws a clear error when the referenced credential is gone (deleted)', async () => {
    const platform = await fakePlatform()
    const store = await Store.open(platform)
    const host = await store.upsertHost({
      label: 'h',
      hostname: 'h',
      port: 22,
      username: 'u',
      authRef: 'missing-id',
      tags: [],
      groupId: null,
    })

    await expect(resolveCredential(store, host)).rejects.toMatchObject({
      code: 'credential_missing',
    })
  })

  it('deleted credential error does not include the secret', async () => {
    const platform = await fakePlatform()
    const store = await Store.open(platform)
    const secret = 'super-secret-hunter2'
    const credential = await store.upsertCredential({
      label: 'pw',
      kind: 'password',
      secret,
    })
    const host = await store.upsertHost({
      label: 'h',
      hostname: 'h',
      port: 22,
      username: 'u',
      authRef: credential.id,
      tags: [],
      groupId: null,
    })
    await store.deleteCredential(credential.id)

    let err: unknown
    try {
      await resolveCredential(store, host)
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
    const msg = err instanceof Error ? err.message : String(err)
    expect(msg).not.toContain(secret)
    expect((err as CoreError).code).toBe('credential_missing')
  })

  it('connecting with saved credential would pass secret unchanged to ssh.connect', async () => {
    // Simulate the useConnectFlow attempt path: resolve then ssh.connect
    const platform = await fakePlatform()
    const store = await Store.open(platform)
    const credential = await store.upsertCredential({
      label: 'pw',
      kind: 'password',
      secret: 'hunter2',
    })
    const host = await store.upsertHost({
      label: 'h',
      hostname: 'h',
      port: 22,
      username: 'u',
      authRef: credential.id,
      tags: [],
      groupId: null,
    })
    const resolved = await resolveCredential(store, host)
    const sshConnect = vi.fn(async (_h: unknown, cred: unknown) => 'sess-1')
    await sshConnect(host, resolved)
    expect(sshConnect).toHaveBeenCalledWith(host, { password: 'hunter2' })
  })
})

describe('classifyConnectError', () => {
  it('recognises an unknown host key as promptable', () => {
    const result = classifyConnectError(
      new CoreError('host_key_unknown', 'unknown', {
        host: 'h',
        fingerprint: 'SHA256:aaa',
        algo: 'ssh-ed25519',
      }),
    )
    expect(result).toEqual({
      kind: 'prompt',
      mode: 'unknown',
      fingerprint: 'SHA256:aaa',
      algo: 'ssh-ed25519',
      expected: null,
    })
  })

  it('recognises a mismatch as a block, not a prompt to trust', () => {
    const result = classifyConnectError(
      new CoreError('host_key_mismatch', 'changed', {
        host: 'h',
        expected: 'SHA256:aaa',
        got: 'SHA256:bbb',
      }),
    )
    expect(result).toEqual({
      kind: 'prompt',
      mode: 'mismatch',
      fingerprint: 'SHA256:bbb',
      algo: '',
      expected: 'SHA256:aaa',
    })
  })

  it('maps an auth failure to a message the user can act on', () => {
    const result = classifyConnectError(new CoreError('auth', 'bad password'))
    expect(result.kind).toBe('message')
    expect(result.kind === 'message' && result.text).toMatch(/username and credential/i)
  })

  it('maps a timeout to its own message', () => {
    const result = classifyConnectError(new CoreError('timeout', 'timed out'))
    expect(result.kind === 'message' && result.text).toMatch(/timed out/i)
  })

  it('falls back to a generic message for anything else', () => {
    const result = classifyConnectError(new CoreError('io', 'socket exploded'))
    expect(result.kind === 'message' && result.text).toContain('socket exploded')
  })
})
