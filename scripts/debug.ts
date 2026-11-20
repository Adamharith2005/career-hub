// Ad-hoc inspector: launches the built app on a throwaway profile, seeds it through the real API, evaluates layout facts.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'careerhub-debug-'))
const env: Record<string, string> = {}
for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v
Object.assign(env, { CAREER_HUB_E2E: '1', CAREER_HUB_USER_DATA: path.join(tmp, 'ud') })
const app = await electron.launch({ args: ['.'], env })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
const call = (n: string, a?: unknown) => page.evaluate(([n, a]) => (window as any).careerHub.call(n, a), [n, a] as const)
await call('profile.create', { name: 'Debug User' })
await call('profile.update', { roles: ['swe'], career_types: ['INTERNSHIP'], onboarding_done: true })
const id = await call('app.create', { company: 'Fixture Corp', title: 'Software Intern', jobText: 'Software Intern\nRequirements:\n- Python and SQL\nLocation: Cyberjaya' })
await page.reload(); await page.getByRole('button', { name: 'Applications', exact: true }).click()
await page.getByText('Fixture Corp').first().click()
await page.waitForSelector('[data-testid="app-title"]')
console.log(JSON.stringify(await page.evaluate(() => {
  const s = document.querySelector('select[aria-label="Change status"]') as HTMLSelectElement
  const cs = getComputedStyle(s)
  return { className: s.className, width: cs.width, display: cs.display, flex: cs.flex, parentW: s.parentElement!.getBoundingClientRect().width, parentClass: s.parentElement!.className }
}), null, 2))
await app.close(); fs.rmSync(tmp, { recursive: true, force: true }); void id
