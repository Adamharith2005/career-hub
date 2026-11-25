// Applies a private project inventory to one profile and (optionally) prepares an UNAPPROVED master resume draft. No database, no approval.
// Usage: node scripts/run-debug.mjs scripts/apply-portfolio.ts <profileId> <portfolio.json> <userDataDir> [--draft] [--seed private/profile-seed.json]
import fs from 'node:fs'
import path from 'node:path'
import { createViewerApi } from '../core/viewer/api.ts'
const [id, file, userData, ...rest] = process.argv.slice(2)
if (!id || !file || !userData) { console.error('Usage: apply-portfolio.ts <profileId> <portfolio.json> <userDataDir> [--draft] [--seed <seed.json>]'); process.exit(1) }
const portfolio = JSON.parse(fs.readFileSync(file, 'utf8'))
const profiles = path.join(userData, 'viewer', 'profiles.json')
if (fs.existsSync(profiles)) fs.copyFileSync(profiles, `${profiles}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`)
const api = createViewerApi({ userDataDir: userData, bundledCatalog: 'data/catalog.json', seedPaths: [], ui: { pickFile: async () => null, openPath: async () => '', openExternal() {}, copy() {} } })
api.store.setPortfolio(id, portfolio)
console.log(`Applied ${portfolio.projects.length} projects to ${id}.`)
const seedIdx = rest.indexOf('--seed')
if (seedIdx >= 0) {
  const sf = rest[seedIdx + 1]; const seed = JSON.parse(fs.readFileSync(sf, 'utf8')); fs.copyFileSync(sf, `${sf}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  const p = seed.profiles.find((x: any) => x.id === id); Object.assign(p, { projects: portfolio.projects, awards: portfolio.awards, master: portfolio.master, skills: portfolio.skills })
  fs.writeFileSync(sf, JSON.stringify(seed, null, 1)); console.log('Updated seed', sf)
}
if (rest.includes('--draft')) {
  const v: any = await api.call('v.cv.master.create', { id })
  console.log('Draft', v.version.status, 'version', v.version.n, 'flags', v.flags)
  const bytes: Uint8Array = await api.call('v.cv.preview', { id, recId: v.rec.id, versionId: v.version.id })
  fs.mkdirSync('test-output/real', { recursive: true }); fs.writeFileSync(`test-output/real/${id}-master-draft.pdf`, bytes); console.log('Wrote test-output/real preview PDF')
}
