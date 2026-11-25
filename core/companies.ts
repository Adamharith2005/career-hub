import fs from 'node:fs'
import path from 'node:path'
import { DB, all, get, run, tx, nowIso, id } from './db.ts'
import { classifyRoleFamilies, slugify, safeParse } from './domain.ts'
import { allowanceFor, GRADE_LABEL } from './allowance.ts'

export const STATUS_ENUM: Record<string, string> = {
  A: 'VERIFIED_ACTIVE_VACANCY',
  B: 'DOCUMENTED_PROGRAM_NO_ACTIVE_LISTING',
  C: 'PORTAL_PRESENT_UNCONFIRMED_INTERN_TRACK',
  D: 'UNADVERTISED_SPECULATIVE_TARGET',
}
export const STATUS_EXPLAIN: Record<string, string> = {
  VERIFIED_ACTIVE_VACANCY: 'Seed research (Nov 2026) recorded an advertised listing. Historical: confirm it is still open.',
  DOCUMENTED_PROGRAM_NO_ACTIVE_LISTING: 'An internship programme is documented but no active listing was recorded.',
  PORTAL_PRESENT_UNCONFIRMED_INTERN_TRACK: 'A careers portal exists; an intern track is unconfirmed.',
  UNADVERTISED_SPECULATIVE_TARGET: 'No advertised internship. Only suitable for a clearly-labelled speculative enquiry.',
  NEEDS_VERIFICATION: 'Status not verified.',
}

/** RFC-4180-ish parser, tab or comma separated, quotes only recognised at the start of a field. */
export function parseDelimited(text: string, delim = '\t'): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', inQ = false, i = 0
  const src = text.replace(/^﻿/, '')
  while (i < src.length) {
    const c = src[i]
    if (inQ) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i += 2; continue } inQ = false; i++; continue }
      field += c; i++; continue
    }
    if (c === '"' && field === '') { inQ = true; i++; continue }
    if (c === delim) { row.push(field); field = ''; i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += c; i++
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((x) => x.trim() !== ''))
}

const COLS = [
  'rank', 'name', 'legal', 'ownership', 'size', 'industry', 'relevance', 'roles', 'address', 'office_status',
  'status_code', 'website', 'careers', 'hr_email', 'contact', 'linkedin', 'method', 'suitability', 'contact_score',
  'evidence', 'last_verified', 'notes',
] as const

const unk = (s: string | undefined) => { const t = (s ?? '').trim(); return !t || /^unknown$/i.test(t) ? null : t }
const BUILDING = /(jalan|persiaran|lingkaran|block|blok|level|tower|menara|suite|unit|building|bangunan|wisma|cyber \d|square|galleria|biz avenue|coplace)/i

export type SeedRow = Record<(typeof COLS)[number], string>

export function rowsToSeed(rows: string[][]): SeedRow[] {
  if (rows.length < 2) throw new Error('The file has no data rows.')
  const header = rows[0]
  if (header.length < 20 || !/rank/i.test(header[0]) || !/company/i.test(header[1]))
    throw new Error(`Unexpected header. Expected the 22-column Cyberjaya Companies layout but found ${header.length} columns starting with "${header[0]}".`)
  return rows.slice(1).map((r) => Object.fromEntries(COLS.map((c, i) => [c, (r[i] ?? '').trim()])) as SeedRow)
}

export interface ImportResult { total: number; inserted: number; updated: number; skipped: { row: number; reason: string }[] }

export function importSeedRows(db: DB, seed: SeedRow[]): ImportResult {
  const rankCount = new Map<string, number>()
  for (const s of seed) rankCount.set(s.rank, (rankCount.get(s.rank) ?? 0) + 1)
  const res: ImportResult = { total: 0, inserted: 0, updated: 0, skipped: [] }
  tx(db, () => {
    seed.forEach((s, idx) => {
      if (!s.name) { res.skipped.push({ row: idx + 2, reason: 'Missing company name' }); return }
      const company_id = `cj-${slugify(s.name, 60)}`            // stable; never derived from rank
      const code = (s.status_code || '').toUpperCase()
      const addr = s.address
      const flags: string[] = []
      if (!unk(s.website)) flags.push('MISSING_WEBSITE')
      const addrNoPostcode = addr.replace(/\b\d{5}\b/g, '').replace(/selangor|cyberjaya/gi, '')
      const precision = BUILDING.test(addrNoPostcode) ? (/\b(suite|unit|level|[A-Z]?\d+-\d+|[A-Z]-\d)/i.test(addr) ? 'SUITE_VERIFIED' : 'BUILDING_VERIFIED') : 'CITY_ONLY'
      if (precision === 'CITY_ONLY') flags.push('BROAD_ADDRESS')
      if ((rankCount.get(s.rank) ?? 0) > 1) flags.push('DUPLICATE_SEED_RANK')
      const score = Number(s.suitability) || null
      const tier = score != null && score >= 86 ? 'T1' : score != null && score >= 78 ? 'T2'
        : /core cs|highly/i.test(s.relevance) ? 'T3' : 'T4'
      const fams = classifyRoleFamilies(`${s.roles} ${s.industry}`)
      if (/core cs/i.test(s.relevance) && !fams.includes('swe')) fams.push('swe')
      const exists = get(db, 'SELECT company_id FROM companies WHERE company_id = ?', company_id)
      const vals = [
        Number(s.rank) || null, s.name, unk(s.legal), s.ownership, s.size, s.industry, s.relevance, s.roles,
        JSON.stringify(fams), addr, precision, s.office_status, code || null, STATUS_ENUM[code] ?? 'NEEDS_VERIFICATION', tier,
        unk(s.website), unk(s.careers), unk(s.hr_email), unk(s.contact), unk(s.linkedin), unk(s.method), score,
        Number(s.contact_score) || null, s.evidence, s.last_verified, s.notes, JSON.stringify(flags), JSON.stringify(s),
      ]
      if (exists) {
        run(db, `UPDATE companies SET seed_rank=?, name=?, legal_entity=?, ownership_type=?, company_size=?, industry=?, cs_relevance=?, relevant_roles=?,
          role_families_json=?, address=?, address_precision=?, office_status=?, status_code_raw=?, status_enum=?, priority_tier=?, website=?, careers_page=?,
          hr_email=?, general_contact=?, linkedin=?, recommended_method=?, suitability_score=?, contact_score=?, evidence_sources=?, last_verified=?,
          research_notes=?, flags_json=?, raw_json=?, imported_at=? WHERE company_id=?`, ...vals, nowIso(), company_id)
        res.updated++
      } else {
        run(db, `INSERT INTO companies (seed_rank,name,legal_entity,ownership_type,company_size,industry,cs_relevance,relevant_roles,role_families_json,address,
          address_precision,office_status,status_code_raw,status_enum,priority_tier,website,careers_page,hr_email,general_contact,linkedin,recommended_method,
          suitability_score,contact_score,evidence_sources,last_verified,research_notes,flags_json,raw_json,imported_at,company_id,is_seed)
          VALUES (${vals.map(() => '?').join(',')},?,?,1)`, ...vals, nowIso(), company_id)
        res.inserted++
      }
      res.total++
    })
  })
  return res
}

export async function readCompanyFile(file: string): Promise<SeedRow[]> {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.xlsx') {
    const mod: any = await import('read-excel-file/node')
    let out: any = typeof mod.readSheet === 'function' ? await mod.readSheet(file) : await mod.default(file)
    if (!Array.isArray(out)) throw new Error('Unsupported spreadsheet reader result')
    if (out.length && out[0] && !Array.isArray(out[0]) && 'data' in out[0]) out = out[0].data // multi-sheet shape
    const rows = (out as any[][]).map((r) => r.map((c) => (c == null ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c))))
    return rowsToSeed(rows)
  }
  const text = fs.readFileSync(file, 'utf8')
  return rowsToSeed(parseDelimited(text, ext === '.csv' ? ',' : '\t'))
}

export async function importCompanyFile(db: DB, file: string) { return importSeedRows(db, await readCompanyFile(file)) }

export interface CompanyFilter { city?: 'Cyberjaya' | 'Putrajaya'; sector?: 'GOVERNMENT' | 'NON_GOVERNMENT'; classes?: string[]; internshipEvidence?: string[]; allowanceGrades?: string[]; minAllowance?: number; verifiedOnly?: boolean; q?: string; roleFamily?: string; ownership?: string; status?: string; tier?: string; hasEmail?: boolean; shortlistedOnly?: boolean; includeOutside?: boolean }

export function listCompanies(db: DB, profileId: string, f: CompanyFilter = {}) {
  const rows = all(db, `SELECT * FROM companies WHERE profile_id IS NULL OR profile_id = ? ORDER BY COALESCE(suitability_score,0) DESC, name`, profileId)
  const star = new Set(all<{ company_id: string }>(db, 'SELECT company_id FROM shortlist WHERE profile_id = ?', profileId).map((r) => r.company_id))
  const grades = new Map(all<{ company_id: string; grade: string; mm: number | null }>(db, 'SELECT company_id, MIN(grade) grade, MAX(monthly_min) mm FROM allowance_evidence GROUP BY company_id').map((r) => [r.company_id, r]))
  const offices = new Map<string, string[]>()
  for (const o of all<{ company_id: string; city: string }>(db, 'SELECT company_id, city FROM company_offices')) offices.set(o.company_id, [...(offices.get(o.company_id) ?? []), o.city])
  const q = f.q?.trim().toLowerCase()
  const cityOk = (c: any) => !f.city || c.city === f.city || (offices.get(c.company_id) ?? []).includes(f.city)
  return rows.map((r) => ({ ...hydrateCompany(r), shortlisted: star.has(r.company_id), cities: offices.get(r.company_id) ?? (r.city ? [r.city] : []),
    allowance_grade: grades.get(r.company_id)?.grade ?? 'A5', allowance_grade_label: GRADE_LABEL[grades.get(r.company_id)?.grade ?? 'A5'], allowance_monthly_min: ['A1', 'A2', 'A3', 'A4'].includes(grades.get(r.company_id)?.grade ?? '') ? grades.get(r.company_id)?.mm ?? null : null })).filter((c) =>
    cityOk(c) && (f.includeOutside || f.city || c.location.state !== 'OUTSIDE') && (!f.shortlistedOnly || c.shortlisted) &&
    (!f.sector || c.sector_group === f.sector) &&
    (!f.classes?.length || f.classes.some((k) => c.classes.includes(k))) &&
    (!f.internshipEvidence?.length || f.internshipEvidence.includes(c.internship_evidence)) &&
    (!f.allowanceGrades?.length || f.allowanceGrades.includes(c.allowance_grade)) &&
    (f.minAllowance == null || (c.allowance_monthly_min != null && c.allowance_monthly_min >= f.minAllowance)) &&
    (!f.verifiedOnly || c.verification_level === 'VERIFIED') &&
    (!q || [c.name, c.legal_entity, c.industry, c.relevant_roles, c.address, c.ownership_type, c.tech_departments, c.city].join(' ').toLowerCase().includes(q)) &&
    (!f.roleFamily || c.role_families.includes(f.roleFamily)) &&
    (!f.ownership || (c.ownership_type ?? '').toLowerCase().includes(f.ownership.toLowerCase())) &&
    (!f.status || c.status_enum === f.status) && (!f.tier || c.priority_tier === f.tier) &&
    (!f.hasEmail || !!c.hr_email || /@/.test(c.general_contact ?? '')))
}

export function hydrateCompany(r: any) {
  const lv = r.last_verified as string | null
  const ageDays = lv ? Math.floor((Date.now() - new Date(lv).getTime()) / 86400000) : null
  const flags = safeParse<string[]>(r.flags_json, [])
  return { ...r, cs_relevance: tidySeedText(r.cs_relevance), research_notes: tidySeedText(r.research_notes), role_families: safeParse<string[]>(r.role_families_json, []), classes: safeParse<string[]>(r.classes_json, []), flags,
    age_days: ageDays, stale: ageDays == null || ageDays > 90, location: locationState(r, flags) }
}

/** The directory export lost its en-dashes ("Highly Relevant ? Core CS"). Display-only repair; stored text is untouched. */
export const tidySeedText = (s?: string | null) => (s ? s.replace(/\s\?\s/g, ' – ') : s ?? null)

export type LocationState = 'VERIFIED' | 'CITY_ONLY' | 'UNKNOWN' | 'OUTSIDE'
/** Cyberjaya-only rule. Never upgrades uncertainty into confirmation: a seed row needs a Cyberjaya address, a verified office and a building-level address. */
export function locationState(r: { address?: string | null; office_status?: string | null; is_seed?: number | null; city?: string | null; verification_level?: string | null }, flags: string[] = []): { state: LocationState; note: string } {
  const addr = (r.address ?? '').trim()
  const city = r.city === 'Putrajaya' ? 'Putrajaya' : 'Cyberjaya'
  const inCity = city === 'Putrajaya' ? /putrajaya|\b62\d{3}\b/i : /cyberjaya|\b63\d{3}\b/i
  if (!addr) return { state: 'UNKNOWN', note: `No address on record — confirm the ${city} office before relying on this entry.` }
  if (!inCity.test(addr)) return { state: 'OUTSIDE', note: `The recorded address is not in ${city}.` }
  if (r.is_seed === 0) return { state: 'CITY_ONLY', note: `Added by you — ${city} location not independently verified.` }
  if (r.city && r.verification_level) {                                  // Career Hub 3.0 rows: the audited level decides
    if (r.verification_level === 'VERIFIED') return { state: 'VERIFIED', note: 'Office confirmed by an official source.' }
    return { state: 'CITY_ONLY', note: r.verification_level === 'PROBABLE' ? 'Office supported by a corporate filing — confirm the reporting location.' : `A ${city} office is claimed in research but not independently confirmed — verify before visiting.` }
  }
  if (flags.includes('BROAD_ADDRESS') || !/verified/i.test(r.office_status ?? ''))
    return { state: 'CITY_ONLY', note: 'Cyberjaya is listed, but the exact office is not confirmed — verify before visiting.' }
  return { state: 'VERIFIED', note: 'Office address verified in seed research.' }
}

export function setShortlist(db: DB, profileId: string, companyId: string, on: boolean) {
  if (!get(db, 'SELECT 1 FROM companies WHERE company_id = ? AND (profile_id IS NULL OR profile_id = ?)', companyId, profileId)) throw new Error('Unknown company')
  if (on) run(db, 'INSERT OR IGNORE INTO shortlist (profile_id, company_id, created_at) VALUES (?,?,?)', profileId, companyId, nowIso())
  else run(db, 'DELETE FROM shortlist WHERE profile_id = ? AND company_id = ?', profileId, companyId)
}

export function getCompany(db: DB, profileId: string, companyId: string) {
  const r = get(db, 'SELECT * FROM companies WHERE company_id = ? AND (profile_id IS NULL OR profile_id = ?)', companyId, profileId)
  if (!r) return null
  const note = get<{ note: string }>(db, 'SELECT note FROM company_notes WHERE profile_id = ? AND company_id = ?', profileId, companyId)
  const starred = !!get(db, 'SELECT 1 FROM shortlist WHERE profile_id = ? AND company_id = ?', profileId, companyId)
  const detail = {
    offices: all(db, 'SELECT city, address, verification, verification_note FROM company_offices WHERE company_id = ? ORDER BY city', companyId),
    sources: all(db, 'SELECT url, description, source_date, confidence, supports FROM research_sources WHERE company_id = ? ORDER BY supports, source_date DESC', companyId),
    allowance: allowanceFor(db, companyId),
    offers: all(db, 'SELECT offer_id, amount, unit, conditions, benefits, offered_on, application_id FROM personal_allowance_offers WHERE profile_id = ? AND company_id = ? ORDER BY created_at DESC', profileId, companyId),
  }
  return { ...hydrateCompany(r), user_note: note?.note ?? '', shortlisted: starred, ...detail }
}

export function addUserCompany(db: DB, profileId: string, c: { name: string; website?: string; address?: string; industry?: string; email?: string; notes?: string }) {
  if (!c.name.trim()) throw new Error('Company name is required')
  const company_id = id('co')
  run(db, `INSERT INTO companies (company_id, profile_id, name, industry, address, website, hr_email, research_notes, status_enum, role_families_json, is_seed, imported_at, last_verified)
           VALUES (?,?,?,?,?,?,?,?, 'NEEDS_VERIFICATION', '[]', 0, ?, ?)`, company_id, profileId, c.name.trim(), c.industry ?? null, c.address ?? null,
    c.website ?? null, c.email ?? null, c.notes ?? null, nowIso(), nowIso().slice(0, 10))
  return company_id
}

export function setCompanyNote(db: DB, profileId: string, companyId: string, note: string) {
  run(db, `INSERT INTO company_notes (profile_id, company_id, note, updated_at) VALUES (?,?,?,?)
           ON CONFLICT(profile_id, company_id) DO UPDATE SET note=excluded.note, updated_at=excluded.updated_at`, profileId, companyId, note, nowIso())
}

/** Every known company name (seed + this profile's). Used by the cross-company leak check. */
export function allCompanyNames(db: DB, profileId: string): string[] {
  return all<{ name: string }>(db, 'SELECT name FROM companies WHERE profile_id IS NULL OR profile_id = ?', profileId).map((r) => r.name)
}
