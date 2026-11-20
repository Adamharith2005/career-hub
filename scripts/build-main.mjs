// Bundles the Electron main + preload (CommonJS). npm packages stay external; node:sqlite is a built-in.
import { build } from 'esbuild'
const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node24', packages: 'external', external: ['electron'], sourcemap: true, logLevel: 'info' }
await build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' })
await build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' })
