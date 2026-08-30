import { describe, expect, it, vi } from 'vitest'
import { CoreError } from '@termif/core'
import { resolveCredential, classifyConnectError } from '../../src/renderer/state/connectFlow.js'
import { Store, Vault } from '@termif/core'
import { fakePlatform } from './fakes/platform.js'

const TEST_PARAMS = { m: 16384, t: 1, p: 1 } as const

describe('resolveCredential', () => {
  it('returns nothing for a host with no stored credential', async () => {
    const platform = await fakePlatform()
    const store = await Store.open(platform)
    const { vault } = await Vault.create(platform, 'pw', TEST_PARAMS)

    const host = await store.upsertHost({
      label: 'h',
      hostname: 'h',
      port: 22,
      username: 'u',
      authRef: null,
      tags: [],
      groupId: null,
    })

    expect(await resolveCredential(store, vault, host)).toBeNull()
  })

  it('decrypts a password credential', async () => {
    const platform = await fakePlatform()
    const store = await Store.open(platform)
    const { vault } = await Vault.create(platform, 'pw', TEST_PARAMS)

    const credential = await store.upsertCredential({
      label: 'pw',
      kind: 'password',
      cipher: 'placeholder',
    })
    const sealed = await store.upsertCredential({
      id: credential.id,
      label: 'pw',
      kind: 'password',
      cipher: vault.encrypt('hunter2', credential.id),
    })
    const host = await store.upsertHost({
      label: 'h',
      hostname: 'h',
      port: 22,
      username: 'u',
      authRef: sealed.id,
      tags: [],
      groupId: null,
    })

    expect(await resolveCredential(store, vault, host)).toEqual({ password: 'hunter2' })
  })

  it('decrypts a key credential into privateKeyPem', async () => {
    const platform = await fakePlatform()
    const store = await Store.open(platform)
    const { vault } = await Vault.create(platform, 'pw', TEST_PARAMS)

    const credential = await store.upsertCredential({
      label: 'key',
      kind: 'key',
      cipher: 'placeholder',
    })
    const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END OPENSSH PRIVATE KEY-----'
    const sealed = await store.upsertCredential({
      id: credential.id,
      label: 'key',
      kind: 'key',
      cipher: vault.encrypt(pem, credential.id),
    })
    const host = await store.upsertHost({
      label: 'h',
      hostname: 'h',
      port: 22,
      username: 'u',
      authRef: sealed.id,
      tags: [],
      groupId: null,
    })

    expect(await resolveCredential(store, vault, host)).toEqual({ privateKeyPem: pem })
  })

  it('throws when the vault is locked but a credential is needed', async () => {
    const platform = await fakePlatform()
    const store = await Store.open(platform)
    const credential = await store.upsertCredential({
      label: 'pw',
      kind: 'password',
      cipher: 'AA',
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

    await expect(resolveCredential(store, null, host)).rejects.toMatchObject({
      code: 'vault_locked',
    })
  })

  it('throws a clear error when the referenced credential is gone', async () => {
    const platform = await fakePlatform()
    const store = await Store.open(platform)
    const { vault } = await Vault.create(platform, 'pw', TEST_PARAMS)
    const host = await store.upsertHost({
      label: 'h',
      hostname: 'h',
      port: 22,
      username: 'u',
      authRef: 'missing-id',
      tags: [],
      groupId: null,
    })

    await expect(resolveCredential(store, vault, host)).rejects.toMatchObject({
      code: 'credential_missing',
    })
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
