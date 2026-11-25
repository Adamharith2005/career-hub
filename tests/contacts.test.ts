import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyContactResearch, asEmail, asUrl, buildIntel, contactSummary, csvCell, findContactFiles, missingCsv, missingEmployers, parseCsv, readContactResearch, recipientChoices, withOverrides, emptyOverrides } from '../core/viewer/contacts.ts'
import { draftEmail } from '../core/viewer/email.ts'
import { createViewerApi } from '../core/viewer/api.ts'
import { reconcileDuplicates, type Catalog, type CatalogCompany } from '../core/viewer/catalog.ts'

const MASTER_COLS = ['Atlas_ID', 'Canonical_Organisation_Name', 'Official_Contact', 'Gemini_Reported_Contact_Tier', 'Gemini_Reported_Contact_Email', 'Gemini_Reported_Contact_URL', 'Gemini_Reported_Target_Department', 'Gemini_Reported_Next_Step', 'Audited_Contact_Tier', 'Preferred_Outreach_Email', 'Confirmed_Contact_Type', 'Audited_Application_URL', 'Independent_Verification_Status', 'Independent_Source_URL', 'Independently_Checked_2026_11_26', 'Gemini_Email_Requires_Check', 'Recommended_Next_Step', 'Contact_Audit_Notes', 'Current_Internship_Opening_Independently_Verified']
const EV_COLS = ['Atlas_ID', 'Organisation_Name', 'Evidence_Origin', 'Contact_Tier_Claimed', 'Contact_Tier_Audited', 'Email_Claimed', 'Email_Independent', 'Contact_Method_Claimed', 'Source_URL', 'Source_Actually_Inspected', 'Evidence_Purpose', 'Evidence_Note', 'Research_Date']
const OUT_COLS = ['Atlas_ID', 'Company', 'Location', 'Employer_Type', 'Best_Contact_Department', 'Best_Independently_Checked_Email', 'Email_Type', 'Gemini_Reported_Email_For_Review', 'Audited_Tier', 'Research_Contact_URL', 'Independent_Verification_Status', 'Recommended_Next_Step', 'Internship_Opening_Independently_Verified']
const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const csv = (cols: string[], rows: Record<string, string>[]) => '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c] ?? '')).join(','))].join('\r\n') + '\r\n'
const NO = 'No - not independently checked', GEM = 'Gemini-reported only - independent verification pending'
const m = (o: Record<string, string>) => ({ Current_Internship_Opening_Independently_Verified: NO, Independent_Verification_Status: GEM, Independently_Checked_2026_11_26: 'No', Gemini_Email_Requires_Check: 'No', ...o })
const MASTER = [
  m({ Atlas_ID: 'FX-A', Canonical_Organisation_Name: 'Fixture Alpha', Gemini_Reported_Contact_Tier: 'E2', Gemini_Reported_Contact_Email: 'jobs@alpha.example', Audited_Contact_Tier: 'E2', Preferred_Outreach_Email: 'jobs@alpha.example', Confirmed_Contact_Type: 'Official employer careers email', Audited_Application_URL: 'https://alpha.example/careers', Independent_Verification_Status: 'Verified official career route', Independent_Source_URL: 'https://alpha.example/careers', Independently_Checked_2026_11_26: 'Yes', Gemini_Reported_Target_Department: 'People & Talent', Contact_Audit_Notes: 'Careers page invites resumes.' }),
  m({ Atlas_ID: 'FX-B', Canonical_Organisation_Name: 'Fixture Beta Agency', Gemini_Reported_Contact_Tier: 'E2', Gemini_Reported_Contact_Email: 'hr@beta.example', Audited_Contact_Tier: 'E4', Preferred_Outreach_Email: 'corpcom@beta.example', Confirmed_Contact_Type: 'Official general corporate communications fallback (NOT HR)', Audited_Application_URL: 'https://beta.example/contact', Independent_Verification_Status: 'Verified general contact, not HR', Independent_Source_URL: 'https://beta.example/contact', Independently_Checked_2026_11_26: 'Yes', Contact_Audit_Notes: 'hr@ not corroborated.' }),
  m({ Atlas_ID: 'FX-C', Canonical_Organisation_Name: 'Fixture Gamma', Gemini_Reported_Contact_Tier: 'E3', Audited_Contact_Tier: 'E3', Confirmed_Contact_Type: 'Gemini-claimed careers / application page', Audited_Application_URL: '[https://careers.gamma.example/jobs](https://careers.gamma.example/jobs)' }),
  m({ Atlas_ID: 'FX-D', Canonical_Organisation_Name: 'Fixture Delta', Gemini_Reported_Contact_Tier: 'E2', Gemini_Reported_Contact_Email: 'career@delta.example', Audited_Contact_Tier: 'E2', Preferred_Outreach_Email: 'career@delta.example', Confirmed_Contact_Type: 'Historical dedicated internship application email', Independent_Verification_Status: 'Historically documented - reconfirm before use', Independently_Checked_2026_11_26: 'Yes', Independent_Source_URL: 'https://uni.example/notice' }),
  m({ Atlas_ID: 'FX-E', Canonical_Organisation_Name: 'Fixture Epsilon', Gemini_Reported_Contact_Tier: 'E4', Gemini_Reported_Contact_Email: 'info@epsilon.example', Audited_Contact_Tier: 'E4', Confirmed_Contact_Type: 'Gemini-claimed general contact - NOT recruiter inbox', Audited_Application_URL: 'https://epsilon.example', Gemini_Email_Requires_Check: 'Yes' }),
  m({ Atlas_ID: 'FX-F', Canonical_Organisation_Name: 'Fixture Zeta', Gemini_Reported_Contact_Tier: 'E6', Audited_Contact_Tier: 'E6', Confirmed_Contact_Type: 'Unverified organisation/contact', Gemini_Reported_Target_Department: 'Unverified' }),
  m({ Atlas_ID: 'FX-G', Canonical_Organisation_Name: 'Fixture Eta', Gemini_Reported_Contact_Tier: 'E5', Audited_Contact_Tier: 'E5', Official_Contact: '+60 3-8000 0000', Gemini_Reported_Contact_URL: 'https://eta.example/enquiry', Confirmed_Contact_Type: 'Gemini-claimed phone or enquiry form' }),
  m({ Atlas_ID: 'FX-H', Canonical_Organisation_Name: 'Fixture Theta', Gemini_Reported_Contact_Tier: 'E2', Gemini_Reported_Contact_Email: 'career@theta.example', Audited_Contact_Tier: 'E3', Confirmed_Contact_Type: 'Official careers page; claimed email unverified', Audited_Application_URL: 'https://theta.example/careers', Independent_Verification_Status: 'Portal verified, claimed email unverified', Independently_Checked_2026_11_26: 'Yes', Contact_Audit_Notes: '=HYPERLINK("http://evil.example","x") email not found on the careers page' }),
  m({ Atlas_ID: 'FX-I', Canonical_Organisation_Name: 'Fixture Iota', Gemini_Reported_Contact_Tier: 'E4', Gemini_Reported_Contact_Email: 'not an address', Audited_Contact_Tier: 'E3', Audited_Application_URL: 'javascript:alert(1)' }),
]
const EVID: Record<string, string>[] = [
  { Atlas_ID: 'FX-A', Organisation_Name: 'Fixture Alpha', Evidence_Origin: 'Independent public-source spot check', Contact_Tier_Claimed: 'E2', Contact_Tier_Audited: 'E2', Email_Claimed: 'jobs@alpha.example', Email_Independent: 'jobs@alpha.example', Source_URL: 'https://alpha.example/careers', Source_Actually_Inspected: 'Yes', Evidence_Purpose: 'Official employer careers email', Evidence_Note: 'Invites speculative resumes.', Research_Date: '2026-11-26' },
  { Atlas_ID: 'FX-A', Organisation_Name: 'Fixture Alpha', Evidence_Origin: 'Gemini pasted research report', Contact_Tier_Claimed: 'E2', Contact_Tier_Audited: 'E2', Email_Claimed: 'jobs@alpha.example', Source_URL: 'https://alpha.example', Source_Actually_Inspected: 'No', Evidence_Purpose: 'Not independently verified', Evidence_Note: 'Reported.', Research_Date: '2026-11-26' },
  { Atlas_ID: 'FX-C', Organisation_Name: 'Fixture Gamma', Evidence_Origin: 'Gemini pasted research report', Contact_Tier_Claimed: 'E3', Contact_Tier_Audited: 'E3', Source_URL: 'https://careers.gamma.example', Source_Actually_Inspected: 'No', Evidence_Purpose: 'Not independently verified', Evidence_Note: 'Apply via portal.', Research_Date: '2026-11-26' },
]
const OUTREACH = [{ Atlas_ID: 'FX-A', Company: 'Fixture Alpha', Audited_Tier: 'E2', Email_Type: 'Verified', Best_Independently_Checked_Email: 'jobs@alpha.example' }]

const co = (id: string, leadId: string | null, name: string, over: Partial<CatalogCompany> = {}): CatalogCompany => ({ id, leadId, name, legalEntity: null, city: 'Cyberjaya', sector: 'NON_GOVERNMENT', classes: [], categoryLabel: null, industry: null, size: null, website: null, offices: [], tech: ['SOFTWARE'], relevance: null, roles: [], techDivision: null,
  internship: { evidence: 'REPORTED_PROGRAMME', sourceLabel: null, auditNote: null, docs: null, deadline: null, deadlineVerified: false, method: null, applicationUrl: null }, allowance: { grade: 'A5', status: 'UNKNOWN', monthlyMin: null, monthlyMax: null, claimText: null, policyRef: false, conditions: null, benefits: null, sourceUrl: null, sourceDate: null, note: '' },
  contacts: { hrEmail: null, generalEmail: null, phone: null, careersUrl: null, contactForm: null, linkedin: null }, sources: [], lastVerified: null, uncertainties: [], notes: null, nextAction: null, verificationLevel: 'VERIFIED', ...over })
const catalog = (): Catalog => ({ version: 1, generatedAt: '', sourceFile: 't', sourceSha256: null, companies: [
  ...['A:Fixture Alpha', 'B:Fixture Beta Agency', 'C:Fixture Gamma', 'D:Fixture Delta', 'E:Fixture Epsilon', 'F:Fixture Zeta', 'G:Fixture Eta', 'H:Fixture Theta', 'I:Fixture Iota'].map((x) => { const [k, n] = x.split(':'); return co(`fx-${k.toLowerCase()}`, `FX-${k}`, n) }),
  co('old-1', null, 'Fixture Unmatched Old', { contacts: { hrEmail: 'hr@old.example', generalEmail: null, phone: null, careersUrl: null, contactForm: null, linkedin: null }, priorLead: true }), co('old-2', null, 'Fixture Unmatched Bare')] })
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'contacts-'))
const writeResearch = (dir: string) => { fs.writeFileSync(path.join(dir, 'CAREER_HUB_EMPLOYER_ATLAS_V4_HR_CONTACTS.csv'), csv(MASTER_COLS, MASTER)); fs.writeFileSync(path.join(dir, 'CAREER_HUB_INTERNSHIP_CONTACT_EVIDENCE.csv'), csv(EV_COLS, EVID)); fs.writeFileSync(path.join(dir, 'CAREER_HUB_INTERNSHIP_OUTREACH_READY.csv'), csv(OUT_COLS, OUTREACH)) }
const imported = async () => { const d = tmp(); writeResearch(d); const r = await readContactResearch(d); return { r, ...applyContactResearch(catalog(), r) } }
const by = (cat: Catalog, id: string) => cat.companies.find((c) => c.id === id)!

describe('safe parsing', () => {
  it('reads quoted commas, quotes, newlines and a BOM; cleans control characters', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","line1\nline2 ""q"""\r\nz\u0007,\r\n'); expect(rows[0]).toEqual({ a: 'x, y', b: 'line1\nline2 "q"' }); expect(rows[1].a).toBe('z')
  })
  it('accepts only real emails and http(s) links; unwraps markdown links', () => {
    expect(asEmail('Jobs@Alpha.Example')).toBe('jobs@alpha.example'); expect(asEmail('mailto:a@b.co')).toBe('a@b.co'); expect(asEmail('not an address')).toBeNull(); expect(asEmail('a@b')).toBeNull()
    expect(asUrl('[https://x.example/a](https://x.example/a)')).toBe('https://x.example/a'); expect(asUrl('javascript:alert(1)')).toBeNull(); expect(asUrl('file:///etc/passwd')).toBeNull(); expect(asUrl('www.x.example')).toBe('https://www.x.example/')
  })
  it('neutralises spreadsheet formulas on export and never evaluates imported text', () => { expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`); expect(csvCell('+1 2')).toBe("'+1 2"); expect(csvCell('plain')).toBe('plain') })
  it('chooses the right file by schema when copies exist', () => {
    const d = tmp(); writeResearch(d); fs.writeFileSync(path.join(d, 'CAREER_HUB_EMPLOYER_ATLAS_V4_HR_CONTACTS (1).csv'), 'Atlas_ID,Name\nX,old\n')
    const f = findContactFiles(d); expect(path.basename(f.master!)).toBe('CAREER_HUB_EMPLOYER_ATLAS_V4_HR_CONTACTS.csv'); expect(f.notes.join(' ')).toMatch(/2 candidates/); expect(f.workbook).toBeNull()
  })
  it('reports a missing file instead of failing', async () => { const d = tmp(); fs.writeFileSync(path.join(d, 'CAREER_HUB_INTERNSHIP_CONTACT_EVIDENCE.csv'), csv(EV_COLS, EVID)); const r = await readContactResearch(d); expect(r.master).toHaveLength(0); expect(r.warnings.join(' ')).toMatch(/Missing file: CAREER_HUB_EMPLOYER_ATLAS_V4_HR_CONTACTS\.csv/) })
})

describe('import into the catalogue', () => {
  it('matches by Atlas ID, preserves every employer and links the evidence', async () => {
    const { catalog: c, report } = await imported()
    expect(report).toMatchObject({ v4Rows: 9, matched: 9, matchedByName: 0, before: 11, after: 11, preservedWithoutResearch: 2, evidenceLinked: 3, duplicateIds: [], unmatchedV4: [] })
    expect(c.companies.map((x) => x.id)).toEqual(catalog().companies.map((x) => x.id)); expect(by(c, 'fx-a').contactIntel!.evidence).toHaveLength(2); expect(by(c, 'old-1').contactIntel).toBeUndefined()
    expect(by(c, 'old-1').contacts.hrEmail).toBe('hr@old.example')
  })
  it('is idempotent: a second import changes nothing and creates no duplicates', async () => {
    const { r, catalog: once } = await imported(); const twice = applyContactResearch(once, r); expect(twice.report.changed).toBe(0); expect(JSON.stringify(twice.catalog)).toBe(JSON.stringify(once)); expect(twice.catalog.companies).toHaveLength(11)
    expect(by(twice.catalog, 'fx-a').contactIntel!.routes.map((x) => x.key)).toEqual([...new Set(by(once, 'fx-a').contactIntel!.routes.map((x) => x.key))])
  })
  it('reports duplicate input rows and unmatched research rows', async () => {
    const d = tmp(); writeResearch(d); const r = await readContactResearch(d); r.master.push({ ...r.master[0] }, { ...r.master[0], Atlas_ID: 'FX-Z', Canonical_Organisation_Name: 'Nobody Ltd' })
    const { report } = applyContactResearch(catalog(), r); expect(report.duplicateIds).toEqual(['FX-A']); expect(report.unmatchedV4).toEqual(['FX-Z Nobody Ltd']); expect(report.after).toBe(11)
  })
  it('never downgrades stronger evidence and keeps older independent evidence with its date', async () => {
    const { r, catalog: once } = await imported(); const weaker = JSON.parse(JSON.stringify(r)); weaker.master[0].Independent_Verification_Status = GEM; weaker.master[0].Independently_Checked_2026_11_26 = 'No'
    const again = applyContactResearch(once, weaker); const route = by(again.catalog, 'fx-a').contactIntel!.routes.find((x) => x.value === 'jobs@alpha.example')!; expect(route.verification).toBe('CHECKED_CURRENT'); expect(route.checkedOn).toBe('2026-11-26')
  })
  it('does not let a company-list update or a re-import remove contact research or user confirmations', async () => {
    const { catalog: c } = await imported(); const ov = emptyOverrides(); ov.confirmed['fx-e'] = [{ value: 'info@epsilon.example', kind: 'EMAIL', tier: 'E4', label: 'General', note: null, at: '2026-11-27T00:00:00Z' }]; ov.research.push('fx-f')
    const shown = withOverrides(c.companies, ov); expect(contactSummary(shown.find((x) => x.id === 'fx-e')!).state).toBe('GENERAL_EMAIL'); expect(contactSummary(shown.find((x) => x.id === 'fx-f')!).needsResearch).toBe(true)
    expect(contactSummary(by(c, 'fx-e')).state).toBe('PENDING')   // the stored list itself is untouched
  })
  it('ignores invalid addresses and unsafe links and preserves the original wording in evidence', async () => {
    const { catalog: c, report } = await imported(); const iota = by(c, 'fx-i').contactIntel!; expect(iota.routes).toHaveLength(0); expect(report.warnings.join(' ')).toMatch(/FX-I: Gemini email is not a valid address/)
    expect(by(c, 'fx-a').contactIntel!.evidence.map((e) => e.origin)).toContain('Gemini pasted research report'); expect(by(c, 'fx-a').contactIntel!.source).toBe('CAREER_HUB_EMPLOYER_ATLAS_V4_HR_CONTACTS.csv')
  })
})

describe('contact classification', () => {
  let cat: Catalog; beforeEach(async () => { cat = (await imported()).catalog })
  const S = (id: string) => contactSummary(by(cat, id))
  it('dedicated or official recruitment email, checked: verified recruitment email', () => { const s = S('fx-a'); expect(s).toMatchObject({ state: 'VERIFIED_EMAIL', label: 'HR / Recruitment' }); expect(s.best).toMatchObject({ value: 'jobs@alpha.example', tier: 'E2', verification: 'CHECKED_CURRENT', department: 'People & Talent' }); expect(s.recipient!.mode).toBe('VERIFIED') })
  it('a general address is never HR, and a Gemini-only HR claim beside it is marked conflicting', () => {
    const s = S('fx-b'); expect(s).toMatchObject({ state: 'GENERAL_EMAIL', label: 'General Email' }); expect(s.best!.tier).toBe('E4'); expect(s.recipient!.mode).toBe('GENERAL_FALLBACK'); expect(s.warnings.join(' ')).toMatch(/not HR/)
    expect(s.routes.find((r) => r.value === 'hr@beta.example')!.verification).toBe('CONFLICTING')
  })
  it('a portal is never treated as an email', () => { const s = S('fx-c'); expect(s.state).toBe('PORTAL'); expect(s.best).toMatchObject({ kind: 'PORTAL', value: 'https://careers.gamma.example/jobs', verification: 'GEMINI_UNVERIFIED' }); expect(s.recipient).toBeNull(); expect(s.routes.some((r) => r.kind === 'EMAIL')).toBe(false) })
  it('a historical address stays historical and is not offered as verified or filled in', () => { const s = S('fx-d'); expect(s).toMatchObject({ state: 'PENDING', historical: true, label: 'HR email · historical' }); expect(s.best!.verification).toBe('CHECKED_HISTORICAL'); expect(s.recipient).toBeNull(); expect(s.warnings.join(' ')).toMatch(/Reconfirm/) })
  it('Gemini-only emails remain unverified', () => { const s = S('fx-e'); expect(s).toMatchObject({ state: 'PENDING', label: 'Needs Verification' }); expect(s.best!.verification).toBe('GEMINI_UNVERIFIED'); expect(s.recipient).toBeNull() })
  it('missing contacts are reported honestly', () => { expect(S('fx-f')).toMatchObject({ state: 'NONE', label: 'No Contact Found', best: null }); expect(S('old-2').state).toBe('NONE') })
  it('phone and form routes are not emails', () => { const s = S('fx-g'); expect(s.state).toBe('PENDING'); expect(s.best!.kind).toBe('PHONE_FORM'); expect(s.recipient).toBeNull() })
  it('a verified portal with a claimed email that was not found keeps the portal and flags the email', () => { const s = S('fx-h'); expect(s.state).toBe('PORTAL'); expect(s.best!.verification).toBe('CHECKED_CURRENT'); expect(s.routes.find((r) => r.kind === 'EMAIL')!.verification).toBe('CONFLICTING'); expect(s.recipient).toBeNull() })
  it('earlier-research contacts stay as alternatives and never become the best route of an employer the research covers', () => {
    const c = by(cat, 'fx-e'); const withLegacy = { ...c, contacts: { ...c.contacts, hrEmail: 'old-hr@epsilon.example', careersUrl: 'https://epsilon.example/jobs' } }; const s = contactSummary(withLegacy)
    expect(s.best!.value).toBe('info@epsilon.example'); expect(s.routes.some((r) => r.value === 'old-hr@epsilon.example' && r.verification === 'EXISTING_UNVERIFIED')).toBe(true); expect(contactSummary(by(cat, 'old-1')).state).toBe('PENDING')
  })
  it('contact readiness is separate from suitability: it is not part of the score', async () => {
    const { suitability } = await import('../core/viewer/suitability.ts'); const st = { id: 's', specialisation: 'Information Systems', degree: '', education: [], skills: [{ group: 'x', items: ['React', 'TypeScript'] }], projects: [], interests: [] }
    expect(suitability(st as any, by(cat, 'fx-a')).score).toBe(suitability(st as any, { ...by(cat, 'fx-a'), contactIntel: undefined }).score)
  })
})

describe('email recipient selection', () => {
  const ADAM: any = { id: 'adam', displayName: 'One', fullName: 'Test Student One', specialisation: 'Data Science', university: 'Test University', degree: 'Bachelor of Computer Science (Data Science)', contact: { email: 'one@example.com', phone: '+60 11-111 1111', location: '' }, links: [], skills: [{ group: 'D', items: ['Python', 'SQL'] }], projects: [], education: [{ title: 'BCS', institution: 'x', dates: '', points: ['CGPA: 3.60'] }], leadership: [{ title: 'Head of Sponsorship', organisation: 'Fixture Fest', date: '2026', points: [] }], interests: [], documents: [], reviewNotes: [] }
  let cat: Catalog; beforeEach(async () => { cat = (await imported()).catalog })
  const D = (id: string, o: any = {}) => draftEmail(ADAM, by(cat, id), { role: 'DATA_ANALYTICS', ...o })
  it('fills in a verified recruitment address, labelled with its check date', () => { const d = D('fx-a'); expect(d.to).toBe('jobs@alpha.example'); expect(d.toMode).toBe('VERIFIED'); expect(d.toNote).toMatch(/Independently checked on 2026-11-26/); expect(d.toWarning).toBeNull() })
  it('uses an official general address only as a clearly labelled fallback', () => { const d = D('fx-b'); expect(d.to).toBe('corpcom@beta.example'); expect(d.toMode).toBe('GENERAL_FALLBACK'); expect(d.toWarning).toMatch(/not HR/) })
  it('leaves the recipient empty for portal-only, historical, unverified and missing contacts, and offers the portal', () => {
    for (const id of ['fx-c', 'fx-d', 'fx-e', 'fx-f', 'fx-h']) { const d = D(id); expect(d.to, id).toBeNull(); expect(d.toMode, id).toBe('NONE') }
    expect(D('fx-c').portal).toMatchObject({ url: 'https://careers.gamma.example/jobs', verified: false }); expect(D('fx-h').portal!.verified).toBe(true); expect(D('fx-f').portal).toBeNull()
  })
  it('lets the user choose another researched address, with a warning for unverified ones', () => {
    const e = D('fx-e'); expect(e.recipients.map((r) => r.email)).toEqual(['info@epsilon.example']); const pick = D('fx-e', { recipientKey: e.recipients[0].key }); expect(pick.to).toBe('info@epsilon.example'); expect(pick.toMode).toBe('MANUAL'); expect(pick.toWarning).toMatch(/not verified/i)
    const h = recipientChoices(by(cat, 'fx-d'))[0]; expect(D('fx-d', { recipientKey: h.key }).toWarning).toMatch(/Historical/); expect(D('fx-e', { recipientKey: 'EMAIL:nobody@nowhere.example' }).to).toBeNull()
  })
  it('never invents an address from a company domain', () => { for (const c of cat.companies) { const d = draftEmail(ADAM, c, { role: 'DATA_ANALYTICS' }); const known = new Set(recipientChoices(c).map((r) => r.email)); if (d.to) expect(known.has(d.to)).toBe(true) } })
  it('keeps the enquiry wording: a recruitment address is not a vacancy', () => { const d = D('fx-a'); expect(d.speculative).toBe(true); expect(d.body).toContain('I am writing to enquire about potential internship opportunities'); expect(d.body).not.toMatch(/apply for the/i); expect(d.subject).toMatch(/^Internship Enquiry — /) })
  it('keeps each student\'s template: Adam keeps his leadership paragraph, Akif does not', () => {
    const akif = { ...ADAM, id: 'akif', fullName: 'Test Student Two', contact: { email: 'two@example.com', phone: '+60 12-222 2222', location: '' }, emailOptions: { leadership: false } }
    expect(D('fx-a').body).toMatch(/Outside the classroom, leading sponsorship for Fixture Fest/); const k = draftEmail(akif, by(cat, 'fx-a'), { role: 'DATA_ANALYTICS' }); expect(k.to).toBe(D('fx-a').to); expect(k.body).not.toMatch(/Outside the classroom|sponsorship/i); expect(k.body).toContain('+60 12-222 2222 | two@example.com'); expect(k.body).not.toContain('Test Student One')
  })
})

describe('missing employer export', () => {
  it('lists employers without research, keeps them honest and neutralises formulas', async () => {
    const { catalog: c } = await imported(); const bad = { ...by(c, 'old-2'), name: '=SUM(A1)', website: 'https://old.example' }; const list = missingEmployers({ ...c, companies: [by(c, 'old-1'), bad] }); expect(list).toHaveLength(2)
    const out = missingCsv(list); const rows = parseCsv(out); expect(rows[0]).toMatchObject({ Career_Hub_Employer_ID: 'old-1', Employer_Name: 'Fixture Unmatched Old', Contact_Verification_State: 'Earlier research, not verified' }); expect(rows[0].Existing_Contact).toContain('hr@old.example')
    expect(rows[1].Employer_Name).toBe("'=SUM(A1)"); expect(rows[1].Contact_Verification_State).toBe('No contact found'); expect(rows[1].Recommended_Next_Action).toMatch(/Do not guess/)
  })
})

describe('API: filters, evidence, confirmation, import and restart', () => {
  let dir: string, res: string, exp: string, ext: string[]
  const mk = () => createViewerApi({ userDataDir: path.join(dir, 'ud'), bundledCatalog: path.join(dir, 'cat.json'), seedPaths: [path.join(dir, 'seed.json')], researchDir: res, exportsDir: exp, ui: { pickFile: async () => null, openPath: async () => '', openExternal: (u: string) => { ext.push(u) }, copy: () => {} } })
  beforeEach(() => {
    dir = tmp(); res = path.join(dir, 'dl'); exp = path.join(dir, 'exports'); ext = []; fs.mkdirSync(res); writeResearch(res)
    fs.writeFileSync(path.join(dir, 'cat.json'), JSON.stringify(catalog())); fs.writeFileSync(path.join(dir, 'seed.json'), JSON.stringify({ version: 1, profiles: [] }))
  })
  it('imports from the research folder, exports the missing list, filters and sorts by readiness, and survives a restart', async () => {
    let api = mk(); const rep: any = await api.call('v.contacts.import'); expect(rep).toMatchObject({ matched: 9, after: 11, preservedWithoutResearch: 2 }); expect(fs.existsSync(path.join(exp, 'CAREER_HUB_MISSING_2_CONTACT_RESEARCH.csv'))).toBe(true)
    const list = async (f: any = {}) => (await api.call('v.companies.list', f)) as any[]
    expect((await list({ contact: 'VERIFIED_EMAIL' })).map((x) => x.id)).toEqual(['fx-a']); expect((await list({ contact: 'GENERAL_EMAIL' })).map((x) => x.id)).toEqual(['fx-b']); expect((await list({ contact: 'PORTAL' })).map((x) => x.id).sort()).toEqual(['fx-c', 'fx-h'])
    expect((await list({ contact: 'NONE' })).map((x) => x.id).sort()).toEqual(['fx-f', 'fx-i', 'old-2']); expect((await list({})).length).toBe(11); expect((await list({ sort: 'contact' }))[0].id).toBe('fx-a')
    const meta: any = await api.call('v.catalog.meta'); expect(meta.facets.contact).toMatchObject({ VERIFIED_EMAIL: 1, GENERAL_EMAIL: 1, NONE: 3 })
    api = mk(); const g: any = await api.call('v.companies.get', { id: 'fx-a' }); expect(g.contactSummary.best.value).toBe('jobs@alpha.example'); expect(g.contactIntel.evidence).toHaveLength(2); expect(g.recipientChoices[0].email).toBe('jobs@alpha.example')
    expect(((await api.call('v.companies.list', {})) as any[]).find((x) => x.id === 'fx-e').contact).toMatchObject({ state: 'PENDING', label: 'Needs Verification' })
  })
  it('keeps a user confirmation and a research flag through restart and re-import; the copy text labels every route', async () => {
    let api = mk(); await api.call('v.contacts.import'); const e: any = await api.call('v.companies.get', { id: 'fx-e' })
    const after: any = await api.call('v.contacts.confirm', { companyId: 'fx-e', key: e.contactSummary.best.key }); expect(after.contactSummary.state).toBe('GENERAL_EMAIL'); expect(after.contactSummary.best.verification).toBe('USER_CONFIRMED')
    await api.call('v.contacts.research', { companyId: 'fx-f', on: true })
    api = mk(); await api.call('v.contacts.import'); const again: any = await api.call('v.companies.get', { id: 'fx-e' }); expect(again.contactSummary.best.verification).toBe('USER_CONFIRMED'); expect(((await api.call('v.companies.list', {})) as any[]).find((x) => x.id === 'fx-f').contact.needsResearch).toBe(true)
    const t = (await api.call('v.copy.contact', { id: 'fx-a' })) as string; expect(t).toContain('Recruitment email: jobs@alpha.example (Independently checked, current)'); expect(t).not.toContain('undefined')
    const off: any = await api.call('v.contacts.confirm', { companyId: 'fx-e', key: again.contactSummary.best.key, on: false }); expect(off.contactSummary.state).toBe('PENDING')
  })
  it('refuses to import when the files are not in the configured folder', async () => { fs.rmSync(res, { recursive: true }); fs.mkdirSync(res); await expect(mk().call('v.contacts.import')).rejects.toThrow(/not found/) })
})

describe('duplicate reconciliation', () => {
  const dupA = () => co('cy-1', 'CY-1', 'Fixture Shared Services', { city: 'Cyberjaya', legalEntity: 'Fixture Shared Services Sdn Bhd / Fixture Group', website: 'https://www.fixture.example/', offices: [{ address: 'Cyber 12, Cyberjaya', status: 'UNVERIFIED', note: null }], roles: ['BI Intern'], contacts: { hrEmail: null, generalEmail: null, phone: null, careersUrl: 'https://fixture.example/old-careers', contactForm: 'form', linkedin: 'https://linkedin.com/company/fixture' } })
  const dupB = () => co('cj-1', 'CJ-1', 'Fixture Shared Services', { city: 'IOI Resort City', legalEntity: 'Fixture Shared Services Sdn Bhd / Fixture Group', website: 'https://www.fixture.example', offices: [{ address: 'IOI City Tower 1', status: 'VERIFIED', note: null }], roles: ['Data Intern'], lastVerified: '2026-11-19' })
  it('folds one organisation recorded twice into the better-evidenced record and keeps every identifier, office, role and source', () => {
    const base: Catalog = { ...catalog(), companies: [dupA(), dupB(), co('other', 'O-1', 'Fixture Other')] }
    const { catalog: c, merged } = reconcileDuplicates(base); expect(merged).toEqual([{ kept: 'cj-1', dropped: 'cy-1' }]); expect(c.companies.map((x) => x.id)).toEqual(['cj-1', 'other'])
    const k = c.companies[0]; expect(k.city).toBe('IOI Resort City'); expect(k.offices.map((o) => o.address)).toEqual(['IOI City Tower 1', 'Cyber 12, Cyberjaya']); expect(k.roles).toEqual(['Data Intern', 'BI Intern']); expect(k.contacts.linkedin).toBe('https://linkedin.com/company/fixture')
    expect(k.mergedFrom).toMatchObject([{ id: 'cy-1', leadId: 'CY-1', city: 'Cyberjaya' }]); expect(k.sources.some((x) => x.url === 'https://fixture.example/old-careers')).toBe(true)
    expect(JSON.stringify(reconcileDuplicates(c).catalog)).toBe(JSON.stringify(c))   // idempotent
  })
  it('does not merge units that merely share a website, or different legal entities', () => {
    const a = co('a', 'A', 'Fixture Department', { website: 'https://gov.example', legalEntity: 'Fixture Department' }), b = co('b', 'B', 'Fixture Operations Office', { website: 'https://gov.example', legalEntity: 'Fixture Operations Office' })
    const x = co('x', 'X', 'Fixture Same Name', { website: 'https://same.example', legalEntity: 'One Sdn Bhd' }), y = co('y', 'Y', 'Fixture Same Name', { website: 'https://same.example', legalEntity: 'Two Sdn Bhd' })
    expect(reconcileDuplicates({ ...catalog(), companies: [a, b, x, y] }).merged).toEqual([])
  })
  it('keeps contact research and resolves the old id for saved documents, overrides and the API', async () => {
    const d = tmp(); fs.mkdirSync(path.join(d, 'dl')); writeResearch(path.join(d, 'dl'))
    const cat: Catalog = { ...catalog(), companies: [...catalog().companies, { ...co('fx-a-old', 'OLD-A', 'Fixture Alpha', { website: 'https://alpha.example' }), legalEntity: null }] }
    fs.writeFileSync(path.join(d, 'cat.json'), JSON.stringify({ ...cat, companies: cat.companies.map((c) => (c.id === 'fx-a' ? { ...c, legalEntity: 'Alpha Sdn Bhd', website: 'https://alpha.example' } : c.id === 'fx-a-old' ? { ...c, legalEntity: 'Alpha Sdn Bhd' } : c)) })); fs.writeFileSync(path.join(d, 'seed.json'), JSON.stringify({ version: 1, profiles: [] }))
    const api = createViewerApi({ userDataDir: path.join(d, 'ud'), bundledCatalog: path.join(d, 'cat.json'), seedPaths: [path.join(d, 'seed.json')], researchDir: path.join(d, 'dl'), exportsDir: path.join(d, 'x'), ui: { pickFile: async () => null, openPath: async () => '', openExternal() {}, copy() {} } })
    const rep: any = await api.call('v.contacts.import'); expect(rep.after).toBe(11); expect(rep.matched).toBe(9)   // the duplicate was already folded when the list loaded
    const viaOld: any = await api.call('v.companies.get', { id: 'fx-a-old' }); expect(viaOld.id).toBe('fx-a'); expect(viaOld.contactSummary.best.value).toBe('jobs@alpha.example'); expect(viaOld.mergedFrom[0].id).toBe('fx-a-old')
    expect(fs.readdirSync(path.join(d, 'x'))).toEqual(['CAREER_HUB_MISSING_2_CONTACT_RESEARCH.csv'])
  })
})
