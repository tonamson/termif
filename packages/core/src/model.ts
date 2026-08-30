import { z } from 'zod'

export const SCHEMA_VERSION = 1

/** Rejects anything that is not an ISO-8601 UTC instant with milliseconds. */
const isoUtc = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, {
  message: 'must be an ISO-8601 UTC timestamp',
})

export const hostSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  hostname: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1),
  /** Id of a `StoredCredential`, or null to prompt at connect time. */
  authRef: z.string().min(1).nullable(),
  tags: z.array(z.string()),
  groupId: z.string().min(1).nullable(),
  updatedAt: isoUtc,
  deleted: z.boolean(),
})

export const storedCredentialSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(['password', 'key']),
  secret: z.string(),
  updatedAt: isoUtc,
  deleted: z.boolean(),
})

export const snippetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  body: z.string().min(1),
  tags: z.array(z.string()),
  updatedAt: isoUtc,
  deleted: z.boolean(),
})

export type Host = z.infer<typeof hostSchema>
export type StoredCredential = z.infer<typeof storedCredentialSchema>
export type Snippet = z.infer<typeof snippetSchema>

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'

/**
 * 16 characters of base64url from 128 random bits: each of the 16 bytes is
 * mapped onto one of the 64-symbol alphabet (`byte % 64`), so every character
 * carries 6 bits and the id holds 96 bits of effective entropy. Ids are
 * generated on four devices with no coordinator, so collision resistance
 * matters more than brevity; `crypto.getRandomValues` is a Web Crypto global,
 * present in every JS runtime this will ever run in.
 */
export function newId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const byte of bytes) {
    out += ID_ALPHABET[byte % 64]
  }
  return out
}
