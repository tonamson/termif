import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { openDatabase } from './db.js'
import { registerHandlers } from './handlers.js'
import { prepareKnownHosts } from './knownHosts.js'
import { initNative } from './native.js'

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Termif',
    // Frameless on both platforms: the renderer draws its own titlebar
    // (src/renderer/views/Titlebar.tsx). The OS bar is a light strip across a
    // dark window otherwise.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: '#12171f',
            symbolColor: '#a7b3c0',
            height: 38,
          },
        }),
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The renderer gets no Node and no direct ipcRenderer: everything goes
      // through the narrow contextBridge surface.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.on('ready-to-show', () => window.show())

  // Never navigate the app window itself; open links in the user's browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL !== undefined) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

void app.whenReady().then(async () => {
  const userData = app.getPath('userData')
  const db = openDatabase(join(userData, 'termif.sqlite'))

  await prepareKnownHosts(db, userData, initNative)
  registerHandlers({ db })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('will-quit', () => db.close())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
