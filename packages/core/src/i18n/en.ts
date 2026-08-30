/**
 * The single source of message keys. Flat by design: the key union is derived
 * from this object, so a typo at a call site fails to compile.
 */
export const en = {
  'error.auth.failed': 'Authentication failed. Check the username and credential.',
  'error.connect.refused': 'Could not reach {host}. The server may be down or the port blocked.',
  'error.connect.timeout': 'Connecting to {host} timed out.',
  'error.network.offline': 'No network. Hosts are shown from this device; syncing will resume later.',
  'error.sftp.failed': 'File operation failed: {reason}',
  'error.forward.bindFailed': 'Could not listen on {bind}. Another program may be using it.',
  'error.internal': 'Something went wrong inside Termif: {reason}',
  'error.unknown': 'Unexpected error: {reason}',

  'hostkey.unknown.title': 'First connection to {host}',
  'hostkey.unknown.body':
    'This server presented a {algo} key with fingerprint {fingerprint}. Verify it out of band before trusting it.',
  'hostkey.unknown.trust': 'Trust and connect',
  'hostkey.unknown.cancel': 'Cancel',
  'hostkey.mismatch.title': 'Host key changed for {host}',
  'hostkey.mismatch.body':
    'The key changed from {expected} to {got}. This can mean the server was rebuilt, or that the connection is being intercepted. Termif will not connect until you remove the old key deliberately.',

  'vault.locked': 'Vault locked',
  'vault.unlock.prompt': 'Enter your master password',
  'vault.unlock.wrong': 'That password did not unlock the vault.',
  'vault.unlock.submit': 'Unlock',
  'vault.unlock.device': 'Unlock with this device',
  'vault.setup.title': 'Choose a master password',
  'vault.setup.warning':
    'If you lose this password, the stored credentials cannot be recovered. Nothing is sent to Google that can decrypt them.',
  'vault.setup.confirm': 'Confirm',
  'vault.setup.create': 'Create vault',
  'vault.setup.tooShort': 'Use at least {N} characters.',
  'vault.setup.mismatch': 'Those do not match.',
  'vault.remember': 'Unlock with biometrics on this device',

  'sync.idle': 'Synced {when}',
  'sync.running': 'Syncing…',
  'sync.failed': 'Sync failed: {reason}. Working from this device.',
  'sync.quota': 'Google rate-limited the sync. Retrying shortly.',
  'sync.offline': 'Working on this device only',
  'sync.signIn': 'Sign in to Google to sync',
  'sync.signIn.body':
    'Termif stores encrypted host data in a Google Sheet you own. Google never sees a readable password.',
  'sync.signIn.start': 'Sign in with Google',
  'sync.signIn.code': 'Enter this code: {code}',
  'sync.signIn.open': 'Open Google in your browser',
  'sync.signIn.waiting': 'Waiting for Google…',
  'sync.signIn.denied': 'Google denied access: {reason}',
  'sync.signIn.expired': 'The code expired. Start again.',
  'sync.signIn.cancel': 'Not now',
  'sync.signOut': 'Disconnect Google',

  'session.reconnecting': 'Connection lost. Reconnecting…',
  'session.reconnected':
    'Reconnected. This is a new shell — scrollback is kept, but the previous session ended.',
  'session.closed': 'Session closed: {reason}',

  'transfer.progress': '{done} of {total}',
  'transfer.done': 'Transferred {name}',
  'transfer.failed': 'Transfer failed: {reason}',
  'transfer.cancelled': 'Transfer cancelled',

  'forward.active': 'Forwarding {from} to {to}',
  'forward.iosForegroundOnly':
    'On iOS this forward only runs while Termif is open. iOS does not allow a background app to keep a listening socket.',
  'forward.androidBackground': 'Keeping this forward alive in the background.',
} as const

export type MessageKey = keyof typeof en
