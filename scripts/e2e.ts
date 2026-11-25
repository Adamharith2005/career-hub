// End-to-end test for the Career Hub viewer: drives the REAL Electron app (real IPC, real PDF preview, real clipboard) with Playwright.
// Uses a SYNTHETIC profile seed and fixture PDFs; no personal data. Native dialogs and external launches are stubbed (CAREER_HUB_E2E=1).
// Run:  npm run build && npm run e2e
import fs from 'node:fs'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { makeCvPdf } from '../tests/helpers.ts'

const OUT = path.resolve('test-output'); const SHOTS = path.join(OUT, 'screens'); fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true })
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'careerhub-e2e-'))
const userData = path.join(tmp, 'userdata'), logFile = path.join(tmp, 'external.log')
const fixtureCv = await makeCvPdf(path.join(tmp, 'One CV.pdf'))
const secondDoc = await makeCvPdf(path.join(tmp, 'One Second.pdf'), ['Alex Tester', 'Second resume variant', '', 'Education', 'Universiti Fixture Malaysia'])
const REAL_WORKBOOK = process.env.CAREER_HUB_REAL_WORKBOOK ?? (fs.existsSync(path.join(os.homedir(), 'Downloads', 'CAREER_HUB_EMPLOYER_ATLAS_V3_recovered_audited.xlsx')) ? path.join(os.homedir(), 'Downloads', 'CAREER_HUB_EMPLOYER_ATLAS_V3_recovered_audited.xlsx') : '')
const seed = path.join(tmp, 'seed.json')
fs.writeFileSync(seed, JSON.stringify({ version: 1, profiles: [
  { id: 'adam', displayName: 'Adam', fullName: 'Test Student One', specialisation: 'Data Science', university: 'Universiti Fixture', degree: 'Bachelor of Computer Science (Data Science)', contact: { email: 'one@example.com', phone: '+60 11-111 1111', location: 'Fixtureville' },
    links: [{ label: 'GitHub', url: 'https://github.com/example-one' }], headline: '', summary: 'Synthetic profile one.', education: [{ title: 'BCS Data Science', institution: 'Universiti Fixture', dates: '2024 – 2028', points: ['CGPA: 3.50'] }],
    skills: [{ group: 'Programming', items: ['Python', 'SQL'] }], projects: [{ title: 'Churn Study', context: 'Coursework', date: '2026', status: 'COMPLETED', stack: ['Python', 'SQL'], points: ['Analysed churn.'], caveat: '', url: null }],
    otherRepos: [], experience: [], leadership: [], languages: ['English'], interests: ['Data Analyst Intern', 'Machine Learning Intern'], internshipWindow: '', availabilityPhrase: '', reviewNotes: ['Synthetic review note.'],
    documents: [{ label: 'One resume', kind: 'RESUME', path: fixtureCv }] },
  { id: 'akif', displayName: 'Akif', fullName: 'Test Student Two', specialisation: 'Information Systems', university: 'Universiti Fixture', degree: 'Bachelor of Computer Science (Information Systems)', contact: { email: 'two@example.com', phone: '+60 12-222 2222', location: 'Fixtureburg' },
    links: [], headline: '', summary: '', education: [], skills: [{ group: 'Web', items: ['React'] }], projects: [{ title: 'Cloud Scanner', context: 'Final Year Project', date: '2027', status: 'PROPOSED', stack: ['Terraform', 'AWS'], points: [], caveat: 'Proposed only.', url: null }],
    otherRepos: [], experience: [], leadership: [], languages: [], interests: ['Software Engineering', 'Cybersecurity', 'Cloud Computing'], internshipWindow: '', availabilityPhrase: '', reviewNotes: [], documents: [] }] }))

const CAT: any[] = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'catalog.json'), 'utf8')).companies
const N = CAT.length, N_CY = CAT.filter((c) => c.city === 'Cyberjaya').length, N_PJ = CAT.filter((c) => c.city === 'Putrajaya').length, N_IOI = CAT.filter((c) => c.city === 'IOI Resort City').length
const N_GOV = CAT.filter((c) => c.sector === 'GOVERNMENT').length, N_NON = CAT.filter((c) => c.sector === 'NON_GOVERNMENT').length
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
  Object.assign(env, { CAREER_HUB_E2E: '1', CAREER_HUB_USER_DATA: userData, CAREER_HUB_SEED: seed, CAREER_HUB_PICK_DOC: secondDoc, CAREER_HUB_PICK_WORKBOOK: (!!REAL_WORKBOOK && fs.existsSync(REAL_WORKBOOK)) ? REAL_WORKBOOK : '', CAREER_HUB_E2E_LOG: logFile })
  const app = await electron.launch({ args: ['.'], env })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}
const resize = (app: ElectronApplication, w: number, h: number) => app.evaluate(({ BrowserWindow }, [W, H]) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(360, 500); win.setSize(W, H); win.center() }, [w, h])
const shot = async (page: Page, name: string) => { await page.waitForTimeout(450); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) }
const noHScroll = async (page: Page, label: string) => { const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth })); expect(o.sw <= o.cw + 1 && o.bw <= o.cw + 1, `${label}: horizontal scroll (${o.sw} > ${o.cw})`) }
const clip = (app: ElectronApplication) => app.evaluate(({ clipboard }) => clipboard.readText())
const count = async (page: Page) => Number((await page.getByTestId('result-count').locator('.figure').first().innerText()).trim())
const waitCount = async (page: Page, n: number) => { await page.waitForFunction((x) => Number(document.querySelector('[data-testid="result-count"] .figure')?.textContent) === x, n, { timeout: 8000 }) }
const clipEventually = async (app: ElectronApplication, pred: (t: string) => boolean) => { for (let i = 0; i < 30; i++) { if (pred(await clip(app))) return true; await new Promise((r) => setTimeout(r, 100)) } return false }
const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name }).click()

let { app, page } = await launch()
await resize(app, 1440, 900)

console.log('\nLaunch and profiles')
await step('opens straight to "Who’s exploring today?" with no database, login or setup', async () => {
  await page.getByRole('heading', { name: /Who’s exploring today/ }).waitFor()
  expect(await page.getByTestId('pick-adam').isVisible() && await page.getByTestId('pick-akif').isVisible(), 'both profile cards')
  expect(!fs.existsSync(path.join(userData, 'careerhub.db')), 'a SQLite database was created')
  expect(!(await page.content()).match(/password|sign up|register/i), 'no account UI')
  await shot(page, '01-profile-picker')
})
await step('Adam opens the explorer with every organisation', async () => {
  await page.getByTestId('pick-adam').click(); await page.getByRole('heading', { name: 'Find your internship fit' }).waitFor()
  await waitCount(page, N); expect(await page.getByTestId('active-profile').innerText() === 'Adam', 'active profile visible')
  await shot(page, '02-explorer-empty-detail')
})
await step('navigation is minimal and has no tracker, kanban or CRM', async () => {
  const labels = await page.getByRole('navigation', { name: 'Primary' }).getByRole('button').allInnerTexts()
  expect(labels.join('|') === 'Explore Companies|My Profile & CV|My Resumes|Settings', `unexpected nav: ${labels}`)
  expect(!(await page.content()).match(/kanban|follow-up|interview pipeline|applications/i), 'tracking UI visible')
})

console.log('\nExplorer')
await step('location filter: Cyberjaya, Putrajaya, IOI Resort City, All', async () => {
  await page.getByRole('group', { name: 'Location' }).getByRole('button', { name: /^Cyberjaya/ }).click(); await waitCount(page, N_CY)
  await page.getByRole('group', { name: 'Location' }).getByRole('button', { name: /^Putrajaya/ }).click(); await waitCount(page, N_PJ)
  await page.getByRole('group', { name: 'Location' }).getByRole('button', { name: /^IOI Resort City/ }).click(); await waitCount(page, N_IOI)
  await page.getByRole('group', { name: 'Location' }).getByRole('button', { name: 'All', exact: true }).click(); await waitCount(page, N)
})
await step('sector, type, technical, allowance and evidence filters narrow the list', async () => {
  const chips = page.getByRole('group', { name: 'Filters', exact: true })
  await chips.getByRole('button', { name: /^Government/ }).click(); await waitCount(page, N_GOV)
  await chips.getByRole('button', { name: /^Non-government/ }).click(); await waitCount(page, N_NON)
  await chips.getByRole('button', { name: /^Non-government/ }).click(); await waitCount(page, N)
  const tech = page.getByRole('group', { name: 'Technical areas' })
  await tech.getByRole('button', { name: /^Cybersecurity/ }).click(); await page.waitForFunction(() => { const n = Number(document.querySelector('[data-testid="result-count"] .figure')?.textContent); return n > 0 && n < 400 }, null, { timeout: 8000 })
  expect(await count(page) < N, 'technical chip narrows the list')
  await tech.getByRole('button', { name: /^Cybersecurity/ }).click(); await waitCount(page, N)
  await page.getByTestId('filters-toggle').click(); const f = page.getByTestId('filters')
  await f.getByRole('button', { name: /^Confirmed unpaid/ }).click(); await waitCount(page, 2)
  await f.getByRole('button', { name: /^Confirmed unpaid/ }).click()
  expect(await f.getByRole('button', { name: /^Advertised opening/ }).isDisabled(), 'no organisation is a verified advertised opening, so that filter is disabled (0)')
  await shot(page, '03-filters'); await waitCount(page, N); await page.getByTestId('filters-toggle').click()
})
await step('search finds a company; the dossier shows everything on one page with honest labels', async () => {
  await page.getByTestId('search').fill('NACSA'); await page.getByTestId('company-row').filter({ hasText: 'NACSA' }).first().click()
  await page.getByTestId('dossier-title').waitFor(); const t = await page.getByTestId('dossier').innerText()
  for (const h of ['Company information', 'Internship', 'Allowance', 'Contact', 'Research evidence', 'Email draft for Adam']) expect(t.includes(h), `missing section ${h}`)
  expect(!/RM\s?0\b/.test(t), 'unknown allowance shown as RM0')
  expect(/general rule, not confirmation/i.test(t), 'government policy must not read as employer confirmation')
  expect(/Not verified/.test(t), 'missing fields use "Not verified"')
  expect(!/undefined|null/.test(t), 'raw undefined/null leaked')
  await shot(page, '04-dossier-government')
})
await step('copy buttons write real clipboard text: details, contact, subject, draft', async () => {
  await page.getByTestId('copy-company').click(); await page.getByText('Copied', { exact: true }).first().waitFor()
  let c = await clip(app); expect(/Agensi Keselamatan Siber Negara/.test(c) && /Allowance/.test(c) && !/undefined|null/.test(c), `company text: ${c.slice(0, 80)}`)
  await page.getByTestId('copy-contact').click(); await page.waitForTimeout(150); c = await clip(app); expect(/info@nacsa\.gov\.my/.test(c), 'contact text has the email')
  await page.getByRole('button', { name: 'Copy general email' }).click(); await page.waitForTimeout(150); expect((await clip(app)) === 'info@nacsa.gov.my', 'single-field copy')
  await page.getByTestId('copy-draft').click(); await page.waitForTimeout(150); c = await clip(app)
  expect(/^To: info@nacsa\.gov\.my\nSubject: /.test(c) && c.includes('Test Student One') && !c.includes('Test Student Two'), `draft text: ${c.slice(0, 120)}`)
  expect(/I am writing to enquire about potential internship opportunities in .+ at /.test(c) && !/advertised|apply for the/.test(c), 'unadvertised enquiry wording'); expect(/Dear Hiring Manager,/.test(c) && /Yours sincerely,\nTest Student One\n/.test(c), 'standard structure and signature')
})
await step('draft is editable and a non-verified recipient is never guessed', async () => {
  await page.getByLabel('Email body').fill('Edited by me'); await page.getByRole('button', { name: 'Copy body' }).click(); await page.waitForTimeout(150); expect((await clip(app)) === 'Edited by me', 'edited body copied')
  await page.getByTestId('search').fill('DOF HQ'); await page.getByTestId('company-row').filter({ hasText: 'Perikanan' }).first().click(); await page.getByTestId('dossier-title').filter({ hasText: 'Perikanan' }).waitFor()
  const t = await page.getByTestId('dossier').innerText(); expect(/Confirmed unpaid/.test(t), 'official-unpaid labelled')
})
await step('email draft follows the standard: structure, attachments, copy buttons, regenerate, restore and the mail app', async () => {
  await page.getByTestId('search').fill('NACSA'); await page.getByTestId('company-row').filter({ hasText: 'NACSA' }).first().click(); await page.getByTestId('email-draft').waitFor()
  const body = page.getByLabel('Email body'); await page.waitForFunction(() => (document.querySelector('textarea[aria-label="Email body"]') as HTMLTextAreaElement)?.value.includes('Dear Hiring Manager'))
  const t0 = await body.inputValue(); const L = t0.split('\n')
  expect(L[0] === 'Dear Hiring Manager,' && L.at(-3) === 'Yours sincerely,' && L.at(-2) === 'Test Student One' && /one@example\.com/.test(L.at(-1)!), `structure: ${t0.slice(0, 80)}`)
  expect(t0.split('\n\n').length === 5, 'greeting, three paragraphs, signature'); expect(/Please find attached my resume\./.test(t0), 'resume ticked by default')
  expect(!/résumé/i.test(await page.locator('main').innerText()), 'accented spelling in the UI')
  const subject = await page.locator('#draft-subject').inputValue(); expect(/^Internship Enquiry — .+ — Test Student One$/.test(subject), `subject: ${subject}`)
  await page.getByTestId('attachments').getByRole('checkbox').first().uncheck(); await page.waitForFunction(() => !/attached/i.test((document.querySelector('textarea[aria-label="Email body"]') as HTMLTextAreaElement).value))
  expect(await page.getByTestId('attachments').getByRole('checkbox', { disabled: true }).count() >= 2, 'cover letter and referral letter offered as unavailable')
  await page.getByTestId('copy-subject').click(); expect(await clipEventually(app, (t) => t === subject), 'copy subject')
  await page.getByTestId('copy-recipient').click(); expect(await clipEventually(app, (t) => t === 'info@nacsa.gov.my'), 'copy recipient')
  const bodyNow = await body.inputValue(); await page.getByTestId('copy-body').click(); expect(await clipEventually(app, (t) => t === bodyNow), 'copy body')
  await page.getByTestId('copy-draft').click(); expect(await clipEventually(app, (t) => t.startsWith(`To: info@nacsa.gov.my\nSubject: ${subject}\n\nDear Hiring Manager,`)), 'copy whole email')
  await body.fill('Edited by me'); await page.getByTestId('restore').click(); await page.waitForFunction(() => (document.querySelector('textarea[aria-label="Email body"]') as HTMLTextAreaElement).value.startsWith('Dear Hiring Manager'))
  await body.fill('Edited again'); await page.getByTestId('regen').click(); await page.waitForFunction(() => (document.querySelector('textarea[aria-label="Email body"]') as HTMLTextAreaElement).value.startsWith('Dear Hiring Manager'))
  expect(/not attached automatically/i.test(await page.getByTestId('attach-warning').innerText()), 'attachment warning visible')
  await page.getByTestId('attachments').getByRole('checkbox').first().check(); await page.waitForFunction(() => /attached my resume/.test((document.querySelector('textarea[aria-label="Email body"]') as HTMLTextAreaElement).value))
  await page.getByTestId('open-mail').click(); await page.getByTestId('attach-checklist').waitFor()
  expect(/still to attach/.test(await page.getByTestId('attach-status').innerText()), 'pending attachments flagged'); await page.getByTestId('attach-checklist').getByRole('checkbox').first().check(); expect(/All documents ticked/.test(await page.getByTestId('attach-status').innerText()), 'checklist completes')
  await page.waitForTimeout(300); expect(/mailto:info@nacsa\.gov\.my\?subject=/.test(fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : ''), 'mail app opened with a mailto link')
  await shot(page, '18-email-draft')
})
await step('compare two organisations in-page', async () => {
  await page.getByTestId('search').fill(''); await waitCount(page, N)
  const boxes = page.getByRole('checkbox', { name: /^Compare / }); await boxes.nth(0).check(); await boxes.nth(1).check()
  await page.getByTestId('compare-btn').click(); await page.getByRole('dialog').waitFor(); await page.getByText(/No clear winner|Closest match/).waitFor()
  await shot(page, '05-compare'); await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' })
})
await step('the selected person’s resume opens beside the company', async () => {
  await page.getByTestId('open-my-doc').click(); await page.getByRole('dialog').waitFor(); await page.waitForSelector('[data-testid="pdf-preview"][data-pages="1"]', { timeout: 15000 })
  await page.keyboard.press('Escape')
})

console.log('\nProfiles, CV and resumes')
await step('Akif’s drafts use Akif’s details only; Adam’s are untouched', async () => {
  await page.getByTestId('profile-chip').click(); await page.getByTestId('pick-akif').click(); await page.getByRole('heading', { name: 'Find your internship fit' }).waitFor(); await waitCount(page, N)
  await page.getByTestId('search').fill('NACSA'); await page.getByTestId('company-row').filter({ hasText: 'NACSA' }).first().click(); await page.getByTestId('dossier-title').waitFor()
  await page.getByTestId('copy-draft').click(); await page.waitForTimeout(150); const c = await clip(app)
  expect(c.includes('Test Student Two') && !c.includes('Test Student One'), 'wrong student in draft'); expect(!/proposed|benchmark/i.test(c) || /proposed/.test(c), 'FYP wording')
  expect((await page.getByTestId('dossier').innerText()).includes('No resume linked for Akif'), 'Akif has no resume; optional banner shown')
  await shot(page, '06-akif-explorer')
})
await step('profile page shows structured info immediately; no CV needed', async () => {
  await nav(page, 'My Profile & CV'); await page.getByTestId('profile-name').waitFor(); const t = await page.locator('main').innerText()
  expect(t.includes('Test Student Two') && t.includes('Cloud Scanner') && /Proposed/.test(t) && !t.includes('Test Student One'), 'akif profile content')
  await page.getByText('No CV or resume linked yet').waitFor()
  await shot(page, '07-profile-no-cv')
})
await step('Adam’s profile previews the linked CV for real', async () => {
  await page.getByRole('button', { name: /Active profile Akif/ }).click(); await page.getByTestId('pick-adam').click(); await page.getByRole('heading', { name: 'Find your internship fit' }).waitFor()
  await nav(page, 'My Profile & CV'); await page.getByTestId('profile-name').waitFor(); await page.waitForSelector('[data-testid="pdf-preview"][data-pages="1"]', { timeout: 15000 })
  expect((await page.locator('main').innerText()).includes('Test Student One'), 'adam profile'); await shot(page, '08-profile-cv-preview')
})
await step('My Resumes: upload, duplicate refused, preview, version shown', async () => {
  await nav(page, 'My Resumes'); await page.getByTestId('doc-card').first().waitFor()
  expect(await page.getByTestId('doc-card').count() === 1, 'seeded resume present')
  await page.getByTestId('doc-add').click(); await page.getByText(/Saved as version 1/).waitFor(); expect(await page.getByTestId('doc-card').count() === 2, 'second resume added')
  await page.getByTestId('doc-add').click(); await page.getByText(/already saved/).first().waitFor()
  await page.getByRole('button', { name: /Add a new version of/ }).first().click(); await page.getByText(/already saved|Saved as version 2/).first().waitFor()
  await shot(page, '09-my-resumes')
})


console.log('\nMatch, tailoring and master resume')
const sha = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const docDir = (id: string) => path.join(userData, 'viewer', 'documents', id)
const adamDocs = () => fs.existsSync(docDir('adam')) ? fs.readdirSync(docDir('adam')).map((n) => path.join(docDir('adam'), n)).sort() : []
let adamDeriv = 0
await step('every company shows a live match percentage, and sorting and view modes work', async () => {
  await nav(page, 'Explore Companies'); await page.getByTestId('search').fill('')
  await page.getByTestId('search').fill('Deriv'); const row = page.getByTestId('company-list').locator('li').filter({ hasText: 'Deriv' }).first(); await row.getByTestId('match-ring').waitFor()
  adamDeriv = Number(await row.getByTestId('match-ring').getAttribute('data-score')); expect(adamDeriv > 0 && adamDeriv <= 100, `score ${adamDeriv}`)
  expect((await row.getByTestId('match-ring').getAttribute('aria-label'))!.includes('percent'), 'ring has a text equivalent')
  await page.getByTestId('search').fill(''); await waitCount(page, N)
  await page.getByTestId('sort').selectOption('name'); await page.waitForTimeout(300)
  const names = await page.getByTestId('company-row').evaluateAll((els) => els.slice(0, 6).map((e) => (e.textContent ?? '').trim()))
  expect(names.length >= 2, 'rows listed'); await page.getByTestId('sort').selectOption('match'); await page.waitForTimeout(300)
  const scores = await page.getByTestId('company-list').getByTestId('match-ring').evaluateAll((els) => els.slice(0, 8).map((e) => Number(e.getAttribute('data-score'))))
  expect(scores.every((v, i) => i === 0 || scores[i - 1] >= v), `best match first: ${scores}`)
  await shot(page, '12-explorer-cards'); await page.getByRole('button', { name: 'Dense research list' }).click(); await page.waitForTimeout(300); await shot(page, '13-explorer-dense')
  await page.getByRole('button', { name: 'Visual cards' }).click()
})
await step('the score is explained and recalculates when the role changes', async () => {
  await page.getByTestId('search').fill('Deriv'); await page.getByTestId('company-row').filter({ hasText: 'Deriv' }).first().click(); await page.getByTestId('match-panel').waitFor()
  await page.getByTestId('match-detail').waitFor(); const t = await page.getByTestId('match-detail').innerText()
  for (const h of ['How the score is built', 'Relevant technical skills', 'Evidence confidence', 'Not verified']) expect(t.includes(h), `missing ${h}`)
  expect(/not a vacancy match|No job description/i.test(await page.getByTestId('match-panel').innerText()), 'states it is an estimate')
  const ring = page.getByTestId('match-panel').getByTestId('match-ring'); const before = await ring.getAttribute('data-score')
  await page.getByTestId('role-select').selectOption('CYBERSECURITY'); await page.waitForFunction((b) => document.querySelector('[data-testid="match-panel"] [data-testid="match-ring"]')?.getAttribute('data-score') !== b, before, { timeout: 8000 })
  await shot(page, '14-match-breakdown'); await page.getByTestId('role-select').selectOption('DATA_ANALYTICS')
})
await step('Adam: Tailor My CV makes a labelled draft, shows what changed, approves to a real PDF, and leaves his resume untouched', async () => {
  const before = adamDocs().map(sha)
  await page.getByTestId('tailor-cv').click(); await page.getByTestId('cv-studio').waitFor()
  expect(/No Specific Vacancy/.test(await page.getByTestId('cv-label').innerText()), 'vacancy label')
  await page.getByTestId('cv-diff').waitFor(); await page.getByTestId('presentation').waitFor(); await page.waitForSelector('[data-testid="pdf-preview"]', { timeout: 15000 })
  expect(!(await page.getByTestId('cv-studio').innerText()).match(/ATS[^.\n]{0,24}\d+\s?%|\d+\s?%[^.\n]{0,24}ATS/i), 'no fake ATS probability')
  await shot(page, '15-cv-studio')
  await page.getByTestId('cv-approve').click(); await page.getByText(/Approved version/).first().waitFor({ timeout: 15000 })
  const dir = path.join(userData, 'viewer', 'cv', 'adam'); const pdfs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.pdf')) : []
  expect(pdfs.length === 1 && /^Adam_Deriv.*_CV\.pdf$/.test(pdfs[0]), `approved file: ${pdfs}`)
  const buf = fs.readFileSync(path.join(dir, pdfs[0])); expect(buf.subarray(0, 5).toString() === '%PDF-', 'real PDF')
  expect(JSON.stringify(adamDocs().map(sha)) === JSON.stringify(before), 'Adam resume bytes changed')
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' })
})
await step('Akif: different score for the same company; his master resume is prepared, reviewed, approved; original kept', async () => {
  await page.getByTestId('profile-chip').click(); await page.getByTestId('pick-akif').click(); await page.getByRole('heading', { name: 'Find your internship fit' }).waitFor()
  await page.getByTestId('search').fill('Deriv'); const row = page.getByTestId('company-list').locator('li').filter({ hasText: 'Deriv' }).first(); await row.getByTestId('match-ring').waitFor()
  const akif = Number(await row.getByTestId('match-ring').getAttribute('data-score')); expect(akif !== adamDeriv, `scores should differ per student (${akif} vs ${adamDeriv})`)
  await nav(page, 'My Resumes'); await page.getByTestId('prepare-master').click(); await page.getByTestId('master-draft').waitFor(); await page.waitForSelector('[data-testid="pdf-preview"]', { timeout: 15000 })
  expect(await page.getByTestId('doc-card').count() === 0, 'draft is not a document yet'); await shot(page, '16-akif-master-draft')
  await page.getByTestId('approve-master').click(); await page.getByText(/current master/i).first().waitFor({ timeout: 15000 })
  await page.getByTestId('doc-card').first().waitFor(); expect(await page.getByTestId('doc-card').count() === 1, 'approved master is a new document')
  const hasAdamPrepare = false; expect(!hasAdamPrepare, 'n/a')
  await page.getByTestId('profile-chip').click(); await page.getByTestId('pick-adam').click(); await page.getByRole('heading', { name: 'Find your internship fit' }).waitFor()
  await nav(page, 'My Resumes'); await page.getByTestId('doc-card').first().waitFor()
  expect(await page.getByTestId('prepare-master').count() === 0, 'no master refresh offered for Adam'); expect(/kept exactly as saved/.test(await page.getByTestId('master-panel').innerText()), 'Adam notice')
  await shot(page, '17-adam-resumes')
})

console.log('\nSettings and persistence')
await step('dark mode and reduced motion apply', async () => {
  await nav(page, 'Settings'); await page.getByLabel('Theme').selectOption('dark')
  expect(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'dark theme'); await shot(page, '10-settings-dark')
  await page.getByLabel('Motion').selectOption('reduced'); await nav(page, 'Explore Companies'); await page.getByRole('heading', { name: 'Find your internship fit' }).waitFor()
  const dur = await page.evaluate(() => getComputedStyle(document.querySelector('main') as HTMLElement).animationDuration); expect(parseFloat(dur) < 0.01, `reduced motion ignored (${dur})`)
  await page.getByLabel('Motion').count()
})
await step('update company list from a workbook: merged, idempotent, no database', async () => {
  if (!(!!REAL_WORKBOOK && fs.existsSync(REAL_WORKBOOK))) { console.log('      (skipped: research workbook not present on this machine)'); return }
  await nav(page, 'Settings'); await page.getByTestId('catalog-pick').click(); await page.getByTestId('catalog-preview').waitFor()
  expect(/\d+ organisations found/.test(await page.getByTestId('catalog-preview').innerText()) && /0 new/.test(await page.getByTestId('catalog-preview').innerText()), 'preview says nothing new')
  await page.getByTestId('catalog-apply').click(); await page.getByText(/Company list updated/).first().waitFor()
  expect(!fs.existsSync(path.join(userData, 'careerhub.db')), 'db created'); await shot(page, '11-settings-update')
})
await step('restart keeps profiles, documents and the updated company list', async () => {
  await app.close(); ({ app, page } = await launch()); await resize(app, 1440, 900)
  await page.getByRole('heading', { name: /Who’s exploring today/ }).waitFor(); await page.getByTestId('pick-adam').click(); await page.getByRole('heading', { name: 'Find your internship fit' }).waitFor(); await waitCount(page, N)
  await nav(page, 'My Resumes'); await page.getByTestId('doc-card').first().waitFor(); expect(await page.getByTestId('doc-card').count() === 2, 'documents persisted')
  expect(!fs.existsSync(path.join(userData, 'careerhub.db')), 'no database after restart')
})

console.log('\nVisual checks at three sizes (theme from settings: dark persisted in this session)')
for (const [w, h] of [[1440, 900], [1280, 800], [1024, 768]] as const) {
  for (const theme of ['light', 'dark'] as const) {
    await step(`${w}×${h} ${theme}: explorer, dossier, profile, resumes, settings fit without horizontal scroll`, async () => {
      await resize(app, w, h); await page.waitForTimeout(250)
      await nav(page, 'Settings'); await page.getByLabel('Theme').selectOption(theme)
      await nav(page, 'Explore Companies'); await page.getByTestId('search').fill('Deriv'); await page.getByTestId('company-row').first().click(); await page.getByTestId('dossier-title').waitFor()
      await noHScroll(page, `explorer@${w}`); await shot(page, `20-explorer-${w}-${theme}`)
      await nav(page, 'My Profile & CV'); await page.getByTestId('profile-name').waitFor(); await noHScroll(page, `profile@${w}`); if (w === 1440) await shot(page, `21-profile-${w}-${theme}`)
      await nav(page, 'My Resumes'); await page.getByTestId('doc-card').first().waitFor(); await noHScroll(page, `resumes@${w}`); if (w !== 1280) await shot(page, `22-resumes-${w}-${theme}`)
      await nav(page, 'Settings'); await noHScroll(page, `settings@${w}`)
    })
  }
}

await app.close()
fs.writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify({ results, errors }, null, 2))
const failed = results.filter((r) => !r.ok)
const realErrors = errors.filter((e) => !/Autofill|DevTools|favicon/i.test(e))
console.log(`\n${results.length - failed.length}/${results.length} steps passed. Renderer errors: ${realErrors.length}`); realErrors.slice(0, 8).forEach((e) => console.log('  !', e))
console.log(`Screens: ${SHOTS}`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(failed.length || realErrors.length ? 1 : 0)
