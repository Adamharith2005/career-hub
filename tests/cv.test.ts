import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createViewerApi } from '../core/viewer/api.ts'
import { buildMaster, buildTailored, plainText, unsupportedClaims, evidenceCoverage } from '../core/viewer/cvengine.ts'
import { extractPdf } from '../core/cv.ts'

const prof = (id: string, over: any) => ({ id, displayName: id === 'adam' ? 'Adam' : 'Akif', fullName: id === 'adam' ? 'Test Student One' : 'Test Student Two', specialisation: id === 'adam' ? 'Data Science' : 'Information Systems', university: 'Test University', degree: 'Bachelor of Computer Science',
  contact: { email: `${id}@example.com`, phone: '+60123456789', location: 'Testville' }, links: [{ label: 'GitHub', url: `https://github.com/${id}-fixture` }], headline: '', summary: '',
  education: [{ title: 'Bachelor of Computer Science', institution: 'Test University', dates: '', points: [id === 'adam' ? 'Current CGPA: 3.60' : 'Current CGPA: 3.40'] }], otherRepos: [], experience: [{ title: 'Tutor', organisation: 'Fixture Centre', date: '2024', points: ['Delivered lessons.'] }], languages: [], internshipWindow: '', reviewNotes: [], availabilityPhrase: '', documents: [], ...over })
const ADAM = prof('adam', { interests: ['Machine Learning'], skills: [{ group: 'Data', items: ['Python', 'pandas', 'SQL', 'Power BI'] }, { group: 'Misc', items: ['Git'] }],
  projects: [{ title: 'Heart prediction', context: 'Coursework', date: '2025', status: 'COMPLETED', stack: ['Python', 'scikit-learn'], points: ['Built a survival prediction model.'], caveat: '', url: null }, { title: 'Sales dashboard', context: 'Challenge', date: '2026', status: 'COMPLETED', stack: ['Power BI', 'SQL'], points: ['Dashboard for production data.'], caveat: '', url: null }], leadership: [] })
const AKIF = prof('akif', { interests: [], skills: [{ group: 'Web', items: ['React', 'TypeScript', 'Firebase', 'Tailwind CSS'] }, { group: 'Cloud', items: ['Terraform', 'AWS'] }, { group: 'Data', items: ['SPSS', 'Excel'] }, { group: 'Other', items: ['SQL'] }],
  projects: [{ title: 'Inventory app', context: 'Workflow', date: '2025', status: 'COMPLETED', stack: ['React', 'Firebase'], points: ['Inventory and distribution workflow.'], caveat: '', url: null }, { title: 'Cloud analyzer', context: 'Final Year Project', date: '2027', status: 'PROPOSED', stack: ['Terraform', 'AWS'], points: ['Proposal explores misconfiguration detection.'], caveat: '', url: null }],
  leadership: [{ id: 'l1', title: 'Head of Sponsorship', organisation: 'Fixture Cup', date: '2026', year: 2026, themes: ['sponsorship'], points: [] }, { id: 'l2', title: 'Deputy Treasurer', organisation: 'Fixture Night', date: '2025', year: 2025, themes: ['treasury'], points: [] }] })
const co = (id: string, name: string, tech: string[]) => ({ id, leadId: null, name, legalEntity: null, city: 'Cyberjaya', sector: 'NON_GOVERNMENT', classes: [], categoryLabel: null, industry: null, size: null, website: null, offices: [], tech, relevance: null, roles: [], techDivision: null,
  internship: { evidence: 'REPORTED_PROGRAMME', sourceLabel: null, auditNote: null, docs: null, deadline: null, deadlineVerified: false, method: null, applicationUrl: null }, allowance: { grade: 'A5', status: 'UNKNOWN', monthlyMin: null, monthlyMax: null, claimText: null, policyRef: false, conditions: null, benefits: null, sourceUrl: null, sourceDate: null, note: '' },
  contacts: { hrEmail: null, generalEmail: null, phone: null, careersUrl: null, contactForm: null, linkedin: null }, sources: [], lastVerified: '2026-11-01', uncertainties: [], notes: null, nextAction: null, verificationLevel: 'VERIFIED' })
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')

describe('CV engine (pure)', () => {
  it('tailors differently per role and only from the student\'s own facts', () => {
    const cloud = buildTailored(AKIF as any, { company: 'SecCo', role: 'CYBERSECURITY', vacancy: 'NONE' }), web = buildTailored(AKIF as any, { company: 'WebCo', role: 'FULL_STACK', vacancy: 'NONE' })
    expect(plainText(cloud.ast)).not.toEqual(plainText(web.ast))
    expect(cloud.ast.sections.find((s) => s.kind === 'projects')!.items![0].heading).toBe('Cloud analyzer')
    expect(web.ast.sections.find((s) => s.kind === 'projects')!.items![0].heading).toBe('Inventory app')
    expect(cloud.ast.sections.find((s) => s.kind === 'skills')!.skillGroups![0].label).toBe('Cloud')
    expect(unsupportedClaims(AKIF as any, cloud.ast)).toEqual([]); expect(unsupportedClaims(AKIF as any, web.ast)).toEqual([])
  })
  it('keeps a proposed project labelled as proposed', () => {
    const t = plainText(buildTailored(AKIF as any, { company: 'SecCo', role: 'CYBERSECURITY', vacancy: 'NONE' }).ast)
    expect(t).toMatch(/Proposed, in progress/); expect(t).not.toMatch(/\b(completed|deployed|benchmarked)\b.*Cloud analyzer/i)
  })
  it('never mixes the two students', () => {
    const a = plainText(buildTailored(ADAM as any, { company: 'X', role: 'DATA_ANALYTICS', vacancy: 'NONE' }).ast), k = plainText(buildTailored(AKIF as any, { company: 'X', role: 'FULL_STACK', vacancy: 'NONE' }).ast)
    expect(a).not.toMatch(/Inventory app|Cloud analyzer|Fixture Cup|Terraform|React/); expect(k).not.toMatch(/Heart prediction|Sales dashboard|Power BI|pandas/)
    expect(a).toMatch(/Test Student One/); expect(k).toMatch(/Test Student Two/)
  })
  it('flags claims the profile does not support', () => {
    const t = buildTailored(ADAM as any, { company: 'X', role: 'DATA_ANALYTICS', vacancy: 'NONE' }); t.ast.summary!.text += ' Expert in Kubernetes and improved accuracy by 40%.'
    const f = unsupportedClaims(ADAM as any, t.ast); expect(f.join(' ')).toMatch(/Docker \/ CI-CD/); expect(f.join(' ')).toMatch(/40%/)
  })
  it('presentation quality is separate from suitability and never counts gaps', () => {
    const m = buildMaster(ADAM as any), t = buildTailored(ADAM as any, { company: 'X', role: 'DATA_ANALYTICS', vacancy: 'NONE' })
    const b = evidenceCoverage(ADAM as any, m.ast, 'DATA_ANALYTICS'), a = evidenceCoverage(ADAM as any, t.ast, 'DATA_ANALYTICS')
    expect(a.percent).toBeGreaterThanOrEqual(b.percent); expect(a.gaps.length).toBe(b.gaps.length)
  })
})

describe('CV workflow through the API', () => {
  let dir: string, api: ReturnType<typeof createViewerApi>, adamFile: string
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-'))
    fs.writeFileSync(path.join(dir, 'adam.pdf'), '%PDF-1.4 adam original'); fs.writeFileSync(path.join(dir, 'akif.pdf'), '%PDF-1.4 akif original')
    const seed = path.join(dir, 'seed.json'); fs.writeFileSync(seed, JSON.stringify({ version: 1, profiles: [{ ...ADAM, documents: [{ label: 'Adam resume', kind: 'RESUME', path: path.join(dir, 'adam.pdf') }] }, { ...AKIF, documents: [{ label: 'Old resume', kind: 'RESUME', path: path.join(dir, 'akif.pdf') }] }] }))
    fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify({ version: 1, generatedAt: '', sourceFile: 't', sourceSha256: null, companies: [co('c1', 'Data Labs', ['ANALYTICS', 'DATA_SCIENCE']), co('c2', 'Sec Corp', ['CYBERSECURITY', 'CLOUD']), co('c3', 'Web House', ['FULL_STACK', 'SOFTWARE'])] }))
    api = createViewerApi({ userDataDir: path.join(dir, 'ud'), bundledCatalog: path.join(dir, 'catalog.json'), seedPaths: [seed], ui: { pickFile: async () => null, openPath: async () => '', openExternal: () => {}, copy: () => {} } })
    adamFile = path.join(dir, 'ud', 'viewer', ((await api.call('v.docs.list', { id: 'adam' }))[0] as any).versions[0].file)
  })
  it('ranks differently per student and role, from real evidence', async () => {
    const a: any[] = await api.call('v.companies.list', { profileId: 'adam' }), k: any[] = await api.call('v.companies.list', { profileId: 'akif' })
    expect(a[0].id).toBe('c1'); expect(k[0].id).toBe('c3')
    const e1: any = await api.call('v.match.explain', { profileId: 'akif', companyId: 'c2', role: 'CYBERSECURITY' }), e2: any = await api.call('v.match.explain', { profileId: 'akif', companyId: 'c2', role: 'FULL_STACK' })
    expect(e1.score).not.toBe(e2.score)
  })
  it('tailors for Adam without touching his resume, approves with review, exports a real PDF', async () => {
    const before = sha(adamFile)
    const t: any = await api.call('v.cv.tailor', { profileId: 'adam', companyId: 'c1' })
    expect(t.version.status).toBe('DRAFT'); expect(t.label).toMatch(/No Specific Vacancy/); expect(t.diff.length).toBeGreaterThan(0); expect(t.suitability.score).toBeGreaterThan(0)
    expect(t.presentation.after.percent).toBeGreaterThanOrEqual(t.presentation.before.percent)
    const ok: any = await api.call('v.cv.approve', { id: 'adam', recId: t.rec.id, versionId: t.version.id })
    expect(ok.version.status).toBe('APPROVED'); expect(ok.version.file).toMatch(/^cv\/adam\/Adam_Data_Labs_.*_CV\.pdf$/)
    const bytes: Uint8Array = await api.call('v.cv.preview', { id: 'adam', recId: t.rec.id, versionId: t.version.id })
    const text = (await extractPdf(bytes)).text ?? ''
    expect(text).toMatch(/Test Student One/); expect(text).toMatch(/Heart prediction/); expect(text).not.toMatch(/Inventory app|\[|TODO/)
    expect(sha(adamFile)).toBe(before)
    expect(((await api.call('v.docs.list', { id: 'adam' })) as any[]).length).toBe(1)
  })
  it('approval requires review when an edit adds an unsupported claim; edits and restores create new versions', async () => {
    const t: any = await api.call('v.cv.tailor', { profileId: 'akif', companyId: 'c3' })
    const e: any = await api.call('v.cv.edit', { id: 'akif', recId: t.rec.id, versionId: t.version.id, summary: 'Experienced with Kubernetes at scale.' })
    expect(e.version.n).toBe(2); expect(e.flags.join(' ')).toMatch(/Docker \/ CI-CD/)
    await expect(api.call('v.cv.approve', { id: 'akif', recId: t.rec.id, versionId: e.version.id })).rejects.toThrow(/Review before approving/)
    const r: any = await api.call('v.cv.restore', { id: 'akif', recId: t.rec.id, versionId: t.version.id })
    expect(r.version.n).toBe(3); expect(r.flags).toEqual([])
    const list: any[] = await api.call('v.cv.list', { id: 'akif' }); expect(list[0].versions.map((v: any) => v.source)).toEqual(['generated', 'edited', 'restored'])
    expect(((await api.call('v.cv.list', { id: 'adam' })) as any[])).toEqual([])
  })
  it('a second tailor for the same company and role adds a version instead of a new record', async () => {
    await api.call('v.cv.tailor', { profileId: 'akif', companyId: 'c2', role: 'CYBERSECURITY' }); await api.call('v.cv.tailor', { profileId: 'akif', companyId: 'c2', role: 'CYBERSECURITY' })
    const l: any[] = await api.call('v.cv.list', { id: 'akif' }); expect(l).toHaveLength(1); expect(l[0].versions).toHaveLength(2)
  })
  it('Akif master resume: draft only, approval adds a new document, original stays intact; Adam is refused', async () => {
    const orig = (await api.call('v.docs.list', { id: 'akif' }) as any[])[0]; const origFile = path.join(dir, 'ud', 'viewer', orig.versions[0].file); const before = sha(origFile)
    const m: any = await api.call('v.cv.master.create', { id: 'akif' })
    expect(m.version.status).toBe('DRAFT'); expect((await api.call('v.docs.list', { id: 'akif' }) as any[])).toHaveLength(1)
    expect(plainText(m.version.ast)).toMatch(/Head of Sponsorship, Fixture Cup/)
    const ok: any = await api.call('v.cv.approve', { id: 'akif', recId: m.rec.id, versionId: m.version.id })
    const docs: any[] = await api.call('v.docs.list', { id: 'akif' }); expect(docs).toHaveLength(2); expect(ok.masterDocId).toBeTruthy()
    expect(sha(origFile)).toBe(before)
    await expect(api.call('v.cv.master.create', { id: 'adam' })).rejects.toThrow(/only prepared for Akif/)
    expect(((await api.call('v.docs.list', { id: 'adam' })) as any[]).length).toBe(1)
  })
})
