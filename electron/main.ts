import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, session } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createViewerApi } from '../core/viewer/api.ts'

// ---- data location (override only for development / automated tests)
const userData = process.env.CAREER_HUB_USER_DATA || path.join(app.getPath('appData'), 'Career Hub')
fs.mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)

const E2E = process.env.CAREER_HUB_E2E === '1'          // test-only: no native dialogs, no launching external apps
const e2eLog = (kind: string, v: string) => { if (E2E && process.env.CAREER_HUB_E2E_LOG) fs.appendFileSync(process.env.CAREER_HUB_E2E_LOG, `${kind}\t${v}\n`) }
const DEV_URL = process.env.VITE_DEV_SERVER_URL

if (!E2E && !app.requestSingleInstanceLock()) app.quit()

let win: BrowserWindow | null = null

function setup() {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  // The viewer needs no database: companies are JSON, profiles are private JSON under userData.
  const api = createViewerApi({
    userDataDir: userData,
    bundledCatalog: path.join(base, 'data', 'catalog.json'),
    seedPaths: [process.env.CAREER_HUB_SEED ?? '', path.join(userData, 'profile-seed.json'), path.join(base, 'private', 'profile-seed.json')].filter(Boolean),
    ui: {
      pickFile: async (kind) => {
        if (E2E) return (kind === 'doc' ? process.env.CAREER_HUB_PICK_DOC : process.env.CAREER_HUB_PICK_WORKBOOK) ?? null
        const r = await dialog.showOpenDialog(win!, kind === 'doc'
          ? { title: 'Choose a CV or resume (PDF or Word, max 10 MB)', properties: ['openFile'], filters: [{ name: 'PDF or Word', extensions: ['pdf', 'docx'] }] }
          : { title: 'Choose the company research workbook', properties: ['openFile'], filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }] })
        return r.canceled ? null : r.filePaths[0]
      },
      openPath: async (p) => { if (E2E) { e2eLog('openPath', p); return '' } return shell.openPath(p) },
      openExternal: (u) => { if (!/^(https?:\/\/|mailto:)/i.test(u)) return; if (E2E) e2eLog('openExternal', u); else void shell.openExternal(u) },
      copy: (t) => clipboard.writeText(t),
    },
  })

  ipcMain.handle('api', async (e, name: string, args: unknown) => {
    // Only our own window may call the API.
    const url = e.senderFrame?.url ?? ''
    if (!(url.startsWith('file://') || (DEV_URL && url.startsWith(DEV_URL)))) return { ok: false, error: { message: 'Blocked request from an unexpected origin.', code: 'FORBIDDEN' } }
    try { return { ok: true, data: await api.call(name, args) } }
    catch (err: any) { return { ok: false, error: { message: err?.message ?? String(err), code: err?.code ?? 'ERROR' } } }
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 600, show: false, backgroundColor: '#f5f3ee', title: 'Career Hub',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  })
  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (ev, url) => { if (!(url.startsWith('file://') || (DEV_URL && url.startsWith(DEV_URL)))) ev.preventDefault() })
  if (DEV_URL) void win.loadURL(DEV_URL)
  else void win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
}

app.whenReady().then(() => {
  // Deny every permission request (camera, geolocation, notifications…): the app needs none. Copying goes through the main process.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  setup(); createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
