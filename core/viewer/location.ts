/**
 * Physical location model. Separate from the old `city` claim, which came from earlier Gemini research and is kept only as history.
 * Principles: a verified office needs location-specific, current evidence; a project contract, client site, coverage area or postal
 * address is not an office; unknown is never promoted; the importer never deletes a company and never overrides a user-confirmed correction.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Catalog, CatalogCompany } from './catalog.ts'
import { csvCell, parseCsv } from './contacts.ts'
import { normalizeOrgKey } from '../research-classify.ts'

export const LOCATION_STATUSES = ['VERIFIED_TARGET_OFFICE', 'VERIFIED_NEARBY_OFFICE', 'PROVISIONAL_LOCAL_OFFICE', 'UNVERIFIED_LOCATION', 'OUTSIDE_TARGET_AREA', 'DISPUTED_LOCATION'] as const
export type LocationStatus = (typeof LOCATION_STATUSES)[number]
export const LOCATION_ZONES = ['CYBERJAYA', 'PUTRAJAYA', 'IOI_RESORT_CITY', 'OUTSIDE', 'UNKNOWN'] as const
export type LocationZone = (typeof LOCATION_ZONES)[number]
/** Only these kinds of site count as an office. The rest are recorded so they are never mistaken for one. */
export const OFFICE_TYPES = ['HEADQUARTERS', 'BRANCH_OFFICE', 'OPERATIONAL_SITE', 'CAMPUS', 'DATA_CENTRE', 'REGISTERED_ADDRESS_ONLY', 'PROJECT_SITE_CLAIM', 'CLIENT_SITE', 'SERVICE_COVERAGE', 'HISTORICAL_BRANCH', 'SPECULATIVE', 'UNKNOWN'] as const
export type OfficeType = (typeof OFFICE_TYPES)[number]
const REAL_OFFICE: OfficeType[] = ['HEADQUARTERS', 'BRANCH_OFFICE', 'OPERATIONAL_SITE', 'CAMPUS', 'DATA_CENTRE']
export type PlacementStatus = 'VERIFIED_LOCAL' | 'VERIFIED_ELSEWHERE' | 'EMPLOYER_VERIFIED_PLACEMENT_UNKNOWN' | 'NOT_VERIFIED'
export type LocationOrigin = 'LEGACY_GEMINI' | 'AUDIT_IMPORT' | 'USER_CONFIRMED'

export interface LocationRecord {
  physical_office_status: LocationStatus
  physical_office_address: string | null
  physical_office_zone: LocationZone
  office_type: OfficeType
  office_source_url: string | null
  office_source_date: string | null
  office_last_checked: string | null
  local_workplace_confirmed: boolean | null
  internship_placement_location: string | null
  internship_placement_source_url: string | null
  location_review_notes: string | null
  /** What reading the source page showed. Only SUPPORTED can verify an office. See check-location-sources.ts. */
  office_source_check: SourceCheck | null
  office_source_check_note: string | null
  placement_source_check: SourceCheck | null
  /** Things a person should look at (a possibly old source, evidence that shows the zone but not the building). Never a reason to reject on its own. */
  evidence_flags: string[]
  origin: LocationOrigin
}
export const SOURCE_CHECKS = ['SUPPORTED', 'ZONE_ONLY', 'PARTIAL', 'UNSUPPORTED', 'UNREACHABLE', 'NOT_CHECKED'] as const
export type SourceCheck = (typeof SOURCE_CHECKS)[number]

export const STATUS_LABEL: Record<LocationStatus, string> = {
  VERIFIED_TARGET_OFFICE: 'Verified office', VERIFIED_NEARBY_OFFICE: 'Verified nearby office', PROVISIONAL_LOCAL_OFFICE: 'Provisional, not verified', UNVERIFIED_LOCATION: 'Location not verified',
  OUTSIDE_TARGET_AREA: 'Outside target area', DISPUTED_LOCATION: 'Location disputed',
}
export const ZONE_LABEL: Record<LocationZone, string> = { CYBERJAYA: 'Cyberjaya', PUTRAJAYA: 'Putrajaya', IOI_RESORT_CITY: 'IOI Resort City', OUTSIDE: 'Outside target area', UNKNOWN: 'Unknown' }
export const PLACEMENT_LABEL: Record<PlacementStatus, string> = {
  VERIFIED_LOCAL: 'Verified local placement', VERIFIED_ELSEWHERE: 'Verified placement elsewhere', EMPLOYER_VERIFIED_PLACEMENT_UNKNOWN: 'Employer location verified, placement unknown', NOT_VERIFIED: 'Location not verified',
}

const CITY_ZONE: Record<string, LocationZone> = { Cyberjaya: 'CYBERJAYA', Putrajaya: 'PUTRAJAYA', 'IOI Resort City': 'IOI_RESORT_CITY' }
const isVerified = (s: LocationStatus) => s === 'VERIFIED_TARGET_OFFICE' || s === 'VERIFIED_NEARBY_OFFICE'
export const isVerifiedLocation = isVerified
const PROJECT_RE = /project[- ](delivery |site|office)|delivery (office|unit)|public sector (support|delivery|digital)|support operations|client site|\bcoverage\b/i
const NEGATIVE_RE = /not supported|not corroborated|omits putrajaya|offices outside|lists offices outside|evidence points to/i
const IOI_ADDR_RE = /ioi (city|resort)|lebuh irc/i

/** Everything the earlier research left that questions a location. Exported for the audit, not used to promote anything. */
export function legacyFlags(c: CatalogCompany): string[] {
  const out: string[] = []
  const offices = c.offices ?? []
  if (!offices.length) out.push('NO_OFFICE_ADDRESS')
  if (offices.length && offices.every((o) => o.status === 'UNVERIFIED')) out.push('ALL_OFFICES_UNVERIFIED')
  else if (offices.some((o) => o.status === 'UNVERIFIED')) out.push('SOME_OFFICES_UNVERIFIED')
  if (offices.some((o) => o.status === 'PROBABLE')) out.push('PROBABLE_ONLY_PENDING_SUITE')
  if (offices.some((o) => NEGATIVE_RE.test(`${o.address} ${o.note ?? ''}`))) out.push('RESEARCH_SAYS_NOT_SUPPORTED')
  if (offices.some((o) => PROJECT_RE.test(`${o.address} ${o.note ?? ''}`)) || PROJECT_RE.test(c.name)) out.push('PROJECT_OR_CLIENT_SITE_WORDING')
  if (offices.some((o) => /\(HQ:|primary hq:/i.test(o.address))) out.push('HQ_ELSEWHERE_STATED')
  if (c.city === 'Putrajaya' && offices.some((o) => IOI_ADDR_RE.test(o.address))) out.push('IOI_ADDRESS_UNDER_PUTRAJAYA_CLAIM')
  if (c.city === 'Putrajaya' && offices.some((o) => /\b62\d{3}\b/.test(o.address) && !/presint|precinct|pusat pentadbiran|persiaran perdana|kompleks|wisma|menara|blok|jalan/i.test(o.address))) out.push('PUTRAJAYA_POSTCODE_WITHOUT_PRECINCT')
  if ((c.mergedFrom ?? []).some((m) => m.city && m.city !== c.city)) out.push('MERGED_RECORD_HAD_DIFFERENT_CITY')
  if (c.uncertainties.some((u) => /office|address|location/i.test(u))) out.push('OFFICE_UNCERTAINTY_NOTED')
  if (/office|location|branch|relocat|headquarter/i.test(`${c.notes ?? ''} ${c.nextAction ?? ''}`)) out.push('NOTES_MENTION_LOCATION')
  if (c.priorLead) out.push('EARLIER_LEAD_UNVERIFIED')
  return out
}

/** The location of a company that has not been through the audit. Nothing here is ever verified: the old "V1 Verified" is a claim. */
export function legacyLocation(c: CatalogCompany): LocationRecord {
  const flags = legacyFlags(c)
  const claimed = c.city ? CITY_ZONE[c.city] ?? 'UNKNOWN' : 'UNKNOWN'
  const offices = c.offices ?? []
  const best = offices.find((o) => o.status === 'VERIFIED') ?? offices.find((o) => o.status === 'PROBABLE') ?? offices[0] ?? null
  const contradiction = flags.includes('RESEARCH_SAYS_NOT_SUPPORTED') || flags.includes('MERGED_RECORD_HAD_DIFFERENT_CITY') || flags.includes('IOI_ADDRESS_UNDER_PUTRAJAYA_CLAIM')
  let status: LocationStatus = claimed === 'UNKNOWN' || !offices.length ? 'UNVERIFIED_LOCATION' : 'PROVISIONAL_LOCAL_OFFICE'
  if (status === 'PROVISIONAL_LOCAL_OFFICE' && flags.includes('ALL_OFFICES_UNVERIFIED')) status = 'UNVERIFIED_LOCATION'
  if (claimed !== 'UNKNOWN' && contradiction) status = 'DISPUTED_LOCATION'
  const type: OfficeType = flags.includes('PROJECT_OR_CLIENT_SITE_WORDING') ? 'PROJECT_SITE_CLAIM' : 'UNKNOWN'
  const notes = [
    `Earlier research (Gemini) placed this organisation in ${c.city ?? 'an unspecified location'}${best ? ` and rated the office "${best.status.toLowerCase()}"` : ''}. That is a claim, not an audited result.`,
    flags.length ? `Flags: ${flags.join(', ')}.` : null,
    ...(c.mergedFrom ?? []).filter((m) => m.city && m.city !== c.city).map((m) => `Historical record ${m.id} (${m.name}) claimed ${m.city}.`),
  ].filter(Boolean).join(' ')
  return {
    physical_office_status: status, physical_office_address: best?.address ?? null, physical_office_zone: claimed, office_type: type, office_source_url: null, office_source_date: null, office_last_checked: null,
    local_workplace_confirmed: null, internship_placement_location: null, internship_placement_source_url: null, location_review_notes: notes, office_source_check: null, office_source_check_note: null, placement_source_check: null, evidence_flags: [], origin: 'LEGACY_GEMINI',
  }
}

/** The location the app uses: an audited record where there is one, otherwise the provisional reading of the old claim. */
/** Records stored by an earlier version lack the source-check fields; they read as unchecked. */
export const locationOf = (c: CatalogCompany): LocationRecord => (c.location ? { ...c.location, office_source_check: c.location.office_source_check ?? null, office_source_check_note: c.location.office_source_check_note ?? null, placement_source_check: c.location.placement_source_check ?? null, evidence_flags: c.location.evidence_flags ?? [] } : legacyLocation(c))

const LOCAL_RE = /cyberjaya|putrajaya|presint|ioi resort|ioi city|puchong ioi|sepang/i
/** Placement is judged on its own source, never inferred from the employer's office. */
export function placementStatus(l: LocationRecord): PlacementStatus {
  const text = l.internship_placement_location?.trim()
  if (text && l.internship_placement_source_url && (l.placement_source_check === 'SUPPORTED' || l.placement_source_check === 'ZONE_ONLY')) return LOCAL_RE.test(text) ? 'VERIFIED_LOCAL' : 'VERIFIED_ELSEWHERE'
  return isVerified(l.physical_office_status) ? 'EMPLOYER_VERIFIED_PLACEMENT_UNKNOWN' : 'NOT_VERIFIED'
}
/** What may be said to a student about where the placement is. Never "based in Cyberjaya" without a placement source. */
export function placementLine(l: LocationRecord): string {
  const p = placementStatus(l)
  if (p === 'VERIFIED_LOCAL') return `Placement verified: ${l.internship_placement_location}`
  if (p === 'VERIFIED_ELSEWHERE') return `Placement is elsewhere: ${l.internship_placement_location}`
  if (p === 'EMPLOYER_VERIFIED_PLACEMENT_UNKNOWN') return 'The employer has a verified local office, but where interns sit is not confirmed. Ask before assuming.'
  return l.internship_placement_location ? `Neither the office nor the placement is verified. The research claims a placement at ${l.internship_placement_location}, but its source was not confirmed (${(l.placement_source_check ?? 'not checked').toLowerCase().replace(/_/g, ' ')}).` : 'Neither the office nor the placement location is verified.'
}

// ---------------------------------------------------------------- filtering
export type LocationView = 'Cyberjaya' | 'Putrajaya' | 'IOI Resort City' | 'Needs verification' | 'Outside target area' | 'All'
export const LOCATION_VIEWS: LocationView[] = ['Cyberjaya', 'Putrajaya', 'IOI Resort City', 'Needs verification', 'Outside target area', 'All']
export function inLocationView(c: CatalogCompany, view: string | undefined | null): boolean {
  if (!view || view === 'All') return true
  const l = locationOf(c), s = l.physical_office_status
  switch (view) {
    case 'Cyberjaya': return s === 'VERIFIED_TARGET_OFFICE' && l.physical_office_zone === 'CYBERJAYA'
    case 'Putrajaya': return s === 'VERIFIED_TARGET_OFFICE' && l.physical_office_zone === 'PUTRAJAYA'
    case 'IOI Resort City': return s === 'VERIFIED_NEARBY_OFFICE' && l.physical_office_zone === 'IOI_RESORT_CITY'
    case 'Needs verification': return s === 'PROVISIONAL_LOCAL_OFFICE' || s === 'UNVERIFIED_LOCATION' || s === 'DISPUTED_LOCATION'
    case 'Outside target area': return s === 'OUTSIDE_TARGET_AREA'
    default: return false
  }
}
export function locationCounts(cs: CatalogCompany[]): Record<LocationView, number> {
  return Object.fromEntries(LOCATION_VIEWS.map((v) => [v, cs.filter((c) => inLocationView(c, v)).length])) as Record<LocationView, number>
}

// ---------------------------------------------------------------- audit file (schema, validation, merge)
export const AUDIT_FILE = 'CAREER_HUB_LOCATION_AUDIT_VERIFIED.csv'
export const AUDIT_COLUMNS = ['company_id', 'atlas_id', 'company_name', 'physical_office_status', 'physical_office_address', 'physical_office_zone', 'office_type', 'office_source_url', 'office_source_date', 'office_last_checked', 'local_workplace_confirmed', 'internship_placement_location', 'internship_placement_source_url', 'location_review_notes', 'office_source_check', 'office_source_check_note', 'placement_source_check'] as const
const ISO = /^\d{4}-\d{2}-\d{2}$/
const realDate = (s: string) => ISO.test(s) && !Number.isNaN(Date.parse(s))
const httpUrl = (s: string): string | null => { try { const u = new URL(s.trim()); return /^https?:$/.test(u.protocol) ? u.toString() : null } catch { return null } }
const nz = (s: string | undefined) => { const t = (s ?? '').trim(); return /^(|n\/a|none|unknown|-|—)$/i.test(t) ? null : t }
/** Office-type words used by the Gemini audit, mapped to the model's own kinds. Anything unrecognised is still rejected. */
const OFFICE_TYPE_ALIAS: [RegExp, OfficeType][] = [
  [/^(DISPUTED_)?(UNVERIFIED_)?CLIENT_OR_PROJECT(_SITE|_UNIT)?$|^PROJECT_SITE$/, 'PROJECT_SITE_CLAIM'], [/^UNVERIFIED_(SUITE_OR_CLUSTER|PRIOR_LEAD)$/, 'UNKNOWN'],
  [/DATA_CENT(ER|RE)/, 'DATA_CENTRE'], [/CAMPUS/, 'CAMPUS'], [/(^|_)HQ$|^CORPORATE_HQ$|^HEADQUARTERS$/, 'HEADQUARTERS'],
  [/^(REGIONAL_DELIVERY_CENTER|GLOBAL_IT_HUB|REGIONAL_SHARED_SERVICES_CENTER|MNC_HOTEL_OR_OPERATIONS_OFFICE)$/, 'OPERATIONAL_SITE'], [/OFFICE$/, 'BRANCH_OFFICE'],
  [/CENT(ER|RE)$|FACILITY$|STATION$|^OPERATIONAL_/, 'OPERATIONAL_SITE'],
]
export const normaliseOfficeType = (raw: string): OfficeType | null => { const t = raw.trim().toUpperCase().replace(/[\s-]+/g, '_'); if (!t) return 'UNKNOWN'; if ((OFFICE_TYPES as readonly string[]).includes(t)) return t as OfficeType; return OFFICE_TYPE_ALIAS.find(([re]) => re.test(t))?.[1] ?? null }
const ZONE_ADDRESS: Record<string, RegExp> = { CYBERJAYA: /cyber|63000/i, PUTRAJAYA: /putrajaya|presint|precinct|\b62\d{3}\b|persiaran perdana|pusat pentadbiran/i, IOI_RESORT_CITY: /ioi|sepang|puchong|lebuh irc/i }
const HISTORICAL_RE = /\b(historical|historic|former(ly)?|previous(ly)?|relocated|has moved|old address|obsolete|no longer|legacy)\b/i
const STALE_DAYS = 548
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
/** Reasons the claimed address cannot be in the claimed zone. The source's content is judged separately, by reading the page. */
export function claimProblems(o: { zone: string; address: string | null }): string[] {
  const out: string[] = []
  if (!o.address) return out
  const re = ZONE_ADDRESS[o.zone]
  if (re && !re.test(o.address)) out.push(`address does not mention ${o.zone.toLowerCase().replace(/_/g, ' ')}`)
  if (o.zone === 'PUTRAJAYA' && /ioi (city|resort)|lebuh irc/i.test(o.address)) out.push('IOI Resort City address filed as Putrajaya')
  if (o.zone === 'PUTRAJAYA' && /\b62\d{3}\b/.test(o.address) && !/putrajaya|presint|precinct|persiaran perdana|pusat pentadbiran/i.test(o.address.replace(/\b62\d{3}\b/, ''))) out.push('only a Putrajaya postcode supports the zone')
  return out
}
/** An old source is flagged for review. Legitimate evidence is not rejected for age, and a missing date is never invented. */
export const staleFlag = (sourceDate: string | null, checked: string | null, today: string) => sourceDate && daysBetween(sourceDate, checked ?? today) > STALE_DAYS ? `Source is dated ${sourceDate}, more than 18 months before it was checked. Confirm it is still current.` : null
const upper = (s: string | undefined) => (s ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_')

export interface AuditRow { row: number; company_id: string | null; atlas_id: string | null; company_name: string | null; location: LocationRecord; downgraded: string | null }
export interface AuditParse { rows: AuditRow[]; errors: string[]; warnings: string[] }

/** Validates every row against the schema. A row that claims more than its evidence supports is downgraded, never promoted. A malformed row is rejected and reported. */
export function parseAudit(text: string, today = new Date().toISOString().slice(0, 10)): AuditParse {
  const raw = parseCsv(text.replace(/^﻿/, ''))
  const out: AuditParse = { rows: [], errors: [], warnings: [] }
  if (!raw.length) { out.errors.push('The audit file has no rows.'); return out }
  const have = new Set(Object.keys(raw[0]).map((k) => k.trim().toLowerCase()))
  const missing = ['physical_office_status', 'physical_office_zone'].filter((k) => !have.has(k))
  if (!(have.has('company_id') || have.has('atlas_id') || have.has('company_name'))) missing.push('company_id or atlas_id')
  if (missing.length) { out.errors.push(`Missing required column(s): ${missing.join(', ')}.`); return out }
  raw.forEach((r0, i) => {
    const r: Record<string, string> = Object.fromEntries(Object.entries(r0).map(([k, v]) => [k.trim().toLowerCase(), v]))
    const row = i + 2
    const status = upper(r.physical_office_status) as LocationStatus, zone = upper(r.physical_office_zone) as LocationZone
    if (!LOCATION_STATUSES.includes(status)) { out.errors.push(`Row ${row}: unknown physical_office_status "${r.physical_office_status}".`); return }
    if (!LOCATION_ZONES.includes(zone)) { out.errors.push(`Row ${row}: unknown physical_office_zone "${r.physical_office_zone}".`); return }
    const id = nz(r.company_id), atlas = nz(r.atlas_id), name = nz(r.company_name)
    if (!id && !atlas && !name) { out.errors.push(`Row ${row}: no company_id, atlas_id or company_name.`); return }
    const ot = normaliseOfficeType(r.office_type ?? '')
    if (!ot) { out.errors.push(`Row ${row}: unknown office_type "${r.office_type}".`); return }
    const src = nz(r.office_source_url), srcUrl = src ? httpUrl(src) : null
    if (src && !srcUrl) { out.errors.push(`Row ${row}: office_source_url is not an http(s) link.`); return }
    const pSrc = nz(r.internship_placement_source_url), pUrl = pSrc ? httpUrl(pSrc) : null
    if (pSrc && !pUrl) { out.errors.push(`Row ${row}: internship_placement_source_url is not an http(s) link.`); return }
    const chk = (k: string): SourceCheck | null | undefined => { const v = upper(r[k]); return !v ? null : (SOURCE_CHECKS as readonly string[]).includes(v) ? (v as SourceCheck) : undefined }
    const oc = chk('office_source_check'), pc = chk('placement_source_check')
    if (oc === undefined || pc === undefined) { out.errors.push(`Row ${row}: source check must be one of ${SOURCE_CHECKS.join(', ')}.`); return }
    const dates: Record<string, string | null> = {}
    for (const k of ['office_source_date', 'office_last_checked']) {
      const v = nz(r[k]); if (v && !realDate(v)) { out.errors.push(`Row ${row}: ${k} "${v}" is not an ISO date (YYYY-MM-DD).`); return }
      if (v && v > today) { out.errors.push(`Row ${row}: ${k} "${v}" is in the future.`); return }
      dates[k] = v
    }
    const lw = nz(r.local_workplace_confirmed); const confirmed = lw == null ? null : /^(true|yes|y|1)$/i.test(lw) ? true : /^(false|no|n|0)$/i.test(lw) ? false : undefined
    if (confirmed === undefined) { out.errors.push(`Row ${row}: local_workplace_confirmed must be true or false.`); return }
    const address = nz(r.physical_office_address)
    // Evidence gates. A verified claim without its proof is kept as a provisional claim, and the reason is recorded.
    let final = status, downgraded: string | null = null, outsideOk = false
    if (isVerified(status)) {
      const zoneOk = status === 'VERIFIED_TARGET_OFFICE' ? zone === 'CYBERJAYA' || zone === 'PUTRAJAYA' : zone === 'IOI_RESORT_CITY'
      const lack = [
        !zoneOk && `zone ${zone} does not fit ${status}`, !address && 'no office address', !srcUrl && 'no office_source_url', !dates.office_last_checked && 'no office_last_checked',
        oc !== 'SUPPORTED' && `the source page was not shown to support this office (${(oc ?? 'not checked').toLowerCase().replace(/_/g, ' ')}${nz(r.office_source_check_note) ? `: ${nz(r.office_source_check_note)}` : ''})`,
        !REAL_OFFICE.includes(ot) && `office_type ${ot} is not a real office`, confirmed !== true && 'local_workplace_confirmed is not true',
        ...claimProblems({ zone, address }),
      ].filter(Boolean) as string[]
      if (lack.length) { final = zone === 'CYBERJAYA' || zone === 'PUTRAJAYA' || zone === 'IOI_RESORT_CITY' ? 'PROVISIONAL_LOCAL_OFFICE' : 'UNVERIFIED_LOCATION'; downgraded = `Not verified: ${lack.join('; ')}.` }
    } else if (status === 'OUTSIDE_TARGET_AREA') {
      if (zone !== 'OUTSIDE' && zone !== 'UNKNOWN') { final = 'UNVERIFIED_LOCATION'; downgraded = `Not accepted as outside: zone is ${zone}, not OUTSIDE.` }
      else if (!srcUrl || !address) { final = 'UNVERIFIED_LOCATION'; downgraded = 'Not accepted as outside: it needs the outside address and a source link.' }
      else if (oc !== 'SUPPORTED') { final = 'UNVERIFIED_LOCATION'; downgraded = `Not accepted as outside: the source page was not shown to support the outside address (${(oc ?? 'not checked').toLowerCase().replace(/_/g, ' ')}).` }
      else outsideOk = true
    } else if (status === 'PROVISIONAL_LOCAL_OFFICE' && (zone === 'OUTSIDE' || zone === 'UNKNOWN')) { final = 'UNVERIFIED_LOCATION'; downgraded = 'Provisional needs a target-area zone; recorded as not verified.' }
    const flags = [isVerified(final) ? staleFlag(dates.office_source_date, dates.office_last_checked, today) : null, /PDF document/i.test(r.office_source_check_note ?? '') ? 'The evidence is a PDF document, not a contact page. Confirm the address is still current.' : null, HISTORICAL_RE.test(`${r.location_review_notes ?? ''} ${r.office_source_check_note ?? ''}`) ? 'The research notes mention a former, historical or relocated address. Confirm the office is current.' : null, oc === 'ZONE_ONLY' ? 'Source shows the employer in this zone (for example a job listing) but not the building address.' : null].filter(Boolean) as string[]
    if (downgraded) out.warnings.push(`Row ${row} (${name ?? id ?? atlas}): ${downgraded}`)
    const rawType = (r.office_type ?? '').trim(); const typeNote = rawType && rawType.toUpperCase() !== ot ? `Audit office type: ${rawType}.` : null
    const notes = [nz(r.location_review_notes), typeNote, downgraded].filter(Boolean).join(' ') || null
    out.rows.push({ row, company_id: id, atlas_id: atlas, company_name: name, downgraded, location: {
      physical_office_status: final, physical_office_address: address, physical_office_zone: outsideOk ? 'OUTSIDE' : zone, office_type: ot, office_source_url: srcUrl, office_source_date: dates.office_source_date,
      office_last_checked: dates.office_last_checked, local_workplace_confirmed: confirmed, internship_placement_location: /^unknown\b/i.test((r.internship_placement_location ?? '').trim()) ? null : nz(r.internship_placement_location), internship_placement_source_url: pUrl, location_review_notes: notes, office_source_check: oc, office_source_check_note: nz(r.office_source_check_note), placement_source_check: pc, evidence_flags: flags, origin: 'AUDIT_IMPORT' } })
  })
  return out
}

export interface LocationOverrides { version: 1; confirmed: Record<string, { location: LocationRecord; at: string }> }
export const emptyLocationOverrides = (): LocationOverrides => ({ version: 1, confirmed: {} })
export function readLocationOverrides(file: string): LocationOverrides {
  try { const o = JSON.parse(fs.readFileSync(file, 'utf8')); return o?.version === 1 && o.confirmed && typeof o.confirmed === 'object' ? o : emptyLocationOverrides() } catch { return emptyLocationOverrides() }
}
export function writeLocationOverrides(file: string, o: LocationOverrides) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(o, null, 2)) }
/** The user's own confirmed corrections win over everything, including an import. */
export function withLocationOverrides(cs: CatalogCompany[], o: LocationOverrides): CatalogCompany[] {
  if (!Object.keys(o.confirmed).length) return cs
  return cs.map((c) => (o.confirmed[c.id] ? { ...c, location: { ...o.confirmed[c.id].location, origin: 'USER_CONFIRMED' as const } } : c))
}

/** Conservative resolution of an incoming audit claim against what is already recorded. */
export function resolveLocation(existing: LocationRecord, incoming: LocationRecord): { result: LocationRecord; outcome: 'REPLACED' | 'KEPT' | 'DISPUTED' | 'SAME' } {
  if (existing.origin === 'USER_CONFIRMED') return { result: existing, outcome: 'KEPT' }
  if (existing.origin === 'LEGACY_GEMINI') return { result: incoming, outcome: 'REPLACED' }   // the earlier claim never had audit evidence
  // A verified status recorded before source pages were read has no content evidence behind it; a later, stricter audit supersedes it.
  if (isVerified(existing.physical_office_status) && existing.office_source_check !== 'SUPPORTED') return { result: incoming, outcome: 'REPLACED' }
  const same = (a: LocationRecord, b: LocationRecord) => JSON.stringify(a) === JSON.stringify(b)
  if (same(existing, incoming)) return { result: existing, outcome: 'SAME' }
  const e = existing.physical_office_status, i = incoming.physical_office_status
  const posE = isVerified(e), posI = isVerified(i)
  const newer = (incoming.office_last_checked ?? '') > (existing.office_last_checked ?? '')
  const conflict = (posE && posI && existing.physical_office_zone !== incoming.physical_office_zone) || (posE && i === 'OUTSIDE_TARGET_AREA') || (posI && e === 'OUTSIDE_TARGET_AREA')
  if (conflict) {
    const note = `Conflicting audit evidence: ${e} (${existing.physical_office_zone}, checked ${existing.office_last_checked ?? 'unknown'}) versus ${i} (${incoming.physical_office_zone}, checked ${incoming.office_last_checked ?? 'unknown'}). ${existing.location_review_notes ?? ''}`.trim()
    return { result: { ...existing, physical_office_status: 'DISPUTED_LOCATION', location_review_notes: note }, outcome: 'DISPUTED' }
  }
  if (e === 'DISPUTED_LOCATION') return newer ? { result: incoming, outcome: 'REPLACED' } : { result: existing, outcome: 'KEPT' }
  // A later reading of the same source that no longer supports the office withdraws the verification.
  if (posE && !posI && incoming.office_source_url && incoming.office_source_url === existing.office_source_url && (incoming.office_last_checked ?? '') >= (existing.office_last_checked ?? '') && incoming.office_source_check && incoming.office_source_check !== 'SUPPORTED') return { result: incoming, outcome: 'REPLACED' }
  if (posE && !posI && i !== 'DISPUTED_LOCATION') return { result: existing, outcome: 'KEPT' }   // weaker evidence never erases verified evidence
  if (posE && i === 'DISPUTED_LOCATION') return { result: { ...existing, physical_office_status: 'DISPUTED_LOCATION', location_review_notes: `${incoming.location_review_notes ?? ''} ${existing.location_review_notes ?? ''}`.trim() || null }, outcome: 'DISPUTED' }
  if (posE && posI) return newer ? { result: incoming, outcome: 'REPLACED' } : { result: existing, outcome: 'KEPT' }
  return { result: incoming, outcome: 'REPLACED' }
}

export interface AuditReport { rows: number; matched: number; updated: number; unchanged: number; disputed: number; keptUserConfirmed: number; keptExisting: number; downgraded: number; unmatched: string[]; ambiguous: string[]; errors: string[]; warnings: string[]; verifiedTarget: number; verifiedNearby: number }

function indexOf(cs: CatalogCompany[]) {
  const byId = new Map<string, CatalogCompany[]>(), byName = new Map<string, CatalogCompany[]>()
  const add = (m: Map<string, CatalogCompany[]>, k: string | null | undefined, c: CatalogCompany) => { if (!k) return; const key = k.toLowerCase(); const l = m.get(key) ?? []; if (!l.includes(c)) l.push(c); m.set(key, l) }
  for (const c of cs) { add(byId, c.id, c); add(byId, c.leadId, c); for (const m of c.mergedFrom ?? []) { add(byId, m.id, c); add(byId, m.leadId, c) }; add(byName, normalizeOrgKey(c.name), c); add(byName, normalizeOrgKey(c.legalEntity ?? ''), c) }
  return { byId, byName }
}

/** Applies a validated audit file. Matches by stable id, then Atlas id, then historical id, then exact name. Never adds or removes a company. Idempotent. */
export function applyLocationAudit(cat: Catalog, audit: AuditParse, overrides: LocationOverrides = emptyLocationOverrides()): { catalog: Catalog; report: AuditReport } {
  const report: AuditReport = { rows: audit.rows.length, matched: 0, updated: 0, unchanged: 0, disputed: 0, keptUserConfirmed: 0, keptExisting: 0, downgraded: 0, unmatched: [], ambiguous: [], errors: [...audit.errors], warnings: [...audit.warnings], verifiedTarget: 0, verifiedNearby: 0 }
  const idx = indexOf(cat.companies)
  const next = new Map<string, CatalogCompany>(cat.companies.map((c) => [c.id, c]))
  const touched = new Set<string>(), changed = new Set<string>()
  for (const r of audit.rows) {
    const label = r.company_name ?? r.company_id ?? r.atlas_id ?? `row ${r.row}`
    const hits = new Set<CatalogCompany>()
    for (const k of [r.company_id, r.atlas_id]) if (k) for (const c of idx.byId.get(k.toLowerCase()) ?? []) hits.add(c)
    if (!hits.size && r.company_name) for (const c of idx.byName.get(normalizeOrgKey(r.company_name)) ?? []) hits.add(c)
    if (!hits.size) { report.unmatched.push(`Row ${r.row}: ${label}`); continue }
    const ids = [...hits].map((c) => c.id)
    if (ids.length > 1) { report.ambiguous.push(`Row ${r.row}: ${label} matches ${ids.join(', ')}`); continue }
    const id = ids[0]; const cur = next.get(id)!
    report.matched++; touched.add(id)
    if (r.downgraded) report.downgraded++
    // The audit result is always stored with the company. A user-confirmed correction is applied on read, so it wins now and the audit is still there if the user withdraws it.
    const { result, outcome } = resolveLocation(locationOf(cur), r.location)
    if (overrides.confirmed[id]) report.keptUserConfirmed++
    else if (outcome === 'KEPT') report.keptExisting++
    if (outcome === 'DISPUTED') report.disputed++
    if (JSON.stringify(result) !== JSON.stringify(cur.location)) { next.set(id, { ...cur, location: result }); changed.add(id) }
  }
  report.updated = changed.size; report.unchanged = touched.size - changed.size
  const companies = cat.companies.map((c) => next.get(c.id)!)
  for (const c of companies) { const s = locationOf(c).physical_office_status; if (s === 'VERIFIED_TARGET_OFFICE') report.verifiedTarget++; if (s === 'VERIFIED_NEARBY_OFFICE') report.verifiedNearby++ }
  return { catalog: changed.size ? { ...cat, companies } : cat, report }
}

// ---------------------------------------------------------------- export for the Gemini audit
export const AUDIT_INPUT_FILE = 'CAREER_HUB_ALL_COMPANIES_LOCATION_AUDIT_INPUT.csv'
export const AUDIT_INPUT_HEADER = ['company_id', 'atlas_id', 'historical_ids', 'company_name', 'legal_entity', 'claimed_city', 'reviewed_address', 'all_recorded_addresses', 'headquarters_if_known', 'website', 'employer_category', 'sector', 'internship_evidence', 'internship_source_label', 'application_url', 'contact_evidence', 'source_urls', 'current_location_status', 'current_location_zone', 'current_location_confidence', 'location_audit_flags', 'location_review_notes', 'physical_office_status', 'physical_office_address', 'physical_office_zone', 'office_type', 'office_source_url', 'office_source_date', 'office_last_checked', 'local_workplace_confirmed', 'internship_placement_location', 'internship_placement_source_url']
const hqOf = (c: CatalogCompany) => { const m = c.offices.map((o) => /\((?:primary )?hq:\s*([^)]+)\)/i.exec(o.address)?.[1] ?? /primary hq:\s*([^)]+)/i.exec(o.address)?.[1]).find(Boolean); return m ? m.trim() : '' }
export function auditInputRows(cs: CatalogCompany[]): string[][] {
  return cs.map((c) => {
    const l = locationOf(c)
    const reviewed = c.offices.find((o) => o.status === 'VERIFIED') ?? c.offices.find((o) => o.status === 'PROBABLE') ?? c.offices[0]
    const contactEv = [...(c.contactIntel?.routes ?? []).map((r) => `${r.kind} ${r.value} [${r.tier}, ${r.verification}]`), ...(c.contactIntel ? [] : [c.contacts.hrEmail, c.contacts.generalEmail, c.contacts.phone].filter(Boolean) as string[])]
    const urls = [...new Set([c.website, c.internship.applicationUrl, c.contacts.careersUrl, ...c.sources.map((s) => s.url), ...(c.contactIntel?.routes ?? []).map((r) => r.sourceUrl)].filter(Boolean) as string[])]
    const conf = l.origin === 'LEGACY_GEMINI' ? `LEGACY_UNAUDITED (office rated ${reviewed?.status ?? 'none'}; claimed ${c.verificationLevel})` : l.origin
    return [c.id, c.leadId ?? '', (c.mergedFrom ?? []).map((m) => m.leadId ? `${m.id}/${m.leadId}` : m.id).join('; '), c.name, c.legalEntity ?? '', c.city ?? '', reviewed?.address ?? '',
      c.offices.map((o) => `[${o.status}] ${o.address}${o.note ? ` — ${o.note}` : ''}`).join(' || '), hqOf(c), c.website ?? '', c.categoryLabel ?? '', c.sector, c.internship.evidence, c.internship.sourceLabel ?? '', c.internship.applicationUrl ?? '',
      contactEv.join(' | '), urls.join(' | '), l.physical_office_status, l.physical_office_zone, conf, legacyFlags(c).join('; '), l.location_review_notes ?? '',
      '', '', '', '', '', '', '', '', '', '']
  })
}
export function auditInputCsv(cs: CatalogCompany[]): string {
  return [AUDIT_INPUT_HEADER, ...auditInputRows(cs)].map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
}
