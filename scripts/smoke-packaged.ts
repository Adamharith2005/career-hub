// Smoke-tests the PACKAGED executable (release/…/Career Hub.exe): boots, imports a CV (pdf.js), generates PDF+DOCX, saves an .eml.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright'
import { makeCvPdf, JD_CYBER } from '../tests/helpers.ts'

const dir = fs.readdirSync('release').find((d) => d.startsWith('Career Hub-'))
if (!dir) throw new Error('Run `npm run package` first')
const exe = path.resolve('release', dir, process.platform === 'win32' ? 'Career Hub.exe' : process.platform === 'darwin' ? 'Career Hub.app/Contents/MacOS/Career Hub' : 'Career Hub')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'careerhub-pkg-'))
const cv = await makeCvPdf(path.join(tmp, 'cv.pdf'))
const env: Record<string, string> = {}
for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v
Object.assign(env, { CAREER_HUB_E2E: '1', CAREER_HUB_USER_DATA: path.join(tmp, 'ud') })
const app = await electron.launch({ executablePath: exe, env })
const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded')
const call = (n: string, a?: unknown) => page.evaluate(([n, a]) => (window as any).careerHub.call(n, a), [n, a] as const)
const ok = (c: unknown, m: string) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ✓', m) }
try {
  const b = await call('boot'); ok(b.companyCount === 78, `seed imported inside the packaged app (${b.companyCount} companies)`)
  await call('profile.create', { name: 'Pkg Tester' })
  await call('profile.update', { roles: ['cyber'], career_types: ['INTERNSHIP'], prefs: { internshipStart: 'March 2027', durationWeeks: 24 } })
  await call('folder.set', { path: path.join(tmp, 'Docs') })
  const imp = await call('cv.import', { path: cv }); ok(imp.added > 5, `pdf.js parsed the CV from inside the asar (${imp.added} facts)`)
  await call('facts.confirm', {})
  const id = await call('app.create', { company: 'Fixture Corp', title: 'Cybersecurity Analyst Intern', jobText: JD_CYBER })
  const g = await call('docs.generate', { appId: id }); ok(g.ok && g.resume.qa.passed && g.letter.qa.passed, 'PDF + DOCX exported and every QA check passed')
  const c = await call('email.compose', { appId: id, kind: 'APPLY' })
  const s = await call('email.saveEml', { appId: id, kind: 'APPLY', language: 'en', to: '', subject: c.draft.subject, body: c.draft.body, attachmentPaths: c.attachments.filter((a: any) => a.checked).map((a: any) => a.path) })
  ok(s.ok && fs.statSync(s.path).size > 5000, `.eml with attachments written (${s.size} bytes)`)
  await call('profile.update', { onboarding_done: true })
  await page.reload(); await page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ }).waitFor({ timeout: 15000 }); ok(true, 'packaged UI renders (CSP + file:// assets + worker)')
  console.log('\nPackaged app smoke test passed.')
} finally { await app.close(); fs.rmSync(tmp, { recursive: true, force: true }) }
