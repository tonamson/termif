import { useEffect, useState } from 'react'
import { t } from '@termif/core'
import type { App } from '../state/boot.js'
import { useStore } from '../state/useStore.js'
import { SetupScreen } from '../views/SetupScreen.js'
import { UnlockScreen } from '../views/UnlockScreen.js'
import { MainLayout } from './MainLayout.js'

export function AppRoot({ app }: { app: App }) {
  const vault = useStore(app.vaultStore)
  const [deviceUnlockAvailable, setDeviceUnlockAvailable] = useState(false)

  // Try the remembered key once, before showing the password prompt.
  useEffect(() => {
    if (vault.phase !== 'locked') return
    let cancelled = false

    void app.vaultStore.tryDeviceUnlock().then((unlocked) => {
      if (!cancelled && !unlocked) setDeviceUnlockAvailable(false)
    })

    return () => {
      cancelled = true
    }
  }, [app, vault.phase])

  if (vault.phase === 'loading') return <main>{t('sync.running')}</main>

  if (vault.phase === 'needsSetup') {
    return <SetupScreen onSetup={(pw, remember) => app.vaultStore.setup(pw, remember)} />
  }

  if (vault.phase === 'locked') {
    return (
      <UnlockScreen
        error={vault.error}
        onUnlock={(pw, remember) => app.vaultStore.unlock(pw, remember)}
        onDeviceUnlock={
          deviceUnlockAvailable ? () => app.vaultStore.tryDeviceUnlock() : null
        }
      />
    )
  }

  return <MainLayout app={app} />
}
