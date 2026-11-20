import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import JSZip from 'jszip'
import { openDb } from '../core/db.ts'
import { createApi, type Env } from '../core/api.ts'

export const SEED = path.resolve('data/cyberjaya-seed.tsv')

/** FICTIONAL test identity. Used only in tests — never shipped as app data. */
export const FIXTURE_CV_LINES = [
  'Alex Tester',
  'Cyberjaya, Selangor, Malaysia | alex.tester@example.com | +60 12-345 6789',
  'github.com/alextester-fixture | linkedin.com/in/alextester-fixture',
  '',
  'Education',
  'Universiti Fixture Malaysia',
  'Bachelor of Computer Science (Hons), Cybersecurity    2023 - 2027',
  'CGPA: 3.62/4.00',
  '',
  'Technical Skills',
  'Languages: Python, Java, SQL, JavaScript',
  'Security Tools: Wireshark, Nmap, Burp Suite, Linux',
  'Web: React, FastAPI',
  '',
  'Projects',
  'Network Traffic Anomaly Detector | Final Year Project    Jan 2025 - Present',
  '- Built a packet-capture pipeline in Python and Wireshark to flag unusual traffic patterns.',
  '- Trained a Scikit-learn model on 12,000 labelled flows and compared two feature sets.',
  'Campus Vulnerability Scanner | Personal Project    Jun 2024 - Aug 2024',
  '- Wrote an Nmap-based scanner with a FastAPI backend and React dashboard.',
  '- Documented findings against the OWASP Top 10.',
  '',
  'Experience',
  'IT Support Intern | Fixture Sdn Bhd    Jun 2024 - Aug 2024',
  '- Resolved Windows and Linux support tickets for 40 staff.',
  '',
  'Leadership',
  'Treasurer | Computer Science Society    2024 - 2025',
  '- Managed the society budget and organised two security workshops.',
  '',
  'Certifications',
  'CompTIA Security+ (in progress)',
  '',
  'Languages',
  'English, Bahasa Malaysia',
]

export async function makeCvPdf(file: string, lines = FIXTURE_CV_LINES): Promise<string> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<void>((r) => doc.on('end', () => r()))
  for (const l of lines) {
    if (l === '') { doc.moveDown(0.4); continue }
    const head = /^(Education|Technical Skills|Projects|Experience|Leadership|Certifications|Languages)$/.test(l)
    doc.font(head || l === lines[0] ? 'Helvetica-Bold' : 'Helvetica').fontSize(head ? 12 : 10).text(l.replace(/^- /, '• ').replace(/ - /g, ' – '), { link: /^github|^linkedin/.test(l) ? undefined : undefined })
  }
  doc.end(); await done
  fs.writeFileSync(file, Buffer.concat(chunks)); return file
}

export async function makeCvDocx(file: string, lines = FIXTURE_CV_LINES) {
  const d = new Document({ sections: [{ children: lines.map((l) => new Paragraph({ children: [new TextRun(l.replace(/^- /, '• '))] })) }] })
  fs.writeFileSync(file, Buffer.from(await Packer.toBuffer(d))); return file
}

/** Minimal real .xlsx (zip of XML parts, inline strings) built from the TSV seed, to exercise the xlsx importer. */
export async function makeXlsxFromTsv(tsv: string, file: string) {
  const { parseDelimited } = await import('../core/companies.ts')
  const rows = parseDelimited(tsv)
  const col = (i: number) => String.fromCharCode(65 + i)
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, ri) =>
    `<row r="${ri + 1}">${r.map((c, ci) => `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(c)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`
  const z = new JSZip()
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`)
  z.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  z.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Companies" sheetId="1" r:id="rId1"/></sheets></workbook>`)
  z.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)
  z.file('xl/worksheets/sheet1.xml', sheet)
  fs.writeFileSync(file, await z.generateAsync({ type: 'nodebuffer' })); return file
}

export interface TestEnv { env: Env; api: ReturnType<typeof createApi>; dir: string; dbFile: string; calls: { opened: string[]; revealed: string[]; external: string[] }; cleanup(): void }

export async function makeEnv(opts: { fetchImpl?: typeof fetch; seed?: boolean } = {}): Promise<TestEnv> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'careerhub-test-'))
  const dbFile = path.join(dir, 'careerhub.db')
  const db = openDb(dbFile)
  const calls = { opened: [] as string[], revealed: [] as string[], external: [] as string[] }
  const keys = new Map<string, string>()
  const env: Env = {
    db, userDataDir: dir, seedFile: SEED, fetchImpl: opts.fetchImpl,
    secrets: { get: (p) => keys.get(p) ?? null, set: (p, v) => { v === null ? keys.delete(p) : keys.set(p, v) }, available: () => true },
    ui: { pickFolder: async () => null, pickFile: async () => null, openPath: async (p) => { calls.opened.push(p); return '' }, showItem: (p) => { calls.revealed.push(p) }, openExternal: (u) => { calls.external.push(u) }, documentsPath: () => path.join(dir, 'Documents') },
    now: () => new Date('2026-11-20T09:00:00Z'),
  }
  const api = createApi(env)
  if (opts.seed !== false) await api.helpers.ensureSeed()
  return { env, api, dir, dbFile, calls, cleanup: () => { try { (db as any).close() } catch {} try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* Windows may hold the WAL briefly; temp dir is disposable */ } } }
}

/** Creates a profile with the fixture CV imported & confirmed, roles set and a storage root. */
export async function onboard(t: TestEnv, name = 'Alex Tester', roles = ['cyber'], opts: { confirm?: boolean; root?: boolean } = {}) {
  const { h } = t.api
  const p: any = await h['profile.create']({ name })
  await h['profile.update']({ roles, primary_role: roles[0], career_types: ['INTERNSHIP'], prefs: { internshipStart: 'March 2027', internshipEnd: 'August 2027', durationWeeks: 24, citizenship: 'malaysian', university: 'Universiti Fixture Malaysia' } })
  if (opts.root !== false) await h['folder.set']({ path: path.join(t.dir, `root-${p.profile_id}`) })
  const cv = await makeCvPdf(path.join(t.dir, `cv-${p.profile_id}.pdf`))
  const imp = await h['cv.import']({ path: cv })
  if (opts.confirm !== false) await h['facts.confirm']({})
  return { profile: p, import: imp }
}

export const JD_CYBER = `Cybersecurity Analyst Intern at Fixture Corp
Location: Cyberjaya (hybrid)
Duration: 4-6 months
Allowance: RM1,500 per month

Responsibilities:
- Monitor alerts and assist the SOC team
- Perform vulnerability scans

Requirements:
- Currently pursuing a Bachelor's degree in Computer Science or related field
- Knowledge of Python and Linux
- Familiar with Wireshark and Nmap
- Understanding of the OWASP Top 10

Preferred:
- Experience with Splunk or SIEM tools
- Kubernetes exposure
`

export const JD_NO_PAY = `Backend Developer Intern at Fixture Corp
Location: Cyberjaya
Requirements:
- Python, FastAPI and SQL
- Git
`
