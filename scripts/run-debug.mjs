import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
// Bundles a TypeScript script with esbuild and runs it under plain Node (core uses TS parameter properties, which type-stripping alone cannot run).
const entry = process.argv[2] ?? 'scripts/debug.ts'
const out = `test-output/${path.basename(entry, '.ts')}.bundle.mjs`
await build({ entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'error' })
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
process.exit(spawnSync(process.execPath, ['--no-warnings', out, ...process.argv.slice(3)], { stdio: 'inherit', env }).status ?? 1)
