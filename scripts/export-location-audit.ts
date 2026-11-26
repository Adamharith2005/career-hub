// Exports every employer in data/catalog.json for the Gemini location audit. No student profile data is read.
// Usage: node scripts/run-debug.mjs scripts/export-location-audit.ts [outDir]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readCatalog } from '../core/viewer/catalog.ts'
import { AUDIT_INPUT_FILE, auditInputCsv, locationCounts } from '../core/viewer/location.ts'
import { parseCsv } from '../core/viewer/contacts.ts'
const dir = process.argv[2] ?? path.join(os.homedir(), 'Documents', 'Career Hub', 'exports')
const cat = readCatalog('data/catalog.json'); if (!cat) throw new Error('data/catalog.json not found')
const csv = auditInputCsv(cat.companies)
fs.mkdirSync(dir, { recursive: true }); const out = path.join(dir, AUDIT_INPUT_FILE); fs.writeFileSync(out, csv)
const back = parseCsv(csv); const ids = new Set(back.map((r) => r.company_id))
console.log(`Catalogue: ${cat.companies.length} companies | CSV rows: ${back.length} | unique ids: ${ids.size}`)
if (back.length !== cat.companies.length || ids.size !== cat.companies.length) throw new Error('Row count does not match the catalogue')
console.log('Views (all provisional until audited):', locationCounts(cat.companies)); console.log('Wrote', out)
