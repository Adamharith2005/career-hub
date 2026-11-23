import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, it, expect, afterAll } from 'vitest'
import { makeEnv, type TestEnv } from './helpers.ts'
import { MIGRATIONS, openDb, all, get } from '../core/db.ts'
import { parseCvText } from '../core/cv.ts'
import { cleanSkillItems, skillProblem, validateFact, auditFacts } from '../core/integrity.ts'
import { buildResume, resumeText, type ResumeAST } from '../core/resume.ts'
import * as P from '../core/profiles.ts'
import * as C from '../core/companies.ts'
import { targetFit, TARGET_WEIGHTS, SCORE_CEILING } from '../core/target.ts'
import { profileCompletion } from '../core/completion.ts'
import { slugify } from '../core/domain.ts'

const envs: TestEnv[] = []
const mk = async () => { const t = await makeEnv(); envs.push(t); return t }
afterAll(() => envs.forEach((e) => e.cleanup()))

/** Fictional people only. Everything is entered through the structured API — no resume is ever uploaded. */
async function structured(t: TestEnv, who: 'ada' | 'bee') {
  const { h } = t.api
  const name = who === 'ada' ? 'Ada Fixture' : 'Bee Sample'
  const p: any = await h['profile.create']({ name })
  await h['profile.switch']({ id: p.profile_id })
  await h['profile.update']({
    roles: who === 'ada' ? ['data', 'swe'] : ['cyber'], primary_role: who === 'ada' ? 'data' : 'cyber', career_types: ['INTERNSHIP'],
    identity: { fullName: name, email: `${who}@example.com`, github: `https://github.com/${who}-fixture` },
    prefs: { internshipStart: 'March 2027', internshipEnd: 'August 2027' }, onboarding_done: true,
  })
  await h['folder.set']({ path: path.join(t.dir, `root-${who}`) })
  const save = (f: any) => h['facts.save'](f)
  await save({ category: 'EDUCATION', title: 'Bachelor of Computer Science (Hons)', organization: 'Universiti Fixture Malaysia', date_start: '2023', date_end: '2027', claim_text: '', tools: [], details: { level: 'Bachelor', cgpa: '3.6', cgpaScale: '4.0' } })
  if (who === 'ada') {
    await save({ category: 'SKILL', title: 'Languages', tools: ['Python', 'JavaScript', 'SQL'] })
    await save({ category: 'SKILL', title: 'Tools', tools: ['Git', 'Docker', 'Linux', 'Power BI'] })
    await save({ category: 'SKILL', title: 'Frameworks', tools: ['React', 'Express'] })
    await save({ category: 'PROJECT', title: 'Sales Insights Dashboard', date_start: 'Jan 2025', date_end: 'Mar 2025', tools: ['Python', 'Pandas', 'SQL', 'Power BI'], details: { projectType: 'personal' },
      claim_text: 'Cleaned and joined weekly sales exports with Pandas.\nBuilt a Power BI dashboard for weekly sales trends.' })
    await save({ category: 'PROJECT', title: 'Home Lab Monitoring Stack', date_start: 'Jun 2024', date_end: 'Aug 2024', tools: ['Docker', 'Linux', 'Bash', 'GitHub Actions'], details: { projectType: 'personal' },
      claim_text: 'Containerised a monitoring stack with Docker Compose.\nAutomated deployment checks with GitHub Actions.' })
    await save({ category: 'PROJECT', title: 'Campus Events Web App', date_start: 'Sep 2024', date_end: 'Dec 2024', tools: ['React', 'Node.js', 'JavaScript', 'Express'], details: { projectType: 'academic' },
      claim_text: 'Built a React front end and Express API for event sign-up.' })
    await save({ category: 'LEADERSHIP', title: 'Treasurer', organization: 'Computer Science Society', date_start: '2024', date_end: '2025', claim_text: 'Managed the society budget and organised workshops.' })
  } else {
    await save({ category: 'SKILL', title: 'Security Tools', tools: ['Wireshark', 'Nmap', 'Linux'] })
    await save({ category: 'SKILL', title: 'Languages', tools: ['Python', 'Bash'] })
    await save({ category: 'PROJECT', title: 'Port Scanner Lab', date_start: 'Feb 2025', date_end: 'Apr 2025', tools: ['Python', 'Nmap'], claim_text: 'Wrote a small port scanner and documented findings.' })
  }
  return p
}
const cid = (name: string) => `cj-${slugify(name, 60)}`

// ------------------------------------------------------------------------------------------------
describe('V2-A. Category integrity (the "Skills: ACTIVITIES & INVOLVEMENT" family of bugs)', () => {
  const CV = ['Alex Tester', 'alex@example.com | Cyberjaya, Malaysia', 'SKILLS', 'Languages: Python, Java', 'Tools: Git, Docker', 'ACTIVITIES & INVOLVEMENT', 'Procurement Officer | Fixture Club', 'Jan 2023 - Dec 2023', ' Led a team of five volunteers', 'REFERENCES', 'Available on request'].join('\n')

  it('parser: an unknown/extra heading ends the skills section; no garbage becomes a skill', () => {
    const r = parseCvText(CV, 'x')
    const skills = r.facts.filter((f) => f.category === 'SKILL')
    expect(skills.map((s) => s.title)).toEqual(['Languages', 'Tools'])
    const flat = skills.flatMap((s) => s.tools ?? [])
    for (const bad of ['ACTIVITIES & INVOLVEMENT', 'Jan 2023 - Dec 2023', 'procurement', 'Procurement Officer']) expect(flat.join('|').toLowerCase()).not.toContain(bad.toLowerCase())
    expect(r.facts.some((f) => f.category === 'LEADERSHIP' && /Procurement Officer/.test(f.title))).toBe(true)
    expect(r.warnings.join(' ')).toMatch(/REFERENCES/)
  })
  it('parser: PDF private-use bullet glyphs never survive as "?" or stray characters', () => {
    const r = parseCvText(CV, 'x')
    const lead = r.facts.find((f) => f.category === 'LEADERSHIP')!
    expect(lead.claim_text).toBe('Led a team of five volunteers')
    expect(JSON.stringify(r.facts)).not.toMatch(/[-�]/)
  })
  it('skill rules reject headings, dates, sentences; keep real skills; dedupe', () => {
    for (const bad of ['ACTIVITIES & INVOLVEMENT', 'Jan 2023 - Dec 2023', '2024', 'Leadership', 'Built a web app for the society using React.', '?']) expect(skillProblem(bad), bad).not.toBeNull()
    expect(cleanSkillItems(['Python', 'python', ' • SQL', 'Power BI', 'Education']).kept).toEqual(['Python', 'SQL', 'Power BI'])
  })
  it('manual entry is validated by category before saving', async () => {
    const t = await mk(); const { h } = t.api
    await h['profile.create']({ name: 'Cat Tester' })
    await expect(h['facts.save']({ category: 'SKILL', title: 'Languages', tools: ['Python', 'ACTIVITIES & INVOLVEMENT'] })).rejects.toThrow(/can't be a skill/)
    await expect(h['facts.save']({ category: 'SKILL', title: 'Jan 2023 - Dec 2023', tools: ['Python'] })).rejects.toThrow(/skill category/)
    await expect(h['facts.save']({ category: 'PROJECT', title: '' })).rejects.toThrow(/name/i)
    expect(validateFact({ category: 'PROJECT', title: 'Real Project' })).toEqual([])
  })
  it('defence in depth: legacy garbage already stored never reaches the resume, and is reported by the audit', async () => {
    const t = await mk(); const { h } = t.api
    const p: any = await h['profile.create']({ name: 'Legacy User' })
    P.addFact(t.env.db, p.profile_id, { category: 'EDUCATION', title: 'BSc Computer Science', organization: 'Uni Legacy', confirmed: true })
    P.addFact(t.env.db, p.profile_id, { category: 'SKILL', title: 'Languages', tools: ['Python', 'SQL'], confirmed: true })
    P.addFact(t.env.db, p.profile_id, { category: 'SKILL', title: 'Skills', tools: ['ACTIVITIES & INVOLVEMENT', 'Jan 2023 - Dec 2023'], confirmed: true })
    P.addFact(t.env.db, p.profile_id, { category: 'SKILL', title: 'Procurement', tools: ['Sourcing'], confirmed: true })
    P.addFact(t.env.db, p.profile_id, { category: 'PROJECT', title: 'Legacy Project', claim_text: ' Did a thing with Python', tools: ['Python'], confirmed: true })
    const facts = P.listFacts(t.env.db, p.profile_id)
    expect(auditFacts(facts).length).toBeGreaterThan(0)
    const ast = buildResume(P.getProfile(t.env.db, p.profile_id)!, facts, { required: [], preferred: [], roleFamily: 'swe', title: 'Software Intern', company: 'X' })
    const txt = resumeText(ast)
    expect(txt).not.toMatch(/ACTIVITIES|Jan 2023|Procurement|\?\s|[-]/)
    expect(txt).toMatch(/Languages: Python, SQL/)
    expect(txt).toMatch(/Did a thing with Python/)
    expect(ast.sections.filter((s) => s.title === 'Education')).toHaveLength(1)
  })
})

describe('V2-B. Migration and backup (no destructive reset)', () => {
  it('upgrades a v1 database in place, keeps every row, and writes a backup first', async () => {
    const t = await mk()
    const f = path.join(t.dir, 'old.db')
    const raw = new DatabaseSync(f)
    raw.exec(MIGRATIONS[0]); raw.exec('PRAGMA user_version = 1')
    raw.prepare(`INSERT INTO profiles (profile_id,name,slug,created_at,updated_at,onboarding_done,onboarding_step) VALUES ('pr_old','Old User','old-user','2026-01-01','2026-01-01',0,3)`).run()
    raw.prepare(`INSERT INTO facts (fact_id,profile_id,category,title,claim_text,confirmed,created_at) VALUES ('f_old','pr_old','PROJECT','Kept Project','Built it',1,'2026-01-02')`).run()
    raw.close()
    const db = openDb(f)
    expect((get<any>(db, 'PRAGMA user_version'))!.user_version).toBe(MIGRATIONS.length)
    const fact = P.listFacts(db, 'pr_old')[0]
    expect(fact.title).toBe('Kept Project'); expect(fact.details).toEqual({}); expect(fact.updated_at).toBe('2026-01-02')
    expect(P.getProfile(db, 'pr_old')!.name).toBe('Old User')
    expect(P.getProfile(db, 'pr_old')!.onboarding_step).toBe(1)          // unfinished wizard restarts, data intact
    const bak = `${f}.pre-v1-to-v${MIGRATIONS.length}.bak`
    expect(fs.existsSync(bak)).toBe(true)
    const old = new DatabaseSync(bak)
    expect((old.prepare('PRAGMA user_version').get() as any).user_version).toBe(1)
    expect((old.prepare('SELECT title FROM facts').get() as any).title).toBe('Kept Project')
    old.close(); (db as any).close()
  })
  it('does not create a backup when the database is already current', async () => {
    const t = await mk()
    const f = path.join(t.dir, 'cur.db'); (openDb(f) as any).close(); (openDb(f) as any).close()
    expect(fs.readdirSync(t.dir).filter((n) => n.startsWith('cur.db.pre-'))).toEqual([])
  })
})

describe('V2-C. Profile-first setup without any resume upload', () => {
  it('a new person reaches "ready to tailor" with structured entries only, and it survives a restart', async () => {
    const t = await mk(); const { h } = t.api
    await structured(t, 'ada')
    expect(all(t.env.db, 'SELECT * FROM source_documents')).toHaveLength(0)    // nothing uploaded
    const c: any = await h['profile.completion']()
    expect(c.ready).toBe(true); expect(c.requiredDone).toBe(c.requiredTotal)
    const facts = P.listFacts(t.env.db, (await h['boot']() as any).activeProfileId)
    expect(facts.filter((f) => f.category === 'EDUCATION')).toHaveLength(1)
    expect(facts.find((f) => f.category === 'PROJECT' && f.title === 'Sales Insights Dashboard')!.details.projectType).toBe('personal')
    expect(facts.find((f) => f.category === 'EDUCATION')!.details.cgpa).toBe('3.6')
    // restart: reopen the same file
    const db2 = openDb(t.dbFile)
    const again = P.listFacts(db2, facts[0].profile_id)
    expect(again.map((f) => f.fact_id).sort()).toEqual(facts.map((f) => f.fact_id).sort())
    ;(db2 as any).close()
  })
  it('completion is a transparent checklist; a sparse profile points at ONE next step', async () => {
    const t = await mk(); const { h } = t.api
    await h['profile.create']({ name: 'Sparse Person' })
    const c: any = await h['profile.completion']()
    expect(c.ready).toBe(false); expect(c.next.key).toBe('roles')
    expect(c.items.every((i: any) => typeof i.hint === 'string' && i.hint.length > 5)).toBe(true)
    await h['profile.update']({ roles: ['swe'] })
    expect(((await h['profile.completion']()) as any).next.key).toBe('education')
  })
  it('multiple education and project records stay in their own categories', async () => {
    const t = await mk(); const { h } = t.api
    await structured(t, 'ada')
    await h['facts.save']({ category: 'EDUCATION', title: 'Diploma in Information Technology', organization: 'Kolej Fixture', date_start: '2020', date_end: '2022', tools: [] })
    const facts: any[] = await h['facts.list']()
    expect(facts.filter((f) => f.category === 'EDUCATION')).toHaveLength(2)
    expect(facts.filter((f) => f.category === 'PROJECT')).toHaveLength(3)
    expect(auditFacts(facts)).toEqual([])
    const ast = buildResume(P.getProfile(t.env.db, facts[0].profile_id)!, facts, { required: [], preferred: [], roleFamily: 'swe', title: 'X', company: 'Y' })
    expect(ast.sections.find((s) => s.kind === 'education')!.items).toHaveLength(2)
  })
  it('optional evidence: only PDF/PNG/JPG/DOCX up to 10 MB, attached to one record of this profile only', async () => {
    const t = await mk(); const { h } = t.api
    await structured(t, 'ada')
    const proj: any = (await h['facts.list']()).find((f: any) => f.title === 'Sales Insights Dashboard')
    const bad = path.join(t.dir, 'x.exe'); fs.writeFileSync(bad, 'MZ')
    await expect(h['evidence.attach']({ factId: proj.fact_id, path: bad })).rejects.toThrow(/PDF, PNG, JPG or DOCX/)
    const big = path.join(t.dir, 'big.pdf'); fs.writeFileSync(big, Buffer.alloc(10 * 1024 * 1024 + 1))
    await expect(h['evidence.attach']({ factId: proj.fact_id, path: big })).rejects.toThrow(/10 MB/)
    const ok = path.join(t.dir, 'writeup.pdf'); fs.writeFileSync(ok, '%PDF-1.4 fixture')
    expect(((await h['evidence.attach']({ factId: proj.fact_id, path: ok })) as any).name).toBe('writeup.pdf')
    expect(await h['evidence.list']()).toHaveLength(1)
    await structured(t, 'bee')
    expect(await h['evidence.list']()).toHaveLength(0)               // other profile sees nothing
    await expect(h['evidence.attach']({ factId: proj.fact_id, path: ok })).rejects.toThrow(/not found/)
  })
})

describe('V2-D. Cyberjaya directory and location rules', () => {
  it('keeps all 78 seed records with unique ids; every one is Cyberjaya; uncertain offices are flagged, not confirmed', async () => {
    const t = await mk(); const { h } = t.api
    await structured(t, 'ada')
    const list: any[] = await h['companies.list']({})
    expect(list).toHaveLength(78)
    expect(new Set(list.map((c) => c.company_id)).size).toBe(78)
    expect(list.every((c) => ['VERIFIED', 'CITY_ONLY'].includes(c.location.state))).toBe(true)
    for (const c of list) if (c.flags.includes('BROAD_ADDRESS')) { expect(c.location.state).toBe('CITY_ONLY'); expect(c.location.note).toMatch(/not confirmed/) }
    expect(list.filter((c) => c.location.state === 'CITY_ONLY').length).toBeGreaterThanOrEqual(6)
    expect(list.every((c) => !/ \? /.test(c.cs_relevance ?? ''))).toBe(true)       // mojibake repaired for display
  })
  it('an out-of-Cyberjaya company never appears in the main directory; an address-less one appears with a verify note', async () => {
    const t = await mk(); const { h } = t.api
    await structured(t, 'ada')
    await h['companies.add']({ name: 'Faraway Labs', address: '12 Jalan Ampang, 50450 Kuala Lumpur' })
    await h['companies.add']({ name: 'Nowhere Systems' })
    await h['companies.add']({ name: 'Mine Cyberjaya', address: 'Block A, Cyber 3, 63000 Cyberjaya' })
    const names = ((await h['companies.list']({})) as any[]).map((c) => c.name)
    expect(names).not.toContain('Faraway Labs')
    const nowhere = ((await h['companies.list']({})) as any[]).find((c) => c.name === 'Nowhere Systems')
    expect(nowhere.location.state).toBe('UNKNOWN'); expect(nowhere.location.note).toMatch(/confirm/i)
    expect(((await h['companies.list']({})) as any[]).find((c) => c.name === 'Mine Cyberjaya').location.state).toBe('CITY_ONLY')
  })
  it('a directory entry is never presented as a live opening', async () => {
    const t = await mk(); const { h } = t.api
    await structured(t, 'ada')
    for (const c of (await h['companies.list']({})) as any[]) {
      const v = c.fit.vacancy
      if (c.status_enum === 'VERIFIED_ACTIVE_VACANCY') { expect(v.state).toBe('HISTORICAL_LISTING'); expect(v.detail).toMatch(/historical/i) }
      else { expect(v.state).toBe('NOT_VERIFIED'); expect(v.headline).toBe('No current opening verified; speculative inquiry may be possible') }
      expect(JSON.stringify(v)).not.toMatch(/currently hiring|is hiring|open position|now open/i)
    }
  })
})

describe('V2-E. Company target fit (explainable, per profile, confidence-aware)', () => {
  it('weights are documented and sum to 1', () => {
    expect(Object.values(TARGET_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
  })
  it('shows NO number until the profile has roles plus some evidence', async () => {
    const t = await mk(); const { h } = t.api
    await h['profile.create']({ name: 'Empty Person' })
    expect(((await h['companies.list']({})) as any[])[0].fit.score).toBeNull()
    await h['profile.update']({ roles: ['data'] })
    const f = ((await h['companies.list']({})) as any[])[0].fit
    expect(f.status).toBe('insufficient'); expect(f.label).toBe('Not enough profile information'); expect(f.score).toBeNull(); expect(f.missingProfile.length).toBeGreaterThan(0)
  })
  it('changing role focus changes the ranking; scores are derived, rounded to 5, labelled and explained', async () => {
    const t = await mk(); const { h } = t.api
    await structured(t, 'ada')
    const top = (focus: string[]) => ((h['companies.list']({ focusRoles: focus }) as Promise<any[]>)).then((l) => [...l].sort((a, b) => b.fit.score - a.fit.score || a.name.localeCompare(b.name)))
    const data = await top(['data']), cyber = await top(['cyber'])
    expect(data.slice(0, 8).map((c) => c.name)).not.toEqual(cyber.slice(0, 8).map((c) => c.name))
    const exp = data.find((c) => c.company_id === cid('Experian Malaysia')), expCyber = cyber.find((c) => c.company_id === cid('Experian Malaysia'))
    expect(exp.fit.score).toBeGreaterThan(expCyber.fit.score)
    for (const c of data) { expect(c.fit.score % 5).toBe(0); expect(['Excellent target', 'Strong target', 'Possible target', 'Low match']).toContain(c.fit.label); expect(c.fit.reasons.length).toBeGreaterThan(0); expect(c.fit.components).toHaveLength(4) }
    const cs = data.find((c) => c.company_id === cid('CyberSecurity Malaysia'))
    expect(cs.fit.roleAlignment).toBe('Low'); expect(cs.fit.components.find((x: any) => x.key === 'role').value).toBeLessThan(0.6)
  })
  it('never shows 100; the ceiling follows evidence confidence (HIGH 95 / MEDIUM 90 / LOW 75)', async () => {
    const t = await mk(); const { h } = t.api
    await structured(t, 'bee')
    const list = (await h['companies.list']({})) as any[]
    for (const c of list) { expect(c.fit.score).toBeLessThanOrEqual(SCORE_CEILING[c.fit.confidence as keyof typeof SCORE_CEILING]); expect(c.fit.score).toBeLessThan(100) }
    const thin: any = await h['profile.create']({ name: 'Thin Profile' }); await h['profile.update']({ roles: ['cyber'], primary_role: 'cyber' })
    await h['facts.save']({ category: 'SKILL', title: 'Security Tools', tools: ['Wireshark', 'Nmap', 'Linux'] })
    const lowList = (await h['companies.list']({})) as any[]
    expect(lowList.every((c) => c.fit.confidence === 'LOW' && c.fit.score <= 75)).toBe(true)
    expect(thin.profile_id).toBeTruthy()
  })
  it('ignores the research "suitability" and "contact" scores entirely (no disguised prestige)', async () => {
    const t = await mk(); const { h } = t.api
    await structured(t, 'ada')
    const c: any = (await h['companies.get']({ id: cid('Experian Malaysia') }))
    const facts = P.listFacts(t.env.db, c.profile_id ?? (await h['boot']() as any).activeProfileId)
    const prof = P.getProfile(t.env.db, (await h['boot']() as any).activeProfileId)!
    const a = targetFit({ profile: prof, facts, company: { ...c, suitability_score: 10, contact_score: 1 } })
    const b = targetFit({ profile: prof, facts, company: { ...c, suitability_score: 100, contact_score: 10 } })
    expect(a.score).toBe(b.score)
  })
  it('unknown is not "missing": no projects ⇒ lower CONFIDENCE and a capped label, not a harsh rejection', async () => {
    const t = await mk(); const { h } = t.api
    const p: any = await h['profile.create']({ name: 'Skills Only' })
    await h['profile.update']({ roles: ['data'], primary_role: 'data' })
    await h['facts.save']({ category: 'SKILL', title: 'Languages', tools: ['Python', 'SQL', 'Pandas'] })
    const e: any = await h['companies.get']({ id: cid('Experian Malaysia') })
    expect(e.fit.status).toBe('scored'); expect(e.fit.confidence).toBe('LOW')
    expect(e.fit.components.find((x: any) => x.key === 'projects').value).toBeNull()
    expect(['Excellent target', 'Strong target']).not.toContain(e.fit.label)
    expect(e.fit.missingProfile.join(' ')).toMatch(/project/i)
  })
  it('recomputes when the profile changes: two people, two different results, no leakage', async () => {
    const t = await mk(); const { h } = t.api
    const ada: any = await structured(t, 'ada'); const bee: any = await structured(t, 'bee')   // bee is active now
    const beeFit = ((await h['companies.get']({ id: cid('CyberSecurity Malaysia') })) as any).fit
    await h['profile.switch']({ id: ada.profile_id })
    const adaFit = ((await h['companies.get']({ id: cid('CyberSecurity Malaysia') })) as any).fit
    expect(beeFit.score).toBeGreaterThan(adaFit.score)
    expect(JSON.stringify(beeFit)).not.toMatch(/Sales Insights|Home Lab|Campus Events/)
    expect(JSON.stringify(adaFit)).not.toMatch(/Port Scanner/)
    await h['companies.shortlist']({ id: cid('CyberSecurity Malaysia'), on: true })
    expect(((await h['companies.list']({ shortlistedOnly: true })) as any[]).map((c) => c.name)).toEqual(['CyberSecurity Malaysia'])
    await h['profile.switch']({ id: bee.profile_id })
    expect(await h['companies.list']({ shortlistedOnly: true })).toHaveLength(0)
  })
})

describe('V2-F. Company-specific, evidence-grounded drafts (manual only)', () => {
  const heading = (ast: ResumeAST, kind: string, i = 0) => ast.sections.find((s) => s.kind === kind)!.items![i].heading
  async function draft(t: TestEnv, name: string, title: string, fam: string) {
    const { h } = t.api
    const appId: string = await h['app.create']({ companyId: cid(name), company: name, title, roleFamily: fam, careerType: 'INTERNSHIP', mode: 'SPECULATIVE_OUTREACH' })
    const gen: any = await h['docs.generate']({ appId })
    expect(gen.ok, JSON.stringify(gen.issues)).toBe(true)
    const full: any = await h['app.get']({ id: appId })
    const resume = full.docs.find((d: any) => d.doc_type === 'RESUME').ast as ResumeAST
    const letter = full.docs.find((d: any) => d.doc_type === 'COVER_LETTER').ast
    const email: any = await h['email.compose']({ appId, kind: 'SPECULATIVE' })
    return { appId, resume, letter, email: email.draft, status: full.app.status, gen }
  }
  it('data vs cloud vs software employers get different emphasis and wording from the SAME facts', async () => {
    const t = await mk(); await structured(t, 'ada')
    const data = await draft(t, 'Experian Malaysia', 'Data Analyst Intern', 'data')
    const cloud = await draft(t, 'Equinix Malaysia (KL2)', 'Cloud Operations Intern', 'cloud_devops')
    const swe = await draft(t, 'Sigma Rectrix Systems', 'Software Engineering Intern', 'swe')
    expect(heading(data.resume, 'projects')).toBe('Sales Insights Dashboard')
    expect(heading(cloud.resume, 'projects')).toBe('Home Lab Monitoring Stack')
    expect(data.resume.summary!.text).toMatch(/Interested in Data Science/); expect(cloud.resume.summary!.text).toMatch(/Interested in Cloud/)
    const lt = (x: any) => x.letter.paragraphs.map((p: any) => p.text).join('\n')
    expect(lt(data)).not.toEqual(lt(cloud)); expect(lt(cloud)).not.toEqual(lt(swe)); expect(lt(data)).not.toEqual(lt(swe))
    expect(lt(data)).toMatch(/data analytics/i); expect(lt(cloud)).toMatch(/data centres/i)
    expect(data.email.body).not.toEqual(cloud.email.body)
    expect(data.email.body).toMatch(/Data Analytics/i); expect(cloud.email.body).toMatch(/Data Centres/i)
    // not find-and-replace: stripping the company name still leaves different documents
    const strip = (s: string, n: string) => s.split(n).join('')
    expect(strip(lt(data), 'Experian Malaysia')).not.toEqual(strip(lt(cloud), 'Equinix Malaysia (KL2)'))
  })
  it('only confirmed facts appear: no invented skills/tools/metrics, and a missing JD skill is not added', async () => {
    const t = await mk(); const { h } = t.api; await structured(t, 'ada')
    const d = await draft(t, 'Experian Malaysia', 'Data Analyst Intern', 'data')
    const own = new Set(P.listFacts(t.env.db, (await h['boot']() as any).activeProfileId).flatMap((f) => f.tools.map((x) => x.toLowerCase())))
    const skillVals = d.resume.sections.find((s) => s.kind === 'skills')!.skillGroups!.flatMap((g) => g.values)
    for (const v of skillVals) expect(own.has(v.toLowerCase()), v).toBe(true)
    expect(skillVals).not.toContain('Tableau'); expect(skillVals).not.toContain('Spark')       // typical for the field, but not the user's
    expect(JSON.stringify([d.resume, d.letter, d.email])).not.toMatch(/Tableau|Spark|Kubernetes|Terraform/)
    expect(resumeText(d.resume)).not.toMatch(/\?\s|ACTIVITIES|[-]/)
  })
  it('speculative drafts never claim an opening exists; preparing a draft never marks Applied', async () => {
    const t = await mk(); const { h } = t.api; await structured(t, 'ada')
    const d = await draft(t, 'Equinix Malaysia (KL2)', 'Cloud Operations Intern', 'cloud_devops')
    expect(d.email.body).toMatch(/no advertised opening|enquiry rather than an application/i)
    expect(d.letter.paragraphs[0].text).toMatch(/enquiry rather than an application/)
    expect(d.letter.paragraphs[0].text).not.toMatch(/apply for the/i)
    expect(d.status).not.toBe('APPLIED')
    expect(((await h['app.get']({ id: d.appId })) as any).app.applied_at).toBeNull()
    expect(d.gen.resume.qa.passed).toBe(true)
    expect(d.gen.resume.pdf.path).toMatch(/Resume_Ada-Fixture_equinix/i)
  })
  it('regenerating never overwrites a previous export (versions) and files stay inside the profile folder', async () => {
    const t = await mk(); const { h } = t.api; await structured(t, 'ada')
    const d = await draft(t, 'Experian Malaysia', 'Data Analyst Intern', 'data')
    const again: any = await h['docs.generate']({ appId: d.appId })
    expect(again.resume.version).toBe(2)
    const docs: any[] = ((await h['app.get']({ id: d.appId })) as any).docs.filter((x: any) => x.doc_type === 'RESUME')
    expect(docs).toHaveLength(2); expect(docs.every((x) => fs.existsSync(x.pdf_path) && fs.existsSync(x.docx_path))).toBe(true)
    expect(new Set(docs.map((x) => x.pdf_path)).size).toBe(2)
    expect(docs[0].pdf_path.startsWith(path.join(t.dir, 'root-ada'))).toBe(true)
  })
  it('profile isolation: Bee\'s documents contain none of Ada\'s facts', async () => {
    const t = await mk(); const { h } = t.api
    await structured(t, 'ada'); await structured(t, 'bee')   // bee active
    const d = await draft(t, 'CyberSecurity Malaysia', 'Cybersecurity Intern', 'cyber')
    const blob = JSON.stringify([d.resume, d.letter, d.email])
    expect(blob).not.toMatch(/Ada|Sales Insights|Home Lab|Campus Events|Power BI|ada@example|ada-fixture/)
    expect(blob).toMatch(/Bee Sample/); expect(blob).toMatch(/Port Scanner Lab/)
    await h['profile.switch']({ id: (all<any>(t.env.db, `SELECT profile_id FROM profiles WHERE name='Ada Fixture'`)[0]).profile_id })
    expect(await h['app.list']({})).toHaveLength(0)
  })
})

describe('V2-G. Scope guard: nothing in this phase sends or reads email', () => {
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)])
  it('no mail/OAuth dependencies, no send/inbox API handlers, no transport code', async () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((n) => /nodemailer|googleapis|google-auth|imap|smtp|mailparser|emailjs|msal/i.test(n))).toEqual([])
    const t = await mk()
    expect(Object.keys(t.api.h).filter((k) => /send|oauth|inbox|smtp|imap|sync|poll/i.test(k) && !/syncMaster/.test(k))).toEqual([])
    const src = ['core', 'electron', 'renderer/src'].flatMap(walk).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n')
    expect(src).not.toMatch(/createTransport|OAuth2Client|users\.messages|smtp:\/\/|imap:\/\/|gmail\.googleapis\.com/i)
  })
})
