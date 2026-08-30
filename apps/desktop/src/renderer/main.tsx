import { createRoot } from 'react-dom/client'
import { AppRoot } from './app/AppRoot.js'
import { bootApp } from './state/boot.js'
import { createPlatform } from './platform.js'
import type { TermifApi } from '../shared/ipc.js'

declare global {
  interface Window {
    termif: TermifApi
  }
}

const root = document.getElementById('root')
if (root === null) throw new Error('missing #root')

const api = window.termif
const platform = createPlatform(api)

// The known_hosts file lives beside the database, per device, and is never
// synced (spec §5).
await api.ssh.init('termif_known_hosts')

const app = await bootApp(platform, api)
createRoot(root).render(<AppRoot app={app} />)
