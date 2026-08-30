import { MainLayout } from './MainLayout.js'
import type { App } from '../state/boot.js'

export function AppRoot({ app }: { app: App }) {
  return <MainLayout app={app} />
}
