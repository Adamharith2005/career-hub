// Launches the built app. ELECTRON_RUN_AS_NODE is cleared because some shells/IDEs set it, which would make Electron behave like plain Node.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const electron = createRequire(import.meta.url)('electron')
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env })
child.on('exit', (c) => process.exit(c ?? 0))
