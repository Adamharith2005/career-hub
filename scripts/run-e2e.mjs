// Bundles scripts/e2e.ts (+ test helpers + core) with esbuild, then runs it. Requires `npm run build` first.
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

fs.mkdirSync('test-output', { recursive: true })
await build({ entryPoints: ['scripts/e2e.ts'], outfile: 'test-output/e2e.bundle.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', logLevel: 'error' })
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const r = spawnSync(process.execPath, ['--no-warnings', 'test-output/e2e.bundle.mjs'], { stdio: 'inherit', env })
process.exit(r.status ?? 1)
