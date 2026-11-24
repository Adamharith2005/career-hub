import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildCatalog, mergeCatalog, filterCatalog, allowanceStatus, isoDate, techTagsFrom, type Catalog } from '../core/viewer/catalog.ts'
import { companyDetailsText, contactText, allowanceHeadline } from '../core/viewer/format.ts'
import { ViewerStore } from '../core/viewer/store.ts'
import { createViewerApi } from '../core/viewer/api.ts'

const H = ['Lead ID', 'Location', 'Organisation', 'Ownership / Type', 'Company Size', 'Industry', 'CS Relevance', 'Potential CS Roles', 'Office Address', 'Office Verification Status',
  'Internship Acceptance Evidence', 'Allowance Evidence Status', 'Original Allowance Claim', 'Allowance Confidence Level', 'Official Website', 'Official Careers Page', 'Public HR Email', 'Contact (General Email / Form)', 'LinkedIn', 'Last Verified']
const rows = [
  ['FX-001', 'Putrajaya', 'Fixture Ministry of Digital', 'Federal Government Ministry', 'Large', 'Public administration', 'Highly Relevant', 'Cybersecurity Analyst Intern, Network Intern', 'Level 1, Fixture Building, Putrajaya', 'OFFICIAL — page lists address',
    'OFFICIAL — internship process published', 'JPA policy potentially applicable; agency-specific payout unverified', 'Up to RM5.00/hr (Max RM900/month)', 'A1 — Verified Current Policy', 'https://fixture.gov.example', 'https://fixture.gov.example/careers', 'UNKNOWN', 'info@fixture.gov.example, +60 3-8000 0000', 'linkedin.com/company/fixture-ministry', 46345],
  ['FX-002', 'Cyberjaya', 'Fixture Data Labs', 'MNC', 'Large', 'Analytics', 'Highly Relevant', 'Data Analyst Intern, Software Engineer Intern', 'Cyber 6, Cyberjaya', 'NOT INDEPENDENTLY CHECKED',
    'NOT CHECKED', 'UNKNOWN — not researched', 'Not provided', '', 'https://labs.example', 'https://labs.example/careers', 'hr@labs.example', 'Contact form via labs.example', '', '2026-11-01'],
  ['FX-003', 'Cyberjaya', 'Fixture Unpaid Department', 'Federal Government Department', 'Small', 'Fisheries', 'Relevant', 'IT Support Intern', '', '', '', 'AGENCY PAGE SAYS UNPAID — reconfirm', 'RM800', 'A1', '', '', 'UNKNOWN', '', '', ''],
]
const sheets = { 'ALL 170 LEADS': [H, ...rows] } as any
const mk = () => buildCatalog(sheets, { sourceFile: 'fixture.xlsx' }).catalog
const copied: string[] = []
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-'))

describe('catalogue', () => {
  it('builds a company per row with sector, city and no duplicates', () => {
    const c = mk(); expect(c.companies).toHaveLength(3)
    expect(new Set(c.companies.map((x) => x.id)).size).toBe(3)
    expect(c.companies[0]).toMatchObject({ city: 'Putrajaya', sector: 'GOVERNMENT' })
    expect(c.companies[1]).toMatchObject({ city: 'Cyberjaya', sector: 'NON_GOVERNMENT' })
  })
  it('unknown allowance is UNKNOWN with no amount, never RM0', () => {
    const b = mk().companies[1]
    expect(b.allowance.status).toBe('UNKNOWN'); expect(b.allowance.monthlyMin).toBeNull()
    expect(allowanceHeadline(b)).toBe('Allowance not confirmed'); expect(JSON.stringify(allowanceHeadline(b))).not.toMatch(/RM0/)
  })
  it('a government policy is an estimate, not a confirmed payment; official unpaid is unpaid', () => {
    const [a, , c] = mk().companies
    expect(a.allowance.policyRef).toBe(true); expect(a.allowance.status).toBe('ESTIMATED'); expect(a.allowance.monthlyMin).toBeNull()
    expect(a.allowance.claimText).toMatch(/RM5/); expect(a.uncertainties.join(' ')).toMatch(/unverified claim/)
    expect(c.allowance.status).toBe('CONFIRMED_UNPAID')
  })
  it('source labels do not become verified evidence; unadvertised is not an opening', () => {
    const [a, b] = mk().companies
    expect(a.verificationLevel).toBe('VERIFIED'); expect(b.verificationLevel).toBe('UNVERIFIED')
    expect(b.internship.evidence).not.toBe('ACTIVE_OPENING'); expect(b.uncertainties.join(' ')).toMatch(/enquiry, not a vacancy/)
  })
  it('parses contacts, normalises links and Excel dates, never guesses', () => {
    const [a, b] = mk().companies
    expect(a.contacts).toMatchObject({ hrEmail: null, generalEmail: 'info@fixture.gov.example', linkedin: 'https://linkedin.com/company/fixture-ministry' })
    expect(a.contacts.phone).toMatch(/^\+?60/); expect(a.lastVerified).toBe('2026-11-19')
    expect(b.contacts).toMatchObject({ hrEmail: 'hr@labs.example', generalEmail: null }); expect(b.contacts.contactForm).toMatch(/form/i)
    expect(isoDate('46345')).toBe('2026-11-19')
  })
  it('filters by city, sector, tech, allowance and evidence', () => {
    const l = mk().companies
    expect(filterCatalog(l, { city: 'Cyberjaya' })).toHaveLength(2)
    expect(filterCatalog(l, { sector: 'GOVERNMENT' }).map((c) => c.name)).toEqual(['Fixture Ministry of Digital', 'Fixture Unpaid Department'])
    expect(filterCatalog(l, { tech: ['CYBERSECURITY'] })).toHaveLength(1)
    expect(filterCatalog(l, { allowance: ['UNKNOWN'] })).toHaveLength(1)
    expect(filterCatalog(l, { evidence: ['CONFIRMED_PROGRAMME'] })).toHaveLength(1)
    expect(filterCatalog(l, { q: 'labs' })).toHaveLength(1)
    expect(techTagsFrom('Data Analyst, Software Engineer')).toEqual(expect.arrayContaining(['ANALYTICS', 'SOFTWARE']))
  })
  it('merge never erases verified data with blanks, keeps stronger evidence, never removes companies', () => {
    const base = mk()
    const blank: Catalog = structuredClone(base)
    blank.companies = blank.companies.slice(0, 2)
    blank.companies[0].contacts.generalEmail = null; blank.companies[0].website = null
    blank.companies[0].allowance = { ...blank.companies[0].allowance, grade: 'A5' }
    blank.companies[0].verificationLevel = 'UNVERIFIED'
    const { catalog, report } = mergeCatalog(base, blank)
    expect(catalog.companies).toHaveLength(3)
    expect(catalog.companies[0].contacts.generalEmail).toBe('info@fixture.gov.example')
    expect(catalog.companies[0].website).toBe('https://fixture.gov.example/')
    expect(catalog.companies[0].verificationLevel).toBe('VERIFIED')
    expect(report.total).toBe(3)
    const again = mergeCatalog(base, structuredClone(base)); expect(again.report).toMatchObject({ added: 0, updated: 0, unchanged: 3 })
    const grown = structuredClone(base); grown.companies.push({ ...grown.companies[0], id: 'fx-004', name: 'Brand New Org' })
    expect(mergeCatalog(base, grown).report.added).toBe(1)
  })
  it('merge matches on lead id: a renamed row updates in place and ids never collide', () => {
    const base = mk(); const renamed = structuredClone(base); renamed.companies[0].name = 'Fixture Ministry of Digital (renamed)'
    const { catalog, report } = mergeCatalog(base, renamed)
    expect(catalog.companies).toHaveLength(3); expect(new Set(catalog.companies.map((c) => c.id)).size).toBe(3); expect(report.added).toBe(0)
    expect(catalog.companies[0].name).toBe('Fixture Ministry of Digital (renamed)')
    const twin = structuredClone(base); twin.companies.push({ ...twin.companies[1], id: 'fx-002', leadId: null, name: 'Fixture Data Labs' })
    const m2 = mergeCatalog(base, twin); expect(m2.catalog.companies).toHaveLength(4); expect(new Set(m2.catalog.companies.map((c) => c.id)).size).toBe(4)   // a second row never overwrites the first
  })
  it('merge: an explicit "not accepting" overrides stale positive evidence; kept evidence keeps its own caveats', () => {
    const base = mk(); const inc = structuredClone(base)
    inc.companies[0].internship = { ...inc.companies[0].internship, evidence: 'NOT_ACCEPTING', auditNote: 'Page says no interns' }
    expect(mergeCatalog(base, inc).catalog.companies[0].internship.evidence).toBe('NOT_ACCEPTING')
    const weak = structuredClone(base); weak.companies[0].internship = { ...weak.companies[0].internship, evidence: 'UNKNOWN', auditNote: 'unchecked' }; weak.companies[0].uncertainties = ['No verified internship opening']
    const kept = mergeCatalog(base, weak).catalog.companies[0]
    expect(kept.internship.evidence).toBe('CONFIRMED_PROGRAMME'); expect(kept.internship.auditNote).not.toBe('unchecked'); expect(kept.uncertainties).toEqual(base.companies[0].uncertainties)
  })
  it('a lead id reused by two different organisations does not merge them', () => {
    const base = mk(); base.companies[1].leadId = 'FX-001'            // two organisations share one lead id
    const again = structuredClone(base)
    const r = mergeCatalog(base, again); expect(r.catalog.companies).toHaveLength(3); expect(r.report).toMatchObject({ added: 0, unchanged: 3 })
  })
  it('allowanceStatus mapping', () => {
    expect(allowanceStatus({ grade: 'A5', amountMin: null, amountMax: null, policyRef: false, claimText: 'RM1000', note: '' })).toBe('UNKNOWN')
    expect(allowanceStatus({ grade: 'A1', amountMin: 900, amountMax: 900, policyRef: false, claimText: null, note: '' })).toBe('CONFIRMED_PAID')
  })
})

describe('copy text and drafts', () => {
  const [a, b] = mk().companies
  it('company details include only real fields', () => {
    const t = companyDetailsText(b)
    expect(t).toContain('Fixture Data Labs'); expect(t).toContain('hr@labs.example'); expect(t).toContain('Address: Cyber 6, Cyberjaya (not verified)')
    expect(t).not.toMatch(/undefined|null|Phone:/)
    expect(contactText(mk().companies[2])).toMatch(/No verified public contact/)
  })
})

describe('profiles and API without a database', () => {
  let dir: string, seed: string
  const seedFile = () => ({ version: 1, profiles: [
    { id: 'adam', displayName: 'Adam', fullName: 'Test Student One', specialisation: 'Data Science', university: 'Test University', degree: 'BSc Test', contact: { email: 'one@example.com', phone: '1', location: 'X' }, links: [], skills: [{ group: 'Prog', items: ['Python'] }], projects: [], interests: ['Data'], documents: [{ label: 'One resume', kind: 'RESUME', path: path.join(dir, 'one.pdf') }] },
    { id: 'akif', displayName: 'Akif', fullName: 'Test Student Two', specialisation: 'Information Systems', university: 'Test University', degree: 'BSc Test 2', contact: { email: 'two@example.com', phone: '2', location: 'Y' }, links: [], skills: [], projects: [], interests: [], documents: [] }] })
  beforeEach(() => {
    dir = tmp(); fs.writeFileSync(path.join(dir, 'one.pdf'), '%PDF-1.4 one'); seed = path.join(dir, 'seed.json'); fs.writeFileSync(seed, JSON.stringify(seedFile()))
    fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(mk()))
  })
  const mkApi = (seeds = [seed]) => createViewerApi({ userDataDir: path.join(dir, 'ud'), bundledCatalog: path.join(dir, 'catalog.json'), seedPaths: seeds, ui: { pickFile: async () => null, openPath: async () => '', openExternal: () => {}, copy: (t: string) => { copied.push(t) } } })

  it('both profiles exist on first launch, with data, and no database file is created', async () => {
    const api = mkApi()
    const ps: any[] = await api.call('v.profiles'); expect(ps.map((p) => p.id)).toEqual(['adam', 'akif'])
    expect((await api.call('v.profile.get', { id: 'adam' }) as any).fullName).toBe('Test Student One')
    expect(fs.existsSync(path.join(dir, 'ud', 'careerhub.db'))).toBe(false)
    expect((await api.call('v.catalog.meta') as any).total).toBe(3)
  })
  it('structured leadership entries load, survive restart, and stay in their own profile', async () => {
    const sd = seedFile() as any
    sd.profiles[1].leadership = [
      { id: 'c-2026-a', title: 'Role A', organisation: 'Fixture Event A', date: '2026', year: 2026, scope: 'College', themes: ['sponsorship'], source: 'fixture', points: [] },
      { id: 'c-2025-b', title: 'Role B', organisation: 'Fixture Event B', date: '2025', year: 2025, points: [] }]
    fs.writeFileSync(seed, JSON.stringify(sd))
    let api = mkApi(); let a: any = await api.call('v.profile.get', { id: 'akif' })
    expect(a.leadership).toHaveLength(2); expect(a.leadership[0]).toMatchObject({ year: 2026, themes: ['sponsorship'], scope: 'College' })
    api = mkApi(); a = await api.call('v.profile.get', { id: 'akif' }); expect(a.leadership.map((e: any) => e.id)).toEqual(['c-2026-a', 'c-2025-b'])
    expect((await api.call('v.profile.get', { id: 'adam' }) as any).leadership).toEqual([])
  })
  it('works with no seed file: two empty, usable profiles', async () => {
    const api = mkApi([path.join(dir, 'missing.json')]); const ps: any[] = await api.call('v.profiles')
    expect(ps.map((p) => p.displayName)).toEqual(['Adam', 'Akif']); expect((await api.call('v.profile.get', { id: 'akif' }) as any).education).toEqual([])
  })
  it('profile data is isolated and edits survive restart; a later seed does not overwrite them', async () => {
    let api = mkApi(); await api.call('v.profile.patch', { id: 'adam', patch: { summary: 'edited by user' } })
    api = mkApi(); expect((await api.call('v.profile.get', { id: 'adam' }) as any).summary).toBe('edited by user')
    expect((await api.call('v.profile.get', { id: 'akif' }) as any).summary).toBe('')
    const docs: any[] = await api.call('v.docs.list', { id: 'adam' }); expect(docs).toHaveLength(1); expect(docs[0].versions[0].state).toBe('OK')
    expect(await api.call('v.docs.list', { id: 'akif' })).toEqual([])
    const v = docs[0].versions[0].id
    await expect(api.call('v.docs.bytes', { id: 'akif', versionId: v })).rejects.toThrow(/Unknown/)   // another profile cannot read it
  })
  it('documents: versioning, duplicate refusal, tamper detection, bad types', async () => {
    const api = mkApi(); const d: any = (await api.call('v.docs.list', { id: 'akif' }))
    const two = path.join(dir, 'two.pdf'); fs.writeFileSync(two, '%PDF-1.4 two')
    const r: any = await api.call('v.docs.add', { id: 'akif', path: two, label: 'Mine' })
    const r2: any = await api.call('v.docs.add', { id: 'akif', path: (() => { const f = path.join(dir, 'three.pdf'); fs.writeFileSync(f, '%PDF-1.4 three'); return f })(), docId: r.docId })
    expect(r2.version).toBe(2)
    await expect(api.call('v.docs.add', { id: 'akif', path: two, docId: r.docId })).rejects.toThrow(/already saved/)
    const bad = path.join(dir, 'x.exe'); fs.writeFileSync(bad, 'MZ'); await expect(api.call('v.docs.add', { id: 'akif', path: bad })).rejects.toThrow(/PDF or Word/)
    const list: any[] = await api.call('v.docs.list', { id: 'akif' }); const v1 = list[0].versions.find((x: any) => x.version === 1)
    const bytes = await api.call('v.docs.bytes', { id: 'akif', versionId: v1.id }) as Uint8Array; expect(Buffer.from(bytes).toString()).toBe('%PDF-1.4 two')
    fs.appendFileSync(path.join(dir, 'ud', 'viewer', v1.file), 'x'); expect(((await api.call('v.docs.list', { id: 'akif' })) as any[])[0].versions.find((x: any) => x.version === 1).state).toBe('CHANGED')
    expect(d).toEqual([])
  })
  it('catalogue update: apply writes a backup + merged file, refreshes the cache and survives restart', async () => {
    const { makeXlsxFromTsv } = await import('./helpers.ts')
    const api = mkApi()
    const edited = rows.map((r) => [...r]); edited[1][17] = 'newer@labs.example'   // blank-safe: only adds a contact
    const tsv = [H, ...edited, ['FX-009', 'Cyberjaya', 'Fixture Added Org', 'Private Malaysian Company', '', 'IT', 'Relevant', 'Software Engineer Intern', '', '', '', '', '', '', '', '', '', '', '', '']].map((r) => r.join('\t')).join('\n')
    const f = await makeXlsxFromTsv(tsv, path.join(dir, 'update.xlsx'))
    const pv: any = await api.call('v.catalog.preview', { path: f }); expect(pv.rows).toBe(4); expect(pv.report.added).toBe(1)
    const rep: any = await api.call('v.catalog.apply', { path: f }); expect(rep.total).toBe(4)
    expect(((await api.call('v.companies.list', {})) as any[]).length).toBe(4)
    const again: any = await api.call('v.catalog.apply', { path: f }); expect(again.added).toBe(0)
    expect(fs.existsSync(path.join(dir, 'ud', 'viewer', 'catalog.json'))).toBe(true)
    expect(fs.readdirSync(path.join(dir, 'ud', 'viewer')).some((n) => /^catalog\.json\..*\.bak$/.test(n))).toBe(true)
    expect(((await mkApi().call('v.companies.list', {})) as any[]).length).toBe(4)   // restart reads the updated list
    const bad = path.join(dir, 'bad.xlsx'); fs.writeFileSync(bad, 'not a workbook'); await expect(api.call('v.catalog.preview', { path: bad })).rejects.toThrow()
  })
  it('a corrupt profiles.json is moved aside, never overwritten', async () => {
    mkApi(); const file = path.join(dir, 'ud', 'viewer', 'profiles.json')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').slice(0, 40))   // truncate
    const api = mkApi()
    const kept = fs.readdirSync(path.join(dir, 'ud', 'viewer')).filter((n) => n.startsWith('profiles.json.corrupt-')); expect(kept).toHaveLength(1)
    expect(fs.readFileSync(path.join(dir, 'ud', 'viewer', kept[0]), 'utf8').length).toBe(40)
    expect(((await api.call('v.profiles')) as any[]).length).toBe(2)
  })
  it('the viewer never imports the SQLite layer', () => {
    for (const f of ['core/viewer/api.ts', 'core/viewer/catalog.ts', 'core/viewer/store.ts', 'core/viewer/email.ts', 'core/viewer/format.ts', 'core/research-parse.ts', 'core/compare.ts', 'core/research-classify.ts', 'electron/main.ts'])
      expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/from '(\.\.?\/)+(core\/)?(db|api|research-import)\.ts'|node:sqlite/)
  })
  it('compare, copy and email handlers work from the catalogue', async () => {
    const api = mkApi(); const ids = ((await api.call('v.companies.list', {})) as any[]).map((c) => c.id)
    const cmp: any = await api.call('v.companies.compare', { ids: ids.slice(0, 2), priority: 'balanced' }); expect(cmp.scored).toHaveLength(2)
    await expect(api.call('v.companies.compare', { ids: [ids[0]] })).rejects.toThrow(/2 to 4/)
    expect(await api.call('v.copy.company', { id: ids[1] })).toContain('Fixture Data Labs')
    const d: any = await api.call('v.email.draft', { profileId: 'adam', companyId: ids[1] }); expect(d.body).toContain('Test Student One'); expect(d.body).not.toContain('Test Student Two')
    await api.call('v.copy.text', { text: 'hello' }); expect(copied.at(-1)).toBe('hello')
    await expect(api.call('v.openExternal', { url: 'file:///etc/passwd' })).rejects.toThrow(/http/)
  })
})

const REAL = process.env.CAREER_HUB_REAL_WORKBOOK ?? ''
describe.skipIf(!REAL || !fs.existsSync(REAL))('real audited workbook', () => {
  it('produces 170 leads: 92 Putrajaya, 78 Cyberjaya, 77 government, no duplicates, no confirmed amounts', async () => {
    const { catalogFromWorkbook } = await import('../core/viewer/catalog.ts'); const { catalog } = await catalogFromWorkbook(REAL)
    const cs = catalog.companies
    expect(cs).toHaveLength(170); expect(new Set(cs.map((c) => c.id)).size).toBe(170)
    expect(cs.filter((c) => c.city === 'Putrajaya')).toHaveLength(92); expect(cs.filter((c) => c.city === 'Cyberjaya')).toHaveLength(78)
    expect(cs.filter((c) => c.sector === 'GOVERNMENT')).toHaveLength(77); expect(cs.filter((c) => c.sector === 'NON_GOVERNMENT')).toHaveLength(93)
    expect(cs.filter((c) => c.verificationLevel === 'VERIFIED')).toHaveLength(5)
    expect(cs.filter((c) => c.allowance.monthlyMin != null)).toHaveLength(0)
    expect(cs.filter((c) => c.allowance.status === 'CONFIRMED_UNPAID')).toHaveLength(2)
  })
})
