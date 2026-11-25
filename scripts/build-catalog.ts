// Builds data/catalog.json from a research workbook (old audited workbook or Employer Atlas). Merges into the existing catalogue; never removes organisations. No database.
// Usage: node scripts/run-debug.mjs scripts/build-catalog.ts "/path/to/workbook.xlsx" [--replace]
import { catalogFromWorkbook, mergeCatalog, readCatalog, writeCatalog } from '../core/viewer/catalog.ts'
const file = process.argv[2]
if (!file) { console.error('Pass the .xlsx path as the first argument.'); process.exit(1) }
const { catalog, warnings } = await catalogFromWorkbook(file)
const existing = process.argv.includes('--replace') ? null : readCatalog('data/catalog.json')
const { catalog: out, report } = mergeCatalog(existing, catalog)
writeCatalog('data/catalog.json', out)
const by = (f: (c: any) => string) => out.companies.reduce((m: any, c) => { const k = f(c); m[k] = (m[k] ?? 0) + 1; return m }, {})
console.log(`Wrote data/catalog.json: ${out.companies.length} organisations`, report)
console.log('city', by((c) => c.city ?? 'none'), '\nsector', by((c) => c.sector), '\nevidence', by((c) => c.internship.evidence), '\nallowance', by((c) => c.allowance.status), '\nprior leads', out.companies.filter((c: any) => c.priorLead).length)
for (const w of warnings.slice(0, 10)) console.log(' -', w)
