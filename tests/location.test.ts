import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AUDIT_COLUMNS, AUDIT_FILE, applyLocationAudit, auditInputCsv, emptyLocationOverrides, inLocationView, legacyLocation, locationCounts, locationOf, parseAudit, placementStatus, resolveLocation, withLocationOverrides, type LocationRecord } from '../core/viewer/location.ts'
import { csvCell, parseCsv } from '../core/viewer/contacts.ts'
import { createViewerApi } from '../core/viewer/api.ts'
import { readCatalog, reconcileDuplicates, type Catalog, type CatalogCompany } from '../core/viewer/catalog.ts'

const co = (id: string, leadId: string, name: string, city: CatalogCompany['city'], over: Partial<CatalogCompany> = {}): CatalogCompany => ({
  id, leadId, name, legalEntity: `${name} Sdn Bhd`, city, sector: 'NON_GOVERNMENT', classes: [], categoryLabel: null, industry: null, size: null, website: `https://${id}.example`,
  offices: city ? [{ address: `1 Test Road, ${city}`, status: 'VERIFIED', note: 'V1 — Verified Physical HQ/Campus' }] : [], tech: ['SOFTWARE'], relevance: null, roles: [], techDivision: null,
  internship: { evidence: 'UNKNOWN', sourceLabel: null, auditNote: null, docs: null, deadline: null, deadlineVerified: false, method: null, applicationUrl: null },
  allowance: { grade: 'A5', status: 'UNKNOWN', monthlyMin: null, monthlyMax: null, claimText: null, policyRef: false, conditions: null, benefits: null, sourceUrl: null, sourceDate: null, note: '' },
  contacts: { hrEmail: null, generalEmail: null, phone: null, careersUrl: null, contactForm: null, linkedin: null }, sources: [], lastVerified: null, uncertainties: [], notes: null, nextAction: null, verificationLevel: 'VERIFIED', ...over,
})
const CAT = (): Catalog => ({ version: 1, generatedAt: 't', sourceFile: 'f', sourceSha256: null, companies: [
  co('a', 'A-1', 'Alpha Systems', 'Cyberjaya'), co('b', 'B-1', 'Beta Works', 'Putrajaya'), co('c', 'C-1', 'Gamma Labs', 'IOI Resort City'), co('d', 'D-1', 'Delta Corp', null),
  co('e', 'E-1', 'Mesiniaga Test', 'Putrajaya', { offices: [{ address: 'Putrajaya project-site presence NOT verified; official listed offices: Subang Jaya', status: 'UNVERIFIED', note: 'NOT SUPPORTED — official page lists offices outside Putrajaya' }, { address: 'Presint 2 Support Operations (HQ: Subang Jaya)', status: 'VERIFIED', note: 'V1' }] }),
  co('f', 'F-1', 'Folded Co', 'IOI Resort City', { mergedFrom: [{ id: 'f-old', leadId: 'F-0', city: 'Cyberjaya', name: 'Folded Co', note: 'same' }] }),
] })
const HEAD = AUDIT_COLUMNS.join(',')
const ADDR: Record<string, string> = { CYBERJAYA: 'Block 3, Cyber 4, Cyberjaya', PUTRAJAYA: 'Presint 2, Persiaran Perdana, Putrajaya', IOI_RESORT_CITY: 'IOI City Tower, IOI Resort City', OUTSIDE: 'KL Sentral, Kuala Lumpur', UNKNOWN: '' }
const FULL = (o: Record<string, string>) => { const r: Record<string, string> = { company_id: 'a', atlas_id: '', company_name: '', physical_office_status: 'VERIFIED_TARGET_OFFICE', physical_office_address: ADDR[o.physical_office_zone ?? 'CYBERJAYA'], physical_office_zone: 'CYBERJAYA', office_type: 'BRANCH_OFFICE', office_source_url: 'https://example.com/contact', office_source_date: '2026-10-01', office_last_checked: '2026-11-20', local_workplace_confirmed: 'true', internship_placement_location: '', internship_placement_source_url: '', location_review_notes: 'Seen on the official contact page.', office_source_check: 'SUPPORTED', office_source_check_note: '', placement_source_check: '', ...o }; return AUDIT_COLUMNS.map((c) => csvCell(r[c])).join(',') }
const file = (...rows: string[]) => [HEAD, ...rows].join('\n') + '\n'
const T = '2026-11-26'

describe('legacy locations are provisional', () => {
  it('never reads an earlier "V1 Verified" claim as a verified office', () => {
    for (const c of CAT().companies) expect(['VERIFIED_TARGET_OFFICE', 'VERIFIED_NEARBY_OFFICE']).not.toContain(locationOf(c).physical_office_status)
    expect(locationOf(CAT().companies[0])).toMatchObject({ physical_office_status: 'PROVISIONAL_LOCAL_OFFICE', physical_office_zone: 'CYBERJAYA', origin: 'LEGACY_GEMINI' })
    expect(locationOf(CAT().companies[3]).physical_office_status).toBe('UNVERIFIED_LOCATION')
  })
  it('marks contradicting records as disputed and keeps the project site out of "office"', () => {
    const e = locationOf(CAT().companies[4]); expect(e.physical_office_status).toBe('DISPUTED_LOCATION'); expect(e.office_type).toBe('PROJECT_SITE_CLAIM'); expect(e.location_review_notes).toMatch(/Flags:.*RESEARCH_SAYS_NOT_SUPPORTED/)
    const f = locationOf(CAT().companies[5]); expect(f.physical_office_status).toBe('DISPUTED_LOCATION'); expect(f.location_review_notes).toMatch(/f-old.*Cyberjaya/)
  })
  it('puts every company in exactly one view, and none under Cyberjaya, Putrajaya or Nearby until audited', () => {
    const cs = CAT().companies, n = locationCounts(cs)
    expect([n.Cyberjaya, n.Putrajaya, n['IOI Resort City']]).toEqual([0, 0, 0]); expect(n.All).toBe(cs.length)
    expect(n['Needs verification'] + n['Outside target area']).toBe(cs.length)
  })
})

describe('audit file validation', () => {
  it('accepts a fully evidenced office', () => {
    const p = parseAudit(file(FULL({})), T); expect(p.errors).toEqual([]); expect(p.warnings).toEqual([])
    expect(p.rows[0].location).toMatchObject({ physical_office_status: 'VERIFIED_TARGET_OFFICE', physical_office_zone: 'CYBERJAYA', local_workplace_confirmed: true, origin: 'AUDIT_IMPORT' })
  })
  it.each([
    ['no source link', { office_source_url: '' }, /no office_source_url/],
    ['not checked', { office_last_checked: '' }, /no office_last_checked/],
    ['no address', { physical_office_address: '' }, /no office address/],
    ['workplace not confirmed', { local_workplace_confirmed: 'false' }, /not true/],
    ['project site', { office_type: 'PROJECT_SITE_CLAIM' }, /not a real office/],
    ['client site', { office_type: 'CLIENT_SITE' }, /not a real office/],
    ['coverage area', { office_type: 'SERVICE_COVERAGE' }, /not a real office/],
    ['historical branch', { office_type: 'HISTORICAL_BRANCH' }, /not a real office/],
    ['zone does not fit', { physical_office_zone: 'IOI_RESORT_CITY' }, /does not fit/],
  ])('downgrades a verified claim with %s, never promoting it', (_n, o, re) => {
    const p = parseAudit(file(FULL(o)), T); expect(p.rows[0].location.physical_office_status).toBe('PROVISIONAL_LOCAL_OFFICE'); expect(p.rows[0].downgraded).toMatch(re); expect(p.warnings).toHaveLength(1)
  })
  it('keeps a nearby office separate, and requires the IOI zone', () => {
    expect(parseAudit(file(FULL({ company_id: 'c', physical_office_status: 'VERIFIED_NEARBY_OFFICE', physical_office_zone: 'IOI_RESORT_CITY' })), T).rows[0].location.physical_office_status).toBe('VERIFIED_NEARBY_OFFICE')
    expect(parseAudit(file(FULL({ physical_office_status: 'VERIFIED_NEARBY_OFFICE', physical_office_zone: 'CYBERJAYA' })), T).rows[0].location.physical_office_status).toBe('PROVISIONAL_LOCAL_OFFICE')
  })
  it('accepts "outside" only with a source or address', () => {
    expect(parseAudit(file(FULL({ physical_office_status: 'OUTSIDE_TARGET_AREA', physical_office_zone: 'OUTSIDE', physical_office_address: 'KL Sentral' })), T).rows[0].location.physical_office_status).toBe('OUTSIDE_TARGET_AREA')
    expect(parseAudit(file(FULL({ physical_office_status: 'OUTSIDE_TARGET_AREA', physical_office_zone: 'OUTSIDE', physical_office_address: '', office_source_url: '' })), T).rows[0].location.physical_office_status).toBe('UNVERIFIED_LOCATION')
  })
  it('rejects malformed rows with a reason and still reads the good ones', () => {
    const p = parseAudit(file(FULL({ physical_office_status: 'VERIFIED' }), FULL({ office_source_date: '2026-13-45' }), FULL({ office_last_checked: '2027-01-01' }), FULL({ office_source_url: 'ftp://x' }), FULL({ local_workplace_confirmed: 'maybe' }), FULL({ office_type: 'BANANA' }), FULL({ company_id: '', company_name: '' }), FULL({ company_id: 'b' })), T)
    expect(p.errors).toHaveLength(7); expect(p.rows.map((r) => r.company_id)).toEqual(['b'])
  })
  it('rejects a file without the required columns or rows', () => {
    expect(parseAudit('company_id,note\na,x\n', T).errors[0]).toMatch(/Missing required column/); expect(parseAudit('', T).errors[0]).toMatch(/no rows/)
  })
  it('reads a spreadsheet-style file with a byte-order mark, mixed case headers and quoted commas', () => {
    const text = '﻿' + HEAD.toUpperCase() + '\r\n' + FULL({ physical_office_address: 'Block 3, Lingkaran Cyber Point, Cyberjaya' }).replace(/\n/g, '') + '\r\n'
    expect(parseAudit(text, T).rows[0].location.physical_office_address).toBe('Block 3, Lingkaran Cyber Point, Cyberjaya')
  })
})

describe('audit evidence gates and audit vocabulary', () => {
  const dl = (o: Record<string, string>) => parseAudit(file(FULL({ physical_office_address: 'Block 3, Cyber 4, 63000 Cyberjaya', ...o })), T).rows[0]
  it('maps the audit office types onto real offices and non-offices', () => {
    for (const [t, ok] of [['FEDERAL_MINISTRY_HQ', true], ['FEDERAL_DEPARTMENT_OR_AGENCY_HQ', true], ['MNC_REGIONAL_OR_LOCAL_OFFICE', true], ['DATA_CENTER_FACILITY', true], ['UNIVERSITY_CAMPUS', true], ['GLOBAL_IT_HUB', true], ['DISPUTED_CLIENT_OR_PROJECT_SITE', false], ['UNVERIFIED_SUITE_OR_CLUSTER', false], ['UNVERIFIED_PRIOR_LEAD', false]] as const)
      expect(dl({ office_type: t }).location.physical_office_status === 'VERIFIED_TARGET_OFFICE', t).toBe(ok)
    expect(dl({ office_type: 'FEDERAL_MINISTRY_HQ' }).location.location_review_notes).toMatch(/Audit office type: FEDERAL_MINISTRY_HQ/)
    expect(parseAudit(file(FULL({ office_type: 'BANANA' })), T).errors).toHaveLength(1)
  })
  it.each([
    ['a source page that only shows the zone (a job listing)', { office_source_check: 'ZONE_ONLY' }, /zone only/],
    ['a source page that does not support it', { office_source_check: 'UNSUPPORTED' }, /unsupported/],
    ['a source page that could not be read', { office_source_check: 'UNREACHABLE', office_source_check_note: 'HTTP 403' }, /unreachable: HTTP 403/],
    ['a source page that was never read', { office_source_check: '' }, /not checked/],
    ['an address outside the zone', { physical_office_address: 'Menara 3, KL Sentral, Kuala Lumpur' }, /does not mention cyberjaya/],
  ])('does not verify an office on %s', (_n, o, re) => { const r = dl(o); expect(r.location.physical_office_status).toBe('PROVISIONAL_LOCAL_OFFICE'); expect(r.downgraded).toMatch(re) })
  it('does not accept a Putrajaya postcode or an IOI address as a Putrajaya office', () => {
    const p = (a: string) => dl({ physical_office_zone: 'PUTRAJAYA', physical_office_address: a }).location.physical_office_status
    expect(p('IOI City Tower 1, Lebuh IRC, IOI Resort City, 62502 Putrajaya')).toBe('PROVISIONAL_LOCAL_OFFICE'); expect(p('Level 3, Some Tower, 62502 Sepang')).toBe('PROVISIONAL_LOCAL_OFFICE')
    expect(p('Presint 2, Persiaran Perdana, 62100 Putrajaya')).toBe('VERIFIED_TARGET_OFFICE')
  })
  it('does not reject by URL shape or age: a dateless page, a careers-path page and an old source verify when the page content supports them', () => {
    expect(dl({ office_source_date: '' }).location).toMatchObject({ physical_office_status: 'VERIFIED_TARGET_OFFICE', office_source_date: null })
    expect(dl({ office_source_url: 'https://example.com/careers/cyberjaya' }).location.physical_office_status).toBe('VERIFIED_TARGET_OFFICE')
    const old = dl({ office_source_date: '2024-04-17' }); expect(old.location.physical_office_status).toBe('VERIFIED_TARGET_OFFICE'); expect(old.location.evidence_flags.join(' ')).toMatch(/more than 18 months/)
    expect(dl({ office_source_date: '2026-10-01' }).location.evidence_flags).toEqual([])
  })
  it('records that a zone-only source is not a building address', () => {
    const r = dl({ office_source_check: 'ZONE_ONLY', placement_source_check: 'ZONE_ONLY' }); expect(r.location).toMatchObject({ physical_office_status: 'PROVISIONAL_LOCAL_OFFICE', office_source_check: 'ZONE_ONLY' }); expect(r.location.evidence_flags.join(' ')).toMatch(/not the building/)
  })
  it('rejects an unknown source check value', () => { expect(parseAudit(file(FULL({ office_source_check: 'TRUST_ME' })), T).errors[0]).toMatch(/source check must be one of/) })
  it('reads the plain-English office types of the second research pass', () => {
    for (const [t, ok] of [['Headquarters', true], ['Operational Facility', true], ['Data Centre', true], ['Branch Office', true], ['Regional Office', true], ['Campus', true], ['Delivery Centre', true], ['Global Service Centre', true], ['Shared Services Centre', true], ['Technology Centre', true], ['Ground Station', true], ['Project Site', false], ['Unknown', false]] as const)
      expect(dl({ office_type: t }).location.physical_office_status === 'VERIFIED_TARGET_OFFICE', t).toBe(ok)
  })
  it('accepts an outside-the-area claim only with the outside address and a source page that supports it', () => {
    const out = (o: Record<string, string>) => parseAudit(file(FULL({ physical_office_status: 'OUTSIDE_TARGET_AREA', physical_office_zone: 'UNKNOWN', physical_office_address: 'Bangsar South City, 59200 Kuala Lumpur', ...o })), T).rows[0]
    expect(out({}).location).toMatchObject({ physical_office_status: 'OUTSIDE_TARGET_AREA', physical_office_zone: 'OUTSIDE' })
    expect(out({ office_source_check: 'PARTIAL' }).location.physical_office_status).toBe('UNVERIFIED_LOCATION')
    expect(out({ office_source_check: '' }).location.physical_office_status).toBe('UNVERIFIED_LOCATION')
    expect(out({ physical_office_address: '' }).location.physical_office_status).toBe('UNVERIFIED_LOCATION')
  })
  it('flags a verified office whose notes describe a former or relocated address', () => {
    expect(dl({ location_review_notes: 'Official page lists the Cyberjaya office; the Putrajaya branch was formerly at Presint 2.' }).location.evidence_flags.join(' ')).toMatch(/former, historical or relocated/)
    expect(dl({ location_review_notes: 'Official contact page lists the office.' }).location.evidence_flags).toEqual([])
  })
  it('treats "UNKNOWN" placements as no placement claim', () => {
    expect(dl({ internship_placement_location: 'UNKNOWN (Corporate HQ in Subang Jaya; placement unconfirmed)', internship_placement_source_url: 'UNKNOWN' }).location).toMatchObject({ internship_placement_location: null, internship_placement_source_url: null })
  })
})

describe('applying an audit', () => {
  const run = (cat: Catalog, text: string, ov = emptyLocationOverrides()) => applyLocationAudit(cat, parseAudit(text, T), ov)
  it('promotes only evidenced companies, adds and removes nothing, and is idempotent', () => {
    const cat = CAT(), before = cat.companies.map((c) => c.id)
    const t = file(FULL({}), FULL({ company_id: 'b', physical_office_status: 'PROVISIONAL_LOCAL_OFFICE', office_source_url: '', office_type: 'UNKNOWN', local_workplace_confirmed: '' }))
    const r1 = run(cat, t); expect(r1.catalog.companies.map((c) => c.id)).toEqual(before); expect(r1.report).toMatchObject({ rows: 2, matched: 2, updated: 2, verifiedTarget: 1 })
    expect(locationOf(r1.catalog.companies[0]).physical_office_status).toBe('VERIFIED_TARGET_OFFICE'); expect(locationOf(r1.catalog.companies[1]).physical_office_status).toBe('PROVISIONAL_LOCAL_OFFICE'); expect(r1.catalog.companies[2].location).toBeUndefined()
    const r2 = run(r1.catalog, t); expect(r2.report).toMatchObject({ updated: 0, unchanged: 2 }); expect(JSON.stringify(r2.catalog)).toBe(JSON.stringify(r1.catalog)); expect(r2.catalog).toBe(r1.catalog)
    expect(JSON.stringify(cat)).toBe(JSON.stringify(CAT()))   // the input is never mutated
  })
  it('matches by stable id, Atlas id, historical id and exact name, and never creates a row', () => {
    const r = run(CAT(), file(FULL({ company_id: 'a' }), FULL({ company_id: '', atlas_id: 'B-1', physical_office_zone: 'PUTRAJAYA' }), FULL({ company_id: 'f-old', physical_office_zone: 'CYBERJAYA' }), FULL({ company_id: '', company_name: 'Delta Corp' }), FULL({ company_id: 'nope' }), FULL({ company_id: '', company_name: 'Not A Company' })))
    expect(r.report.matched).toBe(4); expect(r.report.unmatched).toHaveLength(2); expect(r.catalog.companies).toHaveLength(6)
    expect(locationOf(r.catalog.companies[5]).physical_office_status).toBe('VERIFIED_TARGET_OFFICE')   // reached through its historical id
  })
  it('does not guess when an identifier matches two companies', () => {
    const cat = CAT(); cat.companies[1] = { ...cat.companies[1], mergedFrom: [{ id: 'a', leadId: null, city: null, name: 'x', note: '' }] }
    const r = run(cat, file(FULL({ company_id: 'a' }))); expect(r.report.ambiguous).toHaveLength(1); expect(r.report.matched).toBe(0)
  })
  it('lets a user-confirmed correction win over an import, and keeps it on later imports', () => {
    const mine: LocationRecord = { ...legacyLocation(CAT().companies[0]), physical_office_status: 'OUTSIDE_TARGET_AREA', physical_office_zone: 'OUTSIDE', location_review_notes: 'I phoned them.', origin: 'USER_CONFIRMED' }
    const ov = { version: 1 as const, confirmed: { a: { location: mine, at: 'x' } } }
    const r = run(CAT(), file(FULL({})), ov); expect(r.report.keptUserConfirmed).toBe(1)
    const shown = withLocationOverrides(r.catalog.companies, ov)[0]; expect(locationOf(shown)).toMatchObject({ physical_office_status: 'OUTSIDE_TARGET_AREA', origin: 'USER_CONFIRMED' })
  })
  it('resolves conflicting audits conservatively', () => {
    const base = parseAudit(file(FULL({})), T).rows[0].location
    const other = (o: Record<string, string>) => parseAudit(file(FULL(o)), T).rows[0].location
    expect(resolveLocation(base, other({ physical_office_zone: 'PUTRAJAYA' })).outcome).toBe('DISPUTED')
    expect(resolveLocation(base, other({ physical_office_status: 'OUTSIDE_TARGET_AREA', physical_office_zone: 'OUTSIDE' })).result.physical_office_status).toBe('DISPUTED_LOCATION')
    expect(resolveLocation(base, other({ physical_office_status: 'UNVERIFIED_LOCATION', physical_office_zone: 'UNKNOWN', office_source_url: '' })).result).toBe(base)   // blank never erases verified evidence
    const prov = other({ office_source_url: '' }); expect(resolveLocation(prov, base).result).toBe(base)   // evidence upgrades a provisional claim
    const disputed = resolveLocation(base, other({ physical_office_zone: 'PUTRAJAYA' })).result
    expect(resolveLocation(disputed, other({ physical_office_zone: 'PUTRAJAYA', office_last_checked: '2026-11-25' })).result.physical_office_status).toBe('VERIFIED_TARGET_OFFICE')
    expect(resolveLocation(disputed, other({ office_last_checked: '2026-01-01' })).result).toBe(disputed)
  })
  it('withdraws a verification when a later reading of the same source no longer supports it, but keeps it against a different, weaker claim', () => {
    const v = parseAudit(file(FULL({})), T).rows[0].location
    const recheck = (o: Record<string, string>) => parseAudit(file(FULL({ office_last_checked: '2026-11-26', ...o })), T).rows[0].location
    expect(resolveLocation(v, recheck({ office_source_check: 'PARTIAL' })).result.physical_office_status).toBe('PROVISIONAL_LOCAL_OFFICE')
    expect(resolveLocation(v, recheck({ office_source_check: 'UNREACHABLE' })).result.physical_office_status).toBe('PROVISIONAL_LOCAL_OFFICE')
    expect(resolveLocation(v, recheck({ office_source_check: 'PARTIAL', office_source_url: 'https://other.example/' })).result).toBe(v)
  })
  it('disputes a company whose two audit rows disagree about the zone', () => {
    const r = run(CAT(), file(FULL({}), FULL({ physical_office_zone: 'PUTRAJAYA', office_last_checked: '2026-11-21' })))
    expect(locationOf(r.catalog.companies[0]).physical_office_status).toBe('DISPUTED_LOCATION'); expect(r.report.disputed).toBe(1); expect(inLocationView(r.catalog.companies[0], 'Cyberjaya')).toBe(false); expect(inLocationView(r.catalog.companies[0], 'Needs verification')).toBe(true)
  })
})

describe('views and placement', () => {
  it('Cyberjaya and Putrajaya show only verified offices in their own zone; nothing is hidden from All', () => {
    const cat = run2(file(FULL({}), FULL({ company_id: 'b', physical_office_zone: 'PUTRAJAYA' }), FULL({ company_id: 'c', physical_office_status: 'VERIFIED_NEARBY_OFFICE', physical_office_zone: 'IOI_RESORT_CITY' }), FULL({ company_id: 'd', physical_office_status: 'OUTSIDE_TARGET_AREA', physical_office_zone: 'OUTSIDE' })))
    const ids = (v: string) => cat.companies.filter((c) => inLocationView(c, v)).map((c) => c.id)
    expect(ids('Cyberjaya')).toEqual(['a']); expect(ids('Putrajaya')).toEqual(['b']); expect(ids('IOI Resort City')).toEqual(['c']); expect(ids('Outside target area')).toEqual(['d']); expect(ids('Needs verification')).toEqual(['e', 'f']); expect(ids('All')).toHaveLength(6)
  })
  it('keeps placement separate from the employer office, and judges it on its own source', () => {
    const l = (o: Record<string, string>) => parseAudit(file(FULL(o)), T).rows[0].location
    const P = { internship_placement_location: 'Cyberjaya', internship_placement_source_url: 'https://example.com/p', placement_source_check: 'ZONE_ONLY' }
    expect(placementStatus(l({}))).toBe('EMPLOYER_VERIFIED_PLACEMENT_UNKNOWN')
    expect(placementStatus(l(P))).toBe('VERIFIED_LOCAL')
    expect(placementStatus(l({ ...P, internship_placement_location: 'Penang' }))).toBe('VERIFIED_ELSEWHERE')
    expect(placementStatus(l({ ...P, placement_source_check: '' }))).toBe('EMPLOYER_VERIFIED_PLACEMENT_UNKNOWN')   // an unread source proves nothing
    expect(placementStatus(l({ ...P, placement_source_check: 'UNREACHABLE' }))).toBe('EMPLOYER_VERIFIED_PLACEMENT_UNKNOWN')
    expect(placementStatus(l({ office_source_check: 'ZONE_ONLY' }))).toBe('NOT_VERIFIED')
    expect(placementStatus(l({ office_source_check: 'ZONE_ONLY', ...P }))).toBe('VERIFIED_LOCAL')   // a job listing can prove the placement while the building is unproven
    expect(placementStatus(l({ office_source_check: 'ZONE_ONLY', ...P, placement_source_check: '' }))).toBe('NOT_VERIFIED')
  })
})
const run2 = (text: string) => applyLocationAudit(CAT(), parseAudit(text, T)).catalog

describe('export for the Gemini audit', () => {
  it('has one row per company with stable ids, historical ids and flags, and no student data', () => {
    const cat = CAT(), rows = parseCsv(auditInputCsv(cat.companies))
    expect(rows).toHaveLength(cat.companies.length); expect(new Set(rows.map((r) => r.company_id)).size).toBe(cat.companies.length)
    expect(rows.find((r) => r.company_id === 'f')).toMatchObject({ historical_ids: 'f-old/F-0', atlas_id: 'F-1', current_location_status: 'DISPUTED_LOCATION' })
    expect(rows.find((r) => r.company_id === 'e')!.location_audit_flags).toMatch(/RESEARCH_SAYS_NOT_SUPPORTED/)
    expect(Object.keys(rows[0]).join(' ')).not.toMatch(/akif|adam|resume|profile|student/i)
    for (const c of AUDIT_COLUMNS.filter((x) => !['company_id', 'atlas_id', 'company_name', 'office_source_check', 'office_source_check_note', 'placement_source_check'].includes(x))) expect(Object.keys(rows[0])).toContain(c)   // the file Gemini fills is the file we import
  })
  it('the real catalogue exports completely, and every verified office carries its evidence', () => {
    const cat = readCatalog(path.join(process.cwd(), 'data', 'catalog.json'))!; const rows = parseCsv(auditInputCsv(cat.companies))
    expect(rows).toHaveLength(cat.companies.length); expect(new Set(rows.map((r) => r.company_id)).size).toBe(cat.companies.length)
    for (const c of cat.companies) { const l = locationOf(c); if (/^VERIFIED/.test(l.physical_office_status)) expect(l, c.id).toMatchObject({ origin: 'AUDIT_IMPORT', local_workplace_confirmed: true, office_source_check: 'SUPPORTED', office_source_url: expect.stringMatching(/^https?:/), physical_office_address: expect.any(String) }) }
    expect(cat.companies.every((c) => c.location)).toBe(true)
    expect(locationCounts(cat.companies).All).toBe(cat.companies.length)
    const byId = new Map(cat.companies.map((c) => [c.id, locationOf(c).physical_office_status]))
    for (const id of ['pj-016', 'pj-007', 'cj-009']) expect(byId.get(id)).toBe('DISPUTED_LOCATION')
    expect(byId.get('new-05')).toBe('PROVISIONAL_LOCAL_OFFICE'); expect(byId.get('new-15')).toBe('VERIFIED_NEARBY_OFFICE')   // IOI City Mall's own contact page gives its address
    for (const id of ['pj-039', 'pj-007', 'pj-016', 'cj-009']) expect(byId.get(id), id).toBe('DISPUTED_LOCATION')   // headquarters elsewhere, or conflicting records
    expect(cat.companies.find((c) => c.id === 'cj-009')!.mergedFrom!.map((m) => m.id)).toContain('cy-009')
    const st = (id: string) => locationOf(cat.companies.find((c) => c.id === id)!)
    // offices whose official pages were read and show the address beside the employer
    for (const id of ['cy-002', 'cy-005', 'cy-022', 'cy-023', 'cy-001', 'cy-003', 'cy-020']) expect(st(id), id).toMatchObject({ physical_office_status: 'VERIFIED_TARGET_OFFICE', physical_office_zone: 'CYBERJAYA', office_source_check: 'SUPPORTED' })
    for (const id of ['new-11', 'prior-kometsoft', 'prior-exis-group']) expect(st(id), id).toMatchObject({ physical_office_status: 'VERIFIED_NEARBY_OFFICE', physical_office_zone: 'IOI_RESORT_CITY', office_source_check: 'SUPPORTED' })
    // address labelled for another organisation, third-party-only, mailing-only, blocked and conflicting records stay out of the verified views
    for (const id of ['pj-014', 'cy-038', 'cy-004', 'new-10', 'pj-008', 'pj-022', 'pj-017', 'pj-065', 'pj-070']) expect(st(id).physical_office_status, id).not.toMatch(/^VERIFIED/)
    expect(st('cj-009').physical_office_status).toBe('DISPUTED_LOCATION')
    // second research pass: reviewer holds, third-party and unreadable sources, and unsupported "outside" claims never promote
    for (const id of ['pj-025', 'cy-071', 'cy-026', 'cy-043', 'cy-066']) expect(st(id).physical_office_status, id).not.toMatch(/^VERIFIED/)
    expect(st('pj-025').office_source_check_note).toMatch(/Reviewer hold/); expect(st('cy-026').office_source_check).toBe('PARTIAL')
    for (const id of ['new-03', 'new-17', 'prior-century-software']) expect(st(id).physical_office_status, id).not.toBe('OUTSIDE_TARGET_AREA')   // no source page showed the outside address
    // the first 39 verified offices survive, and records the research reclassified land in the zone the page shows
    for (const id of ['pj-001', 'pj-006', 'pj-020', 'cy-001', 'cy-003', 'cy-020', 'new-11', 'prior-kometsoft', 'pj-027']) expect(st(id).physical_office_status, id).toMatch(/^VERIFIED/)
    expect(st('cy-012')).toMatchObject({ physical_office_status: 'VERIFIED_NEARBY_OFFICE', physical_office_zone: 'IOI_RESORT_CITY' })
    expect(st('pj-082')).toMatchObject({ physical_office_status: 'VERIFIED_TARGET_OFFICE', physical_office_zone: 'CYBERJAYA' })
    expect(st('pj-082').evidence_flags.join(' ')).toMatch(/PDF/)
    // a job listing can place a role in Cyberjaya without proving the building, and office and placement are judged apart
    expect(st('cy-001')).toMatchObject({ placement_source_check: 'ZONE_ONLY' }); expect(placementStatus(st('cy-001'))).toBe('VERIFIED_LOCAL'); expect(placementStatus(st('cy-023'))).toBe('EMPLOYER_VERIFIED_PLACEMENT_UNKNOWN')
    expect(cat.companies.length).toBe(201)
  })
})

describe('API', () => {
  const setup = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loc-')), dl = path.join(dir, 'dl'), ex = path.join(dir, 'ex'); fs.mkdirSync(dl)
    fs.writeFileSync(path.join(dir, 'cat.json'), JSON.stringify(CAT())); fs.writeFileSync(path.join(dir, 'seed.json'), JSON.stringify({ version: 1, profiles: [] }))
    const mk = () => createViewerApi({ userDataDir: path.join(dir, 'ud'), bundledCatalog: path.join(dir, 'cat.json'), seedPaths: [path.join(dir, 'seed.json')], researchDir: dl, exportsDir: ex, ui: { pickFile: async () => null, openPath: async () => '', openExternal: () => {}, copy: () => {} } })
    return { dir, dl, ex, mk }
  }
  it('lists by location view, shows placement honestly, imports an audit, survives a restart and keeps a user correction', async () => {
    const { dl, ex, mk } = setup(); let api = mk()
    const list = async (f: any = {}) => (await api.call('v.companies.list', f)) as any[]
    expect(await list({ city: 'Cyberjaya' })).toHaveLength(0); expect(await list({ city: 'All' })).toHaveLength(6); expect(await list({ city: 'Needs verification' })).toHaveLength(6)
    expect((await api.call('v.catalog.meta') as any).facets.cities).toMatchObject({ Cyberjaya: 0, 'Needs verification': 6, All: 6 })
    const one = (await list({ city: 'All' })).find((x) => x.id === 'a'); expect(one.location).toMatchObject({ verified: false, placement: 'NOT_VERIFIED' })
    await expect(api.call('v.location.import')).rejects.toThrow(/was not found/)
    fs.writeFileSync(path.join(dl, AUDIT_FILE), file(FULL({}), FULL({ company_id: 'ghost' })))
    const rep = await api.call('v.location.import'); expect(rep).toMatchObject({ matched: 1, updated: 1, verifiedTarget: 1 }); expect(rep.unmatched).toHaveLength(1)
    expect((await list({ city: 'Cyberjaya' })).map((x) => x.id)).toEqual(['a']); expect((await list({ city: 'Cyberjaya' }))[0].location.placement).toBe('EMPLOYER_VERIFIED_PLACEMENT_UNKNOWN')
    api = mk(); expect((await list({ city: 'Cyberjaya' })).map((x) => x.id)).toEqual(['a'])   // restart
    await expect(api.call('v.location.confirm', { companyId: 'b', status: 'VERIFIED_TARGET_OFFICE', zone: 'PUTRAJAYA' })).rejects.toThrow(/needs an address/)
    const mine = await api.call('v.location.confirm', { companyId: 'b', status: 'VERIFIED_TARGET_OFFICE', zone: 'PUTRAJAYA', address: 'Presint 3', sourceUrl: 'https://example.com/b', sourceDate: '2026-11-01', officeType: 'BRANCH_OFFICE' })
    expect(mine).toMatchObject({ verified: true, origin: 'USER_CONFIRMED', placement: 'EMPLOYER_VERIFIED_PLACEMENT_UNKNOWN' }); expect((await list({ city: 'Putrajaya' })).map((x) => x.id)).toEqual(['b'])
    fs.writeFileSync(path.join(dl, AUDIT_FILE), file(FULL({}), FULL({ company_id: 'b', physical_office_status: 'OUTSIDE_TARGET_AREA', physical_office_zone: 'OUTSIDE' })))
    expect(await api.call('v.location.import')).toMatchObject({ keptUserConfirmed: 1 }); expect((await list({ city: 'Putrajaya' })).map((x) => x.id)).toEqual(['b'])
    api = mk(); expect((await list({ city: 'Putrajaya' })).map((x) => x.id)).toEqual(['b'])
    expect((await api.call('v.location.confirm', { companyId: 'b', clear: true }) as any).origin).toBe('AUDIT_IMPORT')
    const exp = await api.call('v.location.export'); expect(exp.rows).toBe(6); expect(fs.existsSync(exp.path)).toBe(true); expect(ex).toBeTruthy()
  })
  it('details carry the location, the flags and the historical ids', async () => {
    const { mk } = setup(); const api = mk(); const d: any = await api.call('v.companies.get', { id: 'f-old' })
    expect(d.id).toBe('f'); expect(d.locationInfo).toMatchObject({ physical_office_status: 'DISPUTED_LOCATION', claimedCity: 'IOI Resort City', verified: false }); expect(d.locationInfo.flags).toContain('MERGED_RECORD_HAD_DIFFERENT_CITY')
  })
  it('location never changes technical suitability', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'core', 'viewer', 'suitability.ts'), 'utf8'); expect(src).not.toMatch(/location|\.city\b/i)
  })
})
void reconcileDuplicates
