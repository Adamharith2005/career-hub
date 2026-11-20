import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('careerHub', {
  async call(name: string, args?: unknown) {
    const r = await ipcRenderer.invoke('api', name, args)
    if (!r.ok) { const e: any = new Error(r.error.message); e.code = r.error.code; throw e }
    return r.data
  },
  /** Path of a file dropped onto the window (File.path was removed from modern Electron). */
  pathForFile(f: File) { return webUtils.getPathForFile(f) },
})
