/**
 * HR and internship contact research. No database, no network, nothing sent.
 * Principles: a contact is only as good as its evidence. Gemini-reported is not verified. A general address is not HR.
 * A historical address is not current. Nothing is guessed from a domain. A recruitment contact is never proof of a vacancy.
 */
import fs from 'node:fs'
import path from 'node:path'
import { normalizeOrgKey } from '../research-classify.ts'
import { reconcileDuplicates, type Catalog, type CatalogCompany } from './catalog.ts'

export type RouteKind = 'EMAIL' | 'PORTAL' | 'PHONE_FORM'
export type Tier = 'E1' | 'E2' | 'E3' | 'E4' | 'E5' | 'E6'
export type Verification = 'USER_CONFIRMED' | 'CHECKED_CURRENT' | 'CHECKED_GENERAL' | 'CHECKED_HISTORICAL' | 'CONFLICTING' | 'INVALID' | 'GEMINI_UNVERIFIED' | 'EXISTING_UNVERIFIED'
export type Origin = 'USER' | 'V4_AUDIT' | 'V4_GEMINI' | 'EXISTING'

export const TIER_LABEL: Record<Tier, string> = {
  E1: 'Dedicated internship email', E2: 'Recruitment / HR email', E3: 'Careers portal', E4: 'General company email', E5: 'Phone or contact form', E6: 'No reliable contact',
}
export const VERIFICATION_LABEL: Record<Verification, string> = {
  USER_CONFIRMED: 'Confirmed by you', CHECKED_CURRENT: 'Independently checked, current', CHECKED_GENERAL: 'Independently checked, general contact', CHECKED_HISTORICAL: 'Independently checked, historical. Reconfirm before use',
  CONFLICTING: 'Conflicting information', INVALID: 'Not valid for internship applications', GEMINI_UNVERIFIED: 'Gemini-reported, needs verification', EXISTING_UNVERIFIED: 'Earlier research, not verified',
}
/** Higher wins when the same route arrives twice. User > current independent evidence > older independent evidence > findings against > Gemini > earlier research. */
const RANK: Record<Verification, number> = { USER_CONFIRMED: 7, CHECKED_CURRENT: 6, CHECKED_GENERAL: 6, CHECKED_HISTORICAL: 5, CONFLICTING: 4, INVALID: 4, GEMINI_UNVERIFIED: 2, EXISTING_UNVERIFIED: 1 }

export interface ContactRoute {
  key: string; kind: RouteKind; tier: Tier; value: string; label: string; verification: Verification; origin: Origin
  department: string | null; sourceUrl: string | null; checkedOn: string | null; note: string | null
}
export interface ContactEvidence { origin: string; purpose: string; inspected: boolean; tierClaimed: string; tierAudited: string; emailClaimed: string | null; emailIndependent: string | null; method: string | null; sourceUrl: string | null; note: string | null; date: string | null }
export interface ContactIntel {
  source: string; researchedOn: string | null; routes: ContactRoute[]; evidence: ContactEvidence[]
  nextStep: string | null; auditNote: string | null; reportedDepartment: string | null; openingVerified: boolean; needsResearch?: boolean
}

/* ---------------------------------------------------------------- safe parsing */
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
export const clean = (s: unknown, max = 2000): string => String(s ?? '').replace(CTRL, '').replace(/ /g, ' ').trim().slice(0, max)
const BLANK = /^(|-|—|n\/a|none|unknown|not provided|unverified)$/i
const nz = (s: string): string | null => (BLANK.test(s.trim()) ? null : s.trim())
export const EMAIL_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/
export const asEmail = (s: string): string | null => { const t = s.trim().replace(/^mailto:/i, '').replace(/[<>;,]+$/g, '').toLowerCase(); return EMAIL_RE.test(t) ? t : null }
/** Accepts "https://x", "[x](https://x)" and bare "www.x"; only http(s) survives. */
export function asUrl(s: string): string | null {
  const md = /\]\((https?:\/\/[^)\s]+)\)/i.exec(s); const raw = (md ? md[1] : /(https?:\/\/[^\s)\]]+)/i.exec(s)?.[1] ?? (/^(www\.[^\s]+)$/i.test(s.trim()) ? `https://${s.trim()}` : null))
  if (!raw) return null
  try { const u = new URL(raw.replace(/[.,;]+$/, '')); return /^https?:$/.test(u.protocol) ? u.toString() : null } catch { return null }
}
const day = (s: string): string | null => (/^\d{4}-\d{2}-\d{2}/.test(s.trim()) ? s.trim().slice(0, 10) : null)
const phoneOf = (s: string): string | null => /(?:\+?60|0)[\d\s().-]{7,}\d/.exec(s)?.[0]?.trim() ?? null

/** RFC 4180 reader: quoted fields, embedded commas, quotes and newlines, BOM. Never evaluates anything. */
export function parseCsv(text: string): Record<string, string>[] {
  const t = text.replace(/^﻿/, ''); const rows: string[][] = []; let row: string[] = [], f = '', q = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((x) => x !== '')) rows.push(row); row = [] }
    else f += c
  }
  row.push(f); if (row.some((x) => x !== '')) rows.push(row)
  if (!rows.length) return []
  const head = rows[0].map((h) => clean(h, 120))
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, clean(r[i] ?? '')])))
}
/** A cell that would be read as a formula by a spreadsheet gets a leading apostrophe on export. */
export const csvCell = (v: unknown): string => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

/* ---------------------------------------------------------------- locate and read the research files */
const NAMES = { master: 'CAREER_HUB_EMPLOYER_ATLAS_V4_HR_CONTACTS', evidence: 'CAREER_HUB_INTERNSHIP_CONTACT_EVIDENCE', outreach: 'CAREER_HUB_INTERNSHIP_OUTREACH_READY' } as const
const REQUIRED: Record<keyof typeof NAMES, string[]> = {
  master: ['Atlas_ID', 'Canonical_Organisation_Name', 'Audited_Contact_Tier', 'Independent_Verification_Status', 'Gemini_Reported_Contact_Tier'],
  evidence: ['Atlas_ID', 'Organisation_Name', 'Evidence_Origin', 'Source_Actually_Inspected'], outreach: ['Atlas_ID', 'Company', 'Audited_Tier', 'Email_Type'],
}
export interface ContactFiles { master: string | null; evidence: string | null; outreach: string | null; workbook: string | null; notes: string[] }

/** Picks files by name AND schema, so a "(1)" copy or an older version is never chosen by accident. Newest valid file wins. */
export function findContactFiles(dir: string): ContactFiles {
  const out: ContactFiles = { master: null, evidence: null, outreach: null, workbook: null, notes: [] }
  let names: string[] = []; try { names = fs.readdirSync(dir) } catch { out.notes.push(`Folder not readable: ${dir}`); return out }
  const pick = (stem: string, ext: string, key: keyof typeof NAMES | 'workbook') => {
    const cands = names.filter((n) => n.startsWith(stem) && n.toLowerCase().endsWith(ext)).map((n) => path.join(dir, n))
    const good = cands.filter((f) => { if (ext !== '.csv' || key === 'workbook') return true; try { const head = parseCsv(fs.readFileSync(f, 'utf8').slice(0, 20000) + '\n')[0] ?? {}; return REQUIRED[key].every((c) => c in head) } catch { return false } })
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    if (cands.length > 1) out.notes.push(`${cands.length} candidates for ${stem}${ext}; chose ${path.basename(good[0] ?? cands[0])} by schema and date.`)
    return good[0] ?? null
  }
  out.master = pick(NAMES.master, '.csv', 'master'); out.evidence = pick(NAMES.evidence, '.csv', 'evidence'); out.outreach = pick(NAMES.outreach, '.csv', 'outreach'); out.workbook = pick(NAMES.master, '.xlsx', 'workbook')
  return out
}

export interface ContactResearch { master: Record<string, string>[]; evidence: Record<string, string>[]; outreach: Record<string, string>[]; sheets: { name: string; rows: number }[]; warnings: string[]; sourceFile: string; files: Record<string, string | null> }
export async function readContactResearch(dir: string): Promise<ContactResearch> {
  const f = findContactFiles(dir); const warnings = [...f.notes]
  for (const [k, v] of Object.entries({ master: f.master, evidence: f.evidence, outreach: f.outreach })) if (!v) warnings.push(`Missing file: ${NAMES[k as keyof typeof NAMES]}.csv`)
  if (!f.workbook) warnings.push(`Missing file: ${NAMES.master}.xlsx (the CSV files are used instead)`)
  const read = (p: string | null) => (p ? parseCsv(fs.readFileSync(p, 'utf8')) : [])
  const master = read(f.master), evidence = read(f.evidence), outreach = read(f.outreach)
  const sheets: ContactResearch['sheets'] = []
  if (f.workbook) {
    try {
      const { readWorkbookFile } = await import('../research-parse.ts'); const w = await readWorkbookFile(f.workbook)
      for (const [name, rows] of Object.entries(w.sheets)) sheets.push({ name, rows: Math.max(0, rows.length - 1) })
      const mc = sheets.find((s) => s.name === 'Master Contacts'); if (mc && master.length && mc.rows !== master.length) warnings.push(`Workbook "Master Contacts" has ${mc.rows} rows but the master CSV has ${master.length}.`)
    } catch (e: any) { warnings.push(`Workbook could not be read: ${e?.message ?? e}`) }
  }
  return { master, evidence, outreach, sheets, warnings, sourceFile: f.master ? path.basename(f.master) : '', files: { master: f.master, evidence: f.evidence, outreach: f.outreach, workbook: f.workbook } }
}

/* ---------------------------------------------------------------- build contact intelligence from the research rows */
const tierOf = (s: string): Tier => (/^E[1-6]$/.test(s.trim()) ? (s.trim() as Tier) : 'E6')
function verificationOf(status: string): Verification {
  if (/^verified official career route/i.test(status)) return 'CHECKED_CURRENT'
  if (/^verified general contact/i.test(status)) return 'CHECKED_GENERAL'
  if (/^historically documented/i.test(status)) return 'CHECKED_HISTORICAL'
  if (/^portal verified/i.test(status)) return 'CHECKED_CURRENT'
  if (/wrong recruitment purpose/i.test(status)) return 'INVALID'
  return 'GEMINI_UNVERIFIED'
}
const key = (kind: RouteKind, v: string) => `${kind}:${kind === 'PORTAL' ? v.toLowerCase().replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/, '') : v.toLowerCase()}`

export function buildIntel(row: Record<string, string>, evidence: Record<string, string>[], outreach: Record<string, string> | undefined, source: string, warnings: string[]): ContactIntel {
  const status = clean(row.Independent_Verification_Status), audited = tierOf(row.Audited_Contact_Tier ?? ''), v = verificationOf(status)
  const checked = row.Independently_Checked_2026_11_26 === 'Yes'
  const date = day(evidence.find((e) => e.Source_Actually_Inspected === 'Yes')?.Research_Date ?? '') ?? day(evidence[0]?.Research_Date ?? '')
  const dept = nz(clean(row.Gemini_Reported_Target_Department)); const note = nz(clean(row.Contact_Audit_Notes))
  const src = asUrl(row.Independent_Source_URL ?? '')
  const routes: ContactRoute[] = []
  const add = (r: Omit<ContactRoute, 'key'>) => { const k = key(r.kind, r.value); const i = routes.findIndex((x) => x.key === k); if (i >= 0) { if (RANK[r.verification] > RANK[routes[i].verification]) routes[i] = { ...r, key: k } } else routes.push({ ...r, key: k }) }
  const type = clean(row.Confirmed_Contact_Type)

  const pref = asEmail(row.Preferred_Outreach_Email ?? ''), gem = asEmail(row.Gemini_Reported_Contact_Email ?? '')
  if (clean(row.Preferred_Outreach_Email) && !pref) warnings.push(`${row.Atlas_ID}: preferred email is not a valid address and was ignored.`)
  if (clean(row.Gemini_Reported_Contact_Email) && !gem) warnings.push(`${row.Atlas_ID}: Gemini email is not a valid address and was ignored.`)
  // The best independently checked email. Its tier is the AUDITED tier (a "recruitment" email can audit as general).
  if (pref) {
    const emailTier: Tier = audited === 'E1' || audited === 'E2' || audited === 'E4' ? audited : 'E4'
    add({ kind: 'EMAIL', tier: emailTier, value: pref, label: type || TIER_LABEL[emailTier], verification: v === 'GEMINI_UNVERIFIED' ? 'GEMINI_UNVERIFIED' : v, origin: v === 'GEMINI_UNVERIFIED' ? 'V4_GEMINI' : 'V4_AUDIT', department: dept, sourceUrl: src, checkedOn: v === 'GEMINI_UNVERIFIED' ? null : date, note })
  }
  if (gem && gem !== pref) {
    // A different Gemini address next to a checked one, or beside a verified portal, is a conflict, not a second contact.
    const conflict = (pref && v !== 'GEMINI_UNVERIFIED') || (/^portal verified/i.test(status))
    const gt = tierOf(row.Gemini_Reported_Contact_Tier ?? '')
    add({ kind: 'EMAIL', tier: gt === 'E1' || gt === 'E2' || gt === 'E4' ? gt : 'E4', value: gem, label: `Gemini-reported ${gt === 'E2' ? 'recruitment' : 'general'} address`, verification: conflict ? 'CONFLICTING' : v === 'INVALID' ? 'INVALID' : 'GEMINI_UNVERIFIED', origin: 'V4_GEMINI', department: dept, sourceUrl: null, checkedOn: conflict ? date : null,
      note: conflict ? (note ?? 'The Gemini address was not corroborated by the official source.') : 'Reported by Gemini research. Not independently checked.' })
  }
  const appUrl = asUrl(row.Audited_Application_URL ?? ''), gemUrl = asUrl(row.Gemini_Reported_Contact_URL ?? '')
  if (audited === 'E3' && (appUrl || gemUrl)) add({ kind: 'PORTAL', tier: 'E3', value: (appUrl ?? gemUrl)!, label: 'Careers portal', verification: v, origin: v === 'GEMINI_UNVERIFIED' ? 'V4_GEMINI' : 'V4_AUDIT', department: dept, sourceUrl: src ?? appUrl, checkedOn: v === 'GEMINI_UNVERIFIED' ? null : date, note: v === 'GEMINI_UNVERIFIED' ? 'Reported by Gemini research. The page was not independently inspected.' : note })
  else if (audited === 'E5') {
    const phone = phoneOf(clean(row.Official_Contact)) ?? phoneOf(clean(row.Gemini_Reported_Next_Step)); const url = gemUrl ?? appUrl
    if (url) add({ kind: 'PHONE_FORM', tier: 'E5', value: url, label: 'Enquiry form or contact page', verification: v, origin: v === 'GEMINI_UNVERIFIED' ? 'V4_GEMINI' : 'V4_AUDIT', department: dept, sourceUrl: src, checkedOn: null, note: 'Ask for the internship or industrial-training coordinator.' })
    if (phone) add({ kind: 'PHONE_FORM', tier: 'E5', value: phone, label: 'Telephone', verification: v, origin: v === 'GEMINI_UNVERIFIED' ? 'V4_GEMINI' : 'V4_AUDIT', department: dept, sourceUrl: src, checkedOn: null, note: 'Ask for the internship or industrial-training coordinator.' })
  } else if (audited === 'E4' && appUrl && !pref) add({ kind: 'PORTAL', tier: 'E4', value: appUrl, label: 'Company contact page (research lead)', verification: v === 'GEMINI_UNVERIFIED' ? 'GEMINI_UNVERIFIED' : v, origin: v === 'GEMINI_UNVERIFIED' ? 'V4_GEMINI' : 'V4_AUDIT', department: dept, sourceUrl: src, checkedOn: null, note: 'A general contact page, not a recruitment channel.' })

  if (outreach) {
    const o = asEmail(outreach.Best_Independently_Checked_Email ?? '')
    if (o && pref && o !== pref) warnings.push(`${row.Atlas_ID}: outreach file lists ${o} but the master lists ${pref}. The master is used.`)
    if (o && !pref) warnings.push(`${row.Atlas_ID}: outreach file lists a checked email that the master does not.`)
  }
  const ev: ContactEvidence[] = evidence.map((e) => ({ origin: clean(e.Evidence_Origin), purpose: clean(e.Evidence_Purpose), inspected: e.Source_Actually_Inspected === 'Yes', tierClaimed: clean(e.Contact_Tier_Claimed), tierAudited: clean(e.Contact_Tier_Audited),
    emailClaimed: asEmail(e.Email_Claimed ?? ''), emailIndependent: asEmail(e.Email_Independent ?? ''), method: nz(clean(e.Contact_Method_Claimed)), sourceUrl: asUrl(e.Source_URL ?? ''), note: nz(clean(e.Evidence_Note)), date: day(e.Research_Date ?? '') }))
  void checked
  return { source, researchedOn: date, routes, evidence: ev, nextStep: nz(clean(row.Recommended_Next_Step)), auditNote: note, reportedDepartment: dept, openingVerified: /^yes/i.test(row.Current_Internship_Opening_Independently_Verified ?? '') }
}

/** Merge two intel records for the same employer. Per route the stronger verification wins; a tie goes to the newer date. Nothing is dropped. */
export function mergeIntel(cur: ContactIntel | undefined, inc: ContactIntel): ContactIntel {
  if (!cur) return inc
  const routes = new Map(cur.routes.map((r) => [r.key, r]))
  for (const r of inc.routes) { const o = routes.get(r.key); if (!o || RANK[r.verification] > RANK[o.verification] || (RANK[r.verification] === RANK[o.verification] && (r.checkedOn ?? '') > (o.checkedOn ?? ''))) routes.set(r.key, r) }
  const evKey = (e: ContactEvidence) => [e.origin, e.sourceUrl, e.date, e.note, e.emailClaimed, e.emailIndependent].join('|')
  const ev = new Map(cur.evidence.map((e) => [evKey(e), e])); for (const e of inc.evidence) ev.set(evKey(e), e)
  const newer = (inc.researchedOn ?? '') >= (cur.researchedOn ?? '')
  return { ...(newer ? inc : cur), routes: [...routes.values()], evidence: [...ev.values()], needsResearch: cur.needsResearch }
}

export interface ContactReport {
  merged: { kept: string; dropped: string }[]; v4Rows: number; matched: number; matchedByName: number; unmatchedV4: string[]; duplicateIds: string[]; duplicateRoutes: number; evidenceLinked: number; evidenceOrphans: string[]
  before: number; after: number; preservedWithoutResearch: number; warnings: string[]; changed: number
}
export function applyContactResearch(catalog: Catalog, r: ContactResearch): { catalog: Catalog; report: ContactReport } {
  const warnings = [...r.warnings]; const companies = catalog.companies.map((c) => ({ ...c }))
  const leadCount = new Map<string, number>(); for (const c of companies) if (c.leadId) leadCount.set(c.leadId.toLowerCase(), (leadCount.get(c.leadId.toLowerCase()) ?? 0) + 1)
  const byKey = new Map(companies.map((c) => [`${(c.city ?? '').toLowerCase()}|${normalizeOrgKey(c.name)}`, c]))
  const seen = new Set<string>(); const duplicateIds: string[] = []; const unmatched: string[] = []; const touched = new Set<string>()
  let matched = 0, byName = 0, evidenceLinked = 0, dupRoutes = 0, changed = 0
  const evBy = new Map<string, Record<string, string>[]>(); for (const e of r.evidence) { const k = clean(e.Atlas_ID); (evBy.get(k) ?? evBy.set(k, []).get(k)!).push(e) }
  const outBy = new Map(r.outreach.map((o) => [clean(o.Atlas_ID), o]))
  for (const row of r.master) {
    const id = clean(row.Atlas_ID); if (!id) { warnings.push('A master row has no Atlas_ID and was skipped.'); continue }
    if (seen.has(id)) { duplicateIds.push(id); continue } seen.add(id)
    let c = leadCount.get(id.toLowerCase()) === 1 ? companies.find((x) => x.leadId?.toLowerCase() === id.toLowerCase()) : undefined
    if (!c) { c = companies.find((x) => x.leadId?.toLowerCase() === id.toLowerCase() && normalizeOrgKey(x.name) === normalizeOrgKey(clean(row.Canonical_Organisation_Name))) }
    if (!c) { const nm = normalizeOrgKey(clean(row.Canonical_Organisation_Name).replace(/\s*\(.*$/, '')); c = companies.find((x) => normalizeOrgKey(x.name.replace(/\s*\(.*$/, '')) === nm && !touched.has(x.id)); if (c) byName++ }
    if (!c) { unmatched.push(`${id} ${clean(row.Canonical_Organisation_Name)}`); continue }
    touched.add(c.id); matched++
    const ev = evBy.get(id) ?? []; evidenceLinked += ev.length
    const inc = buildIntel(row, ev, outBy.get(id), r.sourceFile, warnings)
    const before = JSON.stringify(c.contactIntel); const merged = mergeIntel(c.contactIntel, inc)
    dupRoutes += inc.routes.length - new Set(inc.routes.map((x) => x.key)).size
    c.contactIntel = merged; if (JSON.stringify(merged) !== before) changed++
    const i = companies.findIndex((x) => x.id === c!.id); companies[i] = c
  }
  const rec = reconcileDuplicates({ ...catalog, companies })
  const orphans = [...evBy.keys()].filter((k) => !seen.has(k))
  return { catalog: rec.catalog, report: { merged: rec.merged, v4Rows: r.master.length, matched, matchedByName: byName, unmatchedV4: unmatched, duplicateIds, duplicateRoutes: dupRoutes, evidenceLinked, evidenceOrphans: orphans,
    before: catalog.companies.length, after: rec.catalog.companies.length, preservedWithoutResearch: rec.catalog.companies.filter((c) => !c.contactIntel).length, warnings, changed } }
}

/* ---------------------------------------------------------------- user overrides (always win, survive every re-import) */
export interface ContactOverrides { version: 1; confirmed: Record<string, { value: string; kind: RouteKind; tier: Tier; label: string; note: string | null; at: string }[]>; research: string[] }
export const emptyOverrides = (): ContactOverrides => ({ version: 1, confirmed: {}, research: [] })
export function readOverrides(file: string): ContactOverrides { try { const o = JSON.parse(fs.readFileSync(file, 'utf8')); return o?.version === 1 ? { ...emptyOverrides(), ...o } : emptyOverrides() } catch { return emptyOverrides() } }
export function writeOverrides(file: string, o: ContactOverrides) { fs.mkdirSync(path.dirname(file), { recursive: true }); const t = `${file}.tmp`; fs.writeFileSync(t, JSON.stringify(o, null, 1), { mode: 0o600 }); fs.renameSync(t, file) }
export function withOverrides(companies: CatalogCompany[], o: ContactOverrides): CatalogCompany[] {
  if (!Object.keys(o.confirmed).length && !o.research.length) return companies
  return companies.map((c) => {
    const conf = o.confirmed[c.id], need = o.research.includes(c.id); if (!conf?.length && !need) return c
    const intel: ContactIntel = c.contactIntel ? { ...c.contactIntel, routes: [...c.contactIntel.routes] } : { source: 'You', researchedOn: null, routes: [], evidence: [], nextStep: null, auditNote: null, reportedDepartment: null, openingVerified: false }
    for (const x of conf ?? []) { const k = key(x.kind, x.value); const i = intel.routes.findIndex((r) => r.key === k); const r: ContactRoute = { key: k, kind: x.kind, tier: x.tier, value: x.value, label: x.label, verification: 'USER_CONFIRMED', origin: 'USER', department: i >= 0 ? intel.routes[i].department : null, sourceUrl: i >= 0 ? intel.routes[i].sourceUrl : null, checkedOn: x.at.slice(0, 10), note: x.note }; if (i >= 0) intel.routes[i] = r; else intel.routes.push(r) }
    if (need) intel.needsResearch = true
    return { ...c, contactIntel: intel }
  })
}

/* ---------------------------------------------------------------- what the app shows and what the email may use */
export type ContactState = 'VERIFIED_EMAIL' | 'GENERAL_EMAIL' | 'PORTAL' | 'PENDING' | 'NONE'
export interface ContactSummary {
  state: ContactState; label: string; tone: 'ok' | 'info' | 'neutral' | 'warn' | 'bad'; best: ContactRoute | null; routes: ContactRoute[]; readiness: number
  historical: boolean; recipient: { route: ContactRoute; mode: 'VERIFIED' | 'GENERAL_FALLBACK' } | null; warnings: string[]; needsResearch: boolean; hasResearch: boolean
}
const usable = (r: ContactRoute) => r.verification !== 'INVALID' && r.verification !== 'CONFLICTING'
const isCurrent = (r: ContactRoute) => r.verification === 'CHECKED_CURRENT' || r.verification === 'USER_CONFIRMED'

/** All routes for a company: the research intel plus earlier research contacts that the intel does not already cover. */
export function routesOf(c: CatalogCompany): ContactRoute[] {
  const out = [...(c.contactIntel?.routes ?? [])]; const have = new Set(out.map((r) => r.key))
  const add = (kind: RouteKind, tier: Tier, value: string | null, label: string) => { if (!value) return; const k = key(kind, value); if (have.has(k)) return; have.add(k); out.push({ key: k, kind, tier, value, label, verification: 'EXISTING_UNVERIFIED', origin: 'EXISTING', department: null, sourceUrl: null, checkedOn: c.lastVerified, note: 'From the earlier research file. Not independently verified.' }) }
  const k = c.contacts
  add('EMAIL', 'E2', k.hrEmail, 'Public HR email in earlier research'); add('EMAIL', 'E4', k.generalEmail, 'General email in earlier research'); add('PORTAL', 'E3', k.careersUrl, 'Careers page in earlier research')
  if (k.phone) add('PHONE_FORM', 'E5', k.phone, 'Telephone in earlier research')
  return out
}

export function contactSummary(c: CatalogCompany): ContactSummary {
  const all = routesOf(c)
  // When the V4 research covers the employer its audited routes decide; earlier-research routes stay listed as alternatives only.
  const routes = c.contactIntel ? all.filter((r) => r.origin !== 'EXISTING') : all
  const emails = routes.filter((r) => r.kind === 'EMAIL' && usable(r))
  const verifiedEmail = emails.find((r) => (r.tier === 'E1' || r.tier === 'E2') && isCurrent(r))
  const general = emails.find((r) => r.tier === 'E4' && (r.verification === 'CHECKED_GENERAL' || r.verification === 'USER_CONFIRMED'))
  const portalChecked = routes.find((r) => r.kind === 'PORTAL' && r.tier === 'E3' && isCurrent(r))
  const historical = emails.find((r) => r.verification === 'CHECKED_HISTORICAL')
  const portal = routes.find((r) => r.kind === 'PORTAL' && r.tier === 'E3' && usable(r))
  const unverifiedEmail = emails.filter((r) => r.verification === 'GEMINI_UNVERIFIED' || r.verification === 'EXISTING_UNVERIFIED').sort((a, b) => (a.tier === 'E2' ? 0 : 1) - (b.tier === 'E2' ? 0 : 1))[0]
  const phone = routes.find((r) => r.kind === 'PHONE_FORM' && usable(r)); const page = routes.find((r) => r.kind === 'PORTAL' && usable(r))
  const need = !!c.contactIntel?.needsResearch; const warnings: string[] = []
  let state: ContactState, best: ContactRoute | null, label: string, tone: ContactSummary['tone'], readiness: number, recipient: ContactSummary['recipient'] = null, hist = false
  if (verifiedEmail) { state = 'VERIFIED_EMAIL'; best = verifiedEmail; label = verifiedEmail.tier === 'E1' ? 'Internship Contact' : 'HR / Recruitment'; tone = 'ok'; readiness = 5; recipient = { route: verifiedEmail, mode: 'VERIFIED' } }
  else if (general) { state = 'GENERAL_EMAIL'; best = general; label = 'General Email'; tone = 'info'; readiness = 4; recipient = { route: general, mode: 'GENERAL_FALLBACK' }; warnings.push('This is a general address, not HR. Ask them to forward your enquiry to HR or industrial training.') }
  else if (portalChecked) { state = 'PORTAL'; best = portalChecked; label = 'Careers Portal'; tone = 'info'; readiness = 3.5 }
  else if (historical) { state = 'PENDING'; best = historical; label = 'HR email · historical'; tone = 'warn'; readiness = 2.5; hist = true; warnings.push('This address was used in an earlier internship notice. Reconfirm it before you rely on it.') }
  else if (portal) { state = 'PORTAL'; best = portal; label = 'Careers Portal'; tone = 'neutral'; readiness = 3; warnings.push('The portal is reported by research and has not been inspected.') }
  else if (unverifiedEmail) { state = 'PENDING'; best = unverifiedEmail; label = 'Needs Verification'; tone = 'warn'; readiness = 2; warnings.push('This address is reported by research and not verified. It may not reach the internship coordinator.') }
  else if (phone || page) { state = 'PENDING'; best = (phone ?? page)!; label = 'Needs Verification'; tone = 'warn'; readiness = 1.5 }
  else { state = 'NONE'; best = null; label = 'No Contact Found'; tone = 'bad'; readiness = 0 }
  return { state, label, tone, best, routes: all, readiness, historical: hist, recipient, warnings, needsResearch: need, hasResearch: !!c.contactIntel }
}

/** Recipient choices for the email panel. Unverified addresses are choosable but carry a warning; none is ever filled in silently. */
export function recipientChoices(c: CatalogCompany) {
  return routesOf(c).filter((r) => r.kind === 'EMAIL').map((r) => ({ key: r.key, email: r.value, label: r.label, tier: r.tier, verification: r.verification, department: r.department,
    warning: r.verification === 'USER_CONFIRMED' || r.verification === 'CHECKED_CURRENT' ? (r.tier === 'E4' ? 'General address, not HR.' : null) : r.verification === 'CHECKED_GENERAL' ? 'General address, not HR. Ask them to forward your enquiry.' : r.verification === 'CHECKED_HISTORICAL' ? 'Historical address. Reconfirm before use.' : r.verification === 'CONFLICTING' ? 'Conflicting information. Not corroborated by the official source.' : r.verification === 'INVALID' ? 'Not for internship applications.' : 'Not verified. It may not reach the internship coordinator.' }))
}

/* ---------------------------------------------------------------- employers the V4 research does not cover */
export function missingEmployers(catalog: Catalog): CatalogCompany[] { return catalog.companies.filter((c) => !c.contactIntel) }
export const missingFileName = (n: number) => `CAREER_HUB_MISSING_${n}_CONTACT_RESEARCH.csv`
export function missingCsv(list: CatalogCompany[]): string {
  const head = ['Career_Hub_Employer_ID', 'Employer_Name', 'Geographic_Location', 'Employer_Type', 'Existing_Website', 'Existing_Contact', 'Available_Contact_Research', 'Contact_Verification_State', 'Research_Notes', 'Recommended_Next_Action']
  const rows = list.map((c) => {
    const s = contactSummary(c); const k = c.contacts
    const existing = [k.hrEmail && `HR email: ${k.hrEmail}`, k.generalEmail && `General email: ${k.generalEmail}`, k.phone && `Phone: ${k.phone}`, k.careersUrl && `Careers: ${k.careersUrl}`, k.contactForm && `Form: ${k.contactForm}`].filter(Boolean).join(' | ')
    return [c.id, c.name, c.city ?? '', c.categoryLabel ?? (c.sector === 'GOVERNMENT' ? 'Government' : c.sector === 'NON_GOVERNMENT' ? 'Non-government' : ''), c.website ?? '', existing, c.contactIntel ? 'V4 research' : 'None in the V4 files', s.hasResearch ? VERIFICATION_LABEL[s.best?.verification ?? 'GEMINI_UNVERIFIED'] : existing ? 'Earlier research, not verified' : 'No contact found',
      [c.priorLead ? 'Earlier lead not in the latest Atlas list.' : '', ...c.uncertainties.slice(0, 2)].filter(Boolean).join(' '), 'Find the official careers or internship contact, the department responsible, and a source URL. Do not guess addresses from the company domain.']
  })
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
}
