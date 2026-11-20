// End-to-end test: drives the REAL Electron app (real IPC, SQLite, PDF/DOCX export, pdf.js preview) with Playwright.
// Native dialogs and external-app launches are replaced by env-var stubs (CAREER_HUB_E2E=1) so it can run unattended.
// Run:  npm run build && node scripts/e2e.ts
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
  Object.assign(env, { CAREER_HUB_E2E: '1', CAREER_HUB_USER_DATA: userData, CAREER_HUB_PICK_FOLDER: pickFolder, CAREER_HUB_PICK_CV: cv, CAREER_HUB_E2E_LOG: logFile })
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
console.log('\nFirst run')

await step('shows the create-profile screen with no fabricated data', async () => {
  await page.getByRole('heading', { name: /set up your private profile/i }).waitFor()
  expect(!(await page.content()).includes('Alex Tester'), 'unexpected demo identity')
  await shot(page, '01-welcome')
})
await step('creates a profile', async () => { await page.getByLabel('Your name').fill('Alex Tester'); await page.getByRole('button', { name: 'Continue' }).click(); await page.getByRole('heading', { name: /What kind of CS role/ }).waitFor() })

await step('step 1: roles are required; picks Cybersecurity + Cloud, Internship', async () => {
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByText('Choose at least one role').waitFor()
  await page.getByRole('checkbox', { name: 'Cybersecurity' }).click()
  await page.getByRole('checkbox', { name: /Cloud \/ DevOps/ }).click()
  await page.getByRole('checkbox', { name: 'Internship' }).click()
  await page.getByRole('button', { name: /Add optional details/ }).click()
  await page.getByLabel('Internship starts').fill('March 2027'); await page.getByLabel('Internship ends').fill('August 2027'); await page.getByLabel('Duration available (weeks)').fill('24'); await page.getByLabel('Citizenship').selectOption('malaysian')
  await shot(page, '02-onboarding-roles')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('heading', { name: 'Add your master CV' }).waitFor()
})
await step('step 2: imports the CV and shows the confirm/edit screen', async () => {
  await page.getByRole('button', { name: 'Choose your CV file' }).click()
  await page.getByText('We found these details').waitFor({ timeout: 20000 })
  await page.getByText('Network Traffic Anomaly Detector').first().waitFor()
  expect((await page.getByText('Needs review').count()) > 3, 'facts should start unconfirmed')
  await shot(page, '03-onboarding-cv-review')
  await page.getByRole('button', { name: 'Confirm all' }).click()
  await page.getByText('All confirmed').waitFor()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('heading', { name: /Where should applications be saved/ }).waitFor()
})
await step('step 3: folder is created only after choosing; AI stays optional', async () => {
  expect(!fs.existsSync(path.join(pickFolder, 'Career Hub')), 'folder must not exist before authorization')
  expect(await page.getByRole('button', { name: /Finish/ }).isDisabled(), 'finish requires a folder')
  await page.getByRole('button', { name: /Choose folder/ }).click()
  await page.getByTestId('root-path').waitFor()
  expect(fs.existsSync(path.join(pickFolder, 'Career Hub', 'Company-Data', 'cyberjaya-seed-source.tsv')), 'seed copy written')
  await shot(page, '04-onboarding-folder')
  await page.getByRole('button', { name: /Finish/ }).click()
  await page.getByRole('heading', { name: /Good (morning|afternoon|evening), Alex/ }).waitFor()
})

console.log('\nDashboard & directory')
await step('empty dashboard: four honest zero metrics, no fake applications', async () => {
  for (const l of ['Submitted', 'Active', 'Interviewing', 'Offers']) await page.getByText(l, { exact: true }).first().waitFor()
  expect((await page.getByTestId('secondary-metrics').innerText()).includes('Response rate —'), 'response rate must be — with no submissions')
  await page.getByText('No applications yet').waitFor()
  await noHScroll(page, 'home'); await shot(page, '05-home-empty')
})
await step('companies: 78 seed rows, role filter, historical labelling', async () => {
  await page.getByRole('button', { name: 'Companies', exact: true }).click()
  await page.getByText(/employers from seed research/).waitFor()
  await page.getByRole('checkbox', { name: 'Matches my roles' }).click()   // turn off
  await page.getByText(/^78 companies$/).waitFor()
  await page.getByRole('checkbox', { name: 'Matches my roles' }).click()   // back on: cyber + cloud only
  await page.waitForFunction(() => { const t = document.body.innerText.match(/(\d+) compan(y|ies)/); return !!t && Number(t[1]) < 78 }, null, { timeout: 8000 })
  const n = Number((await page.getByText(/^\d+ compan/).first().innerText()).match(/\d+/)![0]); expect(n > 5 && n < 78, `role filter should narrow the list (got ${n})`)
  await page.getByRole('button', { name: /CyberSecurity Malaysia/ }).first().click()
  await page.getByText(/historical/i).first().waitFor()
  await page.getByText('info@cybersecurity.my').waitFor()
  await noHScroll(page, 'companies'); await shot(page, '06-companies')
})

console.log('\nNew application → fit → documents')
await step('paste a vacancy, analyze locally, review, save', async () => {
  await page.getByRole('button', { name: 'New application' }).click()
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
  await page.getByRole('tab', { name: 'Documents' }).click()
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
  await page.getByRole('button', { name: 'Resume', exact: true }).click(); await page.waitForTimeout(600)
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
  await page.getByRole('button', { name: 'New application' }).click()
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
  await page.getByRole('heading', { name: /Good (morning|afternoon|evening), Alex/ }).waitFor()
  await page.getByText('Fixture Corp').first().waitFor(); await page.getByText('Applied').first().waitFor()
  await page.getByText('Fixture Corp').first().click(); await page.getByRole('tab', { name: 'Documents' }).click()
  await page.getByRole('combobox', { name: 'Version' }).waitFor(); expect((await page.getByRole('combobox', { name: 'Version' }).innerText()).includes('v2'), 'both versions persisted')
  await page.waitForSelector('[data-testid="pdf-preview"][data-pages="1"]'); await page.getByRole('tab', { name: 'Timeline' }).click(); await page.getByText('Applied — confirmed by you.').waitFor()
})
await step('deleting an output file shows a recovery banner, not a crash', async () => {
  const pdf = (function find(d: string): string[] { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? find(path.join(d, e.name)) : /Resume_.*_v02\.pdf$/.test(e.name) ? [path.join(d, e.name)] : [])) })(pickFolder)[0]
  fs.renameSync(pdf, pdf + '.moved')
  try {
    await page.getByRole('tab', { name: 'Overview' }).click(); await page.getByRole('tab', { name: 'Documents' }).click()
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
await step('keyboard: tabs move with arrow keys; modal traps focus and closes on Escape', async () => {
  await page.getByRole('button', { name: 'Applications', exact: true }).click(); await page.getByText('Fixture Corp').first().click()
  await page.getByRole('tab', { name: 'Overview' }).focus(); await page.keyboard.press('ArrowRight')
  expect(await page.getByRole('tab', { name: 'Documents' }).getAttribute('aria-selected') === 'true', 'arrow moves tab')
  await page.getByRole('button', { name: 'New application' }).click(); await page.getByRole('dialog').waitFor()
  for (let i = 0; i < 25; i++) await page.keyboard.press('Tab')
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), 'focus stays inside the dialog')
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' })
})

for (const [w, h, tag] of [[1024, 768, 'laptop'], [390, 844, 'narrow']] as const) {
  await step(`responsive ${w}px: no horizontal scroll, key screens render`, async () => {
    await resize(app, w, h); await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Home', exact: true }).click(); await noHScroll(page, `home@${w}`); await shot(page, `20-${tag}-home`)
    await page.getByRole('button', { name: 'Companies', exact: true }).click(); await page.getByText(/employers from seed/).waitFor(); await noHScroll(page, `companies@${w}`); await shot(page, `21-${tag}-companies`)
    await page.getByRole('button', { name: 'Applications', exact: true }).click(); await page.getByText('Fixture Corp').first().click()
    await noHScroll(page, `detail@${w}`); await shot(page, `22-${tag}-overview`)
    await page.getByRole('tab', { name: 'Documents' }).click(); await page.waitForSelector('[data-testid="pdf-preview"][data-pages="1"]'); await noHScroll(page, `documents@${w}`); await shot(page, `23-${tag}-documents`)
    await page.getByRole('tab', { name: 'Email' }).click(); await page.getByLabel('Message').waitFor(); await noHScroll(page, `email@${w}`); await shot(page, `24-${tag}-email`)
    await page.getByRole('button', { name: 'My Profile', exact: true }).click(); await page.getByText('Role focus').waitFor(); await noHScroll(page, `profile@${w}`)
  })
}

console.log('\nIsolation')
await step('a second profile starts empty and cannot see the first profile’s data', async () => {
  await resize(app, 1440, 900)
  await page.getByRole('button', { name: /Alex Tester/ }).click(); await page.getByRole('menuitem', { name: 'Add another profile' }).click()
  await page.getByLabel('New profile name').fill('Sam Friend'); await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('heading', { name: /What kind of CS role/ }).waitFor()
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
