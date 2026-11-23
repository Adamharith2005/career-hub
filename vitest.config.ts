import { defineConfig } from 'vitest/config'
// vmThreads: the default pools fail to register suites in this environment (Vitest 5.1 + Node 24 + node:sqlite).
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 30000, pool: 'vmThreads' } })
