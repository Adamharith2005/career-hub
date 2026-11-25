/**
 * Importer for the "Employer Atlas" workbook (Master Import + audit sheets). No database.
 * Source-reported suitability scores are kept only as history in `sourceClaims`; they are never used for matching.
 * Anything the workbook does not establish stays unknown.
 */
import { classifyOrg, normalizeOrgKey, parseRmRange } from '../research-classify.ts'
import { txt, type Sheets, type Cell } from '../research-parse.ts'
import { techTagsFrom, isoDate, type Catalog, type CatalogCompany, type OfficeStatus, type AllowanceStatus } from './catalog.ts'

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/i
const PHONE = /(?:\+?60|0)[\d\s().-]{7,}\d/
const url = (s: string | null | undefined): string | null => {
  const t = (s ?? '').trim(); if (!t || /\s/.test(t) || EMAIL.test(t)) return null
  const u = /^https?:\/\//i.test(t) ? t : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(t) ? `https://${t}` : null
  if (!u) return null
  try { const p = new URL(u); return /^https?:$/.test(p.protocol) ? p.toString() : null } catch { return null }
}
const blank = (s: string | undefined) => !s || /^(unknown|not provided|n\/a|none|-|—)$/i.test(s.trim())

export const isAtlas = (sheets: Sheets) => !!sheets['Master Import']?.[0]?.map((c) => txt(c)).includes('Atlas_ID')

function table(rows: Cell[][] | undefined) {
  if (!rows?.length) return [] as Record<string, string>[]
  const h = rows[0].map((c) => txt(c))
  return rows.slice(1).filter((r) => r.some((c) => txt(c))).map((r) => Object.fromEntries(h.map((k, i) => [k, txt(r[i])])))
}

const zoneCity = (z: string): CatalogCompany['city'] => /ioi|conez/i.test(z) ? 'IOI Resort City' : /putrajaya/i.test(z) ? 'Putrajaya' : /cyberjaya/i.test(z) ? 'Cyberjaya' : null
const office = (v: string): OfficeStatus => /^V1|^V2/i.test(v) ? 'VERIFIED' : /^V3/i.test(v) ? 'PROBABLE' : 'UNVERIFIED'

function allowanceFrom(grade: string, terms: string): CatalogCompany['allowance'] {
  const g = /^A([1-6])/i.exec(grade)?.[1]; const G = g ? `A${g}` : 'A5'
  const { min, max } = parseRmRange(terms)
  const has = min != null
  let status: AllowanceStatus = 'UNKNOWN'; let note = 'No reliable amount established.'
  if (G === 'A2' && has) { status = 'HISTORICAL'; note = 'Historical or standard band for this kind of employer. The employer has not confirmed a current amount.' }
  else if (G === 'A3' && has) { status = 'ESTIMATED'; note = 'Reported by a third party. Not confirmed by the employer.' }
  else if (G === 'A4') { status = 'ESTIMATED'; note = 'General government policy may apply. This organisation has not confirmed what it actually pays.' }
  else if (G === 'A1' && has) { status = 'CONFIRMED_PAID'; note = 'Source grade A1.' }
  const policy = G === 'A4'
  const show = (G === 'A1' || G === 'A2' || G === 'A3') && has
  return { grade: G, status, monthlyMin: show ? min : null, monthlyMax: show ? max : null, claimText: blank(terms) ? null : terms, policyRef: policy, conditions: null, benefits: null, sourceUrl: null, sourceDate: null, note }
}

export function atlasToCatalog(sheets: Sheets, meta: { sourceFile: string; sourceSha256?: string | null }): { catalog: Catalog; warnings: string[]; priorLeads: number } {
  const warnings: string[] = []
  const master = table(sheets['Master Import'])
  const reviewed = new Map(table(sheets['Review Queue']).map((r) => [r['Atlas ID'], r]))
  const ids = new Set<string>(); const companies: CatalogCompany[] = []
  for (const r of master) {
    const rawName = r.Canonical_Organisation_Name; if (!rawName) continue
    const name = rawName.replace(/\s*\((?:corporate hq|conezi[oó]n[^)]*|complex it|digital retail[^)]*|ioi resort city[^)]*)\)\s*$/i, '').trim() || rawName
    const zone = r.Reviewed_Zone || r.Geographic_Zone
    const city = zoneCity(zone)
    const cls = classifyOrg(r.Canonical_Ownership_Type)
    const sector: CatalogCompany['sector'] = /government|statutory/i.test(r.Sector_Group) ? 'GOVERNMENT' : /private|glc|mnc|institution/i.test(r.Sector_Group) ? 'NON_GOVERNMENT' : cls.sector
    const classes: string[] = [...cls.classes]
    if (/\bsme\b/i.test(r.Canonical_Ownership_Type)) classes.push('SME')
    if (/statutory|commission/i.test(r.Canonical_Ownership_Type) && !classes.includes('STATUTORY_BODY')) classes.push('STATUTORY_BODY')
    const contactParts = (r.Official_Contact ?? '').split(/\s*\|\s*|,\s+(?=[a-z]+\.)/i).map((x) => x.trim()).filter(Boolean)
    const email = EMAIL.exec(r.Official_Contact)?.[0] ?? null
    const phone = PHONE.exec(r.Official_Contact)?.[0]?.trim() ?? null
    const careers = contactParts.map(url).find(Boolean) ?? null
    const website = url(r.Primary_Source_URL)
    const addr = blank(r.Reviewed_Address) ? r.Physical_Office_Location : r.Reviewed_Address
    const ev = r.Internship_Vacancy_Status
    const evidence: CatalogCompany['internship']['evidence'] = /^I1|^I2/i.test(ev) ? 'REPORTED_PROGRAMME' : /^I3/i.test(ev) ? 'HISTORICAL' : /^I4/i.test(ev) ? 'DIRECT_OUTREACH' : 'UNKNOWN'
    const flags = (r.Audit_Flags ?? '').split(/;\s*/).map((x) => x.trim()).filter(Boolean)
    const unc: string[] = []
    if (/^I1/i.test(ev)) unc.push('An active posting is claimed in the research. No current requisition has been checked.')
    if (/^I2/i.test(ev)) unc.push('A recurring programme is reported in the research. It has not been independently re-checked.')
    if (evidence === 'DIRECT_OUTREACH' || evidence === 'UNKNOWN') unc.push('No verified internship opening or programme. Treat as an enquiry, not a vacancy.')
    if (office(r.Office_Verification_Status) !== 'VERIFIED') unc.push('Exact office unit or suite is not confirmed.')
    for (const f of flags) if (!unc.includes(f)) unc.push(f)
    if (/low/i.test(r.Research_Confidence_Overall)) unc.push(`Research confidence: ${r.Research_Confidence_Overall}.`)
    const roles = (r.Relevant_CS_Internship_Roles ?? '').split(/,|;|\//).map((x) => x.trim()).filter((x) => x.length > 2)
    const text = [r.Relevant_CS_Internship_Roles, r.CS_Technical_Relevance, name].join(' | ')
    let tech = techTagsFrom(text); if (!tech.length) tech = ['OTHER_CS']
    const idBase = (r.Atlas_ID || `${(city ?? 'x').slice(0, 2)}-${normalizeOrgKey(name).replace(/\s+/g, '-')}`).toLowerCase()
    let id = idBase, n = 2; while (ids.has(id)) id = `${idBase}-${n++}`; ids.add(id)
    const rq = reviewed.get(r.Atlas_ID)
    if (rq?.['Why Check']) unc.push(`Review queue: ${rq['Why Check']}`)
    companies.push({
      id, leadId: r.Atlas_ID || null, name, legalEntity: blank(r.Legal_Entity_Parent) ? null : r.Legal_Entity_Parent, city, sector, classes,
      categoryLabel: r.Canonical_Ownership_Type || null, industry: null, size: null, website,
      offices: blank(addr) ? [] : [{ address: addr, status: office(r.Office_Verification_Status), note: r.Office_Verification_Status || null }],
      tech, relevance: r.CS_Technical_Relevance || null, roles, techDivision: null,
      internship: { evidence, sourceLabel: ev || null, auditNote: flags.join('; ') || null, docs: null, deadline: null, deadlineVerified: false, method: null, applicationUrl: careers },
      allowance: allowanceFrom(r.Allowance_Confidence_Level, r.Allowance_Terms_Corrected),
      contacts: { hrEmail: null, generalEmail: email, phone, careersUrl: careers, contactForm: null, linkedin: null },
      sources: [...(website ? [{ label: 'Primary source', url: website }] : []), ...(careers && careers !== website ? [{ label: 'Careers / contact', url: careers }] : [])],
      lastVerified: isoDate(r.Source_Last_Verified_Date), uncertainties: unc, notes: null, nextAction: null,
      verificationLevel: office(r.Office_Verification_Status),
      sourceClaims: { adamScore: Number(r.Adam_Suitability_100) || null, akifScore: Number(r.Akif_Suitability_100) || null, note: 'Reported by the source research. Its scores mixed up the two students, so Career Hub never uses them.' },
    })
  }
  // Organisations the latest research dropped. Keep them, clearly unverified; never silently discard.
  const have = new Set(companies.map((c) => normalizeOrgKey(c.name)))
  let priorLeads = 0
  for (const r of table(sheets['Missing Prior Leads'])) {
    const name = r['Employer absent from 187']; if (!name || have.has(normalizeOrgKey(name))) continue
    const area = r['Prior reported area'] ?? ''
    const city = /putrajaya|presint|ayer@8|shaftsbury/i.test(area) ? 'Putrajaya' : /ioi|conez/i.test(area) ? 'IOI Resort City' : /cyber|tamarind|futurise|cbd/i.test(area) ? 'Cyberjaya' : null
    const web = url(r['Candidate source'])
    let id = `prior-${normalizeOrgKey(name).replace(/\s+/g, '-')}`.slice(0, 60)
    companies.push({
      id, leadId: null, name, legalEntity: null, city, sector: 'NON_GOVERNMENT', classes: [], categoryLabel: null, industry: null, size: null, website: web,
      offices: area ? [{ address: area, status: 'UNVERIFIED', note: 'Area reported in earlier research' }] : [], tech: ['OTHER_CS'], relevance: null, roles: [], techDivision: null,
      internship: { evidence: 'UNKNOWN', sourceLabel: null, auditNote: null, docs: null, deadline: null, deadlineVerified: false, method: null, applicationUrl: null },
      allowance: allowanceFrom('A5', ''), contacts: { hrEmail: null, generalEmail: null, phone: null, careersUrl: null, contactForm: null, linkedin: null },
      sources: web ? [{ label: 'Candidate source', url: web }] : [], lastVerified: null,
      uncertainties: ['Reported in earlier research but absent from the latest list. Not verified.', r['Why this needs investigation'] ?? ''].filter(Boolean),
      notes: null, nextAction: 'Verify office and internship relevance before approaching.', verificationLevel: 'UNVERIFIED', priorLead: true,
    }); priorLeads++
  }
  if (master.length !== 187) warnings.push(`Expected about 187 employer rows; found ${master.length}.`)
  return { catalog: { version: 1, generatedAt: new Date().toISOString(), sourceFile: meta.sourceFile, sourceSha256: meta.sourceSha256 ?? null, companies }, warnings, priorLeads }
}
