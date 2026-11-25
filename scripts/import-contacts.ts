// Integrates the V4 HR contact research into data/catalog.json. Reads the four files straight from a folder (default ~/Downloads).
// Usage: node scripts/run-debug.mjs scripts/import-contacts.ts [folder] [--dry] [--export <dir>]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readCatalog, writeCatalog } from '../core/viewer/catalog.ts'
import { applyContactResearch, contactSummary, missingCsv, missingEmployers, missingFileName, readContactResearch } from '../core/viewer/contacts.ts'
const args = process.argv.slice(2).filter((a) => !a.startsWith('--') && a !== args0())
function args0() { const i = process.argv.indexOf('--export'); return i >= 0 ? process.argv[i + 1] : '' }
const dir = args[0] ?? path.join(os.homedir(), 'Downloads')
const dry = process.argv.includes('--dry')
const exportDir = args0() || path.join(os.homedir(), 'Documents', 'Career Hub', 'exports')
const research = await readContactResearch(dir)
console.log('Files:'); for (const [k, v] of Object.entries(research.files)) console.log(`  ${k}: ${v ?? 'MISSING'}`)
console.log(`Rows: master ${research.master.length}, evidence ${research.evidence.length}, outreach ${research.outreach.length}`)
console.log('Master columns:', research.master[0] ? Object.keys(research.master[0]).length : 0, '| Workbook sheets:', research.sheets.map((s) => `${s.name} (${s.rows})`).join(', '))
const cat = readCatalog('data/catalog.json'); if (!cat) throw new Error('data/catalog.json not found')
const { catalog, report } = applyContactResearch(cat, research)
const again = applyContactResearch(catalog, research)
console.log('Merged duplicates:', report.merged)
console.log('Report:', { ...report, merged: report.merged.length, warnings: report.warnings.length, unmatchedV4: report.unmatchedV4.length }); console.log('Idempotent (second run changes nothing):', again.report.changed === 0)
for (const w of report.warnings.slice(0, 12)) console.log('  warning:', w)
const tally: Record<string, number> = {}, tiers: Record<string, number> = {}, ver: Record<string, number> = {}
for (const c of catalog.companies) { const s = contactSummary(c); tally[s.state] = (tally[s.state] ?? 0) + 1; for (const r of c.contactIntel?.routes ?? []) { tiers[r.tier + ' ' + r.kind] = (tiers[r.tier + ' ' + r.kind] ?? 0) + 1; ver[r.verification] = (ver[r.verification] ?? 0) + 1 } }
console.log('Contact state by company:', tally); console.log('Routes by tier/kind:', tiers); console.log('Routes by verification:', ver)
const missing = missingEmployers(catalog); console.log(`Employers without V4 contact research: ${missing.length}`)
if (!dry) {
  writeCatalog('data/catalog.json', catalog); fs.mkdirSync(exportDir, { recursive: true })
  for (const f of fs.readdirSync(exportDir)) if (/^CAREER_HUB_MISSING_\d+_CONTACT_RESEARCH\.csv$/.test(f)) fs.rmSync(path.join(exportDir, f))
  const out = path.join(exportDir, missingFileName(missing.length)); fs.writeFileSync(out, missingCsv(missing)); console.log('Wrote data/catalog.json and', out)
}
