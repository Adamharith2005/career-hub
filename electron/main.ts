import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, session } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { openDb } from '../core/db.ts'
import { createApi, ApiError } from '../core/api.ts'

// ---- data location (override only for development / automated tests)
const userData = process.env.CAREER_HUB_USER_DATA || path.join(app.getPath('appData'), 'Career Hub')
fs.mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)

const E2E = process.env.CAREER_HUB_E2E === '1'          // test-only: no native dialogs, no launching external apps
const e2eLog = (kind: string, v: string) => { if (E2E && process.env.CAREER_HUB_E2E_LOG) fs.appendFileSync(process.env.CAREER_HUB_E2E_LOG, `${kind}\t${v}\n`) }
const DEV_URL = process.env.VITE_DEV_SERVER_URL

if (!E2E && !app.requestSingleInstanceLock()) app.quit()

// ---- API keys: encrypted with the OS credential store (DPAPI / Keychain / libsecret). Never plaintext.
const secretFile = (pid: string) => path.join(userData, 'secrets', `${pid.replace(/[^\w-]/g, '')}.bin`)
const secrets = {
  available: () => safeStorage.isEncryptionAvailable(),
  get(pid: string) {
    try { const f = secretFile(pid); return fs.existsSync(f) && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(fs.readFileSync(f)) : null } catch { return null }
  },
  set(pid: string, value: string | null) {
    const f = secretFile(pid)
    if (value === null) { fs.rmSync(f, { force: true }); return }
    if (!safeStorage.isEncryptionAvailable()) throw new ApiError('Secure key storage is not available on this computer, so the API key was NOT saved. Use a local model, or enable your OS credential store.', 'NO_SECURE_STORAGE')
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, safeStorage.encryptString(value), { mode: 0o600 })
  },
}

let win: BrowserWindow | null = null

function setup() {
  const seedFile = app.isPackaged ? path.join(process.resourcesPath, 'data', 'cyberjaya-seed.tsv') : path.join(app.getAppPath(), 'data', 'cyberjaya-seed.tsv')
  const db = openDb(path.join(userData, 'careerhub.db'))
  const api = createApi({
    db, userDataDir: userData, seedFile, secrets,
    ui: {
      pickFolder: async () => {
        if (E2E) return process.env.CAREER_HUB_PICK_FOLDER ?? null
        const r = await dialog.showOpenDialog(win!, { title: 'Choose where Career Hub saves your applications', properties: ['openDirectory', 'createDirectory'] })
        return r.canceled ? null : r.filePaths[0]
      },
      pickFile: async (kind) => {
        if (E2E) return (kind === 'cv' ? process.env.CAREER_HUB_PICK_CV : kind === 'evidence' ? process.env.CAREER_HUB_PICK_EVIDENCE : process.env.CAREER_HUB_PICK_COMPANY) ?? null
        const r = await dialog.showOpenDialog(win!, kind === 'cv'
          ? { title: 'Choose your CV or résumé', properties: ['openFile'], filters: [{ name: 'PDF or Word', extensions: ['pdf', 'docx'] }] }
          : kind === 'evidence' ? { title: 'Attach a supporting file (max 10 MB)', properties: ['openFile'], filters: [{ name: 'PDF, image or Word', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'docx'] }] }
          : { title: 'Choose the company spreadsheet', properties: ['openFile'], filters: [{ name: 'Spreadsheet', extensions: ['xlsx', 'tsv', 'csv'] }] })
        return r.canceled ? null : r.filePaths[0]
      },
      openPath: async (p) => { if (E2E) { e2eLog('openPath', p); return '' } return shell.openPath(p) },
      showItem: (p) => { if (E2E) e2eLog('showItem', p); else shell.showItemInFolder(p) },
      openExternal: (u) => { if (!/^https?:\/\//i.test(u)) return; if (E2E) e2eLog('openExternal', u); else void shell.openExternal(u) },
      documentsPath: () => app.getPath('documents'),
    },
  })
  void api.helpers.ensureSeed()

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
    width: 1360, height: 880, minWidth: 380, minHeight: 600, show: false, backgroundColor: '#faf8f4', title: 'Career Hub',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: true },
  })
  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (ev, url) => { if (!(url.startsWith('file://') || (DEV_URL && url.startsWith(DEV_URL)))) ev.preventDefault() })
  if (DEV_URL) void win.loadURL(DEV_URL)
  else void win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
}

app.whenReady().then(() => {
  // Deny every permission request (camera, geolocation, notifications…): the app needs none.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  setup(); createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
