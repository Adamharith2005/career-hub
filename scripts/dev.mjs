// Dev loop: Vite dev server (HMR) + Electron pointing at it. Main-process changes need a restart.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const electron = require('electron')
await import('./build-main.mjs')
const vite = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))], { stdio: 'inherit' })
const url = 'http://localhost:5173'
for (let i = 0; i < 60; i++) { try { const r = await fetch(url); if (r.ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
const env = { ...process.env, VITE_DEV_SERVER_URL: url }; delete env.ELECTRON_RUN_AS_NODE
const app = spawn(electron, ['.'], { stdio: 'inherit', env })
app.on('exit', () => { vite.kill(); process.exit(0) })
