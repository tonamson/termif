export type KeyType = 'ed25519' | 'rsa' | 'ecdsa' | 'unknown'

export type KeyReport =
  | { ok: true; type: KeyType; encrypted: boolean; fingerprint: string | null }
  | { ok: false; reason: 'empty' | 'public-key' | 'not-a-key' }

const OPENSSH_BEGIN = '-----BEGIN OPENSSH PRIVATE KEY-----'
const MAGIC = 'openssh-key-v1\0'

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

function readField(bytes: Uint8Array, offset: number): { value: Uint8Array; next: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  const length = view.getUint32(offset)
  return { value: bytes.subarray(offset + 4, offset + 4 + length), next: offset + 4 + length }
}

function typeOf(name: string): KeyType {
  if (name.includes('ed25519')) return 'ed25519'
  if (name.includes('rsa')) return 'rsa'
  if (name.includes('ecdsa')) return 'ecdsa'
  return 'unknown'
}

export async function inspectPrivateKey(text: string): Promise<KeyReport> {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'empty' }
  if (/^(ssh-|ecdsa-)\S+\s+AAAA/.test(trimmed)) return { ok: false, reason: 'public-key' }

  if (trimmed.startsWith(OPENSSH_BEGIN)) {
    const body = trimmed
      .split('\n')
      .filter((line) => !line.startsWith('-----'))
      .join('')
    let bytes: Uint8Array
    try {
      bytes = b64ToBytes(body)
    } catch {
      return { ok: false, reason: 'not-a-key' }
    }
    if (new TextDecoder().decode(bytes.subarray(0, MAGIC.length)) !== MAGIC) {
      return { ok: false, reason: 'not-a-key' }
    }

    let offset = MAGIC.length
    const cipher = readField(bytes, offset)
    offset = cipher.next
    readField(bytes, offset) // kdf
    offset = readField(bytes, offset).next
    // skip kdfOptions + key count (4 bytes)
    const kdfOptions = readField(bytes, offset)
    offset = kdfOptions.next + 4
    const publicKey = readField(bytes, offset)

    const cipherName = new TextDecoder().decode(cipher.value)
    const algo = new TextDecoder().decode(readField(publicKey.value, 0).value)
    const digest = await crypto.subtle.digest('SHA-256', publicKey.value)
    const fingerprint = `SHA256:${btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/=+$/, '')}`

    return {
      ok: true,
      type: typeOf(algo),
      encrypted: cipherName !== 'none',
      fingerprint,
    }
  }

  if (/-----BEGIN (RSA|EC|PRIVATE) .*KEY-----/.test(trimmed)) {
    return {
      ok: true,
      type: trimmed.includes('RSA') ? 'rsa' : trimmed.includes('EC') ? 'ecdsa' : 'unknown',
      encrypted: trimmed.includes('ENCRYPTED'),
      fingerprint: null,
    }
  }

  return { ok: false, reason: 'not-a-key' }
}
