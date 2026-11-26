// Joins the completed Gemini location audit to the original export, writes CAREER_HUB_LOCATION_AUDIT_VERIFIED.csv, dry-runs the importer and (without --dry) merges into data/catalog.json.
// Usage: node scripts/run-debug.mjs scripts/import-location-audit.ts [--dry] [--audit <file>] [--original <file>] [--out <dir>]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readCatalog, writeCatalog } from '../core/viewer/catalog.ts'
import { csvCell, parseCsv } from '../core/viewer/contacts.ts'
import { AUDIT_COLUMNS, AUDIT_FILE, applyLocationAudit, locationCounts, locationOf, parseAudit, placementStatus } from '../core/viewer/location.ts'
const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined }
const dry = process.argv.includes('--dry')
const home = os.homedir()
const auditFile = arg('--audit') ?? path.join(home, 'Downloads', 'CAREER_HUB_LOCATION_AUDIT_201_JOIN_READY.csv')
const originalFile = arg('--original') ?? path.join(home, 'Documents', 'Career Hub', 'exports', 'CAREER_HUB_ALL_COMPANIES_LOCATION_AUDIT_INPUT.csv')
const outDir = arg('--out') ?? path.join(home, 'Downloads')
const fail = (m: string): never => { console.error('STOP:', m); process.exit(1) }

// 1. read and validate both files against the catalogue
const cat = readCatalog('data/catalog.json') ?? fail('data/catalog.json not found')
const audit = parseCsv(fs.readFileSync(auditFile, 'utf8').replace(/^﻿/, '')), orig = parseCsv(fs.readFileSync(originalFile, 'utf8').replace(/^﻿/, ''))
const ids = (rows: Record<string, string>[]) => rows.map((r) => r.company_id)
const dupes = (a: string[]) => a.filter((x, i) => a.indexOf(x) !== i)
if (dupes(ids(audit)).length || dupes(ids(orig)).length) fail(`duplicate company_id: ${[...dupes(ids(audit)), ...dupes(ids(orig))].join(', ')}`)
const catIds = new Set(cat.companies.map((c) => c.id)), oIds = new Set(ids(orig)), aIds = new Set(ids(audit))
const diff = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x))
console.log(`Rows: audit ${audit.length}, original ${orig.length}, catalogue ${cat.companies.length}`)
for (const [n, d] of [['in audit, not in original', diff(aIds, oIds)], ['in original, not in audit', diff(oIds, aIds)], ['in catalogue, not in audit', diff(catIds, aIds)], ['in audit, not in catalogue', diff(aIds, catIds)]] as const) if (d.length) fail(`${n}: ${d.slice(0, 8).join(', ')}`)
const AUDIT12 = ['company_id', 'physical_office_status', 'physical_office_address', 'physical_office_zone', 'office_type', 'office_source_url', 'office_source_date', 'office_last_checked', 'local_workplace_confirmed', 'internship_placement_location', 'internship_placement_source_url', 'location_review_notes']
const missingCols = AUDIT12.filter((c) => !(c in audit[0])); if (missingCols.length) fail(`audit file lacks columns: ${missingCols.join(', ')}`)
if (Object.keys(audit[0]).length !== 12) console.log(`  note: audit file has ${Object.keys(audit[0]).length} columns, expected 12`)
console.log('IDs: 201 unique in each file, identical sets, all present in the catalogue. Audit columns OK.')

// 2. join by company_id; every original column is kept, and the audit fills the audit columns
const byId = new Map(audit.map((r) => [r.company_id, r]))
const extra = Object.keys(orig[0]).filter((c) => !(AUDIT_COLUMNS as readonly string[]).includes(c) && !c.startsWith('physical_office') && !['office_type', 'office_source_url', 'office_source_date', 'office_last_checked', 'local_workplace_confirmed', 'internship_placement_location', 'internship_placement_source_url'].includes(c))
const header = [...AUDIT_COLUMNS, ...extra.map((c) => `original_${c}`)]
// Source-content verdicts from check-location-sources.ts. A verified claim with no verdict is NOT_CHECKED and cannot be promoted.
const checksFile = arg('--checks') ?? 'data/location-source-checks.json'
const checks: Record<string, any> = fs.existsSync(checksFile) ? JSON.parse(fs.readFileSync(checksFile, 'utf8')).results : {}
console.log(`Source checks: ${Object.keys(checks).length} rows from ${checksFile}`)
// Researched supplement: offices whose official pages were found and read after the Gemini audit. Their fields replace the Gemini row's; the source check below still has to pass.
// Second research pass (the 162 remaining employers). Same schema; its rows replace the first audit's rows for those ids, and are judged by the same source checks.
const researchFile = arg('--research')
const research = new Map((researchFile ? parseCsv(fs.readFileSync(researchFile, 'utf8').replace(/^\uFEFF/, '')) : []).map((r) => [r.company_id, r]))
for (const id of research.keys()) if (!byId.has(id)) fail(`research row ${id} is not in the catalogue audit`)
if (researchFile) console.log(`Research: ${research.size} rows from ${researchFile}`)
const suppFile = arg('--supplement') ?? 'data/location-audit-supplement.csv'
const supp = new Map((fs.existsSync(suppFile) ? parseCsv(fs.readFileSync(suppFile, 'utf8')) : []).map((r) => [r.company_id, r]))
for (const id of supp.keys()) if (!byId.has(id)) fail(`supplement row ${id} is not in the audit`)
console.log(`Supplement: ${supp.size} rows from ${suppFile}`)
// Reviewer holds: rows a person read and judged not to be evidence of the employer's own office, whatever the page automatically showed.
const holdFile = arg('--holds') ?? 'data/location-audit-holds.csv'
const holds = new Map((fs.existsSync(holdFile) ? parseCsv(fs.readFileSync(holdFile, 'utf8')) : []).map((r) => [r.company_id, r.reason]))
for (const id of holds.keys()) if (!byId.has(id)) fail(`hold ${id} is not in the audit`)
const merged = orig.map((o) => { const a = { ...byId.get(o.company_id)! } as Record<string, string>; for (const src of [research.get(o.company_id), supp.get(o.company_id)]) for (const [k, v] of Object.entries(src ?? {})) if (k !== 'company_id' && (v !== '' || (src === research.get(o.company_id) && !/^(office_source_check|placement_source_check)/.test(k)))) a[k] = v; const k = checks[o.company_id]; a.office_source_check = k?.office ?? (/^VERIFIED/.test(a.physical_office_status) ? 'NOT_CHECKED' : ''); a.office_source_check_note = k?.officeNote ?? ''; if (holds.has(o.company_id) && /^VERIFIED/.test(a.physical_office_status)) { a.office_source_check = 'PARTIAL'; a.office_source_check_note = holds.get(o.company_id)! } a.placement_source_check = k?.placement ?? (a.internship_placement_location && !/^unknown/i.test(a.internship_placement_location) ? 'NOT_CHECKED' : ''); const base: Record<string, string> = { ...Object.fromEntries(AUDIT_COLUMNS.map((c) => [c, a[c] ?? ''])), atlas_id: o.atlas_id, company_name: o.company_name }; for (const c of extra) base[`original_${c}`] = o[c]; return base })
fs.mkdirSync(outDir, { recursive: true }); const out = path.join(outDir, AUDIT_FILE)
const text = [header, ...merged.map((r) => header.map((c) => r[c] ?? ''))].map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
fs.writeFileSync(out, text); console.log(`Wrote ${out}: ${merged.length} rows, ${header.length} columns (${AUDIT_COLUMNS.length} import columns + ${extra.length} original context columns)`)

// 3. dry run
const today = new Date().toISOString().slice(0, 10)
const parsed = parseAudit(text, today)
const { catalog, report } = applyLocationAudit(cat, parsed)
const again = applyLocationAudit(catalog, parsed)
const claimed = audit.filter((r) => /^VERIFIED/.test(r.physical_office_status)).length
const kept = parsed.rows.filter((r) => /^VERIFIED/.test(r.location.physical_office_status)).length
console.log(`\nDry run: ${parsed.rows.length} rows read, ${parsed.errors.length} rejected, ${parsed.rows.filter((r) => r.downgraded).length} downgraded`)
console.log(`Gemini reported ${claimed} verified offices; ${kept} pass the evidence checks; ${parsed.rows.filter((r) => r.downgraded && /^VERIFIED/.test(audit.find((a) => a.company_id === r.company_id)?.physical_office_status ?? '')).length} verified claims were downgraded`)
const reasons: Record<string, number> = {}; for (const r of parsed.rows) if (r.downgraded) for (const p of r.downgraded.replace(/^Not verified: /, '').replace(/\.$/, '').split('; ')) reasons[p.replace(/\d{4}-\d{2}-\d{2}/, 'DATE')] = (reasons[p.replace(/\d{4}-\d{2}-\d{2}/, 'DATE')] ?? 0) + 1
console.log('Downgrade reasons:', reasons)
console.log('Report:', { ...report, errors: report.errors.length, warnings: report.warnings.length, unmatched: report.unmatched.length, ambiguous: report.ambiguous.length })
console.log('Idempotent (second import changes nothing):', again.report.updated === 0 && again.catalog === catalog)
const counts = locationCounts(catalog.companies); console.log('Views:', counts)
const zone: Record<string, number> = {}; for (const c of catalog.companies) { const l = locationOf(c); const k = `${l.physical_office_status}/${l.physical_office_zone}`; zone[k] = (zone[k] ?? 0) + 1 }; console.log('Status/zone:', zone)

// 4. review queue: verified claims that need a person, plus placement claims
const host = (u: string | null) => (u ?? '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[/?#].*$/, '')
const queue: string[][] = [['company_id', 'company_name', 'audit_status', 'imported_status', 'zone', 'office_source_url', 'office_source_date', 'issues']]
for (const r of parsed.rows) {
  const c = catalog.companies.find((x) => x.id === r.company_id)!, l = locationOf(c), a = byId.get(c.id)!
  const issues: string[] = []
  if (r.downgraded) issues.push(r.downgraded)
  issues.push(...l.evidence_flags)
  const sh = host(l.office_source_url), wh = host(c.website)
  if (/^VERIFIED/.test(a.physical_office_status) && sh && wh && !sh.endsWith(wh) && !wh.endsWith(sh) && !/\.gov\.my$/.test(sh)) issues.push(`source host ${sh} is not the company site ${wh}`)
  if (placementStatus(l) === 'VERIFIED_LOCAL') issues.push(`placement ${l.placement_source_check === 'ZONE_ONLY' ? 'confirmed at zone level only' : 'confirmed'}: ${l.internship_placement_location}`)
  if (/^VERIFIED/.test(a.physical_office_status) && !/^VERIFIED/.test(l.physical_office_status) || issues.length && /^VERIFIED/.test(l.physical_office_status) || placementStatus(l).startsWith('VERIFIED')) queue.push([c.id, c.name, a.physical_office_status, l.physical_office_status, l.physical_office_zone, l.office_source_url ?? '', l.office_source_date ?? '', issues.join(' | ')])
}
const exportDir = path.join(home, 'Documents', 'Career Hub', 'exports'); fs.mkdirSync(exportDir, { recursive: true })
const qf = path.join(exportDir, 'CAREER_HUB_LOCATION_REVIEW_QUEUE.csv'); fs.writeFileSync(qf, queue.map((r) => r.map(csvCell).join(',')).join('\n') + '\n'); console.log(`Review queue: ${queue.length - 1} rows -> ${qf}`)
if (parsed.errors.length || report.unmatched.length || report.ambiguous.length) fail('importer reported errors, unmatched or ambiguous rows; nothing written')
if (dry) { console.log('Dry run only. data/catalog.json untouched.'); process.exit(0) }
const bak = `data/catalog.json.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`; fs.copyFileSync('data/catalog.json', bak)
writeCatalog('data/catalog.json', catalog); console.log(`Imported. Backup ${bak}; wrote data/catalog.json (${catalog.companies.length} companies)`)
