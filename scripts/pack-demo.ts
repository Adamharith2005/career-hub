/**
 * Developer QA: imports a payload into a THROWAWAY database, prepares application packs through the real API and prints the results.
 *   node scripts/pack-demo.ts <payload.json> <profileKey> <company name> <roleFamily> <role title> [outDir]
 * Nothing is sent anywhere; files go to outDir (default: test-output/pack-demo).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDb } from '../core/db.ts'
import { createApi } from '../core/api.ts'
import { importPayload, loadPayloadFile } from '../core/twoprofile.ts'
import { extractPdf } from '../core/cv.ts'

const [payloadFile, key, companyName, family, title, outArg] = process.argv.slice(2)
const out = path.resolve(outArg ?? 'test-output/pack-demo'); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true })
const db = openDb(path.join(out, 'demo.db'))
const { payload, dir } = loadPayloadFile(path.resolve(payloadFile))
importPayload(db, payload, { payloadDir: dir, defaultStorageRoot: path.join(out, 'Career Hub') })
const api = createApi({ db, userDataDir: out, seedFile: path.resolve('data/cyberjaya-seed.tsv'), secrets: { get: () => null, set() {}, available: () => false },
  ui: { pickFolder: async () => null, pickFile: async () => null, openPath: async () => '', showItem() {}, openExternal() {}, documentsPath: () => out, downloadsPath: () => path.join(out, 'Downloads'), copyText() {} } })
await api.helpers.ensureSeed()
const profiles = (await api.call('boot')).profiles
const pr = profiles.find((p: any) => p.stable_key === key)!
await api.call('profile.switch', { id: pr.profile_id })
const cos = await api.call('companies.list', {})
const co = cos.find((c: any) => c.name.toLowerCase().includes(companyName.toLowerCase()))
if (!co) throw new Error('company not found')
const r = await api.call('pack.prepare', { companyId: co.company_id, roleFamily: family, title })
if (!r.ok) { console.log('BLOCKED', JSON.stringify(r.issues, null, 2)); process.exit(1) }
console.log(JSON.stringify({ app: r.app, recipient: r.recipient?.label, to: r.email.to, subject: r.email.subject, words: r.email.words, alignment: { label: r.alignment.label, pre: r.alignment.pre, post: r.alignment.post, band: r.alignment.band, conf: r.alignment.confidence }, lint: r.lint, needs: r.needs.map((n: any) => n.title), qa: { resume: [r.docs.resume.pages, r.docs.resume.qaPassed], cv: [r.docs.cv.pages, r.docs.cv.qaPassed] } }, null, 1))
console.log('\n----- EMAIL BODY -----\n' + r.email.body)
for (const [k, d] of Object.entries(r.docs) as any) {
  const ex = await extractPdf(new Uint8Array(fs.readFileSync(d.pdf_path)))
  fs.copyFileSync(d.pdf_path, path.join(out, `${k}.pdf`)); fs.writeFileSync(path.join(out, `${k}.txt`), ex.text)
  console.log(`\n===== ${k}.pdf: ${ex.pages} page(s), ${ex.text.length} chars, links: ${ex.links.join(' ')}`)
  console.log(d.qa.checks.filter((c: any) => c.status !== 'pass').map((c: any) => `${c.status.toUpperCase()}: ${c.label} — ${c.detail}`).join('\n') || 'all QA checks pass')
}
