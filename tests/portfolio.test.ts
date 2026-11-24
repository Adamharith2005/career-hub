import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { portfolioCoverage } from '../core/viewer/portfolio.ts'
import { buildMaster, buildTailored, plainText, unsupportedClaims } from '../core/viewer/cvengine.ts'
import { renderCv } from '../core/viewer/cvpdf.ts'
import { extractPdf } from '../core/cv.ts'

const base = { id: 'x', displayName: 'Test', fullName: 'Test Student Two', specialisation: 'Information Systems', university: 'Test University', degree: 'Bachelor of Computer Science',
  contact: { email: 'two@example.com', phone: '+60 12', location: 'Testville' }, links: [{ label: 'GitHub', url: 'https://github.com/two-fixture' }], headline: '', summary: '',
  education: [{ title: 'Bachelor of Computer Science', institution: 'Test University', dates: '', points: ['Current CGPA: 3.40'] }], skills: [{ group: 'Web', items: ['React', 'TypeScript'] }, { group: 'Cloud', items: ['Terraform', 'AWS'] }], otherRepos: [],
  experience: [{ title: 'Tutor', organisation: 'Fixture Centre', date: '2024', points: ['Delivered lessons.'] }], languages: [], interests: [], internshipWindow: '', availabilityPhrase: '', reviewNotes: [], documents: [], seeded: true,
  leadership: [{ id: 'l1', title: 'Head of Sponsorship', organisation: 'Fixture Cup', date: '2026', year: 2026, points: [] }],
  awards: [{ title: 'Top 5, Fixture Sprouts (2026): Alpha (team project)', detail: '', date: '2026' }], master: { headline: 'Fixture headline', summary: 'A newly written fixture summary that is not from any old resume.' },
  projects: [
    { id: 'alpha', title: 'Alpha — Assistive Platform', context: 'Fixture Sprouts | Team project', date: '2026', status: 'PROTOTYPE', stack: ['React', 'TypeScript', 'Zod'], points: [], caveat: '', url: null, master: 1, masterBullets: 2, award: 'Top 5, Fixture Sprouts (2026), team project', themes: ['SOFTWARE', 'AI_INTEGRATION'], bullets: [{ text: 'Built a React and TypeScript recognition app that runs on the device.', evidence: 'README' }, { text: 'Added encrypted handover files.', evidence: 'docs' }] },
    { id: 'beta', title: 'Beta — Gallery Platform', context: 'Solo build', date: '2026', status: 'LIVE', stack: ['TypeScript', 'Hono', 'Cloudflare Workers'], points: [], caveat: '', url: null, master: 2, masterBullets: 2, themes: ['CLOUD_DEVOPS', 'SOFTWARE'], bullets: [{ text: 'Built a Hono API on Cloudflare Workers with token checks.', evidence: 'README' }] },
    { id: 'fyp', title: 'Cloud Analyzer', context: 'Final Year Project', date: '2027', status: 'IN_PROGRESS', stack: ['Terraform', 'AWS', 'Python'], points: [], caveat: '', url: null, master: 3, masterBullets: 1, themes: ['CYBERSECURITY', 'CLOUD_DEVOPS'], bullets: [{ text: 'In-progress prototype analysing Terraform AWS configurations. Not yet benchmarked.', evidence: 'README' }] },
    { id: 'gamma', title: 'Gamma — Group App', context: 'Group project', date: '2025', status: 'UNKNOWN', stack: ['Java'], points: [], caveat: '', url: null, contribution: 'TEAM_UNCERTAIN', master: null, bullets: [] },
    { id: 'delta', title: 'Delta — Menu Bar App', context: 'Solo', date: '2026', status: 'LIVE', stack: ['Swift'], points: [], caveat: '', url: null, master: null, additional: 'Swift menu-bar app.', additionalLabel: 'Delta' }] } as any

describe('portfolio inventory', () => {
  it('coverage reports missing ids and uncertain projects on the master', () => {
    const c = portfolioCoverage(base, ['alpha', 'beta', 'fyp', 'gamma', 'delta', 'ghost'])
    expect(c.missing).toEqual(['ghost']); expect(c.noBullets).toEqual([]); expect(c.uncertainOnMaster).toEqual([])
  })
  it('the master is built from the inventory, not the old points, and keeps the award and all leadership', () => {
    const m = buildMaster(base); const t = plainText(m.ast)
    expect(m.ast.sections.map((s) => s.title)).toEqual(['Education', 'Selected Technical Projects', 'Additional Projects', 'Skills', 'Awards & Competitions', 'Leadership & College Involvement', 'Work Experience'])
    expect(m.ast.summary!.text).toBe(base.master.summary); expect(m.ast.header.headline).toBe('Fixture headline')
    expect(t).toMatch(/Top 5, Fixture Sprouts/); expect(t).toMatch(/Head of Sponsorship, Fixture Cup/); expect(t).not.toMatch(/Gamma/); expect(t).toMatch(/In progress/)
    expect(unsupportedClaims(base, m.ast)).toEqual([])
  })
  it('tailoring picks different projects by role and never uses an uncertain contribution', () => {
    const sec = buildTailored(base, { company: 'SecCo', role: 'CYBERSECURITY', vacancy: 'NONE' }), cloud = buildTailored(base, { company: 'CloudCo', role: 'FULL_STACK', vacancy: 'NONE' })
    const first = (b: ReturnType<typeof buildTailored>) => b.ast.sections.find((s) => s.kind === 'projects')!.items![0].heading
    expect(first(sec)).toMatch(/Cloud Analyzer/); expect(first(cloud)).not.toMatch(/Cloud Analyzer/)
    expect(plainText(sec.ast) + plainText(cloud.ast)).not.toMatch(/Gamma/)
    expect(plainText(sec.ast)).toMatch(/Top 5, Fixture Sprouts/)
  })
  it('the PDF is real text, fits two pages, keeps links and shows the award', async () => {
    const pdf = await renderCv(buildMaster(base).ast, { targetPages: 2 })
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-'); expect(pdf.pages).toBeLessThanOrEqual(2); expect(pdf.fontSize).toBeGreaterThanOrEqual(10)
    const x: any = await extractPdf(new Uint8Array(pdf.buffer)); const text: string = x.text ?? (x.lines ?? []).join('\n')
    for (const s of ['Test Student Two', 'Fixture headline', 'Top 5, Fixture Sprouts', 'Head of Sponsorship, Fixture Cup', 'Technologies: React', 'Education']) expect(text).toContain(s)
    expect(text).not.toMatch(/undefined|\[object|TODO|lorem/i); expect((x.links ?? []).join(' ')).toMatch(/github\.com\/two-fixture/)
  })
})

describe('Akif private inventory (runs only where the private seed exists)', () => {
  const seed = path.resolve('private/profile-seed.json')
  const has = fs.existsSync(seed)
  it.skipIf(!has)('covers every required project, labels the FYP honestly and keeps Tanda\'s Top 5', () => {
    const akif = JSON.parse(fs.readFileSync(seed, 'utf8')).profiles.find((p: any) => p.id === 'akif')
    const c = portfolioCoverage(akif, ['tanda', 'lensasamsol', 'kaispagi', 'lestari', 'nbaglass', 'fragrance-web', 'um-inventory', 'fyp-cloudguard', 'greenmarketplace', 'lorong', 'bangsen'])
    expect(c.missing).toEqual([]); expect(c.noBullets).toEqual([]); expect(c.uncertainOnMaster).toEqual([])
    const by = (id: string) => akif.projects.find((p: any) => p.id === id)
    expect(by('fyp-cloudguard').status).toBe('IN_PROGRESS'); expect(by('fyp-cloudguard').bullets.map((b: any) => b.text).join(' ')).toMatch(/not yet benchmarked/i)
    expect(by('greenmarketplace').id).not.toBe(by('lestari').id); expect(by('greenmarketplace').contribution).toBe('TEAM_UNCERTAIN')
    expect(akif.awards.map((a: any) => a.title).join(' ')).toMatch(/Top 5, UMSprouts 9\.0 \(2026\)/)
    expect(by('tanda').master).toBe(1); expect(akif.leadership).toHaveLength(6)
    const m = plainText(buildMaster(akif).ast); expect(m).toMatch(/Top 5, UMSprouts 9\.0 \(2026\)/); expect(m).toMatch(/Tanda/); expect(m).not.toMatch(/Green ?Marketplace/)
    expect(unsupportedClaims(akif, buildMaster(akif).ast)).toEqual([])
  })
})
