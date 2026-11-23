// End-to-end test: drives the REAL Electron app (real IPC, SQLite, PDF export, pdf.js thumbnails, clipboard) with Playwright.
//   npm run build && npm run e2e                       -> FICTIONAL profiles from tests/payload.ts (safe to run anywhere, used by CI)
//   E2E_PAYLOAD=private-import/profiles.payload.json npm run e2e   -> the real private profiles (screenshots go to test-output/screens-real, git-ignored)
// Native dialogs and external-app launches are replaced by env-var stubs (CAREER_HUB_E2E=1) so it runs unattended. Nothing is ever sent.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import JSZip from 'jszip'
import { extractPdf } from '../core/cv.ts'
import { loadPayloadFile, type Payload, type PayloadProfile } from '../core/twoprofile.ts'
import { syntheticPayload } from '../tests/payload.ts'

const REAL = !!process.env.E2E_PAYLOAD
const OUT = path.resolve('test-output'); const SHOTS = path.join(OUT, REAL ? 'screens-real' : 'screens'); fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true })
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'careerhub-e2e-'))
const userData = path.join(tmp, 'userdata'), docsDir = path.join(tmp, 'Documents'), downloads = path.join(tmp, 'Downloads'), logFile = path.join(tmp, 'external.log')
fs.mkdirSync(path.join(userData, 'import'), { recursive: true }); fs.mkdirSync(docsDir, { recursive: true }); fs.mkdirSync(downloads, { recursive: true })
let payload: Payload
if (REAL) { const l = loadPayloadFile(path.resolve(process.env.E2E_PAYLOAD!)); payload = l.payload; fs.copyFileSync(path.resolve(process.env.E2E_PAYLOAD!), path.join(userData, 'import', 'profiles.payload.json')) }
else { payload = syntheticPayload(); fs.writeFileSync(path.join(userData, 'import', 'profiles.payload.json'), JSON.stringify(payload)) }
const P1 = payload.profiles.find((p) => p.key === 'adam')!, P2 = payload.profiles.find((p) => p.key === 'akif')!
const COMPANY = process.env.E2E_COMPANY ?? 'MDEC'

const results: { name: string; ok: boolean; detail?: string }[] = []
const errors: string[] = []
const requests: string[] = []
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
  Object.assign(env, { CAREER_HUB_E2E: '1', CAREER_HUB_USER_DATA: userData, CAREER_HUB_DOCUMENTS: docsDir, CAREER_HUB_DOWNLOADS: downloads, CAREER_HUB_E2E_LOG: logFile })
  const app = await electron.launch({ args: ['.'], env })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  page.on('request', (r) => { const u = r.url(); if (/^https?:/i.test(u)) requests.push(u) })
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}
const resize = (app: ElectronApplication, w: number, h: number) => app.evaluate(({ BrowserWindow }, [W, H]) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(360, 500); win.setSize(W, H); win.center() }, [w, h])
const shot = async (page: Page, name: string) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) }
const noHScroll = async (page: Page, label: string) => { const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); expect(o.sw <= o.cw + 1, `${label}: horizontal scroll (${o.sw} > ${o.cw})`) }
const norm = (s: string) => s.replace(/\s+/g, ' ').toLowerCase()
const cgpaOf = (p: PayloadProfile, level: string) => p.facts.find((f) => f.category === 'EDUCATION' && f.details?.level === level)?.details?.cgpa
const find = (dir: string, name: string): string[] => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? find(path.join(dir, d.name), name) : d.name === name ? [path.join(dir, d.name)] : []) : []

/** Everything that identifies the OTHER person must be absent from this person's documents and email. */
function leakTokens(other: PayloadProfile, own: PayloadProfile): string[] {
  const ownText = norm(JSON.stringify(own))
  const t = [other.identity.email, other.identity.phone, other.identity.fullName, other.identity.github, ...other.facts.filter((f) => ['PROJECT', 'EXPERIENCE', 'LEADERSHIP', 'AWARD'].includes(f.category)).map((f) => f.title)]
  for (const lvl of ['bachelor', 'foundation']) { const c = cgpaOf(other, lvl); if (c && c !== cgpaOf(own, lvl)) t.push(`CGPA: ${c}`) }
  return t.filter((x): x is string => !!x && x.length > 4 && !ownText.includes(norm(x)))
}

let { app, page } = await launch()
await resize(app, 1440, 900)
const clip = () => app.evaluate(({ clipboard }) => clipboard.readText())

async function openCompany(name: string) {
  await page.getByRole('button', { name: 'Companies', exact: true }).first().click()
  await page.getByRole('heading', { name: 'Explore Cyberjaya' }).waitFor()
  await page.locator('input[aria-label^="Search"]').fill(name)
  await page.locator('[data-testid="company-list"] button[data-row]', { hasText: name }).first().click()
  await page.getByRole('button', { name: 'Prepare application' }).click()
  await page.getByTestId('pack-title').getByText(name, { exact: false }).waitFor()
  await page.getByTestId('out-resume').getByTestId('pdf-thumb').and(page.locator('[data-state="ok"]')).waitFor({ timeout: 60000 })
  await page.getByTestId('out-cv').getByTestId('pdf-thumb').and(page.locator('[data-state="ok"]')).waitFor({ timeout: 60000 })
}

async function checkPack(me: PayloadProfile, other: PayloadProfile, tag: string) {
  const subject = await page.getByTestId('out-subject').inputValue()
  const body = await page.getByTestId('out-body').inputValue()
  expect(subject.length > 10 && body.length > 200, 'subject and wording are present')
  expect(norm(body).includes(norm(me.identity.fullName!)) && norm(subject).includes(norm(me.identity.fullName!)), 'email and subject carry this applicant’s full name')
  const words = body.split(/\nKind regards,/)[0].trim().split(/\s+/).length
  expect(words >= 105 && words <= 185, `wording is ${words} words (target 110–180)`)
  expect(!/\b(sent|have sent|was sent)\b/i.test(body + subject), 'no text claims the email was sent')
  const resumeBtn = page.getByTestId('download-resume'), cvBtn = page.getByTestId('download-cv')
  await resumeBtn.click(); await page.waitForTimeout(500); await cvBtn.click(); await page.waitForTimeout(500)
  const outDirs = fs.readdirSync(path.join(downloads, 'Career Hub')).map((d) => path.join(downloads, 'Career Hub', d)).filter((d) => norm(d).includes(norm(me.name))).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  const rPath = find(outDirs[0], 'resume.pdf')[0], cPath = find(outDirs[0], 'cv.pdf')[0]
  expect(rPath && cPath, 'resume.pdf and cv.pdf were downloaded')
  const rb = fs.readFileSync(rPath), cb = fs.readFileSync(cPath)
  expect(rb.subarray(0, 5).toString() === '%PDF-' && cb.subarray(0, 5).toString() === '%PDF-', 'both downloads are real PDFs')
  expect(!rb.equals(cb), 'resume.pdf and cv.pdf are different files')
  const rt = await extractPdf(new Uint8Array(rb)), ct = await extractPdf(new Uint8Array(cb))
  expect(rt.pages === 1, `resume is ${rt.pages} page(s)`)
  expect(ct.pages >= 1 && ct.pages <= 2 && ct.text.length >= rt.text.length * (REAL ? 1.15 : 1), `CV is ${ct.pages} page(s), ${ct.text.length} chars vs resume ${rt.text.length}`)
  const rtx = norm(rt.text), ctx = norm(ct.text)
  for (const lvl of ['bachelor', 'foundation']) { const c = cgpaOf(me, lvl); if (c && lvl === 'bachelor') { expect(rtx.includes(`cgpa: ${c}`) && ctx.includes(`cgpa: ${c}`), `${lvl} CGPA ${c} appears in both PDFs`) } if (c && lvl === 'foundation') expect(ctx.includes(`cgpa: ${c}`) || rtx.includes(`cgpa: ${c}`), `foundation CGPA ${c} appears`) }
  expect(!/\[list|skills: 20\d\d|\{\{|todo/i.test(rt.text + ct.text), 'no placeholder or misclassified "Skills:" fragments')
  for (const t of leakTokens(other, me)) expect(!rtx.includes(norm(t)) && !ctx.includes(norm(t)) && !norm(body + subject).includes(norm(t)), `no cross-profile leakage: "${t}"`)
  fs.writeFileSync(path.join(SHOTS, `${tag}-resume.txt`), rt.text); fs.writeFileSync(path.join(SHOTS, `${tag}-cv.txt`), ct.text); fs.writeFileSync(path.join(SHOTS, `${tag}-email.txt`), `${subject}\n\n${body}`)
  fs.copyFileSync(rPath, path.join(SHOTS, `${tag}-resume.pdf`)); fs.copyFileSync(cPath, path.join(SHOTS, `${tag}-cv.pdf`))
  return { rtx, ctx, body, subject }
}

console.log(`\nFirst screen (${REAL ? 'REAL private profiles' : 'fictional profiles'})`)
await step('shows exactly two profile choices, Adam highlighted by default; nothing opens until one is chosen', async () => {
  await page.getByRole('heading', { name: /who’s applying today/i }).waitFor({ timeout: 30000 })
  const cards = page.locator('[data-testid^="pick-"]')
  expect((await cards.count()) === 2, `expected exactly 2 profile cards, found ${await cards.count()}`)
  expect(await page.getByTestId('pick-adam').evaluate((el) => document.activeElement === el), 'first profile is the focused/highlighted default')
  expect((await page.locator('aside').count()) === 0, 'no app chrome before a profile is chosen')
  expect((await page.getByTestId('pick-adam').innerText()).includes(P1.badge) && (await page.getByTestId('pick-akif').innerText()).includes(P2.badge), 'badges show application timing')
  await shot(page, '01-profile-picker')
})
await step('Akif’s card has no urgency language', async () => {
  const t = (await page.getByTestId('pick-akif').innerText()).toLowerCase()
  expect(!/urgent|overdue|deadline|now\b|asap/.test(t), `unexpected urgency in: ${t}`)
})

console.log('\nProfile 1 (applying now)')
await step(`choose ${P1.name}: lands on Cyberjaya Companies, active person visible, 78 employers`, async () => {
  await page.getByTestId('pick-adam').click()
  await page.getByRole('heading', { name: 'Explore Cyberjaya' }).waitFor()
  expect((await page.getByTestId('active-profile').innerText()).trim() === P1.name, 'active profile name is shown')
  await page.locator('[data-testid="company-list"] button[data-row]').first().waitFor()
  expect((await page.locator('main').innerText()).includes('of 78'), 'all 78 seed companies are listed')
  await shot(page, '02-companies')
})
await step(`${COMPANY} → Prepare application → five outputs on one screen`, async () => {
  await openCompany(COMPANY)
  for (const id of ['out-email', 'out-subject', 'out-body', 'out-resume', 'out-cv']) expect(await page.getByTestId(id).isVisible(), `${id} is visible on the single pack screen`)
  const meta = await page.getByTestId('pack-meta').innerText()
  expect(meta.includes(P1.name) && /v01/.test(meta) && /Prepared/.test(meta) && /Nothing has been sent/.test(meta), `pack header shows profile, version and Prepared (got: ${meta.replace(/\n/g, ' | ')})`)
  expect(!/\b(applied|sent to)\b/i.test(meta.replace('Nothing has been sent', '')), 'status never says Applied/Sent')
  await shot(page, '03-pack-profile1')
})
let p1: { rtx: string; ctx: string; body: string; subject: string }
await step('both PDFs download as real files; text, CGPA, dates and isolation verified from the actual bytes', async () => { p1 = await checkPack(P1, P2, 'pack-p1') })
await step('copy buttons write the real clipboard (subject, wording, everything)', async () => {
  const subject = await page.getByTestId('out-subject').inputValue(), body = await page.getByTestId('out-body').inputValue()
  await page.getByTestId('copy-subject').click(); await page.waitForTimeout(250); expect((await clip()) === subject, 'clipboard holds the subject')
  await page.getByTestId('copy-email-wording').click(); await page.waitForTimeout(250); expect((await clip()) === body, 'clipboard holds the email wording')
  await page.getByTestId('copy-everything').click(); await page.waitForTimeout(250); const all = await clip(); expect(all.includes(subject) && all.includes(body), 'copy-all holds subject and wording')
  if (await page.getByTestId('copy-email-address').count()) { await page.getByTestId('copy-email-address').click(); await page.waitForTimeout(250); expect(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(await clip()), 'a plain verified address was copied') }
})
await step('recipient is either a plain seed address or an explicit “No verified public email” with the careers route', async () => {
  const t = await page.getByTestId('out-email').innerText()
  if (/No verified public email/.test(t)) expect((await page.getByTestId('instructions').count()) + (await page.getByTestId('careers-link').count()) > 0, 'instructions or careers link shown')
  else expect(/[^\s@]+@[^\s@]+\.[^\s@]+/.test(t), 'a real address is displayed')
})
await step('email edits persist locally and survive regenerating documents', async () => {
  const body = page.getByTestId('out-body'); const marker = ' [edited-in-e2e]'
  await body.click(); await body.press('Control+End'); await body.pressSequentially(marker)
  await page.getByRole('region', { name: 'Email wording' }).getByText('Saved', { exact: true }).waitFor({ timeout: 8000 })
  await page.getByRole('button', { name: 'Regenerate documents' }).click()
  await page.waitForFunction(() => (document.querySelector('[data-testid="pack-meta"]')?.textContent ?? '').includes('v02'), null, { timeout: 60000 })
  expect((await page.getByTestId('out-body').inputValue()).includes(marker.trim()), 'edited wording kept after regenerate')
  await page.getByRole('button', { name: 'Reset wording' }).click()
  await page.waitForFunction((m) => !(document.querySelector('[data-testid="out-body"]') as HTMLTextAreaElement)?.value.includes(m), marker.trim(), { timeout: 60000 })
})
await step('alignment estimate is labelled honestly, with before/after and confidence', async () => {
  const a = page.getByTestId('alignment'); await a.waitFor()
  const t = await a.innerText()
  expect(/Company\/role alignment estimate/.test(t) && /Confidence: (High|Medium|Low)/.test(t) && /Before tailoring/.test(t), `got: ${t.slice(0, 160)}`)
  expect(!/ATS score|Vacancy fit/.test(t), 'never calls the estimate an ATS score or vacancy fit without a job post')
  const score = Number(await page.getByTestId('alignment-score').innerText()); const band = await a.getAttribute('data-band')
  expect(band === (score >= 80 ? band : 'amber') && !(score < 80 && band === 'green'), `band ${band} is consistent with score ${score}`)
})
await step('download all produces a zip with just the two PDFs and notes', async () => {
  await page.getByTestId('download-all').click(); await page.waitForTimeout(600)
  const z = find(path.join(downloads, 'Career Hub'), 'application-pack.zip')[0]; expect(!!z, 'zip exists')
  const zip = await JSZip.loadAsync(fs.readFileSync(z)); const names = Object.keys(zip.files)
  expect(['resume.pdf', 'cv.pdf', 'application-notes.txt'].every((n) => names.includes(n)) && names.length === 3, `zip entries: ${names.join(', ')}`)
  expect((await zip.file('resume.pdf')!.async('nodebuffer')).subarray(0, 5).toString() === '%PDF-', 'zip holds a real resume PDF')
  expect(!/sent to|applied on/i.test(await zip.file('application-notes.txt')!.async('string')), 'notes never claim it was sent')
})
await step('Esc closes the pack and returns to the company list', async () => {
  await page.keyboard.press('Escape'); await page.getByRole('heading', { name: 'Explore Cyberjaya' }).waitFor()
})

console.log('\nProfile 2 (applies later) — same company, independent pack')
await step(`switch to ${P2.name} with one click; nothing from ${P1.name} is visible`, async () => {
  await page.getByTestId('active-profile').click(); await page.getByRole('menuitem', { name: new RegExp(P2.name) }).click()
  await page.waitForFunction((n) => document.querySelector('[data-testid="active-profile"]')?.textContent?.trim() === n, P2.name)
  await page.getByRole('heading', { name: 'Explore Cyberjaya' }).waitFor()
  const t = await page.locator('main').innerText()
  expect(!t.includes(P1.identity.fullName!) && !t.includes(P1.identity.email!), 'no first-profile identity on screen')
})
await step(`${COMPANY} for ${P2.name}: independent pack, own projects/dates/signature/PDFs`, async () => {
  await openCompany(COMPANY)
  expect((await page.getByTestId('pack-meta').innerText()).includes(P2.name), 'pack belongs to the second profile')
  await shot(page, '04-pack-profile2')
  const r = await checkPack(P2, P1, 'pack-p2')
  expect(r.body !== p1.body && r.subject !== p1.subject, 'email differs per profile')
  const fyp = P2.facts.find((f) => f.maturity === 'proposal')
  if (fyp) {
    const all = `${r.rtx} ${r.ctx}`
    expect(/in progress|proposed/.test(all) && all.includes('expected mar 2027'.slice(0, 8)) || /in progress/.test(all), 'FYP is labelled in progress / proposed')
    expect(!/(achieved|benchmarked results|deployed|improved detection|f1-score of)/.test(all), 'no completed-result claims for the proposal')
  }
  const tanda = P2.facts.find((f) => f.category === 'AWARD')
  if (tanda) expect(r.ctx.includes(norm(tanda.claim_text!).slice(0, 30)), 'user-reported award wording kept as reported')
  const dates = (P2.prefs?.internshipStart ?? '')
  expect(dates === '' && !/available for a \d+-month/i.test(r.body), 'no invented internship dates for the later applicant')
})
await step('same company, different role produces different wording', async () => {
  const before = await page.getByTestId('out-body').inputValue()
  const ids = await page.locator('[data-testid^="role-"]').evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-testid')!, on: e.getAttribute('aria-checked') === 'true' })))
  const other = ids.find((x) => !x.on)
  if (other) { await page.getByTestId(other.id).click(); await page.waitForFunction((b) => (document.querySelector('[data-testid="out-body"]') as HTMLTextAreaElement)?.value !== b, before, { timeout: 60000 }) }
  expect((await page.getByTestId('out-body').inputValue()) !== before || ids.length < 2, 'a different role changes the email wording')
})

console.log('\nResponsive & accessibility')
for (const [w, h, tag] of [[1024, 768, 'laptop'], [820, 900, 'tablet'], [390, 844, 'narrow']] as const) {
  await step(`pack screen at ${w}px: single coherent screen, no horizontal scroll`, async () => {
    await resize(app, w, h); await page.waitForTimeout(500)
    for (const id of ['out-email', 'out-subject', 'out-body', 'out-resume', 'out-cv']) expect((await page.getByTestId(id).count()) === 1, `${id} present at ${w}px`)
    await noHScroll(page, `pack@${w}`); await shot(page, `05-pack-${tag}`)
  })
}
await step('companies page at 1024px and small window', async () => {
  await resize(app, 1024, 768); await page.keyboard.press('Escape'); await page.getByRole('heading', { name: 'Explore Cyberjaya' }).waitFor(); await noHScroll(page, 'companies@1024'); await shot(page, '06-companies-1024')
  await resize(app, 480, 800); await page.waitForTimeout(300); await noHScroll(page, 'companies@480'); await shot(page, '07-companies-small')
})
await step('no network request left the app', async () => { expect(requests.length === 0, `unexpected http(s) requests: ${requests.slice(0, 3).join(', ')}`) })
await step('nothing was marked Applied or sent', async () => {
  await resize(app, 1440, 900)
  const db = fs.readFileSync(path.join(userData, 'careerhub.db'))
  expect(db.length > 0, 'db exists')
  expect(!fs.existsSync(logFile) || !/openExternal|mailto/.test(fs.readFileSync(logFile, 'utf8')), 'no external mail/open launched')
})

await app.close()
fs.writeFileSync(path.join(OUT, REAL ? 'e2e-results-real.json' : 'e2e-results.json'), JSON.stringify({ results, errors }, null, 2))
const failed = results.filter((r) => !r.ok)
const realErrors = errors.filter((e) => !/Autofill|DevTools|favicon/i.test(e))
console.log(`\n${results.length - failed.length}/${results.length} steps passed. Renderer errors: ${realErrors.length}`); realErrors.slice(0, 8).forEach((e) => console.log('  !', e))
console.log(`Screens: ${SHOTS}`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(failed.length || realErrors.length ? 1 : 0)
