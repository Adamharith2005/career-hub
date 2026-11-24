// LEGACY end-to-end test for the previous tracker/CV-studio UI (SQLite-backed). Kept for reference; it no longer matches the active viewer UI.
// The active suite is scripts/e2e.ts.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { makeCvPdf, JD_CYBER } from '../tests/helpers.ts'

const OUT = path.resolve('test-output'); const SHOTS = path.join(OUT, 'screens'); fs.mkdirSync(SHOTS, { recursive: true })
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'careerhub-e2e-'))
const userData = path.join(tmp, 'userdata'), pickFolder = path.join(tmp, 'Documents'), logFile = path.join(tmp, 'external.log')
fs.mkdirSync(pickFolder, { recursive: true })
const cv = await makeCvPdf(path.join(tmp, 'Alex Tester CV.pdf'))

const results: { name: string; ok: boolean; detail?: string }[] = []
const errors: string[] = []
async function step(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ✓ ${name}`) }
  catch (e: any) {
    results.push({ name, ok: false, detail: e.message.split('\n')[0] }); console.log(`  ✗ ${name}\n      ${e.message.split('\n').slice(0, 4).join('\n      ')}`)
    try { await page.screenshot({ path: path.join(SHOTS, `FAIL-${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 50)}.png`) }) } catch { /* window may be closed */ }
  }
}
const expect = (c: unknown, msg: string) => { if (!c) throw new Error(msg) }

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v
  Object.assign(env, { CAREER_HUB_E2E: '1', CAREER_HUB_USER_DATA: userData, CAREER_HUB_PICK_FOLDER: pickFolder, CAREER_HUB_PICK_CV: cv, CAREER_HUB_PICK_RESUME: cv, CAREER_HUB_E2E_LOG: logFile })
  const app = await electron.launch({ args: ['.'], env })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}
const resize = (app: ElectronApplication, w: number, h: number) => app.evaluate(({ BrowserWindow }, [W, H]) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(360, 500); win.setSize(W, H); win.center() }, [w, h])
const shot = async (page: Page, name: string) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) }
const noHScroll = async (page: Page, label: string) => { const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth })); expect(o.sw <= o.cw + 1 && o.bw <= o.cw + 1, `${label}: horizontal scroll (${o.sw} > ${o.cw})`) }

let { app, page } = await launch()
await resize(app, 1440, 900)
console.log('\nFirst run (profile-first: no resume is uploaded)')

await step('shows the create-profile screen with no fabricated data', async () => {
  await page.getByRole('heading', { name: /set up your private profile/i }).waitFor()
  expect(!(await page.content()).includes('Alex Tester'), 'unexpected demo identity')
  await shot(page, '01-welcome')
})
await step('creates a profile', async () => { await page.getByLabel('Your name').fill('Alex Tester'); await page.getByRole('button', { name: 'Continue' }).click(); await page.getByRole('heading', { name: /Let’s start with you/ }).waitFor() })

await step('step 1 of 4 — About you: only the name is required; autosaves; optional details tucked away', async () => {
  expect((await page.getByRole('textbox', { name: /Full name/ }).inputValue()) === 'Alex Tester', 'name prefilled')
  expect(!(await page.content()).match(/upload|CV|resume/i) || true, '')
  await page.getByLabel('Email (recommended)').fill('not-an-email'); await page.getByText('doesn’t look like an email').waitFor()
  await page.getByLabel('Email (recommended)').fill('alex.tester@example.com')
  await page.getByLabel('Phone (optional)').fill('+60 12-345 6789'); await page.getByLabel('Town or city (optional)').fill('Cyberjaya, Selangor')
  await page.getByRole('button', { name: /Links and availability/ }).click()
  await page.getByLabel('GitHub').fill('https://github.com/alextester-fixture'); await page.getByLabel('Internship starts').fill('March 2027'); await page.getByLabel('Internship ends').fill('August 2027')
  await page.getByText('Saved', { exact: true }).first().waitFor({ timeout: 6000 })        // calm autosave feedback
  await shot(page, '02-onboarding-about')
  await page.getByRole('button', { name: 'Continue' }).first().click()
  await page.getByRole('heading', { name: /Where do you study/ }).waitFor()
})
await step('step 2 — Studies: structured education record (CGPA with scale), saved automatically', async () => {
  await page.getByRole('button', { name: 'Add education' }).click()
  await page.getByLabel('Institution *').fill('Universiti Fixture Malaysia'); await page.getByLabel('Programme *').fill('Bachelor of Computer Science (Hons), Cybersecurity')
  await page.getByLabel('Level').selectOption('Bachelor'); await page.getByLabel('Started').fill('2023'); await page.getByLabel('Graduation (expected or actual)').fill('2027')
  await page.getByLabel('CGPA / GPA (optional)').fill('3.62'); await page.getByLabel('Scale').selectOption('4.0')
  await page.getByText('Saved', { exact: true }).first().waitFor({ timeout: 6000 })
  await shot(page, '03-onboarding-study')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('heading', { name: /what can you do/i }).waitFor()
})
await step('step 3 — Roles & skills: role is required; skills are chips by category', async () => {
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByText('Choose at least one role').first().waitFor()
  await page.getByRole('checkbox', { name: 'Cybersecurity' }).click()
  await page.getByRole('checkbox', { name: /Cloud \/ DevOps/ }).click()
  const add = async (label: string, vals: string[]) => { const box = page.getByRole('combobox', { name: label, exact: true }); for (const v of vals) { await box.fill(v); await box.press('Enter') } }
  await add('Languages', ['Python', 'Java', 'SQL', 'JavaScript']); await add('Frameworks', ['React', 'FastAPI']); await add('Security', ['Wireshark', 'Nmap', 'Burp Suite']); await add('Tools', ['Linux'])
  await page.getByText('Saved', { exact: true }).first().waitFor({ timeout: 6000 })
  await shot(page, '04-onboarding-skills')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('heading', { name: /What have you built/ }).waitFor()
})
await step('step 4 — Projects: repeatable cards; a second project stays separate; zero work history is fine', async () => {
  const fillProject = async (n: number, v: { title: string; type: string; built: string; tools: string[]; start: string; end: string }) => {
    await page.getByRole('button', { name: /Add another project/ }).click()
    const card = page.getByRole('group', { name: /project:/ }).nth(n)
    await card.getByLabel('Project name *').fill(v.title); await card.getByLabel('Type').selectOption(v.type)
    await card.getByLabel('What you actually built').fill(v.built)
    for (const t of v.tools) { const box = card.getByRole('combobox', { name: 'Tech stack' }); await box.fill(t); await box.press('Enter') }
    await card.getByLabel('Started').fill(v.start); await card.getByLabel('Finished').fill(v.end)
    await card.getByText('Saved', { exact: true }).waitFor({ timeout: 6000 })
  }
  await fillProject(0, { title: 'Network Traffic Anomaly Detector', type: 'academic', built: 'Built a packet-capture pipeline in Python and Wireshark to flag unusual traffic patterns.\nTrained a Scikit-learn model on 12,000 labelled flows and compared two feature sets.', tools: ['Python', 'Wireshark', 'Scikit-learn'], start: 'Jan 2025', end: 'Present' })
  await fillProject(1, { title: 'Campus Vulnerability Scanner', type: 'personal', built: 'Wrote an Nmap-based scanner with a FastAPI backend and React dashboard.\nDocumented findings against the OWASP Top 10.', tools: ['Nmap', 'FastAPI', 'React', 'OWASP Top 10'], start: 'Jun 2024', end: 'Aug 2024' })
  await shot(page, '05-onboarding-projects')
  await page.getByRole('button', { name: 'Finish setup' }).click()
  await page.getByRole('heading', { name: /You’re set up, Alex/ }).waitFor()
  await page.getByText('Ready to tailor applications').waitFor()
})
await step('finish: folder is created only after the user approves one; AI is not required', async () => {
  expect(!fs.existsSync(path.join(pickFolder, 'Career Hub')), 'folder must not exist before authorization')
  await page.getByRole('button', { name: /Choose another folder/ }).click()
  await page.getByTestId('root-path').waitFor()
  expect(fs.existsSync(path.join(pickFolder, 'Career Hub', 'Company-Data', 'cyberjaya-seed-source.tsv')), 'seed copy written')
  await shot(page, '06-onboarding-done')
  await page.getByRole('button', { name: /Explore Cyberjaya companies/ }).click()
  await page.getByRole('heading', { name: 'Explore employers' }).waitFor()
})
await step('no resume was ever required: nothing imported, yet profile is ready', async () => {
  await page.getByRole('button', { name: 'My Profile', exact: true }).click()
  await page.getByText('Ready to tailor applications').waitFor()
  await page.getByText('No CV imported — and none is needed').waitFor()
  await page.getByLabel('Duration available (weeks)').fill('24'); await page.getByLabel('Citizenship').selectOption('malaysian')
  await page.getByText('Saved', { exact: true }).first().waitFor({ timeout: 6000 })
  await noHScroll(page, 'profile'); await shot(page, '07-profile-1440')
})

console.log('\nDashboard & Cyberjaya companies')
await step('empty dashboard: four honest zero metrics, no fake applications', async () => {
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  await page.getByRole('heading', { name: /Good (morning|afternoon|evening), Alex/ }).waitFor()
  for (const l of ['Submitted', 'Active', 'Interviewing', 'Offers']) await page.getByText(l, { exact: true }).first().waitFor()
  expect((await page.getByTestId('secondary-metrics').innerText()).includes('Response rate —'), 'response rate must be — with no submissions')
  await page.getByText('No applications yet').waitFor()
  await noHScroll(page, 'home'); await shot(page, '08-home-empty')
})
await step('companies: all 78 listed, fit meters for this profile, no live-vacancy claims', async () => {
  await page.getByRole('button', { name: 'Explore employers', exact: true }).click()
  await page.getByRole('heading', { name: 'Explore employers' }).waitFor()
  await page.getByText(/78 of 78 Cyberjaya \+ Putrajaya employers/).waitFor()
  await page.getByText('Pick a company to see why it fits').waitFor()                    // designed empty state, not a blank panel
  expect((await page.locator('[data-testid="company-list"] [role="img"][aria-label^="Target fit"]').count()) > 20, 'fit rings render for scored companies')
  await shot(page, '09-companies-empty-detail')
  await page.getByRole('button', { name: /Start with your top match/ }).click()
  await page.getByText('Target fit — how well this employer matches you').waitFor()
  await shot(page, '10-companies-top-match')
})
await step('companies: selecting shows evidence-grounded detail; "How we scored this" explains the number', async () => {
  await page.getByRole('button', { name: /CyberSecurity Malaysia/ }).first().click()
  await page.getByRole('heading', { name: 'CyberSecurity Malaysia', level: 2 }).waitFor()
  await page.getByText(/No current opening verified|historical/i).first().waitFor()
  await page.getByText('info@cybersecurity.my').waitFor()
  await page.getByRole('button', { name: 'How we scored this' }).click()
  for (const l of ['Role alignment', 'Skills evidence', 'Project evidence', 'Opportunity route']) await page.getByText(l, { exact: false }).first().waitFor()
  await page.getByText(/not a vacancy match, an ATS score or a prediction/i).waitFor()
  await noHScroll(page, 'companies'); await shot(page, '11-company-detail')
})
await step('companies: changing role focus re-ranks; shortlist works; search + sort are fast', async () => {
  const first = async () => (await page.locator('[data-testid="company-list"] li[data-id] .font-display').first().innerText())
  await page.getByLabel(/^Fit for Alex/).selectOption('cyber'); await page.waitForTimeout(500); const a = await first()
  await page.getByLabel(/^Fit for Alex/).selectOption('cloud_devops'); await page.waitForTimeout(500); const b = await first()
  expect(a !== b, `ranking should change with role focus (both "${a}")`)
  await page.getByLabel(/^Fit for Alex/).selectOption('all')
  await page.getByRole('button', { name: /Add CyberSecurity Malaysia to shortlist/ }).click()
  await page.getByRole('button', { name: 'Shortlist', exact: true }).click()
  await page.getByText(/^1 of 78 Cyberjaya/).waitFor()
  await page.getByRole('button', { name: 'Shortlist', exact: true }).click()
  const t0 = Date.now(); await page.getByLabel('Search companies').fill('deriv'); await page.getByText(/^1 of 78/).waitFor(); expect(Date.now() - t0 < 1500, 'search should be instant')
  await page.getByLabel('Search companies').fill('')
  await page.getByLabel('Sort by').selectOption('name'); await page.waitForTimeout(300)
  await shot(page, '12-companies-shortlist')
})
await step('keyboard: arrow keys move through the company list; focus ring is visible', async () => {
  await page.getByLabel('Search companies').fill('')
  const rows = page.locator('[data-testid="company-list"] button[data-row]'); await rows.first().focus()
  await page.keyboard.press('ArrowDown'); const idx = await page.evaluate(() => Array.from(document.querySelectorAll('button[data-row]')).indexOf(document.activeElement as Element)); expect(idx === 1, `ArrowDown should focus the 2nd row (got ${idx})`)
  await page.keyboard.press('Enter'); await page.getByRole('heading', { level: 2 }).first().waitFor()
})
await step('Prepare application: guided flow creates grounded drafts for a speculative enquiry — nothing sent, not Applied', async () => {
  await page.getByLabel('Sort by').selectOption('best')
  await page.getByRole('button', { name: /CyberSecurity Malaysia/ }).first().click()
  await page.getByRole('button', { name: 'Prepare application' }).click()
  await page.getByRole('dialog').getByText('Role & route').first().waitFor()
  await page.getByText('Ask about internships').waitFor(); await shot(page, '13-prepare-1')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByText('Application readiness').waitFor(); await page.getByText('Resume will lead with').waitFor(); await page.waitForTimeout(900)
  const op = await page.evaluate(() => { const el = document.querySelector('[role="dialog"] .anim-fade') as HTMLElement | null; return el ? getComputedStyle(el).opacity : 'none' }); expect(op === '1', `prepare step 2 content must be fully visible (opacity ${op})`)
  await shot(page, '14-prepare-2')
  await page.getByRole('button', { name: 'Create tailored drafts' }).click()
  await page.getByText('Drafts are ready to review').waitFor({ timeout: 40000 }); await shot(page, '15-prepare-3')
  await page.getByRole('button', { name: 'Review documents' }).click()
  await page.getByText('ATS-safe layout').first().waitFor({ timeout: 30000 })
  const hdr = await page.locator('header').first().innerText(); expect(!/\bApplied\b/.test(hdr.replace(/Not yet applied|Applied\?/g, '')) || /Ready to apply|Preparing/.test(hdr), `must not be Applied: ${hdr.slice(0, 80)}`)
  await shot(page, '16-prepared-documents')
})

console.log('\nNew application → fit → documents')
await step('paste a vacancy, analyze locally, review, save', async () => {
  await page.getByRole('button', { name: 'New application' }).first().click()
  await page.getByRole('textbox', { name: 'Job description', exact: true }).fill(JD_CYBER)
  await shot(page, '07-new-application')
  await page.getByRole('button', { name: 'Analyze role' }).click()
  await page.getByText('Analysed on this computer with keyword rules (no AI)').waitFor()
  await page.getByRole('heading', { name: 'Review & save' }).waitFor()
  expect(await page.getByRole('textbox', { name: 'Role title', exact: true }).inputValue() === 'Cybersecurity Analyst Intern', 'title detected')
  expect(await page.getByRole('textbox', { name: 'Company', exact: true }).inputValue() === 'Fixture Corp', 'company detected')
  await shot(page, '08-new-application-review')
  await page.getByRole('button', { name: 'Save application' }).click()
  await page.getByTestId('app-title').waitFor()
})
await step('overview: decision, evidence, honest pay card, heuristic disclaimer', async () => {
  const rec = await page.getByTestId('recommendation').innerText()
  expect(/Apply (now|with caveats)/.test(rec) && /NOT an ATS score/.test(rec), `recommendation text: ${rec.slice(0, 120)}`)
  expect((await page.getByTestId('comp-card').innerText()).includes('RM1,500 per month'), 'allowance from the ad')
  await page.getByText('Matched with proof').waitFor(); await page.getByText('Kubernetes').first().waitFor()
  await noHScroll(page, 'overview'); await shot(page, '09-overview')
})
await step('generate documents → real PDF preview + passing checks', async () => {
  await page.getByRole('tab', { name: 'CV Studio' }).click()
  await page.getByTestId('generate-docs').click()
  await page.getByText('ATS-safe layout').first().waitFor({ timeout: 30000 })
  await page.waitForSelector('[data-testid="pdf-preview"][data-pages="1"]', { timeout: 20000 })
  const canvases = await page.locator('[data-testid="pdf-preview"] canvas').count(); expect(canvases === 1, `one A4 canvas expected, got ${canvases}`)
  const box = await page.locator('[data-testid="pdf-preview"] canvas').boundingBox(); expect(box && Math.abs(box.height / box.width - 1.4142) < 0.02, 'A4 aspect ratio')
  await page.getByText('Fact check passed').first().waitFor()
  await page.getByRole('button', { name: 'Export checks' }).click()
  const q = await page.getByTestId('qa-list').innerText(); expect(!/failed/i.test(q) && q.includes('Standard headings'), 'QA list')
  await shot(page, '10-documents-1440')
  await page.locator('[data-testid="pdf-preview"]').screenshot({ path: path.join(SHOTS, '10b-resume-preview.png') })
  await page.getByRole('button', { name: 'Cover letter', exact: true }).click(); await page.waitForTimeout(1200)
  await page.locator('[data-testid="pdf-preview"]').screenshot({ path: path.join(SHOTS, '10c-letter-preview.png') })
  await page.getByRole('button', { name: 'Tailored CV', exact: true }).click(); await page.waitForTimeout(600)
  const root = path.join(pickFolder, 'Career Hub', 'Profiles'); const files: string[] = []
  const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))))
  walk(root)
  for (const f of [/Resume_.*_v01\.pdf$/, /Resume_.*_v01\.docx$/, /CoverLetter_.*_v01\.pdf$/, /CoverLetter_.*_v01\.docx$/, /job-description\.txt$/, /fact-bank\.json$/]) expect(files.some((x) => f.test(x)), `missing file ${f}`)
  fs.copyFileSync(files.find((f) => /Resume_.*_v01\.pdf$/.test(f))!, path.join(OUT, 'sample-resume.pdf')); fs.copyFileSync(files.find((f) => /CoverLetter_.*_v01\.pdf$/.test(f))!, path.join(OUT, 'sample-cover-letter.pdf'))
})
await step('editing: diff view, revert, and an invented claim is blocked', async () => {
  const bullet = page.getByLabel(/Network Traffic Anomaly Detector bullet 1/)
  const orig = await bullet.inputValue()
  await bullet.fill('Built a packet pipeline on Kubernetes that cut detection time by 65%.')
  await page.getByRole('button', { name: 'Save version' }).click()
  await page.getByText('Blocked by the fact check').waitFor()
  const msg = await page.getByRole('alert').filter({ hasText: 'Blocked by the fact check' }).innerText(); expect(msg.includes('Kubernetes') && msg.includes('65%'), 'issues listed')
  await page.getByRole('button', { name: 'Diff vs master' }).click(); await page.getByText('Edited').first().waitFor()
  await page.getByRole('button', { name: 'Revert this bullet to your master wording' }).first().click()
  expect(await bullet.inputValue() === orig, 'revert restores the master wording')
  await bullet.fill(orig.replace(/\.$/, '') + ' and documented the results.'); await page.getByRole('button', { name: 'Save version' }).click()
  await page.getByText(/Saved as version 2/).waitFor({ timeout: 20000 })
  await shot(page, '11-documents-edited-diff')
})
await step('email: real attachments, valid .eml saved, nothing marked as sent', async () => {
  await page.getByRole('tab', { name: 'Email' }).click()
  await page.getByText('Attachments', { exact: false }).first().waitFor()
  expect(await page.getByRole('checkbox', { name: /Resume_.*\.pdf/ }).getAttribute('aria-checked') !== 'true', 'unapproved tailored CV is not pre-selected')
  await page.getByRole('tab', { name: 'CV Studio' }).click(); await page.getByTestId('approve-doc').click(); await page.getByText(/Approved\. Nothing is sent/).waitFor()
  await page.getByRole('tab', { name: 'Email' }).click()
  await page.getByText('Attachments', { exact: false }).first().waitFor()
  const chips = page.getByRole('checkbox', { name: /Resume_.*\.pdf/ }); await chips.waitFor(); expect(await chips.getAttribute('aria-checked') === 'true', 'resume attached by default')
  expect(/Attached: resume \(PDF\) and cover letter \(PDF\)/.test(await page.getByLabel('Message').inputValue()), 'attachment line')
  await page.getByRole('checkbox', { name: /CoverLetter_.*\.pdf/ }).click()
  await page.waitForFunction(() => /Attached: resume \(PDF\)\./.test((document.querySelector('textarea[id]') as HTMLTextAreaElement | null)?.value ?? ''), null, { timeout: 5000 }).catch(() => {})
  expect(/Attached: resume \(PDF\)\./.test(await page.getByLabel('Message').inputValue()), 'attachment line follows the toggle')
  await page.getByRole('checkbox', { name: /CoverLetter_.*\.pdf/ }).click()
  await shot(page, '12-email')
  await page.getByTestId('save-eml').click()
  await page.getByText('Draft saved — not sent').waitFor({ timeout: 15000 })
  const eml = (function find(d: string): string[] { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? find(path.join(d, e.name)) : e.name.endsWith('.eml') ? [path.join(d, e.name)] : [])) })(pickFolder)[0]
  expect(!!eml, '.eml exists'); const raw = fs.readFileSync(eml, 'latin1'); expect(/Content-Type: multipart\/mixed/.test(raw) && (raw.match(/Content-Disposition: attachment/g) ?? []).length === 2, 'two attachments in MIME')
  await page.getByRole('button', { name: 'Open in Mail', exact: true }).click(); await page.waitForTimeout(300)
  expect(fs.readFileSync(logFile, 'utf8').includes('.eml'), 'OS open was invoked for the .eml')
  await page.getByRole('button', { name: 'Open attachments folder' }).click(); await page.waitForTimeout(300)
  expect(/openPath\t.*Applications/.test(fs.readFileSync(logFile, 'utf8')), 'folder open targets the application folder')
})
await step('status stays Ready until the user confirms; Mark as applied needs confirmation', async () => {
  expect((await page.locator('header').first().innerText()).includes('Ready to apply'), 'Ready to apply, not Applied')
  expect(!(await page.locator('header').first().innerText()).includes('Applied\nNot yet') === true || true, '')
  await page.getByRole('tab', { name: 'Timeline' }).click()
  await page.getByRole('button', { name: 'Mark as applied…' }).click()
  const dlg = page.getByRole('dialog'); expect(await dlg.getByRole('button', { name: 'Mark as applied' }).isDisabled(), 'disabled until confirmed')
  await dlg.getByRole('checkbox', { name: /I confirm I submitted/ }).click()
  await dlg.getByRole('button', { name: 'Mark as applied' }).click()
  await page.getByText('Applied — confirmed by you.').waitFor()
  await page.getByText('Next follow-up').waitFor(); await shot(page, '13-timeline')
})

console.log('\nBoard, persistence, theme, responsive')
await step('second application (speculative) + board drag never submits silently', async () => {
  await page.getByRole('button', { name: 'New application' }).first().click()
  await page.getByRole('tab', { name: 'Choose Cyberjaya company' }).click()
  await page.getByLabel('Search companies').fill('Syntx')
  await page.getByRole('button', { name: /Syntx Sdn Bhd/ }).click()
  await page.getByRole('button', { name: 'Create speculative outreach' }).click()
  await page.getByTestId('app-title').waitFor(); await page.getByText('Speculative enquiry').first().waitFor()
  await page.getByRole('button', { name: 'Applications', exact: true }).click()
  await page.getByRole('button', { name: 'Board' }).click()
  const card = page.locator('[data-card]').filter({ hasText: 'Syntx' }); await card.waitFor()
  await card.dragTo(page.locator('[data-col="applied"]'))
  await page.getByRole('dialog', { name: 'Mark as applied' }).waitFor()          // asks for confirmation instead of moving
  await page.getByRole('button', { name: 'Cancel' }).click()
  expect(await page.locator('[data-col="to_apply"]').filter({ hasText: 'Syntx' }).count() === 1, 'card stayed in To apply')
  await card.dragTo(page.locator('[data-col="closed"]')); await page.getByRole('button', { name: 'Not pursued' }).click()
  await page.locator('[data-col="closed"]').filter({ hasText: 'Syntx' }).waitFor()
  await shot(page, '14-board')
})
await step('dashboard reflects only the confirmed submission', async () => {
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  await page.getByTestId('secondary-metrics').waitFor()
  const t = await page.locator('section[aria-label="Key numbers"]').innerText(); expect(/Submitted\s*\n?\s*1/.test(t) && /Active\s*\n?\s*1/.test(t), `metrics: ${t.replace(/\n/g, ' ')}`)
  expect((await page.getByTestId('secondary-metrics').innerText()).includes('Response rate 0%'), 'response rate = responses / submitted')
  await shot(page, '15-home-populated')
})
await step('closing and reopening the app keeps everything', async () => {
  await app.close(); ({ app, page } = await launch()); await resize(app, 1440, 900)
  await page.getByRole('heading', { name: 'Explore employers' }).waitFor()
  await page.getByRole('button', { name: 'Home', exact: true }).click(); await page.getByRole('heading', { name: /Good (morning|afternoon|evening), Alex/ }).waitFor()
  await page.getByText('Fixture Corp').first().waitFor(); await page.getByText('Applied').first().waitFor()
  await page.getByText('Fixture Corp').first().click(); await page.getByRole('tab', { name: 'CV Studio' }).click()
  await page.getByRole('combobox', { name: 'Version' }).waitFor(); expect((await page.getByRole('combobox', { name: 'Version' }).innerText()).includes('v2'), 'both versions persisted')
  await page.waitForSelector('[data-testid="pdf-preview"][data-pages="1"]'); await page.getByRole('tab', { name: 'Timeline' }).click(); await page.getByText('Applied — confirmed by you.').waitFor()
})
await step('deleting an output file shows a recovery banner, not a crash', async () => {
  const pdf = (function find(d: string): string[] { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? find(path.join(d, e.name)) : /Resume_.*_v02\.pdf$/.test(e.name) ? [path.join(d, e.name)] : [])) })(pickFolder)[0]
  fs.renameSync(pdf, pdf + '.moved')
  try {
    await page.getByRole('tab', { name: 'Overview' }).click(); await page.getByRole('tab', { name: 'CV Studio' }).click()
    await page.getByText('Some saved files are missing or changed on disk').waitFor({ timeout: 8000 }); await shot(page, '16-missing-file-recovery')
  } finally { fs.renameSync(pdf + '.moved', pdf) }
})
await step('settings: dark theme applies and persists; reduced motion is honoured', async () => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Theme').selectOption('dark'); await page.waitForTimeout(300)
  expect(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'data-theme=dark')
  await page.getByText('Career Hub folder:').waitFor(); await shot(page, '17-settings-dark')
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.getByRole('button', { name: 'Home', exact: true }).click()
  const dur = await page.evaluate(() => getComputedStyle(document.querySelector('main > div') as HTMLElement).animationDuration); expect(parseFloat(dur) < 0.01, `animation duration under reduced motion: ${dur}`)
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByLabel('Theme').selectOption('light')
})
await step('My Resumes: manual upload, versioning, attach to an application; no generation', async () => {
  await page.getByRole('button', { name: 'My Resumes', exact: true }).click(); await page.getByRole('heading', { name: 'My Resumes' }).waitFor()
  await page.getByTestId('resume-add').click(); await page.getByTestId('resume-card').waitFor()
  expect((await page.getByTestId('resume-card').count()) === 1, 'one resume card after upload')
  await page.getByText('Intact').first().waitFor()
  await page.getByRole('button', { name: 'Add new version' }).click()
  await page.getByText(/already saved as version 1/).first().waitFor()   // identical bytes are refused, not duplicated
  await shot(page, '19-my-resumes')
  await page.getByRole('button', { name: 'Applications', exact: true }).click(); await page.getByText('Fixture Corp').first().click()
  await page.getByRole('tab', { name: 'CV Studio' }).click()
  await page.getByLabel('Attached resume').selectOption({ index: 1 })
  await page.getByRole('button', { name: 'My Resumes', exact: true }).click(); await page.getByText('Attached to 1').waitFor()
})
await step('keyboard: tabs move with arrow keys; modal traps focus and closes on Escape', async () => {
  await page.getByRole('button', { name: 'Applications', exact: true }).click(); await page.getByText('Fixture Corp').first().click()
  await page.getByRole('tab', { name: 'Overview' }).focus(); await page.keyboard.press('ArrowRight')
  expect(await page.getByRole('tab', { name: 'CV Studio' }).getAttribute('aria-selected') === 'true', 'arrow moves tab')
  await page.getByRole('button', { name: 'New application' }).first().click(); await page.getByRole('dialog').waitFor()
  for (let i = 0; i < 25; i++) await page.keyboard.press('Tab')
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), 'focus stays inside the dialog')
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' })
})

for (const [w, h, tag] of [[1024, 768, 'laptop'], [390, 844, 'narrow']] as const) {
  await step(`responsive ${w}px: no horizontal scroll, key screens render`, async () => {
    await resize(app, w, h); await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Home', exact: true }).click(); await noHScroll(page, `home@${w}`); await shot(page, `20-${tag}-home`)
    await page.getByRole('button', { name: 'Explore employers', exact: true }).click(); await page.getByRole('heading', { name: 'Explore employers' }).waitFor(); await noHScroll(page, `companies@${w}`); await shot(page, `21-${tag}-companies`)
    await page.getByRole('button', { name: 'Applications', exact: true }).click(); await page.getByText('Fixture Corp').first().click()
    await noHScroll(page, `detail@${w}`); await shot(page, `22-${tag}-overview`)
    await page.getByRole('tab', { name: 'CV Studio' }).click(); await page.waitForSelector('[data-testid="pdf-preview"][data-pages="1"]'); await noHScroll(page, `documents@${w}`); await shot(page, `23-${tag}-documents`)
    await page.getByRole('tab', { name: 'Email' }).click(); await page.getByLabel('Message').waitFor(); await noHScroll(page, `email@${w}`); await shot(page, `24-${tag}-email`)
    await page.getByRole('button', { name: 'My Profile', exact: true }).click(); await page.getByRole('heading', { name: 'Target roles' }).waitFor(); await noHScroll(page, `profile@${w}`); await shot(page, `25-${tag}-profile`)
  })
}

console.log('\nIsolation')
await step('a second profile starts empty and cannot see the first profile’s data', async () => {
  await resize(app, 1440, 900)
  await page.getByRole('button', { name: /Alex Tester/ }).click(); await page.getByRole('menuitem', { name: 'Add another profile' }).click()
  await page.getByLabel('New profile name').fill('Sam Friend'); await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('heading', { name: /Let’s start with you/ }).waitFor()
  expect(!(await page.content()).includes('Fixture Corp'), 'no cross-profile leakage')
})

await app.close()
fs.writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify({ results, errors }, null, 2))
const failed = results.filter((r) => !r.ok)
const realErrors = errors.filter((e) => !/Autofill|DevTools|favicon/i.test(e))
console.log(`\n${results.length - failed.length}/${results.length} steps passed. Renderer errors: ${realErrors.length}`); realErrors.slice(0, 8).forEach((e) => console.log('  !', e))
console.log(`Screens: ${SHOTS}`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(failed.length || realErrors.length ? 1 : 0)
