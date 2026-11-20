import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
await build({ entryPoints: [process.argv[2] ?? 'scripts/debug.ts'], outfile: 'test-output/debug.bundle.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'error' })
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
process.exit(spawnSync(process.execPath, ['--no-warnings', 'test-output/debug.bundle.mjs'], { stdio: 'inherit', env }).status ?? 1)
