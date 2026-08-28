import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const native = require('../index.js')

// 1. The module loads and exposes the expected surface.
for (const fn of [
  'init', 'connect', 'disconnect', 'trustHostKey',
  'openShell', 'write', 'resize', 'closeChannel',
  'sftpList', 'sftpStat', 'sftpMkdir', 'sftpRename', 'sftpRemove', 'sftpReadRange',
  'sftpUpload', 'sftpDownload', 'cancelTransfer',
  'forwardLocal', 'forwardRemote', 'forwardSocks', 'forwardBoundPort', 'closeForward',
  'nextEvents',
]) {
  assert.equal(typeof native[fn], 'function', `missing export: ${fn}`)
}

// 2. init is callable and idempotent.
const khPath = path.join(os.tmpdir(), `termif-napi-kh-${process.pid}`)
native.init(khPath)
native.init(khPath)

// 3. nextEvents returns an array and respects its timeout without blocking forever.
const started = Date.now()
const events = await native.nextEvents(200)
assert.ok(Array.isArray(events), 'nextEvents must resolve to an array')
const elapsed = Date.now() - started
assert.ok(elapsed >= 150 && elapsed < 3000, `idle nextEvents took ${elapsed}ms`)

// 4. A stale handle rejects with a code-prefixed error rather than crashing.
await assert.rejects(
  () => native.disconnect(999999n),
  (err) => {
    assert.match(err.message, /^no_such_session:/, `unexpected message: ${err.message}`)
    return true
  },
)

// 5. Connecting to a closed port rejects and does not take the process down.
await assert.rejects(() =>
  native.connect({
    host: '127.0.0.1',
    port: 1,
    username: 'nobody',
    password: 'x',
    privateKeyPem: null,
    passphrase: null,
    connectTimeoutMs: 2000,
    keepaliveSecs: 30,
  }),
)

console.log('napi smoke test passed')
