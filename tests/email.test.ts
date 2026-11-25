import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { draftEmail, attachmentSentence } from '../core/viewer/email.ts'
import { createViewerApi } from '../core/viewer/api.ts'

const prof = (id: string, over: any) => ({ id, displayName: id === 'adam' ? 'One' : 'Two', fullName: id === 'adam' ? 'Test Student One' : 'Test Student Two', specialisation: id === 'adam' ? 'Data Science' : 'Information Systems', university: 'Test University',
  degree: id === 'adam' ? 'Bachelor of Computer Science (Data Science)' : 'Bachelor of Computer Science (Information Systems)', contact: { email: `${id}@example.com`, phone: id === 'adam' ? '+60 11-111 1111' : '+60 12-222 2222', location: 'X' }, links: [], headline: '', summary: '',
  education: [{ title: 'Bachelor of Computer Science', institution: 'Test University', dates: '', points: [id === 'adam' ? 'CGPA: 3.62' : 'Current CGPA: 3.49'] }, { title: 'Foundation', institution: 'Test University', dates: '', points: ['CGPA: 3.90'] }],
  otherRepos: [], experience: [], languages: [], interests: [], internshipWindow: '', availabilityPhrase: '', reviewNotes: [], documents: [], seeded: true, ...over })
const ADAM = prof('adam', {
  skills: [{ group: 'Data', items: ['Python', 'SQL', 'Power BI', 'Data cleaning', 'Machine learning', 'Statistical analysis'] }, { group: 'Web', items: ['HTML'] }],
  projects: [{ id: 'a1', title: 'Churn Prediction', context: 'Coursework', date: '2026', status: 'COMPLETED', stack: ['Python', 'scikit-learn'], points: [], caveat: '', url: null, themes: ['DATA_SCIENCE_ML'] }, { id: 'a2', title: 'Sales Dashboard', context: 'Challenge | team entry', date: '2026', status: 'COMPLETED', stack: ['Power BI', 'SQL'], points: [], caveat: '', url: null, themes: ['DATA_ANALYTICS'] }],
  leadership: [{ title: 'Head of Sponsorship and Public Relations', organisation: "FixtureFest'26 (Fixture Night 2026)", date: '2026', points: [] }],
  availability: { studyYear: 'third-year', programme: '2u2i', duration: 'continuous 12-month', start: 'February 2027', end: 'February 2028', detail: 'during which I will work on real data science projects with my host company', confirmed: true, source: 'Student-confirmed' },
  academicHighlight: "have received the Dean's List Award twice" })
const AKIF = prof('akif', {
  skills: [{ group: 'Web', items: ['React', 'TypeScript', 'Firebase', 'SQL'] }, { group: 'Cloud', items: ['Terraform', 'AWS'] }],
  projects: [{ id: 'k1', title: 'Inventory App', context: 'Solo build', date: '2026', status: 'COMPLETED', stack: ['React', 'TypeScript', 'Firebase'], points: [], caveat: '', url: null, themes: ['INFO_SYSTEMS', 'FULL_STACK'] },
    { id: 'k2', title: 'Cloud Analyzer with AI-Assisted Remediation', context: 'Final Year Project', date: '2027', status: 'IN_PROGRESS', stack: ['Terraform', 'AWS', 'Python'], points: [], caveat: '', url: null, themes: ['CYBERSECURITY', 'CLOUD_DEVOPS'] },
    { id: 'k3', title: 'Group App', context: 'Group', date: '2025', status: 'UNKNOWN', stack: ['React', 'TypeScript'], points: [], caveat: '', url: null, contribution: 'TEAM_UNCERTAIN' }],
  leadership: [{ title: 'Deputy Director', organisation: 'Fixture Night (FN)', date: '2026', year: 2026, points: [] }, { title: 'Head of Sponsorship', organisation: 'Fixture Cup', date: '2025', year: 2025, points: [] }],
  emailOptions: { leadership: false } })
const co = (id: string, name: string, tech: string[], over: any = {}) => ({ id, leadId: null, name, legalEntity: null, city: 'Cyberjaya', sector: 'NON_GOVERNMENT', classes: [], categoryLabel: null, industry: null, size: null, website: null, offices: [], tech, relevance: null, roles: [], techDivision: null,
  internship: { evidence: 'DIRECT_OUTREACH', sourceLabel: null, auditNote: null, docs: null, deadline: null, deadlineVerified: false, method: null, applicationUrl: null }, allowance: { grade: 'A5', status: 'UNKNOWN', monthlyMin: null, monthlyMax: null, claimText: null, policyRef: false, conditions: null, benefits: null, sourceUrl: null, sourceDate: null, note: '' },
  contacts: { hrEmail: null, generalEmail: null, phone: null, careersUrl: null, contactForm: null, linkedin: null }, sources: [], lastVerified: null, uncertainties: [], notes: null, nextAction: null, verificationLevel: 'VERIFIED', ...over })
const DATA = co('c1', 'Fixture Analytics', ['ANALYTICS', 'DATA_SCIENCE'], { roles: ['Data Analyst Intern', 'Business Intelligence Intern'], contacts: { hrEmail: 'hr@fixture.example', generalEmail: null, phone: null, careersUrl: null, contactForm: null, linkedin: null }, internship: { evidence: 'ACTIVE_OPENING', sourceLabel: null, auditNote: null, docs: null, deadline: null, deadlineVerified: false, method: null, applicationUrl: null } })
const SOFT = co('c2', 'Fixture Software', ['SOFTWARE', 'FULL_STACK'], { roles: ['Software Engineer Intern'] })
const SEC = co('c3', 'Fixture Security', ['CYBERSECURITY', 'CLOUD'])
const A = (p: any, c: any, o: any = {}) => draftEmail(p, c, o)

describe('email template engine', () => {
  it('follows the reference structure for an advertised role', () => {
    const d = A(ADAM, DATA, { role: 'DATA_ANALYTICS', attachments: ['RESUME', 'CV'] }); const L = d.body.split('\n')
    expect(L[0]).toBe('Dear Hiring Manager,'); expect(L[1]).toBe('')
    expect(L[2]).toBe("I am a third-year Computer Science (Data Science) student at Test University, and I would like to apply for the Data Analyst Internship at Fixture Analytics. Under my university's 2u2i programme, I am available for a continuous 12-month internship from February 2027 to February 2028, during which I will work on real data science projects with my host company.")
    expect(L[4]).toMatch(/^I am skilled in (SQL|Python|Power BI), .*Power BI|^I am skilled in .*, with hands-on experience in /)
    expect(L[4]).toContain('I hold a CGPA of 3.62 and have received the Dean\'s List Award twice.'); expect(L[4]).toMatch(/Outside the classroom, leading sponsorship and public relations for FixtureFest'26 has strengthened my communication and teamwork skills\./)
    expect(L[4]).toMatch(/I would be glad to bring these strengths to your team while learning from your work in data analytics\.$/)
    expect(L[6]).toBe('Please find attached my resume and CV. Thank you for your time and consideration. I look forward to hearing from you.')
    expect(L.slice(8)).toEqual(['Yours sincerely,', 'Test Student One', '+60 11-111 1111 | adam@example.com'])
    expect(d.subject).toBe('Application for Data Analyst Internship — Test Student One')
  })
  it('stays within the recommended length and has three body paragraphs', () => {
    for (const [p, c, role] of [[ADAM, DATA, 'DATA_ANALYTICS'], [ADAM, DATA, 'DATA_SCIENCE_ML'], [AKIF, SOFT, 'FULL_STACK'], [AKIF, SEC, 'CYBERSECURITY']] as const) {
      const d = A(p, c, { role, attachments: ['RESUME', 'CV'] }); expect(d.words).toBeGreaterThan(95); expect(d.words).toBeLessThan(200)
      expect(d.body.split('\n\n').length).toBe(5)   // greeting, three paragraphs, signature
    }
  })
  it('uses enquiry wording and subject when there is no confirmed opening', () => {
    const d = A(ADAM, co('x', 'Fixture Data Co', ['ANALYTICS']), { role: 'DATA_ANALYTICS' })
    expect(d.speculative).toBe(true); expect(d.body).toContain('I am writing to enquire about potential internship opportunities in data analytics at Fixture Data Co.'); expect(d.body).not.toMatch(/apply for|advertised/i)
    expect(d.subject).toBe('Internship Enquiry — Data Analytics — Test Student One')
  })
  it('changes the technical paragraph with the role', () => {
    const da = A(ADAM, DATA, { role: 'DATA_ANALYTICS' }).body, ml = A(ADAM, DATA, { role: 'DATA_SCIENCE_ML' }).body, bi = draftEmail(ADAM, co('b', 'Fixture BI', ['ANALYTICS'], { roles: ['Business Intelligence Intern'], internship: DATA.internship }), { role: 'DATA_ANALYTICS' }).body
    expect(da).not.toBe(ml); expect(ml).toMatch(/predictive modelling|machine learning/); expect(ml).toContain('Churn Prediction'); expect(bi).toMatch(/Business Intelligence Internship/); expect(bi).toMatch(/hands-on experience in dashboard development/)
  })
  it('omits programme and dates unless confirmed, and honours the per-email switch', () => {
    const off = { ...ADAM, availability: { ...ADAM.availability, confirmed: false } }
    expect(A(off, DATA, { role: 'DATA_ANALYTICS' }).body).not.toMatch(/2u2i|February|third-year|12-month/)
    expect(A(ADAM, DATA, { role: 'DATA_ANALYTICS', includeAvailability: false }).body).not.toMatch(/2u2i|February 2027/)
    expect(A(AKIF, SOFT, { role: 'FULL_STACK' }).body).not.toMatch(/2u2i|February|third-year|12-month|Dean/)
  })
  it('never leaks one profile into the other', () => {
    const a = A(ADAM, DATA, { role: 'DATA_ANALYTICS' }).body, k = A(AKIF, SOFT, { role: 'FULL_STACK' }).body
    expect(a).not.toMatch(/Test Student Two|two@example|Inventory App|Cloud Analyzer|Fixture Night|Fixture Cup|React|Firebase|222 2222/)
    expect(k).not.toMatch(/Test Student One|one@example|Churn|Sales Dashboard|FixtureFest|Power BI|Dean|111 1111|3\.62/)
    expect(k).toContain('Test Student Two'); expect(k).toContain('+60 12-222 2222 | akif@example.com'); expect(k).toContain('CGPA of 3.49'); expect(k).not.toContain('3.90')
  })
  it('Akif: picks verified skills and real projects, one leadership example, labels the FYP as in progress', () => {
    const soft = A(AKIF, SOFT, { role: 'FULL_STACK' }).body
    expect(soft).toMatch(/skilled in .*(React|TypeScript)/); expect(soft).toContain('hands-on experience in web application development'); expect(soft).toContain('Inventory App'); expect(soft).not.toContain('Group App'); expect(soft).not.toMatch(/Outside the classroom|Deputy Director|Fixture Night|Sponsorship|Fixture Cup/)
    const sec = A(AKIF, SEC, { role: 'CYBERSECURITY' }).body
    expect(sec).toContain('in-progress final year project, Cloud Analyzer'); expect(sec).not.toMatch(/completed|deployed|benchmarked/i)
  })
  it('never claims attachments that were not selected, and words them from what exists', () => {
    expect(A(ADAM, DATA, { role: 'DATA_ANALYTICS' }).body).not.toMatch(/attached/i)
    expect(attachmentSentence(['RESUME', 'CV'])).toBe('Please find attached my resume and CV.')
    expect(attachmentSentence(['RESUME', 'COVER_LETTER', 'REFERRAL_LETTER'])).toBe("Please find attached my resume, cover letter and my faculty's Industrial Training referral letter.")
    expect(A(ADAM, DATA, { role: 'DATA_ANALYTICS', attachments: ['RESUME'] }).body).toContain('Please find attached my resume.'); expect(A(ADAM, DATA, { role: 'DATA_ANALYTICS', attachments: ['RESUME'] }).body).not.toMatch(/cover letter|referral/)
  })
  it('does not guess recipients or invent company facts', () => {
    const none = A(AKIF, SOFT, { role: 'FULL_STACK' }); expect(none.to).toBeNull(); expect(none.toNote).toMatch(/^No verified recruitment address is available/)
    const d = A(ADAM, DATA, { role: 'DATA_ANALYTICS' }); expect(d.to).toBeNull(); expect(d.recipients.map((r) => r.email)).toEqual(['hr@fixture.example']); expect(d.recipients[0].warning).toMatch(/not verified/i); expect(A(ADAM, DATA, { role: 'DATA_ANALYTICS', recipientKey: d.recipients[0].key }).to).toBe('hr@fixture.example'); expect(d.body).not.toMatch(/Fixture Analytics (is|has|builds|offers)|your (platform|product|team of)/i)
    expect(A(AKIF, co('g', 'Gen Co', ['SOFTWARE'], { contacts: { hrEmail: null, generalEmail: 'info@gen.example', phone: null, careersUrl: null, contactForm: null, linkedin: null } }), { role: 'FULL_STACK' }).to).toBeNull()
  })
  it('is stable, free of placeholders, banned phrases and the accented spelling', () => {
    const a = A(ADAM, DATA, { role: 'DATA_ANALYTICS', attachments: ['RESUME', 'CV'] }), b = A(ADAM, DATA, { role: 'DATA_ANALYTICS', attachments: ['RESUME', 'CV'] })
    expect(a).toEqual(b)
    for (const d of [a, A(AKIF, SOFT, { role: 'FULL_STACK', attachments: ['RESUME'] }), A(AKIF, SEC, { role: 'CYBERSECURITY' })]) {
      expect(d.body + d.subject).not.toMatch(/\[|\]|undefined|null|TODO|\{\}/); expect(d.body + d.subject).not.toMatch(/r\u00e9sum\u00e9/i)
      expect(d.body).not.toMatch(/passionate|thrilled|esteemed|cutting-edge|innovative solutions/i)
    }
  })
})

describe('vacancy classification', () => {
  const ev = (e: string) => co('v', 'Fixture Co', ['ANALYTICS'], { roles: ['Data Analyst Intern'], internship: { ...DATA.internship, evidence: e } })
  it('applies only for a verified current opening; everything else is an enquiry', () => {
    const app = A(ADAM, ev('ACTIVE_OPENING'), { role: 'DATA_ANALYTICS' }); expect(app.speculative).toBe(false); expect(app.body).toContain('I would like to apply for the Data Analyst Internship at Fixture Co.'); expect(app.subject).toBe('Application for Data Analyst Internship — Test Student One')
    for (const e of ['CONFIRMED_PROGRAMME', 'REPORTED_PROGRAMME', 'HISTORICAL', 'DIRECT_OUTREACH', 'UNKNOWN', 'NOT_ACCEPTING']) {
      const d = A(ADAM, ev(e), { role: 'DATA_ANALYTICS' }); expect(d.speculative, e).toBe(true)
      expect(d.body, e).toContain('I am writing to enquire about potential internship opportunities in data analytics at Fixture Co.'); expect(d.body, e).not.toMatch(/apply for the|advertised/i); expect(d.subject, e).toMatch(/^Internship Enquiry — Data Analytics — /)
    }
  })
})

describe('Akif email copy: technical focus, no college positions', () => {
  const ROLES = ['SOFTWARE', 'FULL_STACK', 'CYBERSECURITY', 'CLOUD_DEVOPS', 'AI_INTEGRATION', 'INFO_SYSTEMS', 'DATA_ANALYTICS', 'DATA_SCIENCE_ML', 'DATA_ENGINEERING'] as const
  const BANNED = /Deputy Director|Deputy Treasurer|Treasurer|Head of Sponsorship|sponsorship|MAGS|Fixture Night|Fixture Cup|committee|Outside the classroom|communication and teamwork|leading|serving/i
  it('never mentions leadership or soft-skill claims, for any role or vacancy state', () => {
    for (const role of ROLES) for (const c of [SOFT, SEC, DATA, co('z', 'Fixture Z', ['SOFTWARE'], { internship: { ...DATA.internship, evidence: 'HISTORICAL' } })]) {
      const d = A(AKIF, c, { role, attachments: ['RESUME', 'CV'] }); expect(d.body, `${role} ${c.name}`).not.toMatch(BANNED)
      expect(d.body.split('\n\n').length).toBe(5); expect(d.body).toContain('Yours sincerely,\nTest Student Two\n+60 12-222 2222 | akif@example.com'); expect(d.body).toContain('Please find attached my resume and CV.')
    }
  })
  it('closes with a role-specific technical sentence, not one reused sentence', () => {
    const software = A(AKIF, SOFT, { role: 'SOFTWARE' }).body
    expect(software).toContain('I would welcome the opportunity to apply my hands-on experience in web application development and contribute to your software engineering team while continuing to develop my technical skills.')
    const closers = new Set(ROLES.map((r) => A(AKIF, SOFT, { role: r }).body.split('\n\n')[2].split('. ').slice(-1)[0]))
    expect(closers.size).toBeGreaterThanOrEqual(6)
    expect(A(AKIF, SEC, { role: 'CYBERSECURITY' }).body).toMatch(/security work at Fixture Security/)
  })
  it('keeps the college positions in the profile and in the CV evidence, and leaves Adam\'s paragraph exactly as before', async () => {
    const { buildMaster, plainText } = await import('../core/viewer/cvengine.ts')
    expect(AKIF.leadership).toHaveLength(2); expect(plainText(buildMaster(AKIF).ast)).toMatch(/Deputy Director, Fixture Night/)
    expect(A(ADAM, DATA, { role: 'DATA_ANALYTICS' }).body).toContain("Outside the classroom, leading sponsorship and public relations for FixtureFest'26 has strengthened my communication and teamwork skills. I would be glad to bring these strengths to your team while learning from your work in data analytics.")
    const noFlag = { ...AKIF, emailOptions: undefined }; expect(A(noFlag, SOFT, { role: 'SOFTWARE' }).body).toMatch(/Outside the classroom, serving as Deputy Director for Fixture Night/)
  })
})

describe('email workflow through the API', () => {
  let dir: string, api: ReturnType<typeof createViewerApi>, external: string[]
  const copied: string[] = []
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-')); external = []
    fs.writeFileSync(path.join(dir, 'adam.pdf'), '%PDF-1.4 adam'); fs.writeFileSync(path.join(dir, 'cover.pdf'), '%PDF-1.4 adam cover')
    const seed = path.join(dir, 'seed.json'); fs.writeFileSync(seed, JSON.stringify({ version: 1, profiles: [{ ...ADAM, documents: [{ label: 'Resume', kind: 'RESUME', path: path.join(dir, 'adam.pdf') }] }, { ...AKIF, documents: [] }] }))
    fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify({ version: 1, generatedAt: '', sourceFile: 't', sourceSha256: null, companies: [DATA, SOFT, SEC] }))
    api = createViewerApi({ userDataDir: path.join(dir, 'ud'), bundledCatalog: path.join(dir, 'catalog.json'), seedPaths: [seed], ui: { pickFile: async () => null, openPath: async () => '', openExternal: (u: string) => { external.push(u) }, copy: (t: string) => { copied.push(t) } } })
  })
  it('lists only documents that exist and defaults to the resume', async () => {
    const o: any = await api.call('v.email.attachments', { profileId: 'adam', companyId: 'c1' })
    expect(o.options.filter((x: any) => x.available).map((x: any) => x.type)).toEqual(['RESUME']); expect(o.options.find((x: any) => x.type === 'COVER_LETTER')).toMatchObject({ available: false }); expect(o.options.find((x: any) => x.type === 'REFERRAL_LETTER')).toMatchObject({ available: false })
    const d: any = await api.call('v.email.draft', { profileId: 'adam', companyId: 'c1', role: 'DATA_ANALYTICS' }); expect(d.body).toContain('Please find attached my resume.'); expect(d.body).not.toMatch(/cover letter|referral/)
    const none: any = await api.call('v.email.draft', { profileId: 'adam', companyId: 'c1', role: 'DATA_ANALYTICS', attachmentKeys: [] }); expect(none.body).not.toMatch(/attached/)
    const forged: any = await api.call('v.email.draft', { profileId: 'adam', companyId: 'c1', role: 'DATA_ANALYTICS', attachmentKeys: ['missing:COVER_LETTER', 'doc:nope'] }); expect(forged.body).not.toMatch(/cover letter|attached/)
  })
  it('a tailored CV counts as an attachment only once approved; a cover letter once uploaded', async () => {
    const t: any = await api.call('v.cv.tailor', { profileId: 'adam', companyId: 'c1', role: 'DATA_ANALYTICS' })
    let o: any = await api.call('v.email.attachments', { profileId: 'adam', companyId: 'c1' }); expect(o.options.find((x: any) => x.key.startsWith('cv:'))).toMatchObject({ available: false })
    await api.call('v.cv.approve', { id: 'adam', recId: t.rec.id, versionId: t.version.id })
    await api.call('v.docs.add', { id: 'adam', path: path.join(dir, 'cover.pdf'), label: 'Cover letter', kind: 'CV' })
    o = await api.call('v.email.attachments', { profileId: 'adam', companyId: 'c1' }); const d: any = await api.call('v.email.draft', { profileId: 'adam', companyId: 'c1', role: 'DATA_ANALYTICS', attachmentKeys: o.options.filter((x: any) => x.available).map((x: any) => x.key) })
    expect(d.body).toContain('Please find attached my resume, CV and cover letter.'); expect(d.body).not.toMatch(/referral/)
  })
  it('keeps the resume file byte-for-byte unchanged while drafting', async () => {
    const f = () => fs.readdirSync(path.join(dir, 'ud', 'viewer', 'documents', 'adam')).map((n) => fs.readFileSync(path.join(dir, 'ud', 'viewer', 'documents', 'adam', n)).toString('latin1'))
    const before = f(); await api.call('v.email.draft', { profileId: 'adam', companyId: 'c1', role: 'DATA_ANALYTICS' }); await api.call('v.email.draft', { profileId: 'adam', companyId: 'c2' }); expect(f()).toEqual(before)
  })
  it('opens a mail client only for a verified recipient, without claiming attachments, and copies via the API', async () => {
    const d: any = await api.call('v.email.draft', { profileId: 'adam', companyId: 'c1', role: 'DATA_ANALYTICS', attachmentKeys: [], recipientKey: 'EMAIL:hr@fixture.example' }); expect(d.to).toBe('hr@fixture.example')
    await api.call('v.email.mailto', { to: d.to, subject: d.subject, body: d.body }); expect(external[0]).toMatch(/^mailto:hr@fixture\.example\?subject=Application/); expect(decodeURIComponent(external[0])).not.toMatch(/attached/)
    await expect(api.call('v.email.mailto', { to: 'not an address', subject: 's', body: 'b' })).rejects.toThrow(/verified recipient/)
    await api.call('v.copy.text', { text: d.body }); expect(copied.at(-1)).toBe(d.body)
  })
  it('availability can be edited in the profile and is isolated per profile', async () => {
    await api.call('v.profile.patch', { id: 'akif', patch: { availability: { studyYear: 'second-year', confirmed: true } } })
    const k: any = await api.call('v.email.draft', { profileId: 'akif', companyId: 'c2', role: 'FULL_STACK' }); expect(k.body).toContain('second-year Computer Science (Information Systems)')
    const a: any = await api.call('v.email.draft', { profileId: 'adam', companyId: 'c1', role: 'DATA_ANALYTICS' }); expect(a.body).toContain('third-year'); expect(a.body).not.toContain('second-year')
  })
})

describe('terminology', () => {
  it('uses "resume" without the accented spelling in the app, the viewer core and the user-facing docs', () => {
    const files = ['renderer/src/App.tsx', ...fs.readdirSync('renderer/src/viewer').map((f) => `renderer/src/viewer/${f}`), ...fs.readdirSync('core/viewer').map((f) => `core/viewer/${f}`), 'README.md', 'DESIGN.md', 'electron/main.ts']
    for (const f of files) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/r\u00e9sum\u00e9/i)
  })
})
