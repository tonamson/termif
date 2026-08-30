import './styles/app.css'
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

const app = await bootApp(platform)
createRoot(root).render(<AppRoot app={app} />)
