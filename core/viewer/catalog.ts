/**
 * Company research catalogue as plain JSON. No database. Built from the audited workbook, merged safely on update.
 * Principles: unknown is never zero; a government policy is not an employer confirmation; blanks never erase evidence.
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseLeads, readWorkbookFile, type Lead, type Sheets } from '../research-parse.ts'
import { classifyOrg, internshipEvidenceFrom, normalizeOrgKey, parseRmRange, type InternshipEvidence } from '../research-classify.ts'

export type TechTag = 'DEVOPS' | 'DATA_ENGINEERING' | 'INFO_SYSTEMS' | 'SOFTWARE' | 'AI_ML' | 'DATA_SCIENCE' | 'ANALYTICS' | 'CYBERSECURITY' | 'CLOUD' | 'NETWORKING' | 'IT_INFRA' | 'SYSADMIN' | 'FULL_STACK' | 'OTHER_CS'
export const TECH_LABEL: Record<TechTag, string> = {
  DEVOPS: 'DevOps', DATA_ENGINEERING: 'Data engineering', INFO_SYSTEMS: 'Information systems', SOFTWARE: 'Software engineering', AI_ML: 'AI / ML', DATA_SCIENCE: 'Data science', ANALYTICS: 'Analytics', CYBERSECURITY: 'Cybersecurity', CLOUD: 'Cloud',
  NETWORKING: 'Networking', IT_INFRA: 'IT infrastructure', SYSADMIN: 'System administration', FULL_STACK: 'Full stack', OTHER_CS: 'Other CS work',
}
const TECH_RE: Record<Exclude<TechTag, 'OTHER_CS'>, RegExp> = {
  SOFTWARE: /software|developer|programmer|application dev|\bapi\b|back-?end|front-?end|\bqa\b|testing/i,
  AI_ML: /\bai\b|artificial intelligence|machine learning|\bml\b|deep learning|computer vision|\bnlp\b|\bllm\b|generative/i,
  DATA_SCIENCE: /data scien|data engineer|big data|data platform|data lab/i,
  ANALYTICS: /analytic|business intelligence|\bbi\b|data analy|dashboard|reporting/i,
  CYBERSECURITY: /cyber|security|\bsoc\b|forensic|infosec|threat|penetration|vulnerab/i,
  CLOUD: /cloud|devops|\bsre\b|kubernetes|platform engineer/i,
  DEVOPS: /devops|\bsre\b|ci\/cd|site reliability|platform engineer/i,
  DATA_ENGINEERING: /data engineer|etl|data pipeline|data warehouse|big data|data platform/i,
  INFO_SYSTEMS: /information system|business analyst|systems analyst|erp\b|\bsap\b|enterprise (system|application|it)|digital transformation|it consult|business system|e-?government/i,
  NETWORKING: /network|\bnoc\b|telecom|connectivity|5g/i,
  IT_INFRA: /infrastructure|data cent(re|er)|server|hosting|\bit operations\b|\bit systems?\b|ict (operations|infrastructure)/i,
  SYSADMIN: /system(s)? admin|sysadmin|\bit support\b|technical support|help ?desk|it officer|pegawai teknologi maklumat/i,
  FULL_STACK: /full-?stack|web developer|web (app|dev)|mobile app/i,
}
export function techTagsFrom(text: string): TechTag[] {
  const out = (Object.keys(TECH_RE) as (keyof typeof TECH_RE)[]).filter((k) => TECH_RE[k].test(text)) as TechTag[]
  return out
}

export type AllowanceStatus = 'CONFIRMED_PAID' | 'HISTORICAL' | 'ESTIMATED' | 'UNKNOWN' | 'CONFIRMED_UNPAID'
export type OfficeStatus = 'VERIFIED' | 'PROBABLE' | 'UNVERIFIED'

export interface CatalogCompany {
  id: string
  leadId: string | null
  name: string
  legalEntity: string | null
  city: 'Cyberjaya' | 'Putrajaya' | 'IOI Resort City' | null
  sector: 'GOVERNMENT' | 'NON_GOVERNMENT' | 'UNKNOWN'
  /** Source-reported scores, kept as history only. Never used or displayed as a match. */
  sourceClaims?: { adamScore: number | null; akifScore: number | null; note: string }
  /** HR and internship contact research with provenance. See contacts.ts. Never overwritten by a company-list import. */
  contactIntel?: import('./contacts.ts').ContactIntel
  /** Earlier records folded into this one (same organisation, corrected location or renumbered). Old ids still resolve to this company. */
  mergedFrom?: { id: string; leadId: string | null; city: string | null; name: string; note: string }[]
  /** True when the organisation came from the 'missing prior leads' list and is not yet verified. */
  priorLead?: boolean
  classes: string[]                 // MINISTRY, DEPARTMENT, GLC, MNC, PLC, SME, STARTUP, UNIVERSITY_RESEARCH …
  categoryLabel: string | null      // ownership text as researched
  industry: string | null
  size: string | null
  website: string | null
  offices: { address: string; status: OfficeStatus; note: string | null }[]
  tech: TechTag[]
  relevance: string | null
  roles: string[]
  techDivision: string | null
  internship: { evidence: InternshipEvidence; sourceLabel: string | null; auditNote: string | null; docs: string | null; deadline: string | null; deadlineVerified: boolean; method: string | null; applicationUrl: string | null }
  allowance: { grade: string; status: AllowanceStatus; monthlyMin: number | null; monthlyMax: number | null; claimText: string | null; policyRef: boolean; conditions: string | null; benefits: string | null; sourceUrl: string | null; sourceDate: string | null; note: string }
  contacts: { hrEmail: string | null; generalEmail: string | null; phone: string | null; careersUrl: string | null; contactForm: string | null; linkedin: string | null }
  sources: { label: string; url: string | null }[]
  lastVerified: string | null
  uncertainties: string[]
  notes: string | null
  nextAction: string | null
  verificationLevel: OfficeStatus
}

export interface Catalog { version: 1; generatedAt: string; sourceFile: string; sourceSha256: string | null; companies: CatalogCompany[] }

const BLANK = /^(|unknown|not provided|n\/a|none|-|—)$/i
const nz = (s: string | undefined | null): string | null => { const t = (s ?? '').trim(); return BLANK.test(t) ? null : t }
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/i
const PHONE = /(?:\+?60|0)[\d\s().-]{7,}\d/
const httpUrl = (s: string | null | undefined): string | null => {
  const t = (s ?? '').trim(); if (!t) return null
  const u = /^https?:\/\//i.test(t) ? t : /^(www\.|[\w-]+\.(com|my|org|gov\.my|edu\.my|net|io)\b)/i.test(t) || /^linkedin\.com\//i.test(t) ? `https://${t}` : null
  if (!u || /\s/.test(u)) return null
  try { const p = new URL(u); return /^https?:$/.test(p.protocol) ? p.toString() : null } catch { return null }
}
/** Excel serial date → ISO date. Pass-through for ISO strings. */
export function isoDate(v: string | null | undefined): string | null {
  const t = (v ?? '').trim(); if (!t) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  if (/^\d{5}(\.\d+)?$/.test(t)) { const d = new Date((Number(t) - 25569) * 86400000); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10) }
  return null
}
const split = (s: string | null) => (s ?? '').split(/,|;|\n|\/(?=\s)|\band\b/i).map((x) => x.trim()).filter((x) => x.length > 2)
const officeStatus = (audit: string): OfficeStatus => /^official/i.test(audit) ? 'VERIFIED' : /^supported/i.test(audit) ? 'PROBABLE' : 'UNVERIFIED'

export function allowanceStatus(a: Lead['allowance']): AllowanceStatus {
  if (a.grade === 'A6') return 'CONFIRMED_UNPAID'
  if (a.grade === 'A1' && a.amountMin != null) return 'CONFIRMED_PAID'
  if (a.grade === 'A2' && a.amountMin != null) return 'HISTORICAL'
  if (a.policyRef || ((a.grade === 'A3' || a.grade === 'A4') && a.amountMin != null)) return 'ESTIMATED'
  return 'UNKNOWN'
}

export function companyFrom(l: Lead): CatalogCompany {
  const f = l.f
  const cls = classifyOrg(f.ownership)
  const classes: string[] = [...cls.classes]
  const sizeText = `${f.size ?? ''} ${f.ownership ?? ''}`
  if (/\bsme\b|small (and|&) medium|small business/i.test(sizeText)) classes.push('SME')
  if (/start-?up/i.test(sizeText)) classes.push('STARTUP')
  const contact = f.contact ?? ''
  const hrRaw = nz(f.hrEmail)
  const hrEmail = hrRaw ? EMAIL.exec(hrRaw)?.[0] ?? null : null
  const general = EMAIL.exec(contact)?.[0] ?? null
  const phone = PHONE.exec(contact)?.[0]?.trim() ?? null
  const formText = /form|portal|online/i.test(contact) && !general ? contact : null
  const roleText = [f.roles, f.relevance, f.techDivision, f.industry].filter(Boolean).join(' | ')
  let tech = techTagsFrom(roleText)
  if (!tech.length && /relevant/i.test(f.relevance ?? '')) tech = ['OTHER_CS']
  const evidence = internshipEvidenceFrom({ raw: f.internshipRaw || f.rawInternship || null, audit: f.internshipAudit || null })
  const addr = nz(f.address)
  const status = officeStatus(f.officeAudit ?? '')
  const deadline = nz(f.deadline)
  const uncertainties: string[] = []
  if (status !== 'VERIFIED') uncertainties.push(`Office address ${status === 'PROBABLE' ? 'is probable but' : 'is'} not independently verified.`)
  if (evidence === 'UNKNOWN' || evidence === 'DIRECT_OUTREACH') uncertainties.push('No verified internship opening or programme. Treat as an enquiry, not a vacancy.')
  if (/^rolling$/i.test(deadline ?? '')) uncertainties.push('"Rolling" deadline is a spreadsheet label, not a verified deadline.')
  const al = l.allowance
  if (al.claimText && al.grade !== 'A1' && al.grade !== 'A2') uncertainties.push('The original allowance figure is an unverified claim.')
  const auditNote = nz(f.internshipAudit)
  const srcLabels = split(nz(f.evidence))
  const sources: CatalogCompany['sources'] = srcLabels.map((label) => ({ label, url: null }))
  for (const [label, u] of [['Official website', httpUrl(f.website)], ['Careers / application page', httpUrl(f.careers)], ['Allowance source', httpUrl(f.allowanceUrl)], ['Independent verification', httpUrl(f.verifyUrl)]] as const)
    if (u && !sources.some((s) => s.url === u)) sources.push({ label, url: u })
  const rm = parseRmRange(al.claimText)
  return {
    id: (l.leadId ?? `${(l.city ?? 'x').slice(0, 2)}-${normalizeOrgKey(l.name).replace(/\s+/g, '-')}`).toLowerCase(),
    leadId: l.leadId, name: l.name, legalEntity: nz(f.legal), city: l.city as CatalogCompany['city'], sector: cls.sector, classes,
    categoryLabel: nz(f.ownership), industry: nz(f.industry), size: nz(f.size), website: httpUrl(f.website),
    offices: addr ? [{ address: addr, status, note: nz(f.officeAudit) }] : [],
    tech, relevance: nz(f.relevance), roles: split(nz(f.roles)), techDivision: nz(f.techDivision),
    internship: { evidence, sourceLabel: nz(f.internshipRaw || f.rawInternship), auditNote, docs: nz(f.docs), deadline, deadlineVerified: false, method: nz(f.method), applicationUrl: httpUrl(f.careers) },
    allowance: { grade: al.grade, status: allowanceStatus(al), monthlyMin: al.amountMin, monthlyMax: al.amountMax, claimText: al.claimText ?? (rm.min != null ? null : null), policyRef: al.policyRef, conditions: nz(f.allowanceConditions), benefits: nz(f.benefits), sourceUrl: httpUrl(f.allowanceUrl), sourceDate: isoDate(f.allowanceDate), note: al.note },
    contacts: { hrEmail, generalEmail: general, phone, careersUrl: httpUrl(f.careers), contactForm: formText, linkedin: httpUrl(f.linkedin) },
    sources, lastVerified: isoDate(f.lastVerified), uncertainties, notes: nz(f.notes), nextAction: nz(f.nextAction), verificationLevel: status,
  }
}

export function buildCatalog(sheets: Sheets, meta: { sourceFile: string; sourceSha256?: string | null }): { catalog: Catalog; warnings: string[] } {
  const { leads, warnings } = parseLeads(sheets)
  const companies = leads.map(companyFrom)
  const ids = new Set<string>()
  for (const c of companies) { let id = c.id, n = 2; while (ids.has(id)) id = `${c.id}-${n++}`; c.id = id; ids.add(id) }
  return { catalog: { version: 1, generatedAt: new Date().toISOString(), sourceFile: meta.sourceFile, sourceSha256: meta.sourceSha256 ?? null, companies }, warnings }
}

export async function catalogFromWorkbook(file: string) {
  const w = await readWorkbookFile(file)
  const { isAtlas, atlasToCatalog } = await import('./atlas.ts')
  if (isAtlas(w.sheets)) { const r = atlasToCatalog(w.sheets, { sourceFile: w.filename, sourceSha256: w.sha256 }); return { catalog: r.catalog, warnings: r.warnings } }
  return buildCatalog(w.sheets, { sourceFile: w.filename, sourceSha256: w.sha256 })
}

// ---------------------------------------------------------------- merge (safe replacement)
const ALLOW_RANK: Record<string, number> = { A1: 0, A6: 1, A2: 2, A3: 3, A4: 4, A5: 5 }
const EVID_RANK: Record<string, number> = { UNKNOWN: 0, DIRECT_OUTREACH: 0, NOT_ACCEPTING: 1, HISTORICAL: 1, REPORTED_PROGRAMME: 2, CONFIRMED_PROGRAMME: 3, ACTIVE_OPENING: 4 }
const OFFICE_RANK: Record<string, number> = { UNVERIFIED: 0, PROBABLE: 1, VERIFIED: 2 }
const keyOf = (c: CatalogCompany) => `${(c.city ?? '').toLowerCase()}|${normalizeOrgKey(c.name)}`

export interface MergeReport { added: number; updated: number; unchanged: number; keptExisting: string[]; total: number }

/**
 * Incoming wins only for non-blank values; stronger existing evidence is never downgraded (except an explicit "not accepting");
 * companies are never removed. Rows match on lead id first, then on city + normalised name. Two incoming rows never merge into one record.
 */
export function mergeCatalog(existing: Catalog | null, incoming: Catalog): { catalog: Catalog; report: MergeReport } {
  const base = existing?.companies ?? []
  // A lead id only identifies a row when it is unique in both files (the research workbook can reuse one).
  const count = (list: CatalogCompany[]) => { const m = new Map<string, number>(); for (const c of list) if (c.leadId) m.set(c.leadId.toLowerCase(), (m.get(c.leadId.toLowerCase()) ?? 0) + 1); return m }
  const baseN = count(base), incN = count(incoming.companies)
  const byLead = new Map(base.filter((c) => c.leadId && baseN.get(c.leadId.toLowerCase()) === 1 && incN.get(c.leadId.toLowerCase()) === 1).map((c) => [c.leadId!.toLowerCase(), c]))
  const byKey = new Map(base.map((c) => [keyOf(c), c]))
  const out = new Map(base.map((c) => [c.id, c]))
  const used = new Set<string>()
  const report: MergeReport = { added: 0, updated: 0, unchanged: 0, keptExisting: [], total: 0 }
  const freshId = (id: string) => { let x = id, n = 2; while (out.has(x)) x = `${id}-${n++}`; return x }
  for (const inc of incoming.companies) {
    const cur = (inc.leadId ? byLead.get(inc.leadId.toLowerCase()) : undefined) ?? byKey.get(keyOf(inc))
    if (!cur || used.has(cur.id)) {
      if (cur) report.keptExisting.push(`${inc.name}: another row already matched "${cur.name}", so this one was added as a separate organisation`)
      const add = { ...inc, id: freshId(inc.id) }; out.set(add.id, add); report.added++; continue
    }
    used.add(cur.id)
    const m: any = { ...cur }
    for (const [key, v] of Object.entries(inc) as [keyof CatalogCompany, any][]) {
      if (['id', 'offices', 'internship', 'allowance', 'contacts', 'sources', 'uncertainties', 'verificationLevel'].includes(key)) continue
      const blank = v == null || v === '' || (Array.isArray(v) && !v.length)
      if (!blank) m[key] = v
    }
    const offices = [...cur.offices]; for (const o of inc.offices) { const i = offices.findIndex((x) => normalizeOrgKey(x.address) === normalizeOrgKey(o.address)); if (i < 0) offices.push(o); else if (OFFICE_RANK[o.status] >= OFFICE_RANK[offices[i].status]) offices[i] = o }
    m.offices = offices
    m.verificationLevel = OFFICE_RANK[inc.verificationLevel] >= OFFICE_RANK[cur.verificationLevel] ? inc.verificationLevel : cur.verificationLevel
    let kept = false
    const weaker = EVID_RANK[inc.internship.evidence] < EVID_RANK[cur.internship.evidence] && inc.internship.evidence !== 'NOT_ACCEPTING'
    if (weaker) { m.internship = { ...inc.internship, evidence: cur.internship.evidence, auditNote: cur.internship.auditNote, sourceLabel: cur.internship.sourceLabel }; kept = true; report.keptExisting.push(`${cur.name}: kept stronger internship evidence`) }
    else m.internship = { ...cur.internship, ...Object.fromEntries(Object.entries(inc.internship).filter(([, v]) => v != null && v !== '')) }
    if (ALLOW_RANK[inc.allowance.grade] <= ALLOW_RANK[cur.allowance.grade]) m.allowance = inc.allowance
    else { m.allowance = cur.allowance; kept = true; report.keptExisting.push(`${cur.name}: kept stronger allowance evidence (${cur.allowance.grade})`) }
    m.contacts = { ...cur.contacts, ...Object.fromEntries(Object.entries(inc.contacts).filter(([, v]) => v)) }
    const srcs = [...cur.sources]; for (const x of inc.sources) if (!srcs.some((y) => y.label === x.label && y.url === x.url)) srcs.push(x)
    m.sources = srcs
    m.uncertainties = kept ? cur.uncertainties : inc.uncertainties   // caveats always describe the evidence that is actually shown
    m.id = cur.id
    if (JSON.stringify(m) === JSON.stringify(cur)) report.unchanged++; else { report.updated++; out.set(cur.id, m) }
  }
  const companies = [...out.values()]
  report.total = companies.length
  const done = reconcileDuplicates({ version: 1, generatedAt: new Date().toISOString(), sourceFile: incoming.sourceFile, sourceSha256: incoming.sourceSha256, companies })
  report.total = done.catalog.companies.length
  return { catalog: done.catalog, report }
}

// ---------------------------------------------------------------- duplicate reconciliation
const hostOf = (u: string | null) => (u ?? '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '')
const dupKey = (c: CatalogCompany) => {
  const name = normalizeOrgKey(c.name.replace(/\s*\(.*$/, '')); const host = hostOf(c.website); const legal = normalizeOrgKey((c.legalEntity ?? '').replace(/\s*\/.*$/, ''))
  // Only an exact match on name, website host AND legal entity counts. A shared website alone (two units of one ministry) never does.
  return name && host && legal ? `${name}|${host}|${legal}` : null
}
const uniq = <T,>(a: T[], k: (x: T) => string) => { const seen = new Set<string>(); return a.filter((x) => { const s = k(x); if (seen.has(s)) return false; seen.add(s); return true }) }
/** Folds records that are the same organisation into the better-evidenced one, keeping every office, role, source and old id. Idempotent. */
export function reconcileDuplicates(cat: Catalog): { catalog: Catalog; merged: { kept: string; dropped: string }[] } {
  const groups = new Map<string, CatalogCompany[]>()
  for (const c of cat.companies) { const k = dupKey(c); if (k) (groups.get(k) ?? groups.set(k, []).get(k)!).push(c) }
  const drop = new Set<string>(); const replace = new Map<string, CatalogCompany>(); const merged: { kept: string; dropped: string }[] = []
  for (const g of groups.values()) {
    if (g.length < 2) continue
    const rank = (c: CatalogCompany) => (c.contactIntel ? 4 : 0) + (/^(cj|new)-/.test(c.id) ? 2 : 0) + (c.lastVerified && c.lastVerified > '2026-11-18' ? 1 : 0)
    const [keep, ...rest] = [...g].sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id))
    let m: CatalogCompany = { ...keep }
    for (const o of rest) {
      m = { ...m,
        offices: uniq([...m.offices, ...o.offices.map((x) => ({ ...x, note: `Earlier research location (${o.city ?? 'unknown'}). ${x.note ?? ''}`.trim() }))], (x) => normalizeOrgKey(x.address)),
        roles: uniq([...m.roles, ...o.roles], (x) => x.toLowerCase()), tech: [...new Set([...m.tech, ...o.tech])], sources: uniq([...m.sources, ...o.sources, ...(o.contacts.careersUrl && o.contacts.careersUrl !== m.contacts.careersUrl ? [{ label: 'Careers page (earlier record)', url: o.contacts.careersUrl }] : [])], (x) => `${x.label}|${x.url}`),
        uncertainties: uniq([...m.uncertainties, ...o.uncertainties], (x) => x),
        contacts: Object.fromEntries(Object.entries(m.contacts).map(([k, v]) => [k, v ?? (o.contacts as any)[k]])) as CatalogCompany['contacts'],
        mergedFrom: [...(m.mergedFrom ?? []), ...(o.mergedFrom ?? []), { id: o.id, leadId: o.leadId, city: o.city, name: o.name, note: `Same organisation as ${keep.id}: same name, legal entity and website. The later research corrected its location.` }] }
      drop.add(o.id); merged.push({ kept: keep.id, dropped: o.id })
    }
    replace.set(keep.id, m)
  }
  if (!merged.length) return { catalog: cat, merged }
  return { catalog: { ...cat, companies: cat.companies.filter((c) => !drop.has(c.id)).map((c) => replace.get(c.id) ?? c) }, merged }
}

// ---------------------------------------------------------------- persistence
export function readCatalog(file: string): Catalog | null {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8')) as Catalog
    return c?.version === 1 && Array.isArray(c.companies) ? c : null
  } catch { return null }
}
export function writeCatalog(file: string, c: Catalog) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`)
  const tmp = `${file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(c, null, 1)); fs.renameSync(tmp, file)
}

// ---------------------------------------------------------------- query
export interface CatalogFilter {
  q?: string; city?: string; sector?: string; classes?: string[]; tech?: string[]; allowance?: AllowanceStatus[]; evidence?: string[]
}
export function filterCatalog(list: CatalogCompany[], f: CatalogFilter): CatalogCompany[] {
  const q = (f.q ?? '').trim().toLowerCase()
  return list.filter((c) =>
    (!f.city || f.city === 'All' || c.city === f.city) &&
    (!f.sector || c.sector === f.sector) &&
    (!f.classes?.length || f.classes.some((x) => c.classes.includes(x))) &&
    (!f.tech?.length || f.tech.some((x) => c.tech.includes(x as TechTag))) &&
    (!f.allowance?.length || f.allowance.includes(c.allowance.status)) &&
    (!f.evidence?.length || f.evidence.includes(c.internship.evidence)) &&
    (!q || [c.name, c.legalEntity, c.industry, c.categoryLabel, c.roles.join(' '), c.techDivision].some((s) => (s ?? '').toLowerCase().includes(q))))
}
